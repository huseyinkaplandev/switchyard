import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, opencodeDataDir } from './paths';
import { DatabaseSync } from 'node:sqlite';

export type AgentProvider = 'codex' | 'claude-code' | 'opencode' | 'antigravity';
/**
 * Kinds other than `text` are the records that show what actually happened
 * in a chat. Previously only text blocks were stored; tool calls, results
 * and reasoning steps were dropped entirely -- so the transcript showed
 * "what was said" but not "what was done".
 */
export type AgentMessageKind = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'attachment' | 'compaction';

export type AgentArchiveMessage = {
  id: string;
  sessionId: string;
  provider: AgentProvider;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  kind?: AgentMessageKind;
  /** Tool name for tool_use / tool_result. */
  toolName?: string;
  /** Whether tool_result returned an error. */
  isError?: boolean;
  /** Message sent while the agent was running (queued, did not open its own turn). */
  queuedMidTurn?: boolean;
  /**
   * Position of the image within the session.
   *
   * Image data NEVER ENTERS THE DATABASE -- a single screenshot is hundreds
   * of KB of base64. Instead the index is stored and the image is served from
   * the source file on request; the browser caches it.
   */
  assetIndex?: number;
};
export type AgentArchiveThread = {
  id: string;
  provider: AgentProvider;
  title: string;
  cwd: string;
  project: string;
  updatedAt: string;
  promptCount: number;
  responseCount: number;
  archived: boolean;
  sourcePath?: string;
  sourceAvailable?: boolean;
  archiveDbPath?: string;
  internal?: boolean;
};
export type AgentArchiveStatus = {
  sessionCount: number;
  messageCount: number;
  providerCounts: Record<AgentProvider, number>;
  deletedCount: number;
  dbBytes: number;
  lastSyncedAt: string | null;
  severity: 'ok' | 'warning' | 'critical';
  warning: string | null;
};

let db: DatabaseSync | null = null;

function getArchiveDb() {
  if (db) return db;
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, 'data.db'));
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=5000');
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
  /* Extra columns for existing installs. `ALTER TABLE` fails if the column
     exists; SQLite has no "IF NOT EXISTS" here, so each one is tried. */
  for (const column of [
    "ALTER TABLE agent_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'",
    'ALTER TABLE agent_messages ADD COLUMN tool_name TEXT',
    'ALTER TABLE agent_messages ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE agent_messages ADD COLUMN queued_mid_turn INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE agent_messages ADD COLUMN asset_index INTEGER',
  ]) {
    try { db.exec(column); } catch { /* column already exists */ }
  }
  return db;
}

export function archiveSessionFingerprint(id: string) {
  const row = getArchiveDb().prepare('SELECT source_mtime_ms AS sourceMtimeMs, source_size_bytes AS sourceSizeBytes FROM agent_sessions WHERE id=?').get(id) as { sourceMtimeMs?: number; sourceSizeBytes?: number } | undefined;
  return row ? { sourceMtimeMs: Number(row.sourceMtimeMs || 0), sourceSizeBytes: Number(row.sourceSizeBytes || 0) } : null;
}

export function archiveSessionIsExcluded(id: string) {
  return Boolean(getArchiveDb().prepare('SELECT 1 FROM agent_session_exclusions WHERE session_id=?').get(id));
}

export function archiveRemoveInternalClaudeSessions() {
  const database = getArchiveDb();
  const result = database.prepare("DELETE FROM agent_sessions WHERE provider='claude-code' AND (source_path LIKE '%/subagents/%' OR source_path LIKE '/private/%')").run();
  return Number(result.changes || 0);
}

