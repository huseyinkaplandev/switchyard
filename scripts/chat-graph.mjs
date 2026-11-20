#!/usr/bin/env node
// One-line digest per chat plus an entity graph over every archived chat, so an agent finds the right chat in one row
// instead of twenty snippets.
//
//   node scripts/chat-graph.mjs build                 incremental: digest + edges for chats changed since last build
//   node scripts/chat-graph.mjs last --limit 10        the newest chats, one line each
//   node scripts/chat-graph.mjs find "release"         chats whose digest matches (FTS, diacritic-insensitive)
//   node scripts/chat-graph.mjs who file:ui/page.tsx   every chat that touched an entity, newest first
//   node scripts/chat-graph.mjs entities --kind project --limit 20     busiest entities
//   node scripts/chat-graph.mjs show <session id>      that chat's digest, entities and neighbours
//   node scripts/chat-graph.mjs graph --kind project,file --limit 80 [--focus project:api] [--min 2]
//                                                      nodes plus entity-to-entity links (shared chats)
//
// No model is used: the first user prompt says what the chat was for and the last assistant message says how it
// ended. Two entity kinds are built in: project (the chat's project folder) and file (file paths named in the chat).
// Your own kinds come from an optional <data dir>/chat-graph.json:
//
//   {
//     "kinds": { "customer": ["Acme", { "name": "Globex", "aliases": ["Globex Corp"] }], "service": ["billing-api"] },
//     "patterns": { "ticket": "\\b[A-Z]{2,6}-\\d+\\b" },
//     "genericFiles": ["README.md"],
//     "skipPrompts": ["^\\[cron\\]"]
//   }
//
// kinds: names matched as whole words, case-sensitive. patterns: one regex per kind, the whole match is the entity.
// genericFiles: bare file names too common to mean one file. skipPrompts: user messages that are machine-written and
// should not become a chat's "asked" line. Everything lives in search-index.db beside chat-search.mjs; data.db is
// read-only.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { chatLink, dataDir } from './data-dir.mjs';

const dir = dataDir();
const archiveFile = path.join(dir, 'data.db');
const indexFile = path.join(dir, 'search-index.db');
const configFile = path.join(dir, 'chat-graph.json');

const args = process.argv.slice(2);
const command = args[0] ?? 'build';
const flag = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const valueFlags = ['limit', 'kind', 'since', 'focus', 'min'];
const terms = args.slice(1).filter((arg, at) => !arg.startsWith('--') && !valueFlags.includes((args.slice(1)[at - 1] ?? '').replace(/^--/, '')));
const limit = Math.min(Number(flag('limit')) || 10, 200);
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const clip = (text, max) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

