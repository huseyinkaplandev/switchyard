#!/usr/bin/env node
// MCP server (stdio, no dependencies) that gives any agent the chat archive: search, one-line digests, the entity
// graph, remembered facts and handoff notes. Each tool runs chat-search.mjs, chat-graph.mjs or chat-memory.mjs.
//
//   Claude Code:  claude mcp add -s user chat-memory -- node --no-warnings <repo>/scripts/chat-mcp.mjs
//   Codex:        [mcp_servers.chat-memory] command = "node", args = ["--no-warnings", "<repo>/scripts/chat-mcp.mjs"]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const text = { type: 'string' };
const count = { type: 'integer', minimum: 1, maximum: 50 };

const tools = [
  { name: 'chat_search', script: 'chat-search.mjs',
    description: 'Full-text search over every archived chat message (Claude Code, Codex, opencode, Antigravity, every merged machine). Words are ANDed, case and accents are ignored, word* is a prefix, "quoted" is a phrase. Returns snippets with session ids.',
    properties: { query: text, limit: count, since: { ...text, description: 'ISO date, e.g. 2026-01-31' },
      role: { type: 'string', enum: ['user', 'assistant'] }, session: text, sort: { type: 'string', enum: ['recent'] } },
    required: ['query'],
    argv: (input) => [input.query, ...flags(input, ['limit', 'since', 'role', 'session', 'sort'])] },
  { name: 'chat_find', script: 'chat-graph.mjs',
    description: 'Find chats by what they were asked and how they ended: one line per chat. Cheaper than chat_search; use it first. Empty query lists the newest chats.',
    properties: { query: text, limit: count },
    argv: (input) => [...(input.query ? ['find', input.query] : ['last']), '--brief', ...flags(input, ['limit'])] },
  { name: 'chat_who', script: 'chat-graph.mjs',
    description: 'Every chat that touched an entity, newest first. Entity ids look like project:api or file:scripts/server.ts, plus the kinds defined in chat-graph.json.',
    properties: { entity: text, limit: count }, required: ['entity'],
    argv: (input) => ['who', input.entity, '--brief', ...flags(input, ['limit'])] },
  { name: 'chat_show', script: 'chat-graph.mjs',
    description: 'One chat by session id (a full id or its first characters, as printed by the other tools): its digest, entities and neighbouring chats.',
    properties: { session: text }, required: ['session'],
    argv: (input) => ['show', input.session] },
  { name: 'chat_facts', script: 'chat-memory.mjs',
    description: 'Facts, decisions, preferences and corrections remembered from earlier chats, each with its source chat and validity dates. Filter by entity (project:api), free-text query, or scope (user | project). all=true also returns superseded facts.',
    properties: { entity: text, query: text, scope: { type: 'string', enum: ['user', 'project'] }, project: text,
      all: { type: 'boolean' }, limit: count },
    argv: (input) => ['facts', ...flags(input, ['entity', 'query', 'scope', 'project', 'limit']), ...(input.all ? ['--all'] : [])] },
  { name: 'chat_entity_page', script: 'chat-memory.mjs',
    description: 'A markdown page for one entity: its current and superseded facts plus the chats that touched it.',
    properties: { entity: text }, required: ['entity'],
    argv: (input) => ['page', input.entity] },
  { name: 'chat_brief', script: 'chat-memory.mjs',
    description: 'What a chat starting in a folder should know: recent chats in that project and elsewhere, open handoff notes, remembered preferences.',
    properties: { cwd: text, session: text }, required: ['cwd'],
    argv: (input) => ['brief', ...flags(input, ['cwd', 'session'])] },
  { name: 'handoff_add', script: 'chat-memory.mjs',
    description: 'Leave unfinished work for another chat or agent. The next chat that starts in that project sees it; exactly one chat can claim it.',
    properties: { title: text, text, project: text, session: text }, required: ['title', 'text', 'project'],
    argv: (input) => ['handoff', 'add', ...flags(input, ['title', 'text', 'project', 'session'])] },
  { name: 'handoff_list', script: 'chat-memory.mjs',
    description: 'Open handoff notes, optionally for one project.',
    properties: { project: text },
    argv: (input) => ['handoff', 'list', ...flags(input, ['project'])] },
  { name: 'handoff_claim', script: 'chat-memory.mjs',
    description: 'Claim a handoff note for this chat. Fails when another chat already claimed it.',
    properties: { id: { type: 'integer' }, session: text }, required: ['id', 'session'],
    argv: (input) => ['handoff', 'claim', String(input.id), ...flags(input, ['session'])] },
];

function flags(input, names) {
  return names.flatMap((name) => (input[name] === undefined || input[name] === '' ? [] : [`--${name}`, String(input[name])]));
}

function run(tool, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', path.join(here, tool.script), ...tool.argv(input)],
      { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ isError: code !== 0, content: [{ type: 'text', text: (out || err || `exit ${code}`).slice(0, 60000) }] });
    });
  });
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

createInterface({ input: process.stdin }).on('line', async (row) => {
  let request;
  try { request = JSON.parse(row); } catch { return; }
  const { id, method, params } = request;
  if (id === undefined) return;
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'chat-memory', version: '1.0.0' } } });
  } else if (method === 'ping') send({ id, result: {} });
  else if (method === 'tools/list') {
    send({ id, result: { tools: tools.map((tool) => ({ name: tool.name, description: tool.description,
      inputSchema: { type: 'object', properties: tool.properties, required: tool.required ?? [] } })) } });
  } else if (method === 'tools/call') {
    const tool = tools.find((item) => item.name === params?.name);
    if (!tool) return send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
    const input = params.arguments ?? {};
    const missing = (tool.required ?? []).filter((name) => input[name] === undefined || input[name] === '');
    if (missing.length) {
      return send({ id, result: { isError: true, content: [{ type: 'text', text: `missing: ${missing.join(', ')}` }] } });
    }
    send({ id, result: await run(tool, input) });
  } else send({ id, error: { code: -32601, message: `method not found: ${method}` } });
});
