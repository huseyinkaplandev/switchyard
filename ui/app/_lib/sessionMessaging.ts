import 'server-only';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { appDataDir, codexHome, getDataDir, homeDir, localAppDataDir, opencodeDataDir } from './paths';
import { getAgentThread } from './agentArchive';
import { locateLocalSession } from './sessions';
import { codexWriterBusy, messageErrorCode } from '../../scripts/session-writer-probe.mjs';

type Provider = 'codex' | 'claude-code' | 'opencode';
export type MessageReason = 'unknown_session' | 'unsupported' | 'remote_copy' | 'source_missing' | 'workspace_missing' | 'cli_missing' | 'session_busy' | 'active_writer';
export class MessageError extends Error {
  constructor(public code: MessageReason | 'invalid_request' | 'conflict', public status = 400) { super(code); }
}
type Target = { provider: Provider; nativeId: string; cwd: string; command: string; prefix: string[]; targetKey: string };
export type MessageJob = { id: string; targetKey: string; status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'; output: string; error: string; startedAt: string; finishedAt?: string; workerPid?: number };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const active = (job: MessageJob) => job.status === 'starting' || job.status === 'running';
const jobsDir = () => path.join(getDataDir(), 'message-jobs');
const jobPath = (id: string) => { if (!uuid.test(id)) throw new MessageError('invalid_request'); return path.join(jobsDir(), id); };
async function exists(file: string) { try { return (await fs.stat(file)).isFile(); } catch { return false; } }
const within = (root: string, file: string) => { const relative = path.relative(root, file); return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative); };

async function executable(provider: Provider) {
  // Desktop's bundled CLI tracks its model catalog; an old npm CLI may reject it.
  if (provider === 'codex') {
    if (process.platform === 'win32') {
      const bundledRoot = path.join(localAppDataDir(), 'OpenAI', 'Codex', 'bin');
      const folders = await fs.readdir(bundledRoot, { withFileTypes: true }).catch(() => []);
      const candidates = await Promise.all(folders.filter(item => item.isDirectory()).map(async item => {
        const binary = path.join(bundledRoot, item.name, 'codex.exe');
        return { binary, modified: (await fs.stat(binary).catch(() => null))?.mtimeMs || 0 };
      }));
      candidates.sort((a, b) => b.modified - a.modified);
      if (candidates[0]?.modified) return { command: candidates[0].binary, prefix: [] as string[] };
    } else if (process.platform === 'darwin') {
      const binary = '/Applications/Codex.app/Contents/Resources/codex';
      if (await exists(binary)) return { command: binary, prefix: [] as string[] };
    }
  }
  const name = provider === 'claude-code' ? 'claude' : provider;
  const dirs = [...new Set((process.env.PATH || '').split(path.delimiter).concat([
    path.join(homeDir(), '.local', 'bin'), path.join(homeDir(), '.claude', 'local'),
    ...(process.platform === 'win32' ? [path.join(appDataDir(), 'npm'), path.dirname(process.execPath)] : ['/usr/local/bin', '/opt/homebrew/bin']),
  ]))];
  for (const dir of dirs) {
    if (!dir) continue;
    const binary = path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
    if (await exists(binary)) return { command: binary, prefix: [] as string[] };
    if (process.platform === 'win32') {
      const npmFile = provider === 'codex' ? 'node_modules/@openai/codex/bin/codex.js'
        : provider === 'claude-code' ? 'node_modules/@anthropic-ai/claude-code/bin/claude.exe' : 'node_modules/opencode-ai/bin/opencode.exe';
      const file = path.join(dir, npmFile);
      if (await exists(file)) return provider === 'codex' ? { command: process.execPath, prefix: [file] } : { command: file, prefix: [] as string[] };
    }
  }
  throw new MessageError('cli_missing');
}

