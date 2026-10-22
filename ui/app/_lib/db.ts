import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { getDataDir } from './paths';

let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (_db) return _db;
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  _db = new DatabaseSync(path.join(dir, 'data.db'));
  _db.exec('PRAGMA journal_mode=WAL');
  _db.exec('PRAGMA busy_timeout=5000');
  _db.exec('PRAGMA foreign_keys=ON');
  migrate(_db);
  return _db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS roles (
      role TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inbox',
      assignee TEXT,
      role TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      created TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      filename TEXT
    );
    CREATE TABLE IF NOT EXISTS mentions_read (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS agents_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      message TEXT NOT NULL,
      raw TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal',
      assignee TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      prompt_count INTEGER NOT NULL DEFAULT 0,
      response_count INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_synced_at TEXT NOT NULL,
      source_mtime_ms INTEGER NOT NULL DEFAULT 0,
      source_size_bytes INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_provider_updated
      ON agent_sessions(provider, updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      text TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT '',
      ordinal INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session_ordinal
      ON agent_messages(session_id, ordinal);
    CREATE TABLE IF NOT EXISTS agent_session_exclusions (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      deleted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate old drafts table (INTEGER PK → TEXT PK) if present
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='drafts'").get() as { sql: string } | undefined;
  if (tableInfo && !tableInfo.sql.includes('id TEXT PRIMARY KEY')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS drafts_migrate (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        assignee TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO drafts_migrate (id, title, body, priority, assignee, created_at, updated_at)
        SELECT CAST(id AS TEXT), '', body, priority, assignee, updated_at, updated_at FROM drafts;
      DROP TABLE drafts;
      ALTER TABLE drafts_migrate RENAME TO drafts;
    `);
  }

  // Backfill filename for existing rows that lack it
  const missing = db.prepare("SELECT id,title FROM tasks WHERE filename IS NULL OR filename=''").all() as { id: string; title: string }[];
  const stmt = db.prepare('UPDATE tasks SET filename=? WHERE id=?');
  for (const r of missing) {
    stmt.run(generateFilename(r.id, r.title), r.id);
  }
}

// ── Config (lead, agentsMd) ──────────────────────────────────────────

export function configGet(key: string): string | null {
  const row = plain(getDb().prepare('SELECT value FROM config WHERE key=?').get(key) as { value: string } | undefined);
  return row?.value ?? null;
}

export function configSet(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO config (key,value) VALUES (?,?)').run(key, value);
}

// ── Roles ────────────────────────────────────────────────────────────

export function rolesGetAll(): Record<string, string> {
  const rows = plainAll(getDb().prepare('SELECT role,agent_id FROM roles').all() as { role: string; agent_id: string }[]);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.role] = r.agent_id;
  return map;
}

export function rolesReplaceAll(map: Record<string, string>): void {
  const db = getDb();
  db.exec('DELETE FROM roles');
  const stmt = db.prepare('INSERT INTO roles (role,agent_id) VALUES (?,?)');
  for (const [role, agentId] of Object.entries(map)) {
    stmt.run(role, agentId);
  }
}

// ── Tasks ────────────────────────────────────────────────────────────

export type TaskRow = {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
  role: string | null;
  priority: string;
  created: string;
  body: string;
  filename: string | null;
};

function generateFilename(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return `${id}-${slug}.md`;
}

function plain<T extends object>(row: T | undefined): T | null {
  return row ? Object.assign({}, row) : null;
}
function plainAll<T extends object>(rows: T[]): T[] {
  return rows.map(r => Object.assign({}, r));
}

export function tasksGetAll(): TaskRow[] {
  return plainAll(getDb().prepare('SELECT * FROM tasks ORDER BY id').all() as TaskRow[]);
}

export function taskGet(id: string): TaskRow | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
  return plain(row);
}

export function taskUpsert(row: TaskRow): void {
  const filename = row.filename ?? generateFilename(row.id, row.title);
  getDb().prepare(`
    INSERT OR REPLACE INTO tasks (id,title,status,assignee,role,priority,created,body,filename)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(row.id, row.title, row.status, row.assignee, row.role, row.priority, row.created, row.body, filename);
}

export function taskUpdate(id: string, fields: Partial<Omit<TaskRow, 'id'>>): void {
  if ('title' in fields && !('filename' in fields)) {
    const title = (fields as any).title;
    (fields as any).filename = generateFilename(id, title);
  }
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  const setClauses = keys.map(k => `${k}=?`).join(',');
  const values = keys.map(k => (fields as any)[k]);
  values.push(id);
  getDb().prepare(`UPDATE tasks SET ${setClauses} WHERE id=?`).run(...values);
}

export function taskDelete(id: string): void {
  getDb().prepare('DELETE FROM tasks WHERE id=?').run(id);
}

export function taskExists(id: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM tasks WHERE id=?').get(id);
  return !!row;
}

// ── Mentions Read ────────────────────────────────────────────────────

export function mentionsReadGetAll(): Set<string> {
  const rows = plainAll(getDb().prepare('SELECT id FROM mentions_read').all() as { id: string }[]);
  return new Set(rows.map(r => r.id));
}

export function mentionsReadAdd(ids: string[]): void {
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO mentions_read (id) VALUES (?)');
  for (const id of ids) stmt.run(id);
}

// ── Logs ─────────────────────────────────────────────────────────────

export function logInsert(ts: string, role: string, agentId: string, message: string, raw: string): void {
  try {
    getDb().prepare('INSERT OR IGNORE INTO logs (ts,role,agent_id,message,raw) VALUES (?,?,?,?,?)').run(ts, role, agentId, message, raw);
  } catch {
    // ignore duplicate or errors
  }
}

export function logsGetLast(n: number): TaskRow[] {
  return plainAll(getDb().prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(n) as TaskRow[]);
}

// ── Agents History ───────────────────────────────────────────────────

export function historyInsert(ts: string, filename: string, content: string): void {
  getDb().prepare('INSERT INTO agents_history (ts,filename,content) VALUES (?,?,?)').run(ts, filename, content);
}

export function historyGetAll(): { id: number; ts: string; filename: string; content: string }[] {
  return plainAll(getDb().prepare('SELECT * FROM agents_history ORDER BY id DESC').all() as any[]);
}

export function historyGetById(id: number): string | null {
  const row = plain(getDb().prepare('SELECT content FROM agents_history WHERE id=?').get(id) as { content: string } | undefined);
  return row?.content ?? null;
}

export function historyPrune(maxRows: number): void {
  getDb().prepare(`
    DELETE FROM agents_history WHERE id NOT IN (SELECT id FROM agents_history ORDER BY id DESC LIMIT ?)
  `).run(maxRows);
}

// ── Drafts ────────────────────────────────────────────────────

export type DraftRow = {
  id: string;
  title: string;
  body: string;
  priority: string;
  assignee: string | null;
  created_at: string;
  updated_at: string;
};

export function draftList(): DraftRow[] {
  return plainAll(getDb().prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all() as DraftRow[]);
}

export function draftGetById(id: string): DraftRow | null {
  const row = getDb().prepare('SELECT * FROM drafts WHERE id=?').get(id) as DraftRow | undefined;
  return plain(row);
}

export function draftCreate(row: { id: string; title: string; body: string; priority: string; assignee: string | null }): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO drafts (id,title,body,priority,assignee,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(row.id, row.title, row.body, row.priority, row.assignee, now, now);
}

export function draftUpdate(id: string, fields: Partial<Pick<DraftRow, 'title' | 'body' | 'priority' | 'assignee'>>): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  const setClauses = [...keys.map(k => `${k}=?`), 'updated_at=?'].join(',');
  const values = [...keys.map(k => (fields as any)[k]), new Date().toISOString(), id];
  getDb().prepare(`UPDATE drafts SET ${setClauses} WHERE id=?`).run(...values);
}

export function draftDelete(id: string): void {
  getDb().prepare('DELETE FROM drafts WHERE id=?').run(id);
}
