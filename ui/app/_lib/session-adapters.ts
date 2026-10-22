import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SessionMessage, SessionPlatform, SessionSource } from './sessions';

export type AdapterSession = { key: string; file: string; source: SessionSource; platform: SessionPlatform; title: string; updatedAt: string; archived: boolean; readable: boolean; nativeId?: string };
type Home = { home: string; platform: SessionPlatform };

function iso(value: unknown, fallback: string): string {
  if (typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return fallback;
}

function withDb<T>(file: string, run: (db: DatabaseSync) => T): T | null {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return run(db); } finally { db.close(); }
  } catch { return null; }
}

function appSupport(home: string, platform: SessionPlatform, app: string): string {
  return platform === 'macos' ? path.join(home, 'Library', 'Application Support', app) : path.join(home, 'AppData', 'Roaming', app);
}

export async function scanAdapterSessions(homes: Home[]): Promise<AdapterSession[]> {
  const out: AdapterSession[] = [];
  for (const { home, platform } of homes) {
    const vscodeDb = path.join(appSupport(home, platform, 'Code'), 'User', 'globalStorage', 'github.copilot-chat', 'session-store.db');
    const vs = withDb(vscodeDb, db => db.prepare('SELECT id, summary, updated_at FROM sessions').all() as Array<{ id: string; summary: string; updated_at: string }>);
    for (const row of vs || []) out.push({ key: `vscode:${vscodeDb}:${row.id}`, file: vscodeDb, source: 'vscode', platform, nativeId: row.id, title: row.summary || row.id, updatedAt: iso(row.updated_at, new Date(0).toISOString()), archived: false, readable: true });

    const insidersRoot = path.join(appSupport(home, platform, 'Code - Insiders'), 'User', 'workspaceStorage');
    async function scanInsiders(current: string): Promise<void> {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) await scanInsiders(file);
        else if ((path.basename(path.dirname(file)) === 'chatSessions' && entry.name.endsWith('.jsonl')) || entry.name === 'chatSessions.jsonl') {
          const stat = await fs.stat(file);
          out.push({ key: `vscode-insiders:${file}`, file, source: 'vscode-insiders', platform, title: entry.name.replace(/\.jsonl$/, ''), updatedAt: stat.mtime.toISOString(), archived: false, readable: true });
        }
      }
    }
    await scanInsiders(insidersRoot);

    const openDb = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
    const oc = withDb(openDb, db => db.prepare('SELECT id, title, time_updated, time_archived FROM session').all() as Array<{ id: string; title: string; time_updated: number; time_archived: number | null }>);
    for (const row of oc || []) out.push({ key: `opencode:${openDb}:${row.id}`, file: openDb, source: 'opencode', platform, nativeId: row.id, title: row.title || row.id, updatedAt: iso(row.time_updated, new Date(0).toISOString()), archived: !!row.time_archived, readable: true });

    const kiroRoot = path.join(appSupport(home, platform, 'Kiro'), 'User', 'globalStorage', 'kiro.kiroagent', 'workspace-sessions');
    async function scanKiro(current: string): Promise<void> {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) await scanKiro(file);
        else if (entry.name.endsWith('.json')) {
          try {
            const stat = await fs.stat(file);
            const data = JSON.parse(await fs.readFile(file, 'utf8'));
            if (!Array.isArray(data.history)) continue;
            out.push({ key: `kiro:${file}`, file, source: 'kiro', platform, title: data.title || path.basename(file, '.json'), updatedAt: stat.mtime.toISOString(), archived: false, readable: true });
          } catch { /* Skip corrupt session. */ }
        }
      }
    }
    await scanKiro(kiroRoot);

    const cursorDb = path.join(appSupport(home, platform, 'Cursor'), 'User', 'globalStorage', 'state.vscdb');
    const composers = withDb(cursorDb, db => db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as Array<{ key: string; value: string }>);
    for (const row of composers || []) {
      try {
        const data = JSON.parse(row.value);
        const id = row.key.slice('composerData:'.length);
        out.push({ key: `cursor:${cursorDb}:${id}`, file: cursorDb, source: 'cursor', platform, nativeId: id, title: data.name || data.text || id, updatedAt: iso(data.createdAt, new Date(0).toISOString()), archived: false, readable: Array.isArray(data.fullConversationHeadersOnly) && data.fullConversationHeadersOnly.length > 0 });
      } catch { /* Skip corrupt composer. */ }
    }
  }
  return out;
}