if (!existsSync(archiveFile)) { print({ error: `archive not found: ${archiveFile}` }); process.exit(1); }
const db = new DatabaseSync(indexFile);
db.exec('PRAGMA busy_timeout=20000; PRAGMA journal_mode=WAL');
db.exec(`CREATE TABLE IF NOT EXISTS digests (session_id TEXT PRIMARY KEY, provider TEXT, title TEXT, project TEXT,
    started_at TEXT, updated_at TEXT, msgs INTEGER, asked TEXT, answered TEXT, built_at TEXT);
  CREATE VIRTUAL TABLE IF NOT EXISTS digest_fts USING fts5(text, session_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS edges (entity TEXT, kind TEXT, session_id TEXT, at TEXT,
    PRIMARY KEY (entity, session_id));
  CREATE INDEX IF NOT EXISTS edges_session ON edges(session_id);
  CREATE INDEX IF NOT EXISTS edges_kind ON edges(kind, entity);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
db.prepare('ATTACH DATABASE ? AS archive').run(archiveFile);

const defaultGenericFiles = ['SKILL.md', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'MEMORY.md', 'index.ts', 'index.js',
  'package.json', 'route.ts', 'page.tsx', 'layout.tsx', 'tsconfig.json', 'settings.json'];
const configText = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '{}';
const config = (() => {
  try { return JSON.parse(configText); } catch (error) {
    print({ error: `${configFile} is not valid JSON: ${error.message}` });
    process.exit(1);
  }
})();
const genericFiles = new Set(config.genericFiles ?? defaultGenericFiles);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kindName = (kind) => kind.toLowerCase().replace(/[^a-z0-9_-]/g, '');
// Whole-word and case-sensitive, so a name that is also a common word only matches when it is written as the name.
const namedEntities = Object.entries(config.kinds ?? {}).flatMap(([kind, entries]) => entries.flatMap((entry) => {
  const name = typeof entry === 'string' ? entry : entry.name;
  const spellings = typeof entry === 'string' ? [entry] : [entry.name, ...(entry.aliases ?? [])];
  return spellings.filter(Boolean).map((spelling) => ({
    entity: `${kindName(kind)}:${name}`,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(spelling)}(?![\\p{L}\\p{N}])`, 'u'),
  }));
}));
const patternEntities = Object.entries(config.patterns ?? {}).map(([kind, source]) => ({
  kind: kindName(kind), pattern: new RegExp(source, 'gu'),
}));
const skipPrompts = ['^<scheduled-task', ...(config.skipPrompts ?? [])].map((source) => new RegExp(source, 'u'));
const customKinds = [...new Set([...Object.keys(config.kinds ?? {}), ...Object.keys(config.patterns ?? {})].map(kindName))];
// Bump when the rules below change: build() then re-reads every chat, not only the changed ones. A changed config
// does the same.
const extractionVersion = `1:${createHash('sha256').update(configText).digest('hex').slice(0, 12)}`;

