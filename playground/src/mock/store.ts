import data from './demo-snapshot.json';
import { createClock, logStamp, shiftTimes } from './time';
import { AGENTS, type AgentId } from '@ui/_lib/agents';
import type { AgentArchiveMessage, AgentArchiveStatus, AgentArchiveThread } from '@ui/_lib/agentArchiveDb';
import type { DesktopRuntime, HandoffCandidate, HandoffPackage, ItemProgress } from '@ui/_lib/desktopHandoff/types';
import type { WorkspaceGitState } from '@ui/_lib/handoff';
import type { LogEntry } from '@ui/_lib/parseLog';
import type { Mention } from '@ui/_lib/parseMentions';
import type { Task } from '@ui/_lib/parseTask';
import type { RolesMap } from '@ui/_lib/roles';
import type { ScheduledTask } from '@ui/_lib/schedules';

type Captured<T = Record<string, unknown>> = { status: number; body: T };
type Serialized<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] };
type DemoState = {
  entries: Serialized<LogEntry>[];
  lead: AgentId;
  agentsMd: string;
  rolesWarning: string | null;
  roles: RolesMap;
  mentions: { pending: Serialized<Mention>[]; byAgent: Record<AgentId, number> };
};
type ScheduleResponse = { tasks: ScheduledTask[]; [key: string]: unknown };
type PackageDetail = { package: HandoffPackage; bootstrapText: string; progress: ItemProgress[]; runtime: DesktopRuntime; directSupported: boolean; demo: boolean };
type Catalog = { candidates: HandoffCandidate[]; warnings: string[]; accountLabels: Record<string, string> };
type SyncResult = { scanned: number; imported: number; updated: number; skipped: number; excluded: number; lastSyncedAt: string; status: AgentArchiveStatus };

/** What scripts/snapshot.mjs records from the real server in demo mode. */
export type DemoSnapshot = {
  generatedAt: number;
  todaySpanMinutes: number;
  liveConversationId: string;
  threads: AgentArchiveThread[];
  messages: Record<string, AgentArchiveMessage[]>;
  threadSnapshots: Record<string, AgentArchiveThread | null>;
  handoffSnapshots: Record<string, Captured>;
  composer: Record<string, Captured>;
  gitStates: Record<string, WorkspaceGitState>;
  focus: Record<string, Captured>;
  archiveStatus: AgentArchiveStatus;
  syncStatus: AgentArchiveStatus;
  syncResult: SyncResult;
  catalog: Catalog;
  packages: { packages: HandoffPackage[] };
  packageDetails: Record<string, PackageDetail>;
  schedules: ScheduleResponse;
  schedulesInstall: Captured;
  schedulesSaveSkills: Captured;
  schedulesCopyToCodex: Captured<{ copied: number; verified: boolean; tasks: Array<{ sourceId: string; id: string }> }>;
  schedulesAfterCopy: ScheduleResponse;
  state: DemoState;
  tasks: Task[];
  live: { messages: AgentArchiveMessage[]; state: DemoState };
};

const raw = data as unknown as DemoSnapshot;
export const snapshot: DemoSnapshot = shiftTimes(raw, createClock(raw.generatedAt, raw.todaySpanMinutes));
export const liveConversationId = snapshot.liveConversationId;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const toEntry = (entry: Serialized<LogEntry>, at?: Date): LogEntry => {
  const ts = at ?? new Date(entry.ts);
  return { ...entry, ts, raw: entry.raw.replace(/^\[[^\]]+\]/, `[${logStamp(ts)}]`) };
};
const toMention = (mention: Serialized<Mention>): Mention => ({ ...mention, ts: new Date(mention.ts) });

/* ---------- Archive ---------- */

export const archive = {
  threads: clone(snapshot.threads),
  deleted: 0,
  lastSyncedAt: snapshot.archiveStatus.lastSyncedAt,
};

export function archiveStatus(): AgentArchiveStatus {
  const providerCounts = { codex: 0, 'claude-code': 0, opencode: 0, antigravity: 0 } as AgentArchiveStatus['providerCounts'];
  for (const thread of archive.threads) providerCounts[thread.provider]++;
  const messageCount = archive.threads.reduce((sum, thread) => sum + threadMessages(thread.id).length, 0);
  return { ...snapshot.archiveStatus, sessionCount: archive.threads.length, messageCount, providerCounts, deletedCount: archive.deleted, lastSyncedAt: archive.lastSyncedAt };
}

