import 'server-only';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { antigravityHome, codexHome, homeDir, secondaryMacHome } from './paths';
import readline from 'node:readline';
import { readAdapterMessages, scanAdapterSessions, type AdapterSession } from './session-adapters';

export type SessionSource = 'codex' | 'claude' | 'antigravity' | 'cursor' | 'vscode' | 'vscode-insiders' | 'opencode' | 'kiro';
export type SessionPlatform = 'windows' | 'macos';
export type LocalSession = {
  id: string;
  source: SessionSource;
  platform: SessionPlatform;
  title: string;
  updatedAt: string;
  archived: boolean;
  readable: boolean;
};
export type SessionMessage = { role: 'user' | 'assistant'; text: string; timestamp?: string };

type LocatedSession = LocalSession & { file: string; adapter?: AdapterSession };
let cached: { at: number; sessions: LocatedSession[] } | null = null;

async function walk(dir: string, extensions: Set<string>, out: string[]): Promise<void> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file, extensions, out);
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) out.push(file);
  }
}

function localHomes(): Array<{ home: string; platform: SessionPlatform }> {
  const homes: Array<{ home: string; platform: SessionPlatform }> = [{ home: homeDir(), platform: process.platform === 'darwin' ? 'macos' : 'windows' }];
  const macHome = secondaryMacHome();
  if (macHome) homes.push({ home: macHome, platform: 'macos' });
  return homes;
}

function roots(): Array<{ dir: string; source: SessionSource; platform: SessionPlatform; archived: boolean; extensions: Set<string> }> {
  return localHomes().flatMap(({ home, platform }) => {
    const local = home === homeDir();
    const codex = local ? codexHome() : path.join(home, '.codex');
    const antigravity = local ? antigravityHome() : path.join(home, '.gemini', 'antigravity');
    return [
      { dir: path.join(codex, 'sessions'), source: 'codex' as const, platform, archived: false, extensions: new Set(['.jsonl']) },
      { dir: path.join(codex, 'archived_sessions'), source: 'codex' as const, platform, archived: true, extensions: new Set(['.jsonl']) },
      { dir: path.join(home, '.claude', 'projects'), source: 'claude' as const, platform, archived: false, extensions: new Set(['.jsonl']) },
      { dir: path.join(antigravity, 'conversations'), source: 'antigravity' as const, platform, archived: false, extensions: new Set(['.db', '.pb']) },
    ];
  });
}

function codexResponseText(payload: { content?: Array<{ type?: string; text?: string }> }): string {
  return Array.isArray(payload.content)
    ? payload.content.filter(part => part?.type === 'input_text' || part?.type === 'output_text')
      .map(part => part.text || '').filter(text => !/^<image\b[^>]*>$/.test(text.trim()) && text.trim() !== '</image>').join('\n') : '';
}

async function firstUserText(file: string, source: SessionSource): Promise<string> {
  if (source === 'antigravity') return path.basename(file, path.extname(file));
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (source === 'codex' && item.type === 'event_msg' && item.payload?.type === 'user_message') {
          return String(item.payload.message || '').slice(0, 160);
        }
        if (source === 'codex' && item.type === 'response_item' && item.payload?.type === 'message' && item.payload.role === 'user') {
          const text = codexResponseText(item.payload);
          if (text) return text.slice(0, 160);
        }
        if (source === 'claude' && item.type === 'user' && item.message?.role === 'user' && typeof item.message.content === 'string') {
          return item.message.content.slice(0, 160);
        }
      } catch { /* A malformed line does not hide later messages. */ }
    }
  } finally { lines.close(); }
  return path.basename(file, path.extname(file));
}

async function scan(): Promise<LocatedSession[]> {
  if (cached && Date.now() - cached.at < 30_000) return cached.sessions;
  const found: LocatedSession[] = [];
  for (const root of roots()) {
    const files: string[] = [];
    await walk(root.dir, root.extensions, files);
    for (const file of files) {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) continue;
      const id = crypto.createHash('sha256').update(`${root.platform}:${root.source}:${file}`).digest('hex');
      const title = await firstUserText(file, root.source).catch(() => path.basename(file));
      found.push({ id, source: root.source, platform: root.platform, title: title || path.basename(file),
        updatedAt: stat.mtime.toISOString(), archived: root.archived, readable: root.source !== 'antigravity', file });
    }
  }
  for (const adapter of await scanAdapterSessions(localHomes())) {
    const id = crypto.createHash('sha256').update(adapter.key).digest('hex');
    found.push({ id, source: adapter.source, platform: adapter.platform, title: adapter.title,
      updatedAt: adapter.updatedAt, archived: adapter.archived, readable: adapter.readable, file: adapter.file, adapter });
  }
  found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  cached = { at: Date.now(), sessions: found };
  return found;
}

export async function listLocalSessions(): Promise<LocalSession[]> {
  return (await scan()).map(({ file: _file, adapter: _adapter, ...session }) => session);
}

/** Internal resolver; paths and native IDs never accepted from a browser. */
export async function locateLocalSession(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  return (await scan()).find(session => session.id === id) || null;
}

export async function localSessionRevision(id: string) {
  const item = await locateLocalSession(id);
  if (!item) return null;
  const info = await fs.stat(item.file).catch(() => null);
  if (!info) return null;
  const wal = await fs.stat(`${item.file}-wal`).catch(() => null);
  return `"${crypto.createHash('sha256').update(`${id}:${info.size}:${info.mtimeMs}:${wal?.size}:${wal?.mtimeMs}`).digest('hex')}"`;
}

export async function getLocalSession(id: string): Promise<{ session: LocalSession; messages: SessionMessage[] } | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const item = (await scan()).find(session => session.id === id);
  if (!item) return null;
  const { file, adapter, ...session } = item;
  const messages: SessionMessage[] = [];
  const codexEvents: SessionMessage[] = [];
  if (!item.readable) return { session, messages };
  if (adapter) return { session, messages: await readAdapterMessages(adapter) };
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (item.source === 'codex' && record.type === 'event_msg') {
          const role = record.payload?.type === 'user_message' ? 'user' : record.payload?.type === 'agent_message' ? 'assistant' : null;
          const text = role === 'user' ? record.payload?.message : record.payload?.message;
          if (role && typeof text === 'string' && text.trim()) codexEvents.push({ role, text, timestamp: record.timestamp });
        }
        if (item.source === 'codex' && record.type === 'response_item' && record.payload?.type === 'message') {
          const role = record.payload.role;
          const text = codexResponseText(record.payload);
          if ((role === 'user' || role === 'assistant') && text.trim()) messages.push({ role, text, timestamp: record.timestamp });
        }
        if (item.source === 'claude' && (record.type === 'user' || record.type === 'assistant')) {
          const content = record.message?.content;
          const text = typeof content === 'string' ? content : Array.isArray(content)
            ? content.filter((part: { type?: string }) => part?.type === 'text').map((part: { text?: string }) => part.text || '').join('\n') : '';
          if (text.trim()) messages.push({ role: record.type, text, timestamp: record.timestamp });
        }
      } catch { /* Ignore malformed entries. */ }
    }
  } finally { lines.close(); }
  return { session, messages: item.source === 'codex' && !messages.length ? codexEvents : messages };
}
