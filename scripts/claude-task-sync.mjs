#!/usr/bin/env node
// Claude Desktop scheduled-task sync across accounts (Windows + macOS). Plain ESM, no dependencies, Node 22+.
//
//   node scripts/claude-task-sync.mjs status
//   node scripts/claude-task-sync.mjs export                 live Claude account -> state/claude-task-manifest.json + task-prompts/
//   node scripts/claude-task-sync.mjs export --account <a/o> a specific (previous) account instead of the live one
//   node scripts/claude-task-sync.mjs apply                  write manifest into every NON-live account (safe while Claude runs)
//   node scripts/claude-task-sync.mjs apply --restart        quit Claude, write ALL accounts incl. the live one, start Claude
//   node scripts/claude-task-sync.mjs restart                quit + start Claude Desktop
//
// Why: Claude Desktop keeps the live account's task list in memory and overwrites its file, and it rejects the
// whole file when one record breaks its schema (e.g. createdAt must be a number). So other accounts are
// pre-provisioned with schema-valid records (switching to them then just works), and the live account is only
// written while Claude is closed. Prompt files are shared per machine in ~/.claude/scheduled-tasks/<id>/SKILL.md;
// they are rendered from task-prompts/ with {{ROOT}} replaced by the schedules folder's real path, so the same
// manifest works on another machine.
//
// The schedules folder is <data dir>/schedules (SWITCHYARD_SCHEDULES_DIR overrides it). In demo mode
// (SWITCHYARD_DEMO=1) the script never reports a running Claude and refuses to quit or start the app.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const demo = process.env.SWITCHYARD_DEMO === '1';
const root = path.resolve(process.env.SWITCHYARD_SCHEDULES_DIR
  || path.join(process.env.SWITCHYARD_DATA_DIR || path.join(os.homedir(), '.switchyard'), 'schedules'));
const manifestFile = path.join(root, 'state', 'claude-task-manifest.json');
const promptDir = path.join(root, 'task-prompts');
const backupDir = path.join(root, 'state', 'claude-sync-backups');
const isMac = process.platform === 'darwin';
const claudeData = isMac ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude')
  : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude');
const sessionsDir = path.join(claudeData, 'claude-code-sessions');
const taskFilesDir = path.join(os.homedir(), '.claude', 'scheduled-tasks');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = /^[a-zA-Z0-9_-]+$/;
const definitionKeys = ['displayName', 'cronExpression', 'fireAt', 'enabled', 'cwd', 'permissionMode', 'chromePermissionMode', 'model', 'useWorktree', 'sourceBranch', 'disableJitter', 'chromeAllowedDomains', 'userSelectedFolders', 'userSelectedFiles'];
const definitionValue = (key, value) => key === 'cwd' ? nativePath(value) : ['userSelectedFolders', 'userSelectedFiles'].includes(key) && Array.isArray(value) ? value.map(nativePath) : value;
const sameDefinition = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const dirs = (dir) => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
const toPortable = (text) => text.split(root).join('{{ROOT}}').split(root.replace(/\\/g, '/')).join('{{ROOT}}')
  .split(os.homedir()).join('{{HOME}}').split(os.homedir().replace(/\\/g, '/')).join('{{HOME}}');
const fromPortable = (text) => text.split('{{ROOT}}').join(root.replace(/\\/g, '/')).split('{{HOME}}').join(os.homedir().replace(/\\/g, '/'));
const nativePath = (text) => path.normalize(fromPortable(text));

const liveAccountId = () => readJson(path.join(claudeData, 'config.json'), {})?.lastKnownAccountUuid ?? null;

// Orgs the signed-in account belongs to, even before its first Code session: the skills cache is laid out as
// local-agent-mode-sessions/skills-plugin/<org>/<account>.
function knownOrgs(account) {
  const skillsRoot = path.join(claudeData, 'local-agent-mode-sessions', 'skills-plugin');
  return [...new Set([...dirs(path.join(sessionsDir, account)),
    ...dirs(skillsRoot).filter((org) => existsSync(path.join(skillsRoot, org, account)))])].filter((name) => uuid.test(name));
}

