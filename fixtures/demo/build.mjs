// Builds the synthetic demo world: a fake home directory with native Codex, Claude Code, OpenCode and
// Antigravity data, Claude Desktop accounts with scheduled tasks, and a seeded Switchyard data folder.
// Every project, account, address and identifier here is invented. Timestamps are relative to "now"
// so the archive, the "today" filters and the run history always look current.
//
//   node fixtures/demo/build.mjs <target-root>
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { conversations, scheduledTasks, tasks, liveLog, accounts, projects } from './content.mjs';

const MINUTE = 60_000;

function write(file, text, modified) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (modified) fs.utimesSync(file, modified, modified);
}
/** Native tools leave the file's modified time at the last write; mirror that. */
const lastStamp = records => new Date(records.map(record => record.timestamp ?? record.created_at).filter(Boolean).sort().at(-1));
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';

/** Minutes before now, but never before local midnight for items marked as today. */
function clock(now) {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const todaySpan = Math.max(6, Math.floor((now - midnight.getTime()) / MINUTE) - 2);
  return (minutesAgo, today = false) => {
    const scaled = today ? Math.min(minutesAgo, todaySpan * (minutesAgo / 180)) : minutesAgo;
    return new Date(now - Math.max(0, scaled) * MINUTE);
  };
}

function codexRollout(conversation, at, cwd) {
  const records = [];
  let index = 0;
  let callId = 0;
  const stamp = () => at(conversation.startMinutesAgo - index++ * conversation.stepMinutes, conversation.today).toISOString();
  records.push({ timestamp: stamp(), type: 'session_meta', payload: { id: conversation.id, timestamp: at(conversation.startMinutesAgo, conversation.today).toISOString(), cwd, originator: 'codex_cli', cli_version: '0.50.0', source: 'cli', model_provider: 'openai' } });
  for (const turn of conversation.turns) {
    const turnStart = stamp();
    records.push({ timestamp: turnStart, type: 'event_msg', payload: { type: 'task_started' } });
    records.push({ timestamp: turnStart, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.user }] } });
    records.push({ timestamp: turnStart, type: 'event_msg', payload: { type: 'user_message', message: turn.user } });
    for (const step of turn.steps) {
      const time = stamp();
      if (step.think) records.push({ timestamp: time, type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: step.think }], encrypted_content: null } });
      if (step.shell) {
        const id = `call_demo_${conversation.id.slice(-4)}_${++callId}`;
        records.push({ timestamp: time, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', step.shell], workdir: cwd }), call_id: id } });
        records.push({ timestamp: time, type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: `Exit code: ${step.exit ?? 0}\nWall time: ${step.seconds ?? 2.4} seconds\nOutput:\n${step.output ?? ''}` } });
      }
      if (step.patch) {
        const id = `call_demo_${conversation.id.slice(-4)}_${++callId}`;
        records.push({ timestamp: time, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: `*** Begin Patch\n*** Update File: ${step.patch.file}\n@@\n${step.patch.diff}\n*** End Patch`, call_id: id } });
        records.push({ timestamp: time, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: JSON.stringify({ output: `Success. Updated the following files:\nM ${step.patch.file}`, metadata: { exit_code: 0, duration_seconds: 0.1 } }) } });
      }
      if (step.say) {
        records.push({ timestamp: time, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: step.say }] } });
        records.push({ timestamp: time, type: 'event_msg', payload: { type: 'agent_message', message: step.say } });
      }
      if (step.limit) records.push({ timestamp: time, type: 'event_msg', payload: { type: 'error', message: step.limit } });
    }
    records.push({ timestamp: stamp(), type: 'event_msg', payload: { type: 'task_complete' } });
  }
  return records;
}