export async function resolveMessageTarget(kind: string, id: string, checkBusy = false): Promise<Target> {
  let provider: string, file: string, nativeId = '', cwd = '';
  if (kind === 'archive') {
    const thread = getAgentThread(id);
    if (!thread) throw new MessageError('unknown_session', 404);
    provider = thread.provider; file = thread.sourcePath || ''; nativeId = thread.id; cwd = thread.cwd;
  } else if (kind === 'local') {
    const item = await locateLocalSession(id);
    if (!item) throw new MessageError('unknown_session', 404);
    if (item.platform !== (process.platform === 'darwin' ? 'macos' : 'windows')) throw new MessageError('remote_copy');
    provider = item.source === 'claude' ? 'claude-code' : item.source; file = item.file; nativeId = item.adapter?.nativeId || '';
  } else throw new MessageError('invalid_request');
  if (provider !== 'codex' && provider !== 'claude-code' && provider !== 'opencode') throw new MessageError('unsupported');
  const root = provider === 'codex' ? codexHome() : provider === 'claude-code' ? path.join(homeDir(), '.claude') : opencodeDataDir();
  let realFile: string, realRoot: string;
  try { [realFile, realRoot] = await Promise.all([fs.realpath(file), fs.realpath(root)]); }
  catch { throw new MessageError('source_missing'); }
  if (!within(realRoot, realFile)) throw new MessageError('remote_copy');
  if (provider === 'opencode') {
    if (!/^ses_[a-z0-9]+$/i.test(nativeId)) throw new MessageError('source_missing');
    const db = new DatabaseSync(realFile, { readOnly: true });
    try {
      const row = db.prepare('SELECT id, directory FROM session WHERE id=?').get(nativeId) as { id: string; directory: string } | undefined;
      if (!row) throw new MessageError('source_missing');
      cwd = row.directory;
    } finally { db.close(); }
  } else {
    const lines = readline.createInterface({ input: createReadStream(realFile, { encoding: 'utf8' }), crlfDelay: Infinity });
    let found = false, count = 0;
    try {
      for await (const line of lines) {
        if (++count > 100) break;
        try {
          const record = JSON.parse(line);
          const meta = provider === 'codex' && record.type === 'session_meta' ? record.payload : provider === 'claude-code' && record.sessionId ? record : null;
          if (!meta) continue;
          const recordId = provider === 'codex' ? meta.id : meta.sessionId;
          if (nativeId && nativeId !== recordId) throw new MessageError('source_missing');
          nativeId = recordId; cwd = meta.cwd || cwd; found = true; break;
        } catch (error) { if (error instanceof MessageError) throw error; }
      }
    } finally { lines.close(); }
    if (!found || !uuid.test(nativeId)) throw new MessageError('source_missing');
    if (provider === 'codex' && checkBusy) {
      if (await codexWriterBusy(codexHome(), nativeId)) throw new MessageError('active_writer', 409);
      // Never resume a Codex thread whose native turn is already running.
      const handle = await fs.open(realFile, 'r');
      try {
        const stat = await handle.stat(); const buffer = Buffer.alloc(Math.min(stat.size, 256000));
        await handle.read(buffer, 0, buffer.length, stat.size - buffer.length);
        let nativeStart = 0, nativeEnd = 0;
        for (const line of buffer.toString('utf8').split('\n')) {
          try {
            const record = JSON.parse(line);
            if (record.type !== 'event_msg') continue;
            if (record.payload?.type === 'task_started') nativeStart = Date.parse(record.timestamp) || 0;
            if (record.payload?.type === 'task_complete' || record.payload?.type === 'turn_aborted') nativeEnd = Date.parse(record.timestamp) || 0;
          } catch {}
        }
        if (nativeStart > nativeEnd) {
          // A dashboard-owned cancelled/failed turn can be resumed after its worker exits.
          let ownedInterrupted = false;
          try {
            const key = crypto.createHash('sha256').update(`${provider}:${nativeId}`).digest('hex');
            const previous = await readMessageJob(await fs.readFile(path.join(jobsDir(), `${key}.last`), 'utf8'));
            ownedInterrupted = !active(previous) && nativeStart >= Date.parse(previous.startedAt) - 3000 && nativeStart <= Date.parse(previous.finishedAt || '') + 1000;
          } catch {}
          if (!ownedInterrupted) throw new MessageError('session_busy', 409);
        }
      } finally { await handle.close(); }
    }
  }
  try { if (!(await fs.stat(cwd)).isDirectory()) throw new Error(); } catch { throw new MessageError('workspace_missing'); }
  return { provider, nativeId, cwd, ...await executable(provider), targetKey: crypto.createHash('sha256').update(`${provider}:${nativeId}`).digest('hex') };
}