function accounts() {
  const result = [];
  const liveId = liveAccountId();
  const accountIds = dirs(sessionsDir).filter((name) => uuid.test(name));
  if (liveId && uuid.test(liveId) && !accountIds.includes(liveId)) accountIds.push(liveId);
  for (const account of accountIds) {
    const found = [];
    for (const org of account === liveId ? knownOrgs(account) : dirs(path.join(sessionsDir, account)).filter((name) => uuid.test(name))) {
      const folder = path.join(sessionsDir, account, org);
      const files = existsSync(folder) ? readdirSync(folder) : [];
      const sessionFiles = files.filter((name) => /^local_[\w-]+\.json$/.test(name) && typeof readJson(path.join(folder, name))?.cliSessionId === 'string');
      const activity = sessionFiles.concat(files.includes('scheduled-tasks.json') ? ['scheduled-tasks.json'] : []).filter((name) => name.startsWith('local_') || name === 'scheduled-tasks.json')
        .map((name) => statSync(path.join(folder, name)).mtimeMs);
      found.push({ key: `${account}/${org}`, account, org, folder, file: path.join(folder, 'scheduled-tasks.json'),
        sessions: sessionFiles.length, lastActivity: Math.max(0, ...activity) });
    }
    // Schedule-only cross-account folders are not authenticated Desktop profiles. The signed-in account is the
    // exception until its first Code session exists: then its known orgs stand in.
    const authenticated = found.filter((entry) => entry.sessions > 0);
    result.push(...(authenticated.length || account !== liveId ? authenticated : found));
  }
  return result;
}

// Claude Desktop's own account (not the Claude Code CLI login in ~/.claude.json): config.json lastKnownAccountUuid,
// and the org folder of that account with the most recent activity.
function liveAccount(all = accounts()) {
  const accountId = liveAccountId();
  const candidates = all.filter((entry) => entry.account === accountId).sort((a, b) => b.lastActivity - a.lastActivity);
  return candidates[0] ?? null;
}

function claudeRunning() {
  if (demo) return false;
  try {
    if (isMac) return execFileSync('pgrep', ['-x', 'Claude'], { encoding: 'utf8' }).trim().length > 0;
    return /claude\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/NH'], { encoding: 'utf8' }));
  } catch { return false; }
}

function validate(data) {
  const problems = [];
  if (!data || !Array.isArray(data.scheduledTasks)) return ['scheduledTasks missing'];
  const ids = new Set();
  for (const task of data.scheduledTasks) {
    if (ids.has(task.id)) problems.push(`${task.id}: duplicate task id`);
    ids.add(task.id);
    if (typeof task.id !== 'string' || !validId.test(task.id)) problems.push('task without id');
    if (typeof task.enabled !== 'boolean') problems.push(`${task.id}: enabled must be boolean`);
    if (typeof task.filePath !== 'string') problems.push(`${task.id}: filePath must be string`);
    if (typeof task.createdAt !== 'number') problems.push(`${task.id}: createdAt must be number`);
    if (task.permissionMode && !['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk', 'auto'].includes(task.permissionMode)) problems.push(`${task.id}: bad permissionMode`);
    if (task.chromePermissionMode && !['ask', 'skip_all_permission_checks', 'follow_a_plan'].includes(task.chromePermissionMode)) problems.push(`${task.id}: bad chromePermissionMode`);
  }
  return problems;
}

function writePrompts(manifest) {
  const written = [];
  for (const task of manifest.tasks) {
    const source = path.join(promptDir, `${task.id}.md`);
    if (!existsSync(source)) throw new Error(`prompt missing: task-prompts/${task.id}.md`);
    const target = path.join(taskFilesDir, task.id, 'SKILL.md');
    const text = fromPortable(readFileSync(source, 'utf8'));
    if (existsSync(target) && readFileSync(target, 'utf8') === text) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(task.id);
  }
  return written;
}

