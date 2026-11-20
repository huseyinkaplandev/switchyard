#!/usr/bin/env node
// Durable memory on top of the chat index (search-index.db): facts with a source message and a validity window,
// handoff notes between chats, a session-start brief, entity pages and rule proposals.
//
//   node scripts/chat-memory.mjs extract [--limit 20] [--session <id>] [--idle-min 30]   chats -> facts (needs an API key)
//   node scripts/chat-memory.mjs facts [--entity project:api] [--query words] [--scope user] [--all] [--limit 20]
//   node scripts/chat-memory.mjs brief --cwd <dir> [--session <id>]      what a new chat in <dir> should know
//   node scripts/chat-memory.mjs brief --hook                            same, as a Claude Code SessionStart hook
//   node scripts/chat-memory.mjs handoff add --title .. --text .. [--project ..] [--session <id>]
//   node scripts/chat-memory.mjs handoff list [--project ..] | handoff claim <id> --session <id>
//   node scripts/chat-memory.mjs page <entity> [--write]                 facts + chats of one entity, as markdown
//   node scripts/chat-memory.mjs maintain                                drop badly sourced facts, one fact per key
//   node scripts/chat-memory.mjs lessons                                 repeated corrections -> rule proposals
//   node scripts/chat-memory.mjs rules | edit <rule id> --text .. | approve <rule id> | reject <rule id>
//
// Everything except extract works offline. extract sends a clipped transcript to the Anthropic API
// (ANTHROPIC_API_KEY, model from SWITCHYARD_MEMORY_MODEL) and keeps a fact only when its quote is found in the chat
// it cites; this script, not the model, decides what is stored. A newer fact with the same subject and slot closes
// the older one (valid_to, superseded_by) instead of deleting it. approve appends the rule to SWITCHYARD_RULES_FILE
// (default <data dir>/memory/LEARNED_RULES.md); point it at your own CLAUDE.md or AGENTS.md to make agents read it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { chatLink, dataDir } from './data-dir.mjs';

const dir = dataDir();
const archiveFile = path.join(dir, 'data.db');
const indexFile = path.join(dir, 'search-index.db');
const wikiDir = path.join(dir, 'memory');
const rulesFile = path.resolve(process.env.SWITCHYARD_RULES_FILE || path.join(wikiDir, 'LEARNED_RULES.md'));
const model = process.env.SWITCHYARD_MEMORY_MODEL || 'claude-haiku-5-5';

const args = process.argv.slice(2);
const command = args[0] ?? 'facts';
const flag = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const has = (name) => args.includes(`--${name}`);
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const clip = (text, max) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const limit = Math.min(Number(flag('limit')) || 20, 3000);
const now = () => new Date().toISOString();

if (!existsSync(archiveFile)) { print({ error: `archive not found: ${archiveFile}` }); process.exit(1); }
const db = new DatabaseSync(indexFile);
db.exec('PRAGMA busy_timeout=20000; PRAGMA journal_mode=WAL');
db.exec(`CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, session_id TEXT, message_id TEXT, subject TEXT,
    slot TEXT, text TEXT, kind TEXT, scope TEXT, project TEXT, status TEXT, gate TEXT, valid_from TEXT,
    valid_to TEXT, superseded_by INTEGER, created_at TEXT);
  CREATE INDEX IF NOT EXISTS facts_subject ON facts(subject, slot);
  CREATE INDEX IF NOT EXISTS facts_session ON facts(session_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS fact_fts USING fts5(text, fact_id UNINDEXED,
    tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS fact_builds (session_id TEXT PRIMARY KEY, msgs INTEGER, built_at TEXT,
    input_tokens INTEGER, output_tokens INTEGER, kept INTEGER);
  CREATE TABLE IF NOT EXISTS handoffs (id INTEGER PRIMARY KEY, project TEXT, title TEXT, body TEXT,
    from_session TEXT, created_at TEXT, claimed_by TEXT, claimed_at TEXT);
  CREATE TABLE IF NOT EXISTS rules (id INTEGER PRIMARY KEY, key TEXT UNIQUE, text TEXT, sessions INTEGER,
    fact_ids TEXT, status TEXT, created_at TEXT, decided_at TEXT)`);
