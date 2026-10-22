import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { appDataDir, claudeDesktopDir, codexHome, getDataDir, homeDir, isDemoMode, localAppDataDir, secondaryMacHome } from './paths';
import { archiveActivityMessages } from './agentArchiveDb';
import { summarizeActivity } from './desktopHandoff/activity';

/** One Claude Desktop run of a scheduled task, joined with the archived transcript when it exists. */
export type ScheduledRun = { desktopId: string; nativeId: string; account: string; title: string; at: string; outcome: string | null; outcomeAt: string | null };

export type ScheduledTask = {
  id: string;
  source: 'codex' | 'claude' | 'antigravity';
  platform: 'windows' | 'macos';
  account: string;
  name: string;
  schedule: string;
  enabled: boolean;
  prompt: string;
  workingDirectory?: string;
  lastRunAt?: string;
  runs?: ScheduledRun[];
};

type ClaudeTask = {
  id: string;
  displayName?: string;
  cronExpression?: string;
  enabled?: boolean;
  filePath?: string;
  cwd?: string;
  approvedPermissions?: unknown[];
  createdAt?: string;
  lastRunAt?: string;
  lastScheduledFor?: string;
  notifySessionId?: string;
  [key: string]: unknown;
};

type ClaudeScheduleFile = { scheduledTasks: ClaudeTask[]; [key: string]: unknown };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DemoModeError extends Error {
  constructor(action: string) { super(`Demo mode: ${action} is disabled. Nothing on this machine was changed.`); }
}

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch { return null; }
}

