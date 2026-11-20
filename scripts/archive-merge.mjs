#!/usr/bin/env node
// Carries the Switchyard chat archive (data.db) between computers. Plain ESM, Node 22.5+ (node:sqlite).
//
//   node scripts/archive-merge.mjs export <file.db>          consistent copy of this computer's archive
//   node scripts/archive-merge.mjs merge <file.db[.gz]>      adds that archive's chats to this computer's archive
//
// Merge never drops a local chat: a chat in both archives keeps the copy with the newer updated_at, and chats
// deleted from the dashboard on either computer stay deleted. The archive keeps chats whose source file is gone,
// so chats from another computer stay listed and searchable. Images are served from source files, not the
// archive, so those chats show text, thinking and tool records without screenshots.
// Archive location: SWITCHYARD_DATA_DIR or ~/.switchyard/data.db (ui/app/_lib/paths.ts).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { dataDir } from './data-dir.mjs';

const archive = path.join(dataDir(), 'data.db');
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

// Same schema as ui/app/_lib/agentArchiveDb.ts, so a computer whose dashboard never ran can take an archive.
function open(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=10000');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '', source_path TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, prompt_count INTEGER NOT NULL DEFAULT 0, response_count INTEGER NOT NULL DEFAULT 0, first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_synced_at TEXT NOT NULL,
      source_mtime_ms INTEGER NOT NULL DEFAULT 0, source_size_bytes INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_provider_updated ON agent_sessions(provider, updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE, provider TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT '', ordinal INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_session_ordinal ON agent_messages(session_id, ordinal);
    CREATE TABLE IF NOT EXISTS agent_session_exclusions (session_id TEXT PRIMARY KEY, provider TEXT NOT NULL, deleted_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  for (const column of [
    "ALTER TABLE agent_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'",
    'ALTER TABLE agent_messages ADD COLUMN tool_name TEXT',
    'ALTER TABLE agent_messages ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE agent_messages ADD COLUMN queued_mid_turn INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE agent_messages ADD COLUMN asset_index INTEGER',
  ]) {
    try { db.exec(column); } catch { /* column exists */ }
  }
  return db;
}

const sessionColumns = 'id,provider,title,cwd,project,source_path,archived,prompt_count,response_count,first_seen_at,updated_at,last_synced_at,source_mtime_ms,source_size_bytes';
const messageColumns = 'id,session_id,provider,role,text,timestamp,ordinal,kind,tool_name,is_error,queued_mid_turn,asset_index';

const [command, file] = process.argv.slice(2);
if (command === 'export' && file) {
  if (!existsSync(archive)) throw new Error(`no archive at ${archive}`);
  const target = path.resolve(file);
  rmSync(target, { force: true });
  const db = new DatabaseSync(archive, { readOnly: true });
  db.prepare('VACUUM INTO ?').run(target);
  const count = (table) => Number(new DatabaseSync(target, { readOnly: true }).prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  print({ exported: target, sessions: count('agent_sessions'), messages: count('agent_messages') });
} else if (command === 'merge' && file) {
  let source = path.resolve(file);
  let temporary = null;
  if (source.endsWith('.gz')) {
    temporary = mkdtempSync(path.join(os.tmpdir(), 'archive-merge-'));
    const unpacked = path.join(temporary, 'source.db');
    writeFileSync(unpacked, gunzipSync(readFileSync(source)));
    source = unpacked;
  }
  open(source).close();
  const db = open(archive);
  try {
    db.prepare('ATTACH DATABASE ? AS src').run(source);
    db.exec('BEGIN');
    try {
      db.exec('INSERT OR IGNORE INTO main.agent_session_exclusions (session_id,provider,deleted_at) SELECT session_id,provider,deleted_at FROM src.agent_session_exclusions');
      const removed = Number(db.prepare('DELETE FROM main.agent_sessions WHERE id IN (SELECT session_id FROM main.agent_session_exclusions)').run().changes);
      db.exec(`CREATE TEMP TABLE incoming AS
        SELECT s.id, d.id IS NULL AS added FROM src.agent_sessions s LEFT JOIN main.agent_sessions d ON d.id = s.id
        WHERE s.id NOT IN (SELECT session_id FROM main.agent_session_exclusions) AND (d.id IS NULL OR s.updated_at > d.updated_at)`);
      db.exec('DELETE FROM main.agent_messages WHERE session_id IN (SELECT id FROM temp.incoming)');
      db.exec(`INSERT OR REPLACE INTO main.agent_sessions (${sessionColumns}) SELECT ${sessionColumns} FROM src.agent_sessions WHERE id IN (SELECT id FROM temp.incoming)`);
      db.exec(`INSERT OR REPLACE INTO main.agent_messages (${messageColumns}) SELECT ${messageColumns} FROM src.agent_messages WHERE session_id IN (SELECT id FROM temp.incoming)`);
      db.exec("INSERT OR IGNORE INTO main.agent_sync_meta (key,value) SELECT key,value FROM src.agent_sync_meta WHERE key LIKE 'internal:%'");
      const added = Number(db.prepare('SELECT COUNT(*) AS n FROM temp.incoming WHERE added').get().n);
      const updated = Number(db.prepare('SELECT COUNT(*) AS n FROM temp.incoming WHERE NOT added').get().n);
      const total = Number(db.prepare('SELECT COUNT(*) AS n FROM src.agent_sessions').get().n);
      db.exec('COMMIT');
      print({ archive, added, updated, unchanged: total - added - updated, removedDeleted: removed });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
} else {
  print({ error: 'usage: archive-merge.mjs export <file.db> | merge <file.db[.gz]>' });
  process.exitCode = 1;
}