db.prepare('ATTACH DATABASE ? AS archive').run(archiveFile);
const addColumn = (table, column, type) => {
  if (!db.prepare(`pragma table_info(${table})`).all().some((row) => row.name === column)) {
    db.exec(`alter table ${table} add column ${column} ${type}`);
  }
};
addColumn('rules', 'note', 'TEXT');
addColumn('rules', 'edited', 'INTEGER NOT NULL DEFAULT 0');
const tableExists = (name) => Boolean(db.prepare("select 1 from sqlite_master where name = ?").get(name));

const factSchema = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['text', 'kind', 'subject', 'slot', 'scope', 'source', 'quote'],
    properties: {
      text: { type: 'string' },
      kind: { type: 'string', enum: ['decision', 'preference', 'correction', 'fact', 'procedure'] },
      subject: { type: 'string' }, slot: { type: 'string' },
      scope: { type: 'string', enum: ['user', 'project', 'session'] },
      source: { type: 'integer' }, quote: { type: 'string' },
    },
  } } },
};

const instructions = `You extract durable memory from a transcript between a user and an AI agent, for other
agents that will work with the same user in later, different chats.

Return at most 8 items, and fewer or none when the chat holds nothing lasting. Worth keeping:
- decision: something that was decided and will still hold later
- preference: how the user wants work done in general
- correction: the user told the agent it did something wrong and how to do it instead
- fact: a stable fact about a tool, project, system or the people and organisations involved
- procedure: a way of doing something that was shown to work

Leave out progress narration, anything that only matters inside this chat, guesses, and every secret,
key, password or token.

Lines marked "task-prompt" are automated instructions that are already written down in files: take nothing
from them and never quote them. A preference or a correction must be something the user wrote in a "user"
line; what the agent concluded on its own is at most a decision, fact or procedure.

Fields:
- text: one self-contained English sentence a stranger could act on; absolute dates, never "today".
- subject: what the item is about, as "user", "project:<name>", or one of the entity ids listed under
  "Entities in this chat" when it fits ("project:api", "file:scripts/x.ts").
- slot: a short snake_case name for the attribute stated ("deploy_target", "commit_style"), so a later
  statement about the same attribute replaces this one. Reuse a key from "Existing keys" when the topic matches.
- scope: user = holds in every project; project = holds for this project only; session = only this chat.
- source: the number in [brackets] of the message that supports the item.
- quote: up to 120 characters copied exactly from that message.`;

async function askModel(key, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21' },
    body: JSON.stringify({
      model, max_tokens: 4000, system: instructions,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: factSchema } },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  if (body.stop_reason !== 'end_turn') throw new Error(`stop_reason ${body.stop_reason}`);
  const text = body.content.find((block) => block.type === 'text')?.text ?? '{"items":[]}';
  return { items: JSON.parse(text).items ?? [], usage: body.usage ?? {} };
}