export async function readMessageJob(id: string): Promise<MessageJob> {
  let job: MessageJob;
  try { job = JSON.parse(await fs.readFile(path.join(jobPath(id), 'status.json'), 'utf8')); }
  catch (error) { if (error instanceof MessageError) throw error; throw new MessageError('unknown_session', 404); }
  if (active(job) && Date.now() - Date.parse(job.startedAt) > 20_000) {
    let alive = false;
    if (job.workerPid) { try { process.kill(job.workerPid, 0); alive = true; } catch {} }
    if (!alive) {
      job.status = 'failed'; job.error = 'worker_stopped'; job.finishedAt = new Date().toISOString();
      const file = path.join(jobPath(id), 'status.json');
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(job), { mode: 0o600 });
      await fs.rename(temp, file);
    }
  }
  job.error = messageErrorCode(job.error);
  return job;
}

export async function blockedMessageReason(target: Target, job: MessageJob | null) {
  if (target.provider === 'codex' && !(job && active(job)) && await codexWriterBusy(codexHome(), target.nativeId)) return 'active_writer';
  return null;
}

export async function currentMessageJob(targetKey: string) {
  try { return await readMessageJob(await fs.readFile(path.join(jobsDir(), `${targetKey}.lock`), 'utf8')); } catch { return null; }
}

export async function startMessageJob(target: Target, message: string, id: string, images: string[] = []) {
  const directory = jobPath(id);
  await fs.mkdir(jobsDir(), { recursive: true, mode: 0o700 });
  try {
    const previous = await readMessageJob(id);
    if (previous.targetKey !== target.targetKey) throw new MessageError('conflict', 409);
    return previous;
  } catch (error) { if (!(error instanceof MessageError) || error.status !== 404) throw error; }
  const lockPath = path.join(jobsDir(), `${target.targetKey}.lock`);
  // No await inside lock replacement: concurrent requests cannot remove a new lock.
  if (fsSync.existsSync(lockPath)) {
    const owner = fsSync.readFileSync(lockPath, 'utf8');
    const existing = JSON.parse(fsSync.readFileSync(path.join(jobPath(owner), 'status.json'), 'utf8')) as MessageJob;
    let alive = false;
    if (existing.workerPid) { try { process.kill(existing.workerPid, 0); alive = true; } catch {} }
    if (active(existing) && (alive || Date.now() - Date.parse(existing.startedAt) < 20_000)) throw new MessageError('session_busy', 409);
    fsSync.unlinkSync(lockPath);
  }
  let lock: number;
  try { lock = fsSync.openSync(lockPath, 'wx', 0o600); } catch { throw new MessageError('session_busy', 409); }
  fsSync.writeFileSync(lock, id); fsSync.closeSync(lock);
  const state: MessageJob = { id, targetKey: target.targetKey, status: 'starting', output: '', error: '', startedAt: new Date().toISOString() };
  let createdDirectory = false;
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    createdDirectory = true;
    await fs.writeFile(path.join(directory, 'request.json'), JSON.stringify({ ...target, id, message, lockPath, images }), { mode: 0o600 });
    await fs.writeFile(path.join(directory, 'status.json'), JSON.stringify(state), { mode: 0o600 });
    await fs.writeFile(path.join(jobsDir(), `${target.targetKey}.last`), id, { mode: 0o600 });
    const worker = path.resolve(process.cwd(), 'scripts/session-message-worker.mjs');
    if (!await exists(worker)) throw new Error('Message worker missing');
    const child = spawn(process.execPath, [worker, directory], { shell: false, windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return state;
  } catch (error) {
    await fs.unlink(lockPath).catch(() => {});
    state.status = 'failed'; state.error = error instanceof Error ? error.message : 'Worker failed';
    if (createdDirectory) await fs.writeFile(path.join(directory, 'status.json'), JSON.stringify(state), { mode: 0o600 }).catch(() => {});
    throw error;
  }
}

export async function stopMessageJob(id: string) {
  const job = await readMessageJob(id);
  if (active(job)) await fs.writeFile(path.join(jobPath(id), 'cancel'), '', { mode: 0o600 });
  return job;
}
