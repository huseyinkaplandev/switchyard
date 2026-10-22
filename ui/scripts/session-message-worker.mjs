import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { invocation, parseOutput } from './session-message-protocol.mjs';
import { messageErrorCode } from './session-writer-probe.mjs';

const jobDir = process.argv[2];
const spec = JSON.parse(fs.readFileSync(path.join(jobDir, 'request.json'), 'utf8'));
let state = { id: spec.id, targetKey: spec.targetKey, status: 'starting', output: '', error: '', startedAt: new Date().toISOString(), workerPid: process.pid };
const save = () => {
  const temp = path.join(jobDir, 'status.tmp');
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temp, path.join(jobDir, 'status.json'));
};
save();
const call = invocation(spec.provider, spec.nativeId, spec.message, spec.images || []);
const env = { ...process.env };
if (spec.provider === 'claude-code') {
  // Resumed sessions belong to the CLI's own login; a local router override may not be running.
  for (const name of Object.keys(env)) if (/^ANTHROPIC_(BASE_URL|AUTH_TOKEN)$/i.test(name)) delete env[name];
}
const child = spawn(spec.command, [...spec.prefix, ...call.args], { cwd: spec.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
let buffer = '', stderr = '', failed = false, finished = false, stopping = false;
let flushTimer;
function flush() { clearTimeout(flushTimer); flushTimer = setTimeout(save, 100); }
function line(text) {
  const event = parseOutput(spec.provider, text);
  if (!event) return;
  if (event.error) { state.error = String(event.error).slice(-4000); failed = true; }
  if (event.text) {
    if (event.final) state.output = event.text.slice(-64000);
    else state.output = (state.output + (event.append && state.output ? '\n\n' : '') + event.text).slice(-64000);
  }
  flush();
}
function stop() {
  if (stopping) return;
  stopping = true;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else child.kill('SIGTERM');
}
function finish(status, error = '') {
  if (finished) return;
  finished = true;
  clearTimeout(flushTimer); clearTimeout(deadline); clearInterval(cancelCheck);
  if (buffer) line(buffer);
  clearTimeout(flushTimer);
  state.status = status; state.error = messageErrorCode(error || state.error); state.finishedAt = new Date().toISOString();
  save();
  try {
    if (fs.readFileSync(spec.lockPath, 'utf8') === spec.id) fs.unlinkSync(spec.lockPath);
  } catch {}
}
const deadline = setTimeout(() => { failed = true; state.error = 'timeout'; stop(); }, 30 * 60 * 1000);
const cancelCheck = setInterval(() => {
  if (fs.existsSync(path.join(jobDir, 'cancel'))) { state.error = 'cancelled'; failed = true; stop(); }
}, 500);
child.on('spawn', () => { state.status = 'running'; state.pid = child.pid; save(); });
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
  if (buffer.length > 2_000_000) { failed = true; state.error = 'output_limit'; buffer = ''; stop(); }
});
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
child.on('error', error => finish('failed', error.message));
function exit(code) {
  if (buffer) { line(buffer); buffer = ''; }
  finish(code === 0 && !failed ? 'completed' : state.error === 'cancelled' ? 'cancelled' : 'failed', code === 0 ? '' : state.error || stderr || `Agent exited (${code})`);
}
child.on('close', exit);
// MCP/console descendants can retain inherited pipes after the CLI has exited.
// Completion follows the CLI, while allowing its final buffered events to drain.
child.on('exit', code => setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); exit(code); }, 200));
child.stdin.on('error', () => {});
child.stdin.end(call.stdin);