async function directories(dir: string): Promise<string[]> {
  try { return (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}

function tomlString(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*')\\s*$`, 'm'));
  if (!match) return '';
  if (match[1].startsWith("'")) return match[1].slice(1, -1);
  try { return JSON.parse(match[1]) as string; }
  catch { return match[1].slice(1, -1); }
}

async function readCodexTasks(home: string, platform: ScheduledTask['platform']): Promise<ScheduledTask[]> {
  const root = home === homeDir() ? path.join(codexHome(), 'automations') : path.join(home, '.codex', 'automations');
  const result: ScheduledTask[] = [];
  for (const name of await directories(root)) {
    try {
      const text = await fs.readFile(path.join(root, name, 'automation.toml'), 'utf8');
      result.push({
        id: tomlString(text, 'id') || name,
        source: 'codex', platform, account: 'local', name: tomlString(text, 'name') || name,
        schedule: tomlString(text, 'rrule'), enabled: tomlString(text, 'status') === 'ACTIVE',
        prompt: tomlString(text, 'prompt'),
      });
    } catch { /* Incomplete automation; omit. */ }
  }
  return result;
}

async function readClaudePrompt(id: string, home = homeDir()): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return '';
  const file = path.join(home, '.claude', 'scheduled-tasks', id, 'SKILL.md');
  try {
    const text = await fs.readFile(file, 'utf8');
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  } catch { return ''; }
}

async function hasClaudeSessions(directory: string): Promise<boolean> {
  const names = await fs.readdir(directory).catch(() => [] as string[]);
  for (const name of names.filter(name => /^local_[\w-]+\.json$/.test(name))) {
    const session = await readJson<{cliSessionId?: unknown}>(path.join(directory, name));
    if (typeof session?.cliSessionId === 'string') return true;
  }
  return false;
}

async function readClaudeTasks(home: string, platform: ScheduledTask['platform']): Promise<ScheduledTask[]> {
  const root = home === homeDir() ? path.join(claudeDesktopDir(), 'claude-code-sessions')
    : platform === 'macos' ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
      : path.join(home, 'AppData', 'Roaming', 'Claude', 'claude-code-sessions');
  const result: ScheduledTask[] = [];
  const folders: Array<{ account: string; organization: string; directory: string }> = [];
  for (const account of await directories(root)) {
    if (!uuidPattern.test(account)) continue;
    for (const organization of await directories(path.join(root, account))) {
      if (!uuidPattern.test(organization)) continue;
      const directory = path.join(root, account, organization);
      if (await hasClaudeSessions(directory)) folders.push({ account, organization, directory });
    }
  }
  // Run history follows the task id across accounts, so it survives an account switch.
  const runs = await readClaudeRuns(folders.map(folder => folder.directory));
  for (const { account, organization, directory } of folders) {
    {
      const file = await readJson<ClaudeScheduleFile>(path.join(directory, 'scheduled-tasks.json'));
      for (const task of file?.scheduledTasks || []) {
        if (!task.id || !/^[a-zA-Z0-9_-]+$/.test(task.id)) continue;
        result.push({
          id: task.id, source: 'claude', platform, account: `${account}/${organization}`,
          name: task.displayName || task.id, schedule: task.cronExpression || (typeof task.fireAt === 'number' ? new Date(task.fireAt).toISOString() : ''),
          enabled: task.enabled === true, prompt: await readClaudePrompt(task.id, home),
          workingDirectory: task.cwd,
          lastRunAt: typeof task.lastRunAt === 'string' ? task.lastRunAt : runs.get(task.id)?.[0]?.at,
          runs: runs.get(task.id) ?? [],
        });
      }
    }
  }
  return result;
}

/**
 * Claude Desktop records every scheduled run as a local Code session whose metadata carries the task id.
 * The outcome is the last real assistant reply in the archive, so a run that "succeeded" without doing
 * anything is visible as such.
 */
async function readClaudeRuns(folders: string[], limit = 10): Promise<Map<string, ScheduledRun[]>> {
  const runs = new Map<string, ScheduledRun[]>();
  const files = (await Promise.all(folders.map(async directory => (await fs.readdir(directory).catch(() => [] as string[]))
    .filter(name => /^local_[\w-]+\.json$/.test(name)).map(name => path.join(directory, name))))).flat();
  for (const file of files) {
    const name = path.basename(file);
    const session = await readJson<{ sessionId?: unknown; cliSessionId?: unknown; title?: unknown; scheduledTaskId?: unknown; createdAt?: unknown }>(file);
    if (!session || typeof session.scheduledTaskId !== 'string' || typeof session.cliSessionId !== 'string') continue;
    const created = typeof session.createdAt === 'number' || typeof session.createdAt === 'string' ? new Date(session.createdAt) : null;
    const at = created && Number.isFinite(created.valueOf()) ? created.toISOString() : (await fs.stat(file)).mtime.toISOString();
    let outcome: string | null = null, outcomeAt: string | null = null;
    try {
      const summary = summarizeActivity(archiveActivityMessages(session.cliSessionId));
      outcome = summary.lastAssistant?.text ?? null; outcomeAt = summary.lastAssistant?.at ?? null;
    } catch { /* The archive may not have synced this run yet. */ }
    const list = runs.get(session.scheduledTaskId) ?? [];
    list.push({ desktopId: String(session.sessionId ?? name), nativeId: session.cliSessionId, account: `${path.basename(path.dirname(path.dirname(file)))}/${path.basename(path.dirname(file))}`, title: typeof session.title === 'string' ? session.title : '', at, outcome, outcomeAt });
    runs.set(session.scheduledTaskId, list);
  }
  for (const [id, list] of runs) runs.set(id, list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit));
  return runs;
}

async function readAntigravityTasks(home: string, platform: ScheduledTask['platform']): Promise<ScheduledTask[]> {
  const root = path.join(home, '.gemini', 'config', 'sidecars');
  const config = await readJson<{ sidecars?: Record<string, { enabled?: boolean }> }>(path.join(home, '.gemini', 'config', 'config.json'));
  const result: ScheduledTask[] = [];
  for (const id of await directories(root)) {
    const sidecar = await readJson<Record<string, unknown>>(path.join(root, id, 'sidecar.json'));
    if (!sidecar || sidecar.builtin !== 'schedule' || !Array.isArray(sidecar.args)) continue;
    result.push({
      id, source: 'antigravity', platform, account: 'local',
      name: typeof sidecar.display_name === 'string' ? sidecar.display_name : id,
      schedule: String(sidecar.args[0] || ''), enabled: config?.sidecars?.[id]?.enabled === true,
      prompt: sidecar.args.slice(1).map(String).join(' '),
    });
  }
  return result;
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const platform = process.platform === 'darwin' ? 'macos' : 'windows';
  const homes: Array<{ home: string; platform: ScheduledTask['platform'] }> = [{ home: homeDir(), platform }];
  const macHome = secondaryMacHome();
  if (macHome) homes.push({ home: macHome, platform: 'macos' });
  const groups = await Promise.all(homes.flatMap(({ home, platform }) => [
    readCodexTasks(home, platform), readClaudeTasks(home, platform), readAntigravityTasks(home, platform),
  ]));
  return groups.flat().sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
}