// "User" messages the harness wrote: scheduled-task prompts and task notifications. Their rules already live in
// files, so nothing is extracted from them, and a preference or correction must cite the person's own words.
const machineText = /^\s*(?:<scheduled-task|<task-notification|<system-reminder|<agent-message|<command-|<local-command|\[SYSTEM NOTIFICATION|Another Claude session sent|This session is being continued)/;
const fromPerson = (row) => row.role === 'user' && !machineText.test(row.text);
const usableSource = (kind, row) => !machineText.test(row.text)
  && (!['preference', 'correction'].includes(kind) || fromPerson(row));

// The middle of a very long chat is dropped: its opening states the goal and its end states the outcome.
function transcriptOf(rows) {
  const lines = rows.map((row, at) => `[${at}] ${machineText.test(row.text) ? 'task-prompt' : row.role}: ${clip(row.text, 1500)}`);
  const whole = lines.join('\n');
  if (whole.length <= 48000) return whole;
  const head = [];
  const tail = [];
  let size = 0;
  for (const row of lines) { if (size + row.length > 12000) break; head.push(row); size += row.length; }
  size = 0;
  for (const row of lines.slice(head.length).reverse()) {
    if (size + row.length > 34000) break; tail.unshift(row); size += row.length;
  }
  return `${head.join('\n')}\n[... ${lines.length - head.length - tail.length} messages left out ...]\n${tail.join('\n')}`;
}

const squash = (text) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
function sourceOf(item, rows) {
  const quote = squash(item.quote).slice(0, 120);
  if (quote.length < 12) return null;
  const cited = rows[item.source];
  if (cited && usableSource(item.kind, cited) && squash(cited.text).includes(quote)) return cited;
  return rows.find((row) => usableSource(item.kind, row) && squash(row.text).includes(quote)) ?? null;
}

// The extractor proposes a scope; a session-scoped item is stored but never reaches a brief.
const decide = (item) => ({ status: item.scope === 'session' ? 'session' : 'active', scope: item.scope, gate: null });

function store(session, items) {
  const old = db.prepare('select id from facts where session_id = ?').all(session.id).map((row) => row.id);
  for (const id of old) {
    db.prepare("update facts set status = 'active', valid_to = null, superseded_by = null where superseded_by = ?").run(id);
    db.prepare('delete from fact_fts where fact_id = ?').run(id);
  }
  db.prepare('delete from facts where session_id = ?').run(session.id);
  const insert = db.prepare(`insert into facts (session_id, message_id, subject, slot, text, kind, scope, project,
    status, gate, valid_from, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let kept = 0;
  for (const item of items) {
    const id = Number(insert.run(session.id, item.messageId, item.subject, item.slot, item.text, item.kind, item.scope,
      session.project, item.status, item.gate, item.at, now()).lastInsertRowid);
    if (item.status !== 'active') continue;
    kept += 1;
    db.prepare('insert into fact_fts (text, fact_id) values (?, ?)').run(`${item.subject} ${item.text}`, id);
    if (!item.subject || !item.slot) continue;
    const scoped = item.scope === 'project' ? 'and project = ?' : '';
    db.prepare(`update facts set status = 'superseded', valid_to = ?, superseded_by = ?
      where status = 'active' and subject = ? and slot = ? and id != ? and valid_from <= ? ${scoped}`)
      .run(item.at, id, item.subject, item.slot, id, item.at, ...(scoped ? [session.project] : []));
  }
  return kept;
}

async function extract() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return print({ error: 'extract needs ANTHROPIC_API_KEY in the environment' });
  if (!tableExists('digests')) return print({ error: 'run chat-graph.mjs build first' });
  const one = flag('session');
  const idle = new Date(Date.now() - (Number(flag('idle-min') ?? 30)) * 60_000).toISOString();
  const sessions = one
    ? db.prepare('select session_id id, project, title, msgs from digests where session_id = ?').all(one)
    : db.prepare(`select d.session_id id, d.project, d.title, d.msgs from digests d
        left join fact_builds b on b.session_id = d.session_id
        where d.msgs >= 4 and d.updated_at < ? and (b.session_id is null or d.msgs >= b.msgs + 6)
          and d.session_id not in (select session_id from archive.agent_session_exclusions)
        order by d.updated_at desc limit ?`).all(idle, limit);
  const messages = db.prepare(`select id, role, text, timestamp from archive.agent_messages
    where session_id = ? and kind in ('text','compaction') and length(text) > 0 order by ordinal`);
  const knownKeys = db.prepare(`select subject || ' | ' || slot as key, max(text) text from facts
    where kind in ('preference','correction') and status = 'active' group by subject, slot limit 60`).all()
    .map((row) => `${row.key}: ${clip(row.text, 90)}`).join('\n');
  const totals = { chats: 0, candidates: 0, unsupported: 0, active: 0, session: 0, failed: 0,
    inputTokens: 0, outputTokens: 0 };
  const errors = [];
  const queue = [...sessions];
  const work = async () => {
    for (let session = queue.shift(); session; session = queue.shift()) {
      const rows = messages.all(session.id);
      const entities = db.prepare('select entity from edges where session_id = ? limit 40').all(session.id)
        .map((row) => row.entity).join(', ');
      const prompt = [`Project: ${session.project}`, `Chat title: ${session.title}`,
        `Entities in this chat: ${entities || 'none'}`, `Existing keys:\n${knownKeys || 'none'}`,
        `Transcript:\n${transcriptOf(rows)}`].join('\n\n');
      try {
        const { items, usage } = await askModel(key, prompt);
        totals.inputTokens += usage.input_tokens ?? 0;
        totals.outputTokens += usage.output_tokens ?? 0;
        totals.candidates += items.length;
        const backed = [];
        for (const item of items.slice(0, 8)) {
          const source = sourceOf(item, rows);
          if (!source) { totals.unsupported += 1; continue; }
          backed.push({ ...item, text: clip(item.text, 400), subject: clip(item.subject, 80), slot: clip(item.slot, 60),
            project: session.project, messageId: source.id, at: source.timestamp || now() });
        }
        const decided = backed.map((item) => ({ ...item, ...decide(item) }));
        for (const item of decided) totals[item.status] += 1;
        const kept = store(session, decided);
        db.prepare(`insert or replace into fact_builds (session_id, msgs, built_at, input_tokens, output_tokens, kept)
          values (?, ?, ?, ?, ?, ?)`).run(session.id, session.msgs, now(), usage.input_tokens ?? 0,
          usage.output_tokens ?? 0, kept);
        totals.chats += 1;
      } catch (error) {
        totals.failed += 1;
        if (errors.length < 5) errors.push(`${session.id}: ${String(error.message).slice(0, 200)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, work));
  print({ model, ...totals, errors, waiting: one ? 0 : db.prepare(`select count(*) n from digests d
    left join fact_builds b on b.session_id = d.session_id where d.msgs >= 4 and b.session_id is null`).get().n });
}

const factRow = (row) => ({ id: row.id, text: row.text, kind: row.kind, scope: row.scope, status: row.status,
  subject: row.subject, project: row.project, valid_from: row.valid_from, valid_to: row.valid_to,
  superseded_by: row.superseded_by, session_id: row.session_id, message_id: row.message_id,
  link: chatLink(row.provider ?? '', row.session_id) });

function facts() {
  const where = [has('all') ? "status in ('active','superseded')" : "status = 'active'"];
  const values = [];
  if (flag('entity')) { where.push('subject = ?'); values.push(flag('entity')); }
  if (flag('scope')) { where.push('scope = ?'); values.push(flag('scope')); }
  if (flag('project')) { where.push('project = ?'); values.push(flag('project')); }
  if (flag('query')) {
    const match = (flag('query').match(/\S+/g) ?? []).map((word) => `"${word.replace(/"/g, '')}"`).join(' AND ');
    where.push('id in (select fact_id from fact_fts where fact_fts match ?)');
    values.push(match);
  }
  print({ facts: db.prepare(`select facts.*, (select provider from archive.agent_sessions s where s.id = facts.session_id) provider
    from facts where ${where.join(' and ')} order by valid_from desc limit ?`)
    .all(...values, limit).map(factRow) });
}

function briefText(cwd, self) {
  const project = path.basename(String(cwd ?? '').replace(/[\\/]+$/, '')) || '';
  const out = [];
  const day = (iso) => String(iso ?? '').slice(5, 16).replace('T', ' ');
  if (tableExists('digests')) {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    // Same folder or below it, on any computer's path style; the project name covers the other machine.
    const folder = String(cwd ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const here = db.prepare(`select d.session_id, d.title, d.updated_at, d.answered from digests d
      join archive.agent_sessions s on s.id = d.session_id
      where (d.project = ? or replace(lower(s.cwd), '\\', '/') = ? or replace(lower(s.cwd), '\\', '/') like ?)
        and d.session_id != ? and d.updated_at > ? order by d.updated_at desc limit 5`)
      .all(project, folder, `${folder}/%`, self ?? '', since);
    const shown = new Set(here.map((row) => row.session_id));
    if (here.length) {
      out.push(`Recent chats in this project (${project}):`);
      for (const row of here) out.push(`- ${day(row.updated_at)} "${clip(row.title, 40)}": ${clip(row.answered, 150)} [${row.session_id.slice(0, 8)}]`);
    }
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const elsewhere = db.prepare(`select session_id, project, title, updated_at, answered from digests
      where project != ? and session_id != ? and updated_at > ?
      order by updated_at desc limit 9`).all(project, self ?? '', dayAgo)
      .filter((row) => !shown.has(row.session_id)).slice(0, 4);
    if (elsewhere.length) {
      out.push('Other projects, last 24 h:');
      for (const row of elsewhere) out.push(`- ${day(row.updated_at)} ${row.project} "${clip(row.title, 36)}": ${clip(row.answered, 110)} [${row.session_id.slice(0, 8)}]`);
    }
  }
  const open = db.prepare(`select id, title, body, created_at from handoffs
    where claimed_by is null and (project = ? or project = '') order by created_at desc limit 3`).all(project);
  if (open.length) {
    out.push('Open handoff notes for this project (claim one: chat-memory.mjs handoff claim <id> --session <this chat>):');
    for (const row of open) out.push(`- #${row.id} ${clip(row.title, 60)}: ${clip(row.body, 240)}`);
  }
  const known = db.prepare(`select text, valid_from from facts where status = 'active'
    and (scope = 'user' or (scope = 'project' and project = ?)) and kind in ('preference','correction','decision')
    order by valid_from desc limit 8`).all(project);
  if (known.length) {
    out.push('Remembered from earlier chats:');
    for (const row of known) out.push(`- ${clip(row.text, 200)} (${String(row.valid_from).slice(0, 10)})`);
  }
  if (!out.length) return '';
  return ['Chat memory (auto, from the chat archive; ids in [brackets] open with the chat_show tool or',
    'chat-graph.mjs show <id>; search more with chat_search / chat_facts):', ...out].join('\n').slice(0, 3200);
}

function brief() {
  if (!has('hook')) return process.stdout.write(`${briefText(flag('cwd') ?? process.cwd(), flag('session'))}\n`);
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { input = {}; }
  const text = input.source === 'compact' ? '' : briefText(input.cwd ?? process.cwd(), input.session_id);
  if (text) print({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
}

function handoff() {
  const action = args[1];
  if (action === 'add') {
    if (!flag('title') || !flag('text')) return print({ error: 'handoff add needs --title and --text' });
    const project = flag('project') ?? path.basename(process.cwd());
    const id = db.prepare(`insert into handoffs (project, title, body, from_session, created_at)
      values (?, ?, ?, ?, ?)`).run(project, flag('title'), flag('text'), flag('session') ?? '', now()).lastInsertRowid;
    return print({ id: Number(id), project });
  }
  if (action === 'claim') {
    if (!flag('session')) return print({ error: 'handoff claim <id> needs --session' });
    const done = db.prepare('update handoffs set claimed_by = ?, claimed_at = ? where id = ? and claimed_by is null')
      .run(flag('session'), now(), Number(args[2]));
    const row = db.prepare('select * from handoffs where id = ?').get(Number(args[2]));
    return print(done.changes ? { claimed: true, ...row } : { claimed: false, by: row?.claimed_by ?? null });
  }
  const project = flag('project');
  print(db.prepare(`select * from handoffs where ${has('all') ? '1=1' : 'claimed_by is null'}
    ${project ? 'and project = ?' : ''} order by created_at desc limit ?`).all(...(project ? [project, limit] : [limit])));
}

function page() {
  const entity = args[1] ?? '';
  const rows = db.prepare(`select facts.*, (select provider from archive.agent_sessions s where s.id = facts.session_id) provider
    from facts where subject = ? and status in ('active','superseded') order by status, valid_from desc`).all(entity);
  const chats = tableExists('edges') ? db.prepare(`select d.session_id, d.title, d.updated_at, d.answered from edges e
    join digests d on d.session_id = e.session_id where e.entity = ? order by d.updated_at desc limit 12`).all(entity) : [];
  const fact = (row) => `- ${row.status === 'superseded' ? `~~${row.text}~~ (until ${String(row.valid_to).slice(0, 10)})` : row.text}`
    + ` — ${String(row.valid_from).slice(0, 10)}, [chat](${chatLink(row.provider ?? '', row.session_id)})`;
  const text = [`# ${entity}`, '', '## Facts', ...(rows.length ? rows.map(fact) : ['- none yet']), '', '## Chats',
    ...chats.map((row) => `- ${row.updated_at.slice(0, 10)} **${clip(row.title, 60)}**: ${clip(row.answered, 180)} (${row.session_id})`)]
    .join('\n');
  if (has('write')) {
    mkdirSync(wikiDir, { recursive: true });
    writeFileSync(path.join(wikiDir, `${entity.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.md`), `${text}\n`);
  }
  process.stdout.write(`${text}\n`);
}

// A preference or correction seen in two or more chats becomes a proposal. Nothing reaches the rules file unapproved.
function lessons() {
  const groups = db.prepare(`select subject, slot, count(distinct session_id) sessions, group_concat(id) ids
    from facts where kind in ('preference','correction') and status in ('active','superseded') and scope != 'session'
      and slot != '' group by subject, slot having sessions >= 2`).all();
  for (const group of groups) {
    const latest = db.prepare(`select text from facts where subject = ? and slot = ? and status = 'active'
      order by valid_from desc limit 1`).get(group.subject, group.slot);
    if (!latest) continue;
    db.prepare(`insert into rules (key, text, sessions, fact_ids, status, created_at) values (?, ?, ?, ?, 'proposed', ?)
      on conflict(key) do update set sessions = excluded.sessions, fact_ids = excluded.fact_ids,
        text = case when rules.status = 'proposed' and rules.edited = 0 then excluded.text else rules.text end`)
      .run(`${group.subject}|${group.slot}`, latest.text, group.sessions, group.ids, now());
  }
  // A proposal whose facts were merged away or rejected no longer stands; ids of the others never change.
  const standing = new Set(groups.map((group) => `${group.subject}|${group.slot}`));
  for (const rule of db.prepare("select id, key from rules where status = 'proposed' and edited = 0").all()) {
    if (!standing.has(rule.key)) db.prepare('delete from rules where id = ?').run(rule.id);
  }
  const proposed = db.prepare("select id, key, text, sessions from rules where status = 'proposed' order by sessions desc").all();
  mkdirSync(wikiDir, { recursive: true });
  writeFileSync(path.join(wikiDir, 'PROPOSED_RULES.md'), ['# Proposed rules', '',
    'Seen in two or more chats. Approve: `node scripts/chat-memory.mjs approve <id>`; reject: `... reject <id>`.', '',
    ...proposed.map((rule) => `- **#${rule.id}** (${rule.sessions} chats, ${rule.key}): ${rule.text}`)].join('\n') + '\n');
  print({ proposed, file: path.join(wikiDir, 'PROPOSED_RULES.md') });
}

// Housekeeping over stored facts: drop the ones whose source is not allowed and keep a single current fact per key.
function maintain() {
  const report = { badSource: 0, superseded: 0 };
  const sourced = db.prepare(`select f.id, f.kind, m.role, m.text from facts f
    join archive.agent_messages m on m.id = f.message_id where f.status in ('active','superseded')`).all();
  const drop = db.prepare("update facts set status = 'rejected', gate = ? where id = ?");
  for (const row of sourced) {
    if (usableSource(row.kind, row)) continue;
    drop.run(JSON.stringify({ reason: 'source is a task prompt or not the user' }), row.id);
    db.prepare('delete from fact_fts where fact_id = ?').run(row.id);
    report.badSource += 1;
  }
  db.prepare(`update facts set status = 'active', valid_to = null, superseded_by = null
    where status = 'superseded' and superseded_by in (select id from facts where status = 'rejected')`).run();
  const crowded = db.prepare(`select subject, slot, scope, case when scope = 'project' then project else '' end place
    from facts where status = 'active' and subject != '' and slot != ''
    group by subject, slot, scope, place having count(*) > 1`).all();
  for (const group of crowded) {
    const rows = db.prepare(`select id, valid_from from facts where status = 'active' and subject = ? and slot = ?
      and scope = ? and (? = '' or project = ?) order by valid_from desc, id desc`)
      .all(group.subject, group.slot, group.scope, group.place, group.place);
    for (const row of rows.slice(1)) {
      db.prepare("update facts set status = 'superseded', valid_to = ?, superseded_by = ? where id = ?")
        .run(rows[0].valid_from, rows[0].id, row.id);
      report.superseded += 1;
    }
  }
  print({ ...report, facts: db.prepare('select status, count(*) n from facts group by status').all() });
}

function rules() {
  const status = flag('status') ?? 'proposed';
  const rows = db.prepare(`select * from rules ${status === 'all' ? '' : 'where status = ?'}
    order by sessions desc, id`).all(...(status === 'all' ? [] : [status]));
  const source = db.prepare(`select f.session_id, f.text, f.valid_from at, d.title from facts f
    left join digests d on d.session_id = f.session_id where f.id = ?`);
  print({ file: rulesFile, rules: rows.map((rule) => ({ id: rule.id, key: rule.key, text: rule.text,
    sessions: rule.sessions, status: rule.status, note: rule.note, created_at: rule.created_at,
    decided_at: rule.decided_at, sources: String(rule.fact_ids ?? '').split(',').filter(Boolean).slice(-5)
      .map((id) => source.get(Number(id))).filter(Boolean) })) });
}

function proposedRule() {
  const rule = db.prepare('select * from rules where id = ?').get(Number(args[1]));
  if (!rule) print({ error: `no rule ${args[1]}` });
  else if (rule.status !== 'proposed') print({ error: `rule ${rule.id} is already ${rule.status}` });
  else return rule;
  return null;
}

function editRule() {
  const rule = proposedRule();
  const text = clip(flag('text'), 600);
  if (!rule) return;
  if (text.length < 10) return print({ error: 'edit <id> needs --text (10+ characters)' });
  db.prepare('update rules set text = ?, edited = 1 where id = ?').run(text, rule.id);
  print({ id: rule.id, text });
}

function decideRule(status) {
  const rule = proposedRule();
  if (!rule) return;
  const text = clip(flag('text'), 600) || rule.text;
  if (status === 'approved') {
    const current = existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8') : '';
    const heading = '## Learned rules';
    mkdirSync(path.dirname(rulesFile), { recursive: true });
    appendFileSync(rulesFile, `${current.includes(heading) ? '' : `\n${heading}\n\n`}- ${text}\n`);
  }
  db.prepare('update rules set status = ?, text = ?, note = ?, decided_at = ? where id = ?')
    .run(status, text, clip(flag('note'), 200) || null, now(), rule.id);
  print({ id: rule.id, status, text, file: status === 'approved' ? rulesFile : null });
}

if (command === 'extract') await extract();
else if (command === 'facts') facts();
else if (command === 'brief') brief();
else if (command === 'handoff') handoff();
else if (command === 'page') page();
else if (command === 'lessons') lessons();
else if (command === 'maintain') maintain();
else if (command === 'rules') rules();
else if (command === 'edit') editRule();
else if (command === 'approve') decideRule('approved');
else if (command === 'reject') decideRule('rejected');
else print({ error: 'commands: extract | facts | brief | handoff add|list|claim | page <entity> | maintain | lessons | rules | edit <id> | approve <id> | reject <id>' });
db.close();
