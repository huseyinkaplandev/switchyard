#!/usr/bin/env node
// Appends new records to one demo Codex conversation and to the activity log, a few seconds apart, so the
// live transcript stream and the Activity tab update while you watch. Start `npm run demo` first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveConversationId } from '../fixtures/demo/content.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.SWITCHYARD_DEMO_ROOT || path.join(repo, '.demo'));
const sessions = path.join(root, 'home', '.codex', 'sessions');
const logFile = path.join(root, 'data', 'LIVE_LOG.md');

function findRollout(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { const found = findRollout(file); if (found) return found; }
    else if (entry.name.endsWith(`${liveConversationId}.jsonl`)) return file;
  }
  return null;
}

if (!fs.existsSync(sessions)) { console.error('No demo data found. Run "npm run demo" first.'); process.exit(1); }
const rollout = findRollout(sessions);
if (!rollout) { console.error('The live demo conversation is missing. Restart "npm run demo".'); process.exit(1); }

const pad = (n) => String(n).padStart(2, '0');
const logTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const item = (payload) => ({ timestamp: new Date().toISOString(), type: 'response_item', payload });
const event = (payload) => ({ timestamp: new Date().toISOString(), type: 'event_msg', payload });

const script = [
  [event({ type: 'task_started' })],
  [item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Now add tests for the delay schedule and make sure jitter never goes above the cap.' }] })],
  [item({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Mock Math.random at 0 and 1 to pin both ends of the jitter range, then check every attempt up to the cap.' }], encrypted_content: null })],
  [item({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: src/webhooks/deliver.test.ts\n+it("never exceeds the cap", () => { ... });\n*** End Patch', call_id: 'call_live_1' }),
   item({ type: 'custom_tool_call_output', call_id: 'call_live_1', output: JSON.stringify({ output: 'Success. Updated the following files:\nA src/webhooks/deliver.test.ts', metadata: { exit_code: 0 } }) })],
  [item({ type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test -- webhooks'] }), call_id: 'call_live_2' }),
   item({ type: 'function_call_output', call_id: 'call_live_2', output: 'Exit code: 0\nWall time: 3.1 seconds\nOutput:\nTests: 17 passed, 17 total' })],
  [item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Added 5 tests for the delay schedule. With jitter pinned at both ends, every attempt stays between 50 and 100 percent of its base delay and never above 60 s. 17 webhook tests pass.' }] }),
   event({ type: 'agent_message', message: 'Added 5 tests for the delay schedule.' })],
  [event({ type: 'task_complete' })],
];
const logLines = [
  'backend/codex: TASK-0005 writing delay schedule tests',
  'backend/codex: TASK-0005 17 webhook tests green, @qa ready for review',
];

let step = 0;
console.log(`Appending to ${path.basename(rollout)} every 3 seconds. Press Ctrl+C to stop.`);
const timer = setInterval(() => {
  if (step >= script.length) { clearInterval(timer); console.log('Done.'); return; }
  fs.appendFileSync(rollout, script[step].map(record => JSON.stringify(record)).join('\n') + '\n');
  if (step === 1 || step === script.length - 1) fs.appendFileSync(logFile, `[${logTime(new Date())}] ${logLines[step === 1 ? 0 : 1]}\n`);
  console.log(`  step ${step + 1}/${script.length}`);
  step++;
}, 3000);