function mergeInto(entry, manifest) {
  const original = existsSync(entry.file) ? readFileSync(entry.file, 'utf8') : null;
  const data = original ? JSON.parse(original) : { scheduledTasks: [], recordedSkips: {} };
  if (!Array.isArray(data.scheduledTasks)) throw new Error(`${entry.key}: scheduledTasks missing`);
  const byId = new Map();
  const changed = [];
  for (const task of data.scheduledTasks) {
    const prior = byId.get(task.id);
    if (!prior) byId.set(task.id, task);
    else {
      changed.push(`${task.id}:duplicate-removed`);
      if ((Date.parse(task.lastRunAt || '') || 0) > (Date.parse(prior.lastRunAt || '') || 0)) byId.set(task.id, task);
    }
  }
  data.scheduledTasks = [...byId.values()];
  for (const task of data.scheduledTasks) {
    if (typeof task.createdAt === 'string') { task.createdAt = Date.parse(task.createdAt) || Date.now(); changed.push(`${task.id}:createdAt`); }
  }
  for (const definition of manifest.tasks) {
    const wanted = { id: definition.id, filePath: path.join(taskFilesDir, definition.id, 'SKILL.md') };
    for (const key of definitionKeys) if (definition[key] !== undefined) wanted[key] = definitionValue(key, definition[key]);
    const existing = byId.get(definition.id);
    if (existing) {
      const before = JSON.stringify(existing);
      Object.assign(existing, wanted);
      for (const key of definitionKeys) if (definition[key] === undefined) delete existing[key];
      if (JSON.stringify(existing) !== before) changed.push(`${definition.id}:updated`);
    } else {
      data.scheduledTasks.push({ ...wanted, createdAt: Date.now() });
      changed.push(`${definition.id}:added`);
    }
  }
  for (const id of manifest.retired ?? []) {
    const task = byId.get(id);
    if (task && task.enabled) { task.enabled = false; changed.push(`${id}:retired`); }
  }
  const problems = validate(data);
  if (problems.length) throw new Error(`${entry.key}: ${problems.join('; ')}`);
  if (!changed.length) return [];
  mkdirSync(backupDir, { recursive: true });
  if (original) copyFileSync(entry.file, path.join(backupDir, `${Date.now()}-${entry.account.slice(0, 8)}-${entry.org.slice(0, 8)}.json`));
  mkdirSync(entry.folder, { recursive: true });
  const temporary = `${entry.file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2));
  renameSync(temporary, entry.file);
  return changed;
}

function quitClaude() {
  if (demo) throw new Error('Demo mode: Claude Desktop is never closed.');
  if (!claudeRunning()) return;
  try {
    if (isMac) execFileSync('osascript', ['-e', 'quit app "Claude"']);
    else execFileSync('taskkill', ['/IM', 'claude.exe'], { stdio: 'ignore' });
  } catch { /* already closing */ }
  const deadline = Date.now() + 30000;
  while (claudeRunning() && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  if (claudeRunning() && !isMac) execFileSync('taskkill', ['/F', '/IM', 'claude.exe'], { stdio: 'ignore' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  if (claudeRunning()) throw new Error('Claude did not close; scheduled-task files were not changed.');
}

async function startClaude() {
  if (demo) throw new Error('Demo mode: Claude Desktop is never started.');
  const launcher = isMac ? 'open' : path.join(process.env.LOCALAPPDATA || '', 'AnthropicClaude', 'claude.exe');
  if (!isMac && !existsSync(launcher)) throw new Error('Claude launcher not found: ' + launcher);
  await new Promise((resolve, reject) => {
    const child = spawn(launcher, isMac ? ['-a', 'Claude'] : [], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (claudeRunning()) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Claude did not reopen; the task files were written but startup could not be verified.');
}

function verifyInstallation(entries, manifest) {
  const errors = [];
  for (const entry of entries) {
    const data = readJson(entry.file);
    errors.push(...validate(data).map(problem => entry.key + ': ' + problem));
    for (const task of manifest.tasks) {
      const records = data?.scheduledTasks?.filter(record => record.id === task.id) ?? [];
      if (records.length !== 1) { errors.push(entry.key + ': ' + task.id + ' record missing or duplicated'); continue; }
      const record = records[0];
      for (const key of definitionKeys) {
        const wanted = task[key] === undefined ? undefined : definitionValue(key, task[key]);
        if (!sameDefinition(record[key], wanted)) errors.push(entry.key + ': ' + task.id + ' ' + key + ' could not be verified');
      }
      const installed = path.join(taskFilesDir, task.id, 'SKILL.md');
      const source = path.join(promptDir, task.id + '.md');
      if (record.filePath !== installed || !existsSync(installed) ||
        readFileSync(installed, 'utf8').replace(/\r\n/g, '\n') !== fromPortable(readFileSync(source, 'utf8')).replace(/\r\n/g, '\n')) {
        errors.push(entry.key + ': ' + task.id + ' prompt could not be verified');
      }
    }
  }
  return errors;
}

const command = process.argv[2] ?? 'status';
const all = accounts();
const live = liveAccount(all);

if (command === 'status') {
  const manifest = readJson(manifestFile, { tasks: [] });
  print({
    platform: process.platform, claudeRunning: claudeRunning(), liveAccount: live?.key ?? null, exportedFrom: manifest.exportedFrom ?? null, manifestTasks: manifest.tasks.map((t) => t.id),
    accounts: all.map((entry) => {
      const data = readJson(entry.file);
      const ids = new Set((data?.scheduledTasks ?? []).map((t) => t.id));
      const enabled = new Set((data?.scheduledTasks ?? []).filter((t) => t.enabled).map((t) => t.id));
      const problems = data ? validate(data) : [];
      for (const task of manifest.tasks) {
        const record = data?.scheduledTasks?.find(record => record.id === task.id);
        if (!record) continue;
        for (const key of definitionKeys) {
          const wanted = task[key] === undefined ? undefined : definitionValue(key, task[key]);
          if (!sameDefinition(record[key], wanted)) problems.push(`${task.id}: ${key} differs from manifest`);
        }
        const source = path.join(promptDir, `${task.id}.md`);
        const installed = path.join(taskFilesDir, task.id, 'SKILL.md');
        if (record.filePath !== installed) problems.push(`${task.id}: wrong prompt path`);
        if (!existsSync(source) || !existsSync(installed) || fromPortable(readFileSync(source,'utf8')).replace(/\r\n/g,'\n') !== readFileSync(installed,'utf8').replace(/\r\n/g,'\n')) problems.push(`${task.id}: prompt differs or missing`);
      }
      return { key: entry.key, live: entry.key === live?.key, sessions: entry.sessions, valid: data ? problems.length === 0 : 'no file',
        problems, missing: manifest.tasks.filter((t) => !ids.has(t.id)).map((t) => t.id),
        notEnabled: manifest.tasks.filter((t) => t.enabled && ids.has(t.id) && !enabled.has(t.id)).map((t) => t.id) };
    }),
  });
} else if (command === 'export') {
  const requestedAccount = process.argv.indexOf('--account');
  const source = requestedAccount >= 0 ? all.find(entry => entry.key === process.argv[requestedAccount + 1]) : live;
  if (!source) throw new Error('authenticated Claude source account not found');
  const data = readJson(source.file);
  const problems = validate(data);
  if (problems.length) throw new Error('Source invalid: ' + problems.join('; '));
  const previous = readJson(manifestFile, { tasks: [], retired: [] });
  const keep = new Set(previous.tasks.map(t => t.id));
  const retired = new Set(previous.retired ?? []);
  for (const task of data.scheduledTasks) if (task.enabled) retired.delete(task.id);
  const chosen = data.scheduledTasks.filter(t => validId.test(t.id) && !retired.has(t.id) && (keep.has(t.id) || t.enabled) && (t.cronExpression || typeof t.fireAt === 'number'));
  if (!chosen.length) throw new Error('Empty source export refused; central tasks retained');
  const prompts = new Map();
  const tasks = chosen.map(t => {
    prompts.set(t.id, toPortable(readFileSync(t.filePath, 'utf8')));
    const prior = previous.tasks.find(p => p.id === t.id);
    const entry = { ...prior, id: t.id };
    for (const key of definitionKeys) delete entry[key];
    for (const key of definitionKeys) {
      if (t[key] === undefined) continue;
      entry[key] = key === 'cwd' ? toPortable(t[key]).split(path.sep).join('/') :
        ['userSelectedFolders','userSelectedFiles'].includes(key) && Array.isArray(t[key]) ? t[key].map(toPortable) : t[key];
    }
    // Preserve extra manifest metadata (labels, dependencies) while replacing native definition fields.
    return entry;
  });
  for (const task of previous.tasks) if (!tasks.some(t => t.id === task.id)) retired.add(task.id);
  const changed = !sameDefinition(previous.tasks, tasks) || !sameDefinition(previous.retired ?? [], [...retired]) ||
    [...prompts].some(([id,text]) => !existsSync(path.join(promptDir,id+'.md')) || readFileSync(path.join(promptDir,id+'.md'),'utf8') !== text);
  if (changed && existsSync(manifestFile)) {
    const backup = path.join(backupDir, Date.now() + '-export-' + process.pid);
    mkdirSync(backup, { recursive: true });
    copyFileSync(manifestFile, path.join(backup,'manifest.json'));
    mkdirSync(path.join(backup,'task-prompts'));
    for (const file of readdirSync(promptDir)) if (file.endsWith('.md')) copyFileSync(path.join(promptDir,file),path.join(backup,'task-prompts',file));
  }
  mkdirSync(promptDir, { recursive: true });
  for (const [id,text] of prompts) {
    const file = path.join(promptDir,id+'.md');
    if (!existsSync(file) || readFileSync(file,'utf8') !== text) writeFileSync(file,text);
  }
  const manifest = { ...previous, version: 1, exportedAt: new Date().toISOString(), exportedFrom: source.key,
    note: 'Captured from Desktop. {{ROOT}} = schedules folder; {{HOME}} = user home.', tasks, retired: [...retired] };
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  const temporary = manifestFile + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify(manifest,null,2));
  renameSync(temporary,manifestFile);
  print({ exported: tasks.map(t => t.id), retired: [...retired], changed, from: source.key });
} else if (command === 'apply') {
  const manifest = readJson(manifestFile);
  if (!manifest?.tasks?.length) throw new Error('state/claude-task-manifest.json missing: run export first');
  const manifestProblems = validate({scheduledTasks: manifest.tasks.map(task => ({...task, filePath:'manifest', createdAt:0}))});
  if (manifestProblems.length) throw new Error(`Invalid manifest: ${manifestProblems.join('; ')}`);
  for (const task of manifest.tasks) if (!existsSync(path.join(promptDir, `${task.id}.md`))) throw new Error(`prompt missing: ${task.id}`);
  const restart = process.argv.includes('--restart');
  const wasRunning = claudeRunning();
  if (restart && !live) throw new Error('No active Claude Desktop account found; the installation cannot be verified.');
  if (!all.length) throw new Error('No Claude Desktop account found.');
  if (restart) quitClaude();
  const targets = restart ? accounts() : all;
  const prompts = writePrompts(manifest);
  const results = {};
  for (const entry of targets) {
    if (claudeRunning() && (restart || entry.key === live?.key)) {
      results[entry.key] = restart ? 'error: Claude reopened; file writes stopped' : 'skipped: live account while Claude runs (use --restart)';
      continue;
    }
    try { results[entry.key] = mergeInto(entry, manifest); } catch (error) { results[entry.key] = 'error: ' + error.message; }
  }
  const failures = Object.entries(results).filter(([,result]) => typeof result === 'string' && result.startsWith('error:'));
  let restarted = false;
  let verificationErrors = [];
  if (restart && !failures.length) verificationErrors = verifyInstallation(targets, manifest);
  if (restart && (wasRunning || process.argv.includes('--start'))) {
    try {
      await startClaude();
      restarted = true;
      // Desktop loads its in-memory scheduler asynchronously. Verify again after startup,
      // so a stale snapshot overwriting the imported records cannot become a success.
      for (let attempt = 0; attempt < 15 && !verificationErrors.length; attempt++) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        verificationErrors = verifyInstallation(targets, manifest);
        if (!claudeRunning()) verificationErrors.push('Claude closed after startup.');
        if (liveAccount()?.key !== live?.key) verificationErrors.push('The Claude account changed during installation.');
      }
    } catch (error) { verificationErrors.push(error.message); }
  }
  const verified = restart && restarted && !failures.length && !verificationErrors.length;
  print({ prompts, results, restarted, verified, verificationErrors,
    liveAccount: live?.key ?? null, verifiedTasks: verified ? manifest.tasks.length : 0,
    verifiedAccounts: verified ? targets.length : 0, ok: !failures.length && !verificationErrors.length });
  if (failures.length || verificationErrors.length) process.exitCode = 1;
} else if (command === 'restart') {
  quitClaude();
  await startClaude();
  print({ restarted: true });
} else {
  print({ error: 'usage: claude-task-sync.mjs status | export | apply [--restart] | restart' });
  process.exit(1);
}
