import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');

/** A temporary data dir with a small synthetic archive, and runners for the chat scripts against it. */
export function chatArchive(chats, graphConfig) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-archive-'));
  const dataDir = path.join(base, 'data');
  const env = { ...process.env, SWITCHYARD_DATA_DIR: dataDir, SWITCHYARD_DEMO: '', SWITCHYARD_PORT: '3010', ANTHROPIC_API_KEY: '' };
  const script = (name) => path.join(scripts, `${name}.mjs`);
  const text = (name, ...args) => execFileSync(process.execPath, ['--no-warnings', script(name), ...args], { env, encoding: 'utf8' });
  const run = (name, ...args) => JSON.parse(text(name, ...args));
  run('archive-merge', 'merge', path.join(base, 'empty.db'));
  const db = new DatabaseSync(path.join(dataDir, 'data.db'));
  for (const chat of chats) {
    db.prepare(`INSERT INTO agent_sessions (id,provider,title,cwd,project,source_path,first_seen_at,updated_at,last_synced_at,prompt_count,response_count)
      VALUES (?,?,?,?,?,?,?,?,?,1,1)`).run(chat.id, chat.provider, chat.title, chat.cwd, chat.project, `/sessions/${chat.id}.jsonl`, chat.at, chat.at, chat.at);
    chat.messages.forEach(([role, body], ordinal) => db.prepare('INSERT INTO agent_messages (id,session_id,provider,role,text,timestamp,ordinal) VALUES (?,?,?,?,?,?,?)')
      .run(`${chat.id}:${ordinal}`, chat.id, chat.provider, role, body, chat.at, ordinal));
  }
  db.close();
  if (graphConfig) fs.writeFileSync(path.join(dataDir, 'chat-graph.json'), JSON.stringify(graphConfig));
  /** Sends JSON-RPC requests to the MCP server and returns the responses by id. */
  const mcp = (requests) => {
    const result = spawnSync(process.execPath, ['--no-warnings', script('chat-mcp')], { env, encoding: 'utf8', input: `${requests.map((request) => JSON.stringify({ jsonrpc: '2.0', ...request })).join('\n')}\n` });
    return Object.fromEntries(result.stdout.trim().split('\n').map((line) => JSON.parse(line)).map((reply) => [reply.id, reply]));
  };
  return { dataDir, run, text, mcp, index: () => new DatabaseSync(path.join(dataDir, 'search-index.db')), close: () => fs.rmSync(base, { recursive: true, force: true }) };
}

export const sampleChats = [
  { id: 'aaaa1111-0000-4000-8000-000000000001', provider: 'claude-code', title: 'Fix the invoice export', cwd: '/work/api', project: 'api', at: new Date(Date.now() - 3600_000).toISOString(), messages: [
    ['user', 'The invoice export in scripts/export-invoices.ts drops the last row. Ticket OPS-42.'],
    ['assistant', 'Fixed the off-by-one in scripts/export-invoices.ts and added a test.'],
  ] },
  { id: 'bbbb2222-0000-4000-8000-000000000002', provider: 'codex', title: 'Plan the Acme rollout', cwd: '/work/web', project: 'web', at: new Date(Date.now() - 1800_000).toISOString(), messages: [
    ['user', 'Plan the rollout for Acme, see OPS-42 for the export fix. Use the café staging box.'],
    ['assistant', 'Rollout plan written: staging first, then production.'],
  ] },
];

export const sampleGraphConfig = { kinds: { customer: ['Acme'] }, patterns: { ticket: '\\bOPS-\\d+\\b' } };