let codexTransfer: Promise<unknown> = Promise.resolve();

export function copyClaudeTasksToCodex(ids?: string[]): Promise<unknown> {
  const operation = codexTransfer.catch(() => {}).then(async () => {
    const account = await getActiveClaudeAccount();
    if (!account) throw new Error('No active Claude Desktop account');
    const platform = process.platform === 'darwin' ? 'macos' : 'windows';
    const source = (await readClaudeTasks(homeDir(), platform)).filter(task => task.account === account);
    if (ids && (!ids.length || ids.some(id => typeof id !== 'string' || !source.some(task => task.id === id)))) throw new Error('Unknown source task');
    const selected = source.filter(task => ids ? ids.includes(task.id) : task.enabled);
    if (!selected.length) throw new Error('No scheduled Claude tasks selected');
    const { copyClaudeSchedules } = await import('./codexScheduleTransfer.mjs');
    return copyClaudeSchedules(selected, { home: homeDir(), codexHome: codexHome() });
  });
  codexTransfer = operation;
  return operation;
}

// Claude Desktop's own account (config.json lastKnownAccountUuid), not the Claude Code CLI login in
// ~/.claude.json: the two can differ, and only the Desktop account owns the scheduled tasks.
function claudeDataDir(): string {
  return claudeDesktopDir();
}

export async function getActiveClaudeAccount(): Promise<string | null> {
  const accountId = (await readJson<{ lastKnownAccountUuid?: string }>(path.join(claudeDataDir(), 'config.json')))?.lastKnownAccountUuid;
  if (!accountId || !uuidPattern.test(accountId)) return null;
  const accountDir = path.join(claudeDataDir(), 'claude-code-sessions', accountId);
  let best: { org: string; at: number } | null = null;
  for (const org of await directories(accountDir)) {
    if (!uuidPattern.test(org) || !await hasClaudeSessions(path.join(accountDir, org))) continue;
    const names = await fs.readdir(path.join(accountDir, org)).catch(() => [] as string[]);
    for (const name of names.filter(n => n.startsWith('local_') || n === 'scheduled-tasks.json')) {
      const at = (await fs.stat(path.join(accountDir, org, name)).catch(() => null))?.mtimeMs ?? 0;
      if (!best || at > best.at) best = { org, at };
    }
  }
  if (best) return `${accountId}/${best.org}`;
  // A freshly signed-in account has no Code session yet; its org is known from the skills cache layout.
  const skillsRoot = path.join(claudeDataDir(), 'local-agent-mode-sessions', 'skills-plugin');
  for (const org of await directories(skillsRoot)) {
    if (uuidPattern.test(org) && (await directories(path.join(skillsRoot, org))).includes(accountId)) return `${accountId}/${org}`;
  }
  return null;
}

// Single source of truth for task definitions: <data dir>/schedules and scripts/claude-task-sync.mjs
// (writes schema-valid records; never edits the live account while Claude Desktop runs).
function taskRoot(): string { return path.join(getDataDir(), 'schedules'); }
function repositoryScript(name: string): string { return path.resolve(process.cwd(), '..', 'scripts', name); }

/** Child scripts see the same home, data folder and demo flag as the server. */
function scriptEnvironment(): NodeJS.ProcessEnv {
  const home = homeDir();
  return { ...process.env, HOME: home, USERPROFILE: home, APPDATA: appDataDir(), LOCALAPPDATA: localAppDataDir(),
    SWITCHYARD_DATA_DIR: getDataDir(), SWITCHYARD_SCHEDULES_DIR: taskRoot() };
}