function fileEntity(raw) {
  const parts = raw.replace(/^\.\//, '').split('/');
  if (parts.length === 1) return genericFiles.has(parts[0]) ? null : parts[0];
  return parts.slice(-2).join('/');
}

function entitiesOf(text, title, project) {
  const found = new Set();
  const haystack = `${title}\n${text}`;
  if (project) found.add(`project:${project}`);
  for (const named of namedEntities) if (named.pattern.test(haystack)) found.add(named.entity);
  for (const { kind, pattern } of patternEntities) {
    for (const hit of haystack.matchAll(pattern)) if (hit[0] && hit[0].length <= 60) found.add(`${kind}:${hit[0]}`);
  }
  const files = /\b[\w-]+(?:\/[\w.-]+)*\.(?:ts|tsx|mjs|cjs|js|jsx|md|json|py|go|rs|rb|java|cs|sql|sh|ps1|ya?ml|toml|css|html)\b/g;
  for (const file of haystack.match(files) ?? []) {
    const entity = fileEntity(file);
    if (entity && entity.length <= 48) found.add(`file:${entity}`);
  }
  return [...found].slice(0, 60);
}

// A bare "server.ts" and "api/server.ts" are one file when only one such path is known.
function mergeBareFiles() {
  const byName = new Map();
  for (const { entity } of db.prepare("select distinct entity from edges where kind = 'file' and entity like '%/%'").all()) {
    const name = entity.split('/').at(-1);
    byName.set(name, byName.has(name) ? null : entity);
  }
  let merged = 0;
  for (const [name, full] of byName) {
    if (!full) continue;
    merged += Number(db.prepare('update or ignore edges set entity = ? where entity = ?').run(full, `file:${name}`).changes);
    db.prepare('delete from edges where entity = ?').run(`file:${name}`);
  }
  return merged;
}

function build() {
  if (db.prepare("select value from meta where key = 'graphVersion'").get()?.value !== extractionVersion) {
    db.exec("update digests set built_at = ''");
    db.prepare("insert into meta (key, value) values ('graphVersion', ?) on conflict(key) do update set value = excluded.value")
      .run(extractionVersion);
  }
  const sessions = db.prepare(`select s.id, s.provider, s.title, s.project, s.updated_at,
      (select count(*) from archive.agent_messages m where m.session_id = s.id and m.kind in ('text','compaction')) msgs
    from archive.agent_sessions s
    where msgs > 0 and (s.updated_at > coalesce((select built_at from digests d where d.session_id = s.id), ''))
      and s.id not in (select session_id from archive.agent_session_exclusions)
    order by s.updated_at desc`).all();
  const messages = db.prepare(`select role, text, timestamp from archive.agent_messages
    where session_id = ? and kind in ('text','compaction') order by ordinal`);
  const insert = db.prepare(`insert or replace into digests
    (session_id, provider, title, project, started_at, updated_at, msgs, asked, answered, built_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const edge = db.prepare('insert or replace into edges (entity, kind, session_id, at) values (?, ?, ?, ?)');
  let built = 0;
  let edgeCount = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    // A chat hidden after it was indexed leaves the graph too.
    db.exec(`delete from edges where session_id in (select session_id from archive.agent_session_exclusions);
      delete from digest_fts where session_id in (select session_id from archive.agent_session_exclusions);
      delete from digests where session_id in (select session_id from archive.agent_session_exclusions)`);
    for (const session of sessions) {
      const rows = messages.all(session.id);
      const asks = rows.filter((row) => row.role === 'user');
      const replies = rows.filter((row) => row.role === 'assistant');
      // What the chat was asked, and how it ended: an agent's closing message is already its own summary.
      const asked = clip(asks.find((row) => !skipPrompts.some((pattern) => pattern.test(row.text.trim())))?.text
        ?? asks[0]?.text ?? '', 400);
      const answered = clip(replies.at(-1)?.text ?? '', 700);
      // Entities are read from both ends of the chat: a long chat names what it settled on near its close.
      const whole = rows.map((row) => row.text).join('\n');
      const sample = [asked, answered, whole.slice(0, 14000), whole.slice(-14000)].join('\n');
      db.prepare('delete from digest_fts where session_id = ?').run(session.id);
      db.prepare('insert into digest_fts (text, session_id) values (?, ?)')
        .run(`${session.title}\n${session.project}\n${asked}\n${answered}`, session.id);
      db.prepare('delete from edges where session_id = ?').run(session.id);
      for (const entity of entitiesOf(sample, session.title ?? '', session.project ?? '')) {
        edge.run(entity, entity.split(':')[0], session.id, session.updated_at);
        edgeCount += 1;
      }
      insert.run(session.id, session.provider, session.title, session.project,
        rows[0]?.timestamp ?? '', session.updated_at, session.msgs, asked, answered, session.updated_at);
      built += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const merged = built ? mergeBareFiles() : 0;
  print({ built, edges: edgeCount, merged, digests: db.prepare('select count(*) n from digests').get().n, index: indexFile });
}

// --brief: one text line per chat (about a tenth of the JSON), enough to pick the chat to open.
const brief = args.includes('--brief');
const briefLine = (row) => [(row.updated_at ?? '').slice(0, 16).replace('T', ' '), row.provider, clip(row.title, 38),
  `${row.msgs}m`, clip(row.answered, 110), row.session_id].join(' | ');
const line = (row) => ({
  at: row.updated_at, provider: row.provider, title: clip(row.title, 60), msgs: row.msgs,
  asked: clip(row.asked, 160), answered: clip(row.answered, 220), session: row.session_id,
  link: chatLink(row.provider, row.session_id),
});
const out = (rows, head) => {
  if (!brief) return print(head ? { ...head, hits: rows.map(line) } : rows.map(line));
  process.stdout.write(`${rows.map(briefLine).join('\n')}\n`);
};
// Plain words become quoted FTS terms joined by AND, so punctuation in a query is never read as FTS syntax.
const ftsQuery = (words) => (words.join(' ').match(/"[^"]+"|\S+/g) ?? []).map((token) => {
  if (token.startsWith('"')) return token;
  const prefix = token.endsWith('*');
  const word = token.replace(/\*+$/, '').replace(/"/g, '');
  return word ? `"${word}"${prefix ? '*' : ''}` : '';
}).filter(Boolean).join(' AND ');

const select = 'select d.session_id, d.provider, d.title, d.project, d.updated_at, d.msgs, d.asked, d.answered from digests d';
if (command === 'build') build();
else if (command === 'last') out(db.prepare(`${select} order by d.updated_at desc limit ?`).all(limit));
else if (command === 'find') {
  const query = terms.join(' ');
  const match = ftsQuery(terms);
  const rows = match ? db.prepare(`${select} join digest_fts f on f.session_id = d.session_id
    where digest_fts match ? order by d.updated_at desc limit ?`).all(match, limit) : [];
  out(rows, { query });
} else if (command === 'who') {
  const entity = terms[0] ?? '';
  const exact = entity.includes(':');
  const rows = db.prepare(`${select} join edges e on e.session_id = d.session_id
    where e.entity ${exact ? '= ?' : 'like ?'} group by d.session_id order by d.updated_at desc limit ?`)
    .all(exact ? entity : `%${entity}%`, limit);
  out(rows, { entity });
} else if (command === 'entities') {
  const kind = flag('kind');
  print(db.prepare(`select entity, kind, count(*) chats, max(at) last from edges
    ${kind ? 'where kind = ?' : ''} group by entity order by chats desc, last desc limit ?`)
    .all(...(kind ? [kind, limit] : [limit])));
} else if (command === 'show') {
  // A prefix of the session id is enough to open a chat.
  const row = db.prepare(`${select} where d.session_id like ? order by d.updated_at desc`).get(`${terms[0] ?? ''}%`);
  const id = row?.session_id ?? terms[0] ?? '';
  if (!row) print({ error: `no digest for ${id}; run build` });
  else {
    const entities = db.prepare('select entity from edges where session_id = ? order by kind, entity').all(id).map((item) => item.entity);
    const neighbours = db.prepare(`select d.session_id, d.title, d.updated_at, count(*) shared from edges e
      join edges mine on mine.entity = e.entity and mine.session_id = ?
      join digests d on d.session_id = e.session_id
      where e.session_id != ? group by e.session_id order by shared desc, d.updated_at desc limit 6`).all(id, id);
    print({ ...line(row), entities, neighbours: neighbours.map((item) => ({ ...item, title: clip(item.title, 50) })) });
  }
} else if (command === 'graph') {
  // Two entities are linked when the same chats touch both; weight = number of shared chats.
  const kinds = (flag('kind') ?? ['project', ...customKinds].join(',')).split(',');
  const marks = kinds.map(() => '?').join(',');
  const focus = flag('focus');
  const nodes = focus
    ? db.prepare(`select other.entity, other.kind, count(*) chats, max(other.at) last from edges mine
        join edges other on other.session_id = mine.session_id
        where mine.entity = ? and (other.entity = ? or other.kind in (${marks}))
        group by other.entity order by chats desc limit ?`).all(focus, focus, ...kinds, limit)
    : db.prepare(`select entity, kind, count(*) chats, max(at) last from edges where kind in (${marks})
        group by entity order by chats desc limit ?`).all(...kinds, limit);
  const names = nodes.map((node) => node.entity);
  const slots = names.map(() => '?').join(',');
  const links = names.length < 2 ? [] : db.prepare(`select a.entity source, b.entity target, count(*) weight
      from edges a join edges b on b.session_id = a.session_id and a.entity < b.entity
      where a.entity in (${slots}) and b.entity in (${slots})
      group by a.entity, b.entity having weight >= ? order by weight desc limit ?`)
    .all(...names, ...names, Number(flag('min')) || 2, limit * 6);
  print({ focus: focus ?? null, kinds, nodes, links });
} else print({ error: 'commands: build | graph | last | find <words> | who <entity> | entities | show <session id>' });
db.close();