export async function readAdapterMessages(item: AdapterSession): Promise<SessionMessage[]> {
  const nativeId = item.nativeId;
  if (item.source === 'vscode' && nativeId) return withDb(item.file, db => {
    const rows = db.prepare('SELECT user_message, assistant_response, timestamp FROM turns WHERE session_id = ? ORDER BY turn_index').all(nativeId) as Array<{ user_message: string; assistant_response: string; timestamp: string }>;
    return rows.flatMap(row => [
      ...(row.user_message ? [{ role: 'user' as const, text: row.user_message, timestamp: row.timestamp }] : []),
      ...(row.assistant_response ? [{ role: 'assistant' as const, text: row.assistant_response, timestamp: row.timestamp }] : []),
    ]);
  }) || [];
  if (item.source === 'opencode' && nativeId) return withDb(item.file, db => {
    const rows = db.prepare('SELECT m.data AS message, p.data AS part, p.time_created AS at FROM part p JOIN message m ON m.id = p.message_id WHERE p.session_id = ? ORDER BY p.time_created, p.id').all(nativeId) as Array<{ message: string; part: string; at: number }>;
    return rows.flatMap(row => {
      try {
        const message = JSON.parse(row.message), part = JSON.parse(row.part);
        if (part.type !== 'text' || typeof part.text !== 'string' || !part.text.trim()) return [];
        if (message.role !== 'user' && message.role !== 'assistant') return [];
        return [{ role: message.role as 'user' | 'assistant', text: part.text, timestamp: iso(row.at, '') }];
      } catch { return []; }
    });
  }) || [];
  if (item.source === 'kiro') {
    const data = JSON.parse(await fs.readFile(item.file, 'utf8'));
    return (data.history || []).flatMap((entry: { message?: { role?: string; content?: Array<{ type?: string; text?: string }> | string } }) => {
      const role = entry.message?.role;
      const content = entry.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') : '';
      return (role === 'user' || role === 'assistant') && text ? [{ role, text }] : [];
    });
  }
  if (item.source === 'vscode-insiders') {
    const lines = (await fs.readFile(item.file, 'utf8')).split(/\r?\n/);
    const requests = new Map<string, unknown>();
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.kind === 0 && Array.isArray(record.v?.requests)) for (const req of record.v.requests) requests.set(req.requestId, req);
        if (record.kind === 2 && Array.isArray(record.v)) for (const req of record.v) requests.set(req.requestId, req);
      } catch { /* Skip incomplete line. */ }
    }
    const messages: SessionMessage[] = [];
    for (const req of requests.values()) {
      const row = req as { message?: { text?: string }; response?: Array<{ value?: string; content?: string }> | string; timestamp?: number };
      if (row.message?.text) messages.push({ role: 'user', text: row.message.text, timestamp: iso(row.timestamp, '') });
      const text = Array.isArray(row.response) ? row.response.map(part => part.value || part.content || '').join('\n') : typeof row.response === 'string' ? row.response : '';
      if (text.trim()) messages.push({ role: 'assistant', text, timestamp: iso(row.timestamp, '') });
    }
    return messages;
  }
  if (item.source === 'cursor' && nativeId) return withDb(item.file, db => {
    const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(`composerData:${nativeId}`) as { value: string } | undefined;
    if (!row) return [];
    const data = JSON.parse(row.value);
    return (data.fullConversationHeadersOnly || []).flatMap((entry: { type?: string; text?: string }) => {
      const role = entry.type === 'user' ? 'user' : entry.type === 'assistant' ? 'assistant' : null;
      return role && entry.text ? [{ role, text: entry.text }] : [];
    });
  }) || [];
  return [];
}