export function syncArchive(): SyncResult {
  archive.lastSyncedAt = new Date().toISOString();
  return { ...snapshot.syncResult, scanned: archive.threads.length, skipped: archive.threads.length, lastSyncedAt: archive.lastSyncedAt, status: archiveStatus() };
}

export function threadMessages(id: string): AgentArchiveMessage[] {
  const base = snapshot.messages[id] ?? [];
  return id === liveConversationId ? [...base, ...live.messages] : base;
}

/* ---------- Live replay (scripts/demo-live.mjs) ---------- */

type LiveStatus = 'idle' | 'armed' | 'running' | 'done';
type LiveListener = (messages: AgentArchiveMessage[]) => void;
const STEP_MS = 3000;
const baseEntries = snapshot.state.entries;
const liveEntries = snapshot.live.state.entries.filter(entry => !baseEntries.some(base => base.raw === entry.raw));
/** Messages appended in the same demo-live tick arrive together. */
const liveSteps = (() => {
  const steps: AgentArchiveMessage[][] = [];
  let last = -Infinity;
  for (const message of snapshot.live.messages) {
    const at = Date.parse(message.timestamp);
    if (at - last > 1500 || !steps.length) steps.push([]);
    steps.at(-1)!.push(message);
    last = at;
  }
  return steps;
})();

export const live = {
  status: 'idle' as LiveStatus,
  messages: [] as AgentArchiveMessage[],
  entries: [] as LogEntry[],
  listeners: new Set<LiveListener>(),
  timers: [] as number[],
};

function resetLive() {
  for (const timer of live.timers) window.clearTimeout(timer);
  live.timers = [];
  live.messages = [];
  live.entries = [];
}

/** Opening the live conversation re-arms a finished replay so a visitor always sees it stream. */
export function armLiveReplay() {
  if (live.status === 'idle' || live.status === 'done') {
    resetLive();
    live.status = 'armed';
  }
}

export function startLiveReplay() {
  if (live.status === 'running') return;
  if (live.status !== 'armed') resetLive();
  live.status = 'running';
  liveSteps.forEach((step, index) => {
    live.timers.push(window.setTimeout(() => {
      const now = new Date();
      const added = step.map(message => ({ ...message, timestamp: now.toISOString() }));
      live.messages.push(...added);
      if (index === 0 && liveEntries[0]) live.entries.push(toEntry(liveEntries[0], now));
      if (index === liveSteps.length - 1) {
        for (const entry of liveEntries.slice(1)) live.entries.push(toEntry(entry, now));
        live.status = 'done';
      }
      for (const listener of live.listeners) listener(added);
    }, 1500 + index * STEP_MS));
  });
}

/* ---------- Activity log state (getState) ---------- */

const activity = {
  lead: snapshot.state.lead,
  handled: new Set<string>(),
};

export function setLead(id: AgentId) {
  activity.lead = id;
}

export function markHandled(ids: readonly string[]) {
  for (const id of ids) activity.handled.add(id);
}

export function currentState() {
  const replayed = live.status === 'done' && live.entries.length === liveEntries.length;
  const source = replayed ? snapshot.live.state : snapshot.state;
  const pending = source.mentions.pending.filter(mention => !activity.handled.has(mention.id)).map(toMention);
  const byAgent = Object.fromEntries(AGENTS.map(agent => [agent.id, 0])) as Record<AgentId, number>;
  for (const mention of pending) {
    if (mention.targetType === 'all') for (const agent of AGENTS) byAgent[agent.id]++;
    else if ((mention.targetType === 'agent' || mention.targetType === 'role') && byAgent[mention.targetSlug as AgentId] !== undefined) byAgent[mention.targetSlug as AgentId]++;
  }
  return {
    entries: [...baseEntries.map(entry => toEntry(entry)), ...live.entries],
    lead: activity.lead,
    agentsMd: snapshot.state.agentsMd,
    rolesWarning: snapshot.state.rolesWarning,
    roles: snapshot.state.roles,
    mentions: { pending, byAgent },
  };
}

/* ---------- Schedules ---------- */

export const schedules = clone(snapshot.schedules);

export function toggleSchedule(input: { source: string; account: string; id: string; enabled: boolean }) {
  const task = schedules.tasks.find(item => item.source === input.source && item.account === input.account && item.id === input.id);
  if (!task) return false;
  task.enabled = input.enabled;
  return true;
}