function claudeSession(conversation, at, cwd) {
  const records = [];
  let index = 0;
  let toolId = 0;
  let parent = null;
  const stamp = () => at(conversation.startMinutesAgo - index++ * conversation.stepMinutes, conversation.today).toISOString();
  const base = () => ({ sessionId: conversation.id, cwd, version: '2.1.0', gitBranch: conversation.branch ?? 'main', userType: 'external' });
  const push = (record) => {
    const uuid = `${conversation.id.slice(0, 24)}${String(records.length + 1).padStart(12, '0')}`;
    records.push({ parentUuid: parent, isSidechain: false, ...base(), ...record, uuid });
    parent = uuid;
  };
  if (conversation.title) records.push({ type: 'custom-title', customTitle: conversation.title, sessionId: conversation.id });
  for (const turn of conversation.turns) {
    push({ type: 'user', timestamp: stamp(), message: { role: 'user', content: turn.user } });
    for (const step of turn.steps) {
      const time = stamp();
      const content = [];
      if (step.think) content.push({ type: 'thinking', thinking: step.think, signature: '' });
      if (step.tool) {
        const id = `toolu_demo_${conversation.id.slice(-4)}_${++toolId}`;
        content.push({ type: 'tool_use', id, name: step.tool.name, input: step.tool.input });
        push({ type: 'assistant', timestamp: time, message: { id: `msg_demo_${toolId}`, role: 'assistant', model: 'claude-sonnet-4-5', stop_reason: 'tool_use', content } });
        push({ type: 'user', timestamp: time, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: step.tool.result, is_error: step.tool.error === true }] } });
        continue;
      }
      if (step.say) content.push({ type: 'text', text: step.say });
      if (step.limit) {
        push({ type: 'assistant', timestamp: time, isApiErrorMessage: true, message: { id: 'msg_demo_limit', role: 'assistant', model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text: step.limit }] } });
        continue;
      }
      if (content.length) push({ type: 'assistant', timestamp: time, message: { id: `msg_demo_${index}`, role: 'assistant', model: 'claude-sonnet-4-5', stop_reason: 'end_turn', content } });
    }
  }
  return records;
}

function antigravityTranscript(conversation, at) {
  const records = [];
  let index = 0;
  const stamp = () => at(conversation.startMinutesAgo - index++ * conversation.stepMinutes, conversation.today).toISOString();
  for (const turn of conversation.turns) {
    records.push({ source: 'USER_EXPLICIT', type: 'USER_INPUT', content: `<USER_REQUEST>${turn.user}</USER_REQUEST>`, created_at: stamp() });
    for (const step of turn.steps) {
      const time = stamp();
      if (step.tool) {
        records.push({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: step.say ?? '', thinking: step.think ?? '', tool_calls: [{ name: step.tool.name, args: step.tool.input }], created_at: time });
        records.push({ source: 'MODEL', type: 'GENERIC', content: step.tool.result, created_at: time });
      } else {
        records.push({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: step.say ?? '', thinking: step.think ?? '', created_at: time });
      }
    }
  }
  return records;
}

/** The small part of Antigravity's summary index that Switchyard reads: id, title and workspace URI. */
function antigravityIndex(items) {
  const varint = (value) => { const bytes = []; do { let byte = value & 0x7f; value >>>= 7; if (value) byte |= 0x80; bytes.push(byte); } while (value); return Buffer.from(bytes); };
  const parts = [];
  for (const { id, title, cwd } of items) {
    const titleBytes = Buffer.from(title, 'utf8');
    const uri = Buffer.from(`file:///${cwd.replace(/\\/g, '/')}`, 'utf8');
    const sub = Buffer.concat([Buffer.from([0x0a]), varint(titleBytes.length), titleBytes, Buffer.from([0x1a]), varint(uri.length), uri]);
    parts.push(Buffer.from([0x0a, 0x24]), Buffer.from(id, 'latin1'), Buffer.from([0x12]), varint(sub.length), sub);
  }
  return Buffer.concat(parts);
}