export function archiveSessionUpsert(input: {
  thread: AgentArchiveThread;
  sourcePath: string;
  sourceMtimeMs: number;
  sourceSizeBytes: number;
  messages: AgentArchiveMessage[];
}) {
  const database = getArchiveDb();
  const now = new Date().toISOString();
  const firstSeenRow = database.prepare('SELECT first_seen_at AS firstSeenAt FROM agent_sessions WHERE id=?').get(input.thread.id) as { firstSeenAt?: string } | undefined;
  const firstSeen = typeof firstSeenRow?.firstSeenAt === 'string' ? firstSeenRow.firstSeenAt : undefined;
  database.exec('BEGIN');
  try {
    database.prepare(`
      INSERT INTO agent_sessions (id,provider,title,cwd,project,source_path,archived,prompt_count,response_count,first_seen_at,updated_at,last_synced_at,source_mtime_ms,source_size_bytes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,title=excluded.title,cwd=excluded.cwd,project=excluded.project,source_path=excluded.source_path,archived=excluded.archived,prompt_count=excluded.prompt_count,response_count=excluded.response_count,updated_at=excluded.updated_at,last_synced_at=excluded.last_synced_at,source_mtime_ms=excluded.source_mtime_ms,source_size_bytes=excluded.source_size_bytes
    `).run(input.thread.id, input.thread.provider, input.thread.title, input.thread.cwd, input.thread.project, input.sourcePath, input.thread.archived ? 1 : 0, input.thread.promptCount, input.thread.responseCount, firstSeen || now, input.thread.updatedAt, now, input.sourceMtimeMs, input.sourceSizeBytes);
    database.prepare('DELETE FROM agent_messages WHERE session_id=?').run(input.thread.id);
    const messageStmt = database.prepare('INSERT INTO agent_messages (id,session_id,provider,role,text,timestamp,ordinal,kind,tool_name,is_error,queued_mid_turn,asset_index) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    input.messages.forEach((message, ordinal) => messageStmt.run(message.id, input.thread.id, input.thread.provider, message.role, message.text, message.timestamp, ordinal, message.kind || 'text', message.toolName ?? null, message.isError ? 1 : 0, message.queuedMidTurn ? 1 : 0, message.assetIndex ?? null));
    database.prepare('INSERT OR REPLACE INTO agent_sync_meta (key,value) VALUES (?,?)').run(`internal:${input.thread.id}`, input.thread.internal ? 'true' : 'false');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function archiveThreads(): AgentArchiveThread[] {
  type RawThread = Omit<AgentArchiveThread, 'archived' | 'sourceAvailable' | 'internal'> & { archived: number; sourcePath: string };
  return (getArchiveDb().prepare(`SELECT id,provider,title,cwd,project,updated_at AS updatedAt,prompt_count AS promptCount,response_count AS responseCount,archived,source_path AS sourcePath FROM agent_sessions WHERE id NOT IN (SELECT session_id FROM agent_session_exclusions) AND id NOT IN (SELECT substr(key,10) FROM agent_sync_meta WHERE key LIKE 'internal:%' AND value='true') ORDER BY updated_at DESC`).all() as RawThread[]).map((row) => ({
    id: String(row.id),
    provider: row.provider === 'claude-code' ? 'claude-code' : row.provider === 'opencode' ? 'opencode' : row.provider === 'antigravity' ? 'antigravity' : 'codex',
    title: String(row.title || ''),
    cwd: String(row.cwd || ''),
    project: String(row.project || ''),
    updatedAt: String(row.updatedAt || ''),
    promptCount: Number(row.promptCount || 0),
    responseCount: Number(row.responseCount || 0),
    archived: Boolean(row.archived),
    sourcePath: String(row.sourcePath || ''),
    sourceAvailable: row.provider === 'opencode' ? fs.existsSync(path.join(opencodeDataDir(), 'opencode.db')) : fs.existsSync(String(row.sourcePath || '')),
    archiveDbPath: path.join(getDataDir(), 'data.db'),
  }));
}

export function archiveThread(id: string): AgentArchiveThread | null {
  return archiveThreads().find((thread) => thread.id === id) || null;
}

/** Read bounded previews without loading full transcripts into every catalog request. */
export function archiveActivityMessages(id: string): AgentArchiveMessage[] {
  const prefixes = ['[Request interrupted','<task-notification>','<local-command-','<command-','<system-reminder>','<ci-monitor-event>','<in-app-browser-context','<ide_','<user-memory-input>','<environment_context>','<cross-session-message','Caveat: The messages below','[Image:','Shell cwd was reset','API Error:','[No response requested'];
  const rows = getArchiveDb().prepare(`SELECT id,role,substr(text,1,1000) AS text,timestamp FROM (
    SELECT id,role,text,timestamp,ROW_NUMBER() OVER(PARTITION BY role ORDER BY julianday(timestamp) DESC,ordinal DESC) AS rank
    FROM agent_messages WHERE session_id=? AND kind='text' AND is_error=0
    AND julianday(timestamp) IS NOT NULL AND trim(text)<>''
    AND ${prefixes.map(() => 'instr(ltrim(text),?)<>1').join(' AND ')}
  ) WHERE rank=1`).all(id,...prefixes) as Array<{id:string;role:'user'|'assistant';text:string;timestamp:string}>;
  return rows.map(row=>({...row,sessionId:id,provider:'codex' as const,kind:'text' as const}));
}

export function archiveMessages(id: string): AgentArchiveMessage[] {
  const rows = getArchiveDb().prepare(`SELECT id,session_id AS sessionId,provider,role,text,timestamp,kind,tool_name AS toolName,is_error AS isError,queued_mid_turn AS queuedMidTurn,asset_index AS assetIndex FROM agent_messages WHERE session_id=? ORDER BY ordinal`).all(id) as Array<{
    id?: string; sessionId?: string; provider?: string; role?: string; text?: string; timestamp?: string;
    kind?: string; toolName?: string | null; isError?: number; queuedMidTurn?: number; assetIndex?: number | null;
  }>;
  const kinds: AgentMessageKind[] = ['text', 'thinking', 'tool_use', 'tool_result', 'attachment', 'compaction'];
  return rows.map((row) => ({
    id: String(row.id || ''),
    sessionId: String(row.sessionId || id),
    provider: row.provider === 'claude-code' ? 'claude-code' : row.provider === 'opencode' ? 'opencode' : row.provider === 'antigravity' ? 'antigravity' : 'codex',
    role: row.role === 'assistant' ? 'assistant' : 'user',
    text: String(row.text || ''),
    timestamp: String(row.timestamp || ''),
    kind: kinds.includes(row.kind as AgentMessageKind) ? (row.kind as AgentMessageKind) : 'text',
    toolName: row.toolName ? String(row.toolName) : undefined,
    isError: Boolean(row.isError),
    queuedMidTurn: Boolean(row.queuedMidTurn),
    assetIndex: typeof row.assetIndex === 'number' ? row.assetIndex : undefined,
  }));
}

export function archiveDelete(id: string) {
  const database = getArchiveDb();
  database.prepare('INSERT OR REPLACE INTO agent_session_exclusions (session_id,provider,deleted_at) SELECT id,provider,? FROM agent_sessions WHERE id=?').run(new Date().toISOString(), id);
  database.prepare('DELETE FROM agent_sessions WHERE id=?').run(id);
}

export function archivePrune(days: number) {
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
  const ids = (getArchiveDb().prepare('SELECT id FROM agent_sessions WHERE updated_at < ? AND id NOT IN (SELECT session_id FROM agent_session_exclusions)').all(cutoff) as Array<{ id?: string }>).map((row) => String(row.id || '')).filter(Boolean);
  ids.forEach(archiveDelete);
  return ids.length;
}

export function archiveSetMeta(key: string, value: string) {
  getArchiveDb().prepare('INSERT OR REPLACE INTO agent_sync_meta (key,value) VALUES (?,?)').run(key, value);
}

export function archiveGetMeta(key: string) {
  const row = getArchiveDb().prepare('SELECT value FROM agent_sync_meta WHERE key=?').get(key) as { value?: string } | undefined;
  return typeof row?.value === 'string' ? row.value : null;
}

export function archiveStatus(): AgentArchiveStatus {
  const database = getArchiveDb();
  const counts = database.prepare('SELECT provider, COUNT(*) AS count FROM agent_sessions WHERE id NOT IN (SELECT session_id FROM agent_session_exclusions) GROUP BY provider').all() as Array<{ provider: AgentProvider; count: number }>;
  const sessionCount = counts.reduce((total, row) => total + Number(row.count), 0);
  const messageCount = Number((database.prepare('SELECT COUNT(*) AS count FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions)').get() as { count: number }).count);
  const deletedCount = Number((database.prepare('SELECT COUNT(*) AS count FROM agent_session_exclusions').get() as { count: number }).count);
  const providerCounts: Record<AgentProvider, number> = { codex: 0, 'claude-code': 0, opencode: 0, antigravity: 0 };
  counts.forEach((row) => { providerCounts[row.provider] = Number(row.count); });
  const dir = getDataDir();
  const dbBytes = ['data.db', 'data.db-wal', 'data.db-shm'].reduce((total, filename) => {
    try { return total + fs.statSync(path.join(dir, filename)).size; } catch { return total; }
  }, 0);
  /* The thresholds were set when only text was stored. The archive now also
     holds tool calls and results -- measured growth is twofold -- so 50 MB
     stopped signalling "unexpected growth" and would warn constantly in normal
     use. The threshold was rescaled for the new data model; its purpose is
     unchanged: report unusual growth. */
  const severity = dbBytes >= 500 * 1024 * 1024 || sessionCount >= 10000 ? 'critical' : dbBytes >= 250 * 1024 * 1024 || sessionCount >= 5000 ? 'warning' : 'ok';
  return {
    sessionCount, messageCount, providerCounts, deletedCount, dbBytes,
    lastSyncedAt: archiveGetMeta('last_synced_at'), severity,
    warning: severity === 'critical' ? 'The archive database is very large. Delete old conversations.' : severity === 'warning' ? 'The archive database is growing. Consider pruning old conversations.' : null,
  };
}
