#!/usr/bin/env node
// Full-text search over every archived chat (Claude Code, Codex, opencode, Antigravity) for people and for agents.
//
//   node scripts/chat-search.mjs "release checklist"           words are ANDed, case- and diacritic-insensitive
//   node scripts/chat-search.mjs "migrat*" --limit 30          trailing * = prefix
//   node scripts/chat-search.mjs '"rate limit"' --role assistant --since 2026-01-01 --sort recent
//   node scripts/chat-search.mjs "deploy" --session <session id> --provider claude-code
//   node scripts/chat-search.mjs --rebuild                     drop and rebuild the index
//
// The index lives beside the archive (search-index.db, FTS5) and never touches data.db's schema: each call first adds
// the messages archived since the last call, so results are current. Only what was said is indexed (user and assistant
// text plus compaction summaries); tool calls and tool output are left out, they are most of the archive and mostly
// noise.
// Output is JSON: { query, indexed, added, hits: [{ sessionId, provider, title, project, role, at, messageId, snippet, link }] }.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { chatLink, dataDir } from './data-dir.mjs';

const dir = dataDir();
const archiveFile = path.join(dir, 'data.db');
const indexFile = path.join(dir, 'search-index.db');
const indexedKinds = "('text','compaction')";
const verifyEveryMs = 6 * 3600_000;

const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const valueFlags = new Set(['limit', 'provider', 'role', 'since', 'session', 'sort']);
const terms = args.filter((arg, at) => !arg.startsWith('--') && !valueFlags.has((args[at - 1] ?? '').replace(/^--/, '')));
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (!existsSync(archiveFile)) { print({ error: `archive not found: ${archiveFile}` }); process.exit(1); }
mkdirSync(dir, { recursive: true });
if (args.includes('--rebuild')) for (const suffix of ['', '-wal', '-shm']) rmSync(indexFile + suffix, { force: true });

const db = new DatabaseSync(indexFile);
db.exec('PRAGMA busy_timeout=20000; PRAGMA journal_mode=WAL');
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(text, message_id UNINDEXED, session_id UNINDEXED,
  provider UNINDEXED, role UNINDEXED, at UNINDEXED, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
db.prepare('ATTACH DATABASE ? AS archive').run(archiveFile);

const meta = (key) => db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
const setMeta = (key, value) => db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));

function addSince(rowid) {
  const result = db.prepare(`INSERT INTO messages (text, message_id, session_id, provider, role, at)
    SELECT text, id, session_id, provider, role, timestamp FROM archive.agent_messages
    WHERE rowid > ? AND kind IN ${indexedKinds} AND length(text) > 0`).run(rowid);
  const top = db.prepare('SELECT max(rowid) AS top FROM archive.agent_messages').get().top ?? 0;
  setMeta('lastRowid', top);
  return Number(result.changes);
}

// Messages are re-imported (deleted and inserted again) when a transcript changes, which can reuse rowids: every few
// hours the row counts are compared and the index is rebuilt when they differ. A rebuild of tens of thousands of messages takes seconds.
let added = 0;
db.exec('BEGIN IMMEDIATE');
try {
  added = addSince(Number(meta('lastRowid') ?? 0));
  if (Date.now() - Number(meta('verifiedAt') ?? 0) > verifyEveryMs) {
    const expected = db.prepare(`SELECT count(*) AS total FROM archive.agent_messages WHERE kind IN ${indexedKinds} AND length(text) > 0`).get().total;
    const actual = db.prepare('SELECT count(*) AS total FROM messages').get().total;
    if (expected !== actual) { db.exec('DELETE FROM messages'); added = addSince(0); }
    setMeta('verifiedAt', Date.now());
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
const indexed = db.prepare('SELECT count(*) AS total FROM messages').get().total;

if (!terms.length) { print({ indexed, added, index: indexFile }); process.exit(0); }

// Plain words become quoted FTS terms joined by AND; a trailing * keeps its prefix meaning; a term the caller already
// quoted is a phrase and passes through.
const query = terms.join(' ').trim();
const match = (query.match(/"[^"]+"|\S+/g) ?? []).map((token) => {
  if (token.startsWith('"')) return token;
  const prefix = token.endsWith('*');
  const word = token.replace(/\*+$/, '').replace(/"/g, '');
  return word ? `"${word}"${prefix ? '*' : ''}` : '';
}).filter(Boolean).join(' AND ');

const filters = [];
const values = [];
for (const [name, column] of [['provider', 'messages.provider'], ['role', 'messages.role'], ['session', 'messages.session_id']]) {
  if (flag(name)) { filters.push(`${column} = ?`); values.push(flag(name)); }
}
if (flag('since')) { filters.push('messages.at >= ?'); values.push(flag('since')); }
const limit = Math.min(Math.max(Number(flag('limit') ?? 20) || 20, 1), 200);
const order = flag('sort') === 'recent' ? 'messages.at DESC' : 'bm25(messages), messages.at DESC';

// The join drops hits whose message was deleted or re-imported since it was indexed, and hidden sessions.
const hits = db.prepare(`SELECT messages.session_id AS sessionId, messages.provider AS provider, sessions.title AS title,
    sessions.project AS project, messages.role AS role, messages.at AS at, messages.message_id AS messageId,
    snippet(messages, 0, '«', '»', '…', 28) AS snippet
  FROM messages
  JOIN archive.agent_messages AS live ON live.id = messages.message_id
  JOIN archive.agent_sessions AS sessions ON sessions.id = messages.session_id
  WHERE messages MATCH ? ${filters.map((filter) => `AND ${filter}`).join(' ')}
    AND messages.session_id NOT IN (SELECT session_id FROM archive.agent_session_exclusions)
  ORDER BY ${order} LIMIT ?`).all(match, ...values, limit).map((hit) => ({
  ...hit, snippet: String(hit.snippet).replace(/\s+/g, ' ').trim(),
  link: chatLink(hit.provider, hit.sessionId),
}));

print({ query, indexed, added, hits });