function opencodeDatabase(file, items, at) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT, directory TEXT, version TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  const insertSession = db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?)');
  const insertMessage = db.prepare('INSERT INTO message VALUES (?,?,?,?)');
  const insertPart = db.prepare('INSERT INTO part VALUES (?,?,?,?,?)');
  for (const { conversation, cwd } of items) {
    let index = 0, counter = 0;
    const stamp = () => at(conversation.startMinutesAgo - index++ * conversation.stepMinutes, conversation.today).getTime();
    const created = stamp();
    const message = (role, time, parts) => {
      const id = `msg_demo${conversation.id.slice(-6)}${String(++counter).padStart(3, '0')}`;
      insertMessage.run(id, conversation.id, time, JSON.stringify({ role, time: { created: time } }));
      parts.forEach((part, offset) => insertPart.run(`prt_demo${conversation.id.slice(-6)}${String(counter).padStart(3, '0')}${offset}`, id, conversation.id, time + offset, JSON.stringify(part)));
    };
    let last = created;
    for (const turn of conversation.turns) {
      last = stamp();
      message('user', last, [{ type: 'text', text: turn.user }]);
      for (const step of turn.steps) {
        last = stamp();
        const parts = [];
        if (step.think) parts.push({ type: 'reasoning', text: step.think });
        if (step.tool) parts.push({ type: 'tool', tool: step.tool.name, state: step.tool.error ? { status: 'error', input: step.tool.input, error: step.tool.result } : { status: 'completed', input: step.tool.input, output: step.tool.result } });
        if (step.say) parts.push({ type: 'text', text: step.say });
        message('assistant', last, parts);
      }
    }
    insertSession.run(conversation.id, 'prj_demo', null, conversation.title, cwd, '1.0.0', created, last, null);
  }
  db.close();
}

function toml(value) { return JSON.stringify(value); }