/** Copies Claude tasks to Codex with the records the real copy produced. */
export function copySchedulesToCodex(ids?: string[]) {
  const result = snapshot.schedulesCopyToCodex.body;
  const copied = result.tasks.filter(task => !ids || ids.includes(task.sourceId));
  for (const task of copied) {
    if (schedules.tasks.some(item => item.source === 'codex' && item.id === task.id)) continue;
    const record = snapshot.schedulesAfterCopy.tasks.find(item => item.source === 'codex' && item.id === task.id);
    if (record) schedules.tasks.push(clone(record));
  }
  return { ...result, copied: copied.length, tasks: copied };
}

/* ---------- Desktop handoff packages ---------- */

const MARKER_HASH = '0'.repeat(64);
export const handoff = {
  packages: clone(snapshot.packages.packages),
  bootstrap: Object.fromEntries(Object.values(snapshot.packageDetails).map(detail => [detail.package.id, detail.bootstrapText])) as Record<string, string>,
  progress: {} as Record<string, Record<string, ItemProgress>>,
  runtime: {} as Record<string, DesktopRuntime>,
  stop: new Set<string>(),
};
export const samplePackageId = handoff.packages[0]?.id;

/* The sample package opens mid-delivery: one chat verified in the new account, one still queued. */
if (samplePackageId) {
  const pkg = handoff.packages[0];
  const now = Date.now();
  const [first, second] = pkg.items;
  handoff.progress[pkg.id] = {};
  if (first) handoff.progress[pkg.id][first.id] = {
    itemId: first.id, state: 'reply-observed', titleVerified: true, destinationAccount: 'demo-destination/demo-org',
    destinationId: `local_demo-${first.id.slice(0, 8)}`, submittedAt: new Date(now - 95_000).toISOString(),
    firstReplyAt: new Date(now - 80_000).toISOString(), updatedAt: new Date(now - 80_000).toISOString(),
  };
  if (second) handoff.progress[pkg.id][second.id] = { itemId: second.id, state: 'queued', updatedAt: new Date(now - 80_000).toISOString() };
  handoff.runtime[pkg.id] = { status: 'stopped', running: false, updatedAt: new Date(now - 80_000).toISOString() };
}

export function packageDetail(id: string): PackageDetail | null {
  const pkg = handoff.packages.find(item => item.id === id);
  if (!pkg) return null;
  const progress = pkg.items.map(item => handoff.progress[id]?.[item.id] ?? { itemId: item.id, state: 'prepared' as const, updatedAt: pkg.createdAt });
  return { package: pkg, progress, runtime: handoff.runtime[id] ?? { status: 'idle', running: false }, directSupported: true, demo: true, bootstrapText: handoff.bootstrap[id] ?? '' };
}