export type ClaudeSyncAccount = { key: string; live: boolean; sessions: number; valid: boolean | string; problems: string[]; missing: string[]; notEnabled: string[] };
export type ClaudeSyncStatus = { exportedFrom?: string | null; platform: string; claudeRunning: boolean; liveAccount: string | null; manifestTasks: string[]; accounts: ClaudeSyncAccount[] };

async function runSync(args: string[]): Promise<unknown> {
  const script = repositoryScript('claude-task-sync.mjs');
  await fs.mkdir(taskRoot(), { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, ...args], { cwd: taskRoot(), timeout: 120_000, windowsHide: true, env: scriptEnvironment() }, (error, stdout, stderr) => {
      if (error) {
        let details = '';
        try { const result = JSON.parse(stdout); details = [...Object.entries(result.results || {}).filter(([,value]) => typeof value === 'string' && value.startsWith('error:')).map(([account,value]) => `${account}: ${value}`), ...(result.verificationErrors || [])].join('; '); } catch { /* Prefer stderr for non-JSON failures. */ }
        return reject(new Error((details || stderr || error.message).slice(0, 1000)));
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`Unexpected output: ${stdout.slice(0, 200)}`)); }
    });
  });
}

export async function claudeSyncStatus(): Promise<ClaudeSyncStatus | null> {
  try { return await runSync(['status']) as ClaudeSyncStatus; } catch { return null; }
}

// One click: quit Claude Desktop, write the manifest into every account including the live one, start Claude.
export async function installClaudeTasks(): Promise<unknown> {
  if (isDemoMode()) throw new DemoModeError('restarting Claude Desktop to install tasks');
  if (syncing) throw new Error('Task sync is already running; try again in a few seconds.');
  syncing = true;
  try {
    const result = await runSync(['apply', '--restart', '--start']) as { ok?: boolean; verified?: boolean };
    if (!result.ok || !result.verified) throw new Error('The task installation could not be verified after Claude restarted.');
    return result;
  } finally { syncing = false; }
}

export type SkillSaveResult = { skills: number; repo: { changed: string[] }; local: { changed: string[]; skipped: string[] };
  accounts: Record<string, { added?: string[]; updated?: string[]; serverOwned?: string[]; error?: string }>; ok: boolean };

let savingSkills = false;

// One click: copy the newest copy of every skill into the bundle folder, ~/.claude/skills and every
// Claude Desktop account's skill cache. Nothing is committed or pushed anywhere.
export async function saveAllSkills(): Promise<SkillSaveResult> {
  if (isDemoMode()) throw new DemoModeError('skill sync');
  if (savingSkills) throw new Error('Skill sync is already running.');
  savingSkills = true;
  try {
    return await new Promise<SkillSaveResult>((resolve, reject) => {
      execFile(process.execPath, [repositoryScript('skills-sync.mjs'), 'save'], { timeout: 300_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: scriptEnvironment() }, (error, stdout, stderr) => {
        if (error && !stdout) return reject(new Error((stderr || error.message).slice(0, 1000)));
        try { resolve(JSON.parse(stdout) as SkillSaveResult); } catch { reject(new Error((stderr || stdout).slice(0, 1000))); }
      });
    });
  } finally { savingSkills = false; }
}

type AutoMigrationState = { lastAccount: string; capturedFrom?: string | null; lastApply?: { at: string; result: unknown }; needsInstall?: boolean; error?: string };
let monitoring = false;
let syncing = false;
let monitorTimer: NodeJS.Timeout | null = null;

function autoStateFile(): string { return path.join(getDataDir(), 'claude-auto-migration.json'); }