export function buildDemo(root, now = Date.now()) {
  const at = clock(now);
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  fs.rmSync(root, { recursive: true, force: true });
  const claudeDesktop = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Claude')
    : path.join(home, 'AppData', 'Roaming', 'Claude');
  const projectPath = (name) => projects[name];
  const codexIndex = [];
  const antigravityItems = [];
  const opencodeItems = [];
  const desktopSessions = [];

  for (const conversation of conversations) {
    const cwd = projectPath(conversation.project);
    if (conversation.provider === 'codex') {
      const started = at(conversation.startMinutesAgo, conversation.today);
      const day = started.toISOString().slice(0, 10).split('-');
      const name = `rollout-${started.toISOString().slice(0, 19).replace(/:/g, '-')}-${conversation.id}.jsonl`;
      const folder = conversation.archived ? path.join(home, '.codex', 'archived_sessions') : path.join(home, '.codex', 'sessions', ...day);
      const records = codexRollout(conversation, at, cwd);
      write(path.join(folder, name), jsonl(records), lastStamp(records));
      codexIndex.push({ id: conversation.id, thread_name: conversation.title, updated_at: started.toISOString() });
    } else if (conversation.provider === 'claude-code') {
      const slug = cwd.replace(/[:\\/]/g, '-');
      const records = claudeSession(conversation, at, cwd);
      write(path.join(home, '.claude', 'projects', slug, `${conversation.id}.jsonl`), jsonl(records), lastStamp(records));
      if (conversation.desktop) desktopSessions.push({ conversation, cwd });
    } else if (conversation.provider === 'antigravity') {
      const records = antigravityTranscript(conversation, at);
      write(path.join(home, '.gemini', 'antigravity', 'brain', conversation.id, '.system_generated', 'logs', 'transcript.jsonl'), jsonl(records), lastStamp(records));
      antigravityItems.push({ id: conversation.id, title: conversation.title, cwd });
    } else if (conversation.provider === 'opencode') {
      opencodeItems.push({ conversation, cwd });
    }
  }
  write(path.join(home, '.codex', 'session_index.jsonl'), jsonl(codexIndex));
  fs.mkdirSync(path.join(home, '.gemini', 'antigravity'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'antigravity', 'agyhub_summaries_proto.pb'), antigravityIndex(antigravityItems));
  opencodeDatabase(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), opencodeItems, at);

  // Claude Desktop: two accounts; the user switched to account B after account A hit its usage limit.
  write(path.join(claudeDesktop, 'config.json'), JSON.stringify({ lastKnownAccountUuid: accounts.b.account }, null, 2));
  for (const { conversation, cwd } of desktopSessions) {
    const owner = accounts[conversation.desktop.account];
    const created = at(conversation.startMinutesAgo, conversation.today).getTime();
    const metadata = {
      sessionId: `local_${conversation.desktop.local}`, cliSessionId: conversation.id, title: conversation.title, cwd, originCwd: cwd,
      createdAt: created, lastActivityAt: created + conversation.turns.length * 60_000, isArchived: false, model: 'claude-sonnet-4-5',
      ...(conversation.desktop.scheduledTaskId ? { scheduledTaskId: conversation.desktop.scheduledTaskId } : {}),
    };
    write(path.join(claudeDesktop, 'claude-code-sessions', owner.account, owner.org, `local_${conversation.desktop.local}.json`), JSON.stringify(metadata, null, 2));
  }
  for (const [key, owner] of Object.entries(accounts)) {
    const records = scheduledTasks.claude.filter(task => task.accounts.includes(key)).map(task => ({
      id: task.id, displayName: task.name, cronExpression: task.cron, enabled: task.enabled, cwd: projectPath(task.project),
      filePath: path.join(home, '.claude', 'scheduled-tasks', task.id, 'SKILL.md'), createdAt: now - 20 * 24 * 60 * MINUTE,
      permissionMode: 'default', model: 'claude-sonnet-4-5',
      ...(task.lastRunMinutesAgo ? { lastRunAt: at(task.lastRunMinutesAgo).toISOString() } : {}),
    }));
    write(path.join(claudeDesktop, 'claude-code-sessions', owner.account, owner.org, 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: records, recordedSkips: {} }, null, 2));
  }
  for (const task of scheduledTasks.claude) {
    write(path.join(home, '.claude', 'scheduled-tasks', task.id, 'SKILL.md'), `---\nname: ${task.id}\ndescription: ${task.name}\n---\n${task.prompt}\n`);
  }
  for (const task of scheduledTasks.codex) {
    write(path.join(home, '.codex', 'automations', task.id, 'automation.toml'), [
      'version = 1', `id = ${toml(task.id)}`, 'kind = "cron"', `name = ${toml(task.name)}`, `prompt = ${toml(task.prompt)}`,
      `status = ${toml(task.enabled ? 'ACTIVE' : 'PAUSED')}`, `rrule = ${toml(task.rrule)}`, 'execution_environment = "local"',
      `cwds = [${toml(projectPath(task.project))}]`, `created_at = ${now - 9 * 24 * 60 * MINUTE}`, `updated_at = ${now - 2 * 24 * 60 * MINUTE}`, '',
    ].join('\n'));
  }
  const sidecars = {};
  for (const task of scheduledTasks.antigravity) {
    write(path.join(home, '.gemini', 'config', 'sidecars', task.id, 'sidecar.json'), JSON.stringify({ builtin: 'schedule', display_name: task.name, args: [task.cron, task.prompt] }, null, 2));
    sidecars[task.id] = { enabled: task.enabled };
  }
  write(path.join(home, '.gemini', 'config', 'config.json'), JSON.stringify({ sidecars }, null, 2));

  // Switchyard's own data folder.
  const date = (minutesAgo) => {
    const value = at(minutesAgo);
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  };
  write(path.join(data, 'LIVE_LOG.md'), liveLog.map(([minutesAgo, line]) => `[${date(minutesAgo)}] ${line}`).join('\n') + '\n');
  write(path.join(data, 'LEAD.md'), 'claude-code');
  for (const task of tasks) {
    const created = at(task.createdDaysAgo * 24 * 60).toISOString().slice(0, 10);
    write(path.join(data, 'tasks', `${task.id}-${task.slug}.md`), `---\nid: ${task.id}\ntitle: ${task.title}\nstatus: ${task.status}\nassignee: ${task.assignee ?? 'null'}\nrole: ${task.role ?? 'null'}\ncreated: ${created}\npriority: ${task.priority}\n---\n\n${task.body}\n`);
  }
  write(path.join(data, 'desktop-account-labels.json'), JSON.stringify({
    [`${accounts.a.account}/${accounts.a.org}`]: accounts.a.label,
    [`${accounts.b.account}/${accounts.b.org}`]: accounts.b.label,
  }, null, 2));
  // The previous session ran on account A, so the first poll treats this start as an account switch.
  write(path.join(data, 'claude-auto-migration.json'), JSON.stringify({ lastAccount: `${accounts.a.account}/${accounts.a.org}`, needsInstall: false }, null, 2));
  return { home, data };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.demo'));
  const result = buildDemo(target);
  console.log(`Demo data written to ${target}`);
  console.log(`  home: ${result.home}`);
  console.log(`  data: ${result.data}`);
}