export function createPackage(keys: unknown, targetProvider: unknown): HandoffPackage {
  if (!Array.isArray(keys) || !keys.length || keys.length > 50 || new Set(keys).size !== keys.length) throw new Error('Select 1–50 unique chats');
  if (targetProvider !== 'claude-code' && targetProvider !== 'codex') throw new Error('Invalid destination');
  const sources = keys.map(key => {
    const source = snapshot.catalog.candidates.find(candidate => candidate.key === key);
    if (!source || !source.title.trim() || !source.cwd || !source.sourceAvailable) throw new Error('Source title, directory or transcript unavailable');
    return source;
  });
  const template = handoff.packages[0];
  const id = crypto.randomUUID();
  const directory = template ? template.items[0].transcriptFile.replace(/[\\/][^\\/]+[\\/]transcript\.json$/, '').replace(template.id, id) : id;
  const separator = directory.includes('\\') ? '\\' : '/';
  const pkg: HandoffPackage = {
    version: 1, id, createdAt: new Date().toISOString(), targetProvider,
    window: { from: null, to: new Date().toISOString(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    items: sources.map(source => {
      const itemId = crypto.randomUUID();
      const file = (name: string) => [directory, itemId, name].join(separator);
      return { id: itemId, source, marker: `DESKTOP-HANDOFF:${id}:${itemId}`, transcriptFile: file('transcript.json'), handoffFile: file('handoff.md'), promptFile: file('prompt.txt'), hashes: { 'transcript.json': MARKER_HASH, 'handoff.md': MARKER_HASH, 'prompt.txt': MARKER_HASH } };
    }),
  };
  handoff.packages.unshift(pkg);
  const sample = template ? handoff.bootstrap[template.id] ?? '' : '';
  handoff.bootstrap[id] = sample.split(template?.id ?? '\u0000').join(id).replace(/each of the \d+ selected chats/, `each of the ${pkg.items.length} selected chats`);
  return pkg;
}

const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

/** In-browser port of ui/scripts/desktop-handoff/demo-runner.mjs. */
export function startDelivery(id: string, action: 'start' | 'open', itemId?: string) {
  const pkg = handoff.packages.find(item => item.id === id);
  if (!pkg) throw new Error('Package unavailable');
  if (itemId !== undefined && (typeof itemId !== 'string' || !pkg.items.some(item => item.id === itemId)) || action === 'open' && !itemId) throw new Error('Invalid package item');
  if (handoff.runtime[id]?.running) throw new Error('Package controller already running');
  const setRuntime = (value: Partial<DesktopRuntime>) => { handoff.runtime[id] = { ...handoff.runtime[id], status: 'idle', running: false, ...value, updatedAt: new Date().toISOString() }; };
  const write = (progress: ItemProgress) => { handoff.progress[id] = { ...handoff.progress[id], [progress.itemId]: { ...progress, updatedAt: new Date().toISOString() } }; };
  handoff.stop.delete(id);
  setRuntime({ status: 'running', running: true });
  if (action === 'open') {
    void pause(900).then(() => setRuntime({ status: 'finished', running: false }));
    return { started: true };
  }
  void (async () => {
    const busy = new Set<string>();
    for (const item of itemId ? pkg.items.filter(entry => entry.id === itemId) : pkg.items) {
      if (handoff.stop.has(id)) { setRuntime({ status: 'stopped', running: false }); return; }
      let state: ItemProgress = handoff.progress[id]?.[item.id] ?? { itemId: item.id, state: 'prepared', updatedAt: '' };
      if (state.state === 'reply-observed' && state.titleVerified) continue;
      const cwd = item.source.cwd.toLowerCase();
      if (busy.has(cwd)) {
        write({ ...state, state: 'queued', blockedBy: 'same working directory' });
        await pause(900);
      }
      busy.add(cwd);
      const destinationId = `local_demo-${item.id.slice(0, 8)}`;
      for (const next of ['opening', 'opened', 'sent'] as const) {
        state = { ...state, state: next, destinationAccount: 'demo-destination/demo-org', blockedBy: undefined, ...(next === 'opening' ? {} : { destinationId }), ...(next === 'sent' ? { submittedAt: new Date().toISOString() } : {}) };
        write(state);
        await pause(700);
      }
      write({ ...state, state: 'reply-observed', firstReplyAt: new Date().toISOString(), titleVerified: true });
      busy.delete(cwd);
      await pause(500);
    }
    setRuntime({ status: 'finished', running: false });
  })();
  return { started: true };
}

export function stopDelivery(id: string) {
  handoff.stop.add(id);
  return { stopping: true };
}

/* ---------- Reply composer jobs (ui/scripts/demo-agent.mjs) ---------- */

type Job = { id: string; targetKey: string; status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'; output: string; error: string; startedAt: string; finishedAt?: string };
export const jobs = new Map<string, Job>();

export function currentJob(targetKey: string) {
  return [...jobs.values()].find(job => job.targetKey === targetKey && (job.status === 'starting' || job.status === 'running')) ?? null;
}

export function startJob(targetKey: string, provider: string, message: string, requestId: string) {
  const existing = jobs.get(requestId);
  if (existing) return existing;
  const job: Job = { id: requestId, targetKey, status: 'starting', output: '', error: '', startedAt: new Date().toISOString() };
  jobs.set(requestId, job);
  const reply = `Demo mode: this reply is simulated and no agent CLI was started. A real run would resume the session and answer:\n\n> ${message.trim().slice(0, 200)}`;
  window.setTimeout(() => {
    if (job.status !== 'starting') return;
    job.status = 'running';
    const words = provider === 'claude-code' ? reply.split(/(?<=\s)/) : [reply];
    let index = 0;
    const tick = window.setInterval(() => {
      if (job.status !== 'running') { window.clearInterval(tick); return; }
      job.output += words.slice(index, index + 6).join('');
      index += 6;
      if (index >= words.length) {
        window.clearInterval(tick);
        job.output = reply;
        job.status = 'completed';
        job.finishedAt = new Date().toISOString();
      }
    }, 120);
  }, 800);
  return job;
}

export function cancelJob(id: string) {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'starting' || job.status === 'running') {
    job.status = 'cancelled';
    job.error = 'cancelled';
    job.finishedAt = new Date().toISOString();
  }
  return job;
}