// Every minute, capture source edits before provisioning inactive accounts. On a switch,
// capture the previous source first; never import an unreconciled stale destination.
async function syncClaudeAccountChange(force = false): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const current = await getActiveClaudeAccount();
    if (!current) return;
    const file = autoStateFile();
    const state = await readJson<AutoMigrationState>(file);
    const due = force || !state?.lastApply || Date.now() - Date.parse(state.lastApply.at) > 60_000 || state.lastAccount !== current;
    if (!due) return;
    try {
      const before = await claudeSyncStatus();
      if (!before) throw new Error('Could not read the Claude task records; nothing was migrated from stale data.');
      const { scheduleCaptureSource } = await import('./claudeScheduleSyncPolicy');
      const capturedFrom = scheduleCaptureSource(current, state, before);
      if (capturedFrom) await runSync(['export', '--account', capturedFrom]);
      const result = await runSync(['apply']);
      const status = await claudeSyncStatus();
      const live = status?.accounts.find(account => account.live);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ lastAccount: current, capturedFrom, lastApply: { at: new Date().toISOString(), result },
        needsInstall: Boolean(live && (live.missing.length || live.notEnabled.length || live.valid !== true)) }, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await fs.writeFile(file, JSON.stringify({ ...(state ?? { lastAccount: current }), error: message }, null, 2));
    }
  } finally { syncing = false; }
}

export async function monitorClaudeAccountChanges(): Promise<AutoMigrationState | null> {
  await syncClaudeAccountChange();
  if (!monitoring) {
    monitoring = true;
    monitorTimer = setInterval(() => { syncClaudeAccountChange().catch(() => {}); }, 60_000);
    monitorTimer.unref();
  }
  return readJson<AutoMigrationState>(autoStateFile());
}

function claudeFileFor(account: string): string {
  const [user, organization, extra] = account.split('/');
  if (extra || !uuidPattern.test(user || '') || !uuidPattern.test(organization || '')) throw new Error('Invalid account');
  return path.join(claudeDataDir(), 'claude-code-sessions', user, organization, 'scheduled-tasks.json');
}

async function backupAndWrite(file: string, contents: string): Promise<void> {
  const backupDirectory = path.join(getDataDir(), 'schedule-edit-backups');
  await fs.mkdir(backupDirectory, { recursive: true });
  const backup = path.join(backupDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}-${path.basename(file)}`);
  await fs.copyFile(file, backup);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function setScheduledTaskEnabled(source: ScheduledTask['source'], account: string, id: string, enabled: boolean): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid task ID');
  if (source === 'codex') {
    const root = path.join(codexHome(), 'automations');
    for (const directory of await directories(root)) {
      const file = path.join(root, directory, 'automation.toml');
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      if (tomlString(text, 'id') !== id) continue;
      if (!/^status\s*=\s*"(?:ACTIVE|PAUSED)"\s*$/m.test(text)) throw new Error('Unsupported Codex status');
      await backupAndWrite(file, text.replace(/^status\s*=\s*"(?:ACTIVE|PAUSED)"\s*$/m, `status = "${enabled ? 'ACTIVE' : 'PAUSED'}"`));
      return;
    }
    throw new Error('Codex task not found');
  }
  if (source === 'claude') {
    if (account !== await getActiveClaudeAccount()) throw new Error('Sign in to the selected Claude account first');
    const file = claudeFileFor(account);
    const data = await readJson<ClaudeScheduleFile>(file);
    if (!data?.scheduledTasks) throw new Error('Claude schedule file unavailable');
    const task = data.scheduledTasks.find(item => item.id === id);
    if (!task) throw new Error('Claude task not found');
    task.enabled = enabled;
    await backupAndWrite(file, JSON.stringify(data, null, 2));
    return;
  }
  if (source === 'antigravity') {
    const root = path.join(homeDir(), '.gemini', 'config');
    if (!(await directories(path.join(root, 'sidecars'))).includes(id)) throw new Error('Antigravity sidecar not found');
    const file = path.join(root, 'config.json');
    const data = await readJson<{ sidecars?: Record<string, { enabled?: boolean; [key: string]: unknown }>; [key: string]: unknown }>(file);
    if (!data?.sidecars?.[id]) throw new Error('Antigravity sidecar configuration unavailable');
    data.sidecars[id].enabled = enabled;
    await backupAndWrite(file, JSON.stringify(data, null, 2));
  }
}
