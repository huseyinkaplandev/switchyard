import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { invocation, parseOutput } from './session-message-protocol.mjs';
import { codexWriterBusy, messageErrorCode } from './session-writer-probe.mjs';

test('Codex images are literal paths attached to the exact session', () => {
  const files = ['C:\\local folder\\screenshot.png', '/tmp/a;echo bad.webp'];
  const call = invocation('codex', 'exact-session', 'Review images', files);
  assert.deepEqual(call.args.slice(-6), ['--image', files[0], '--image', files[1], 'exact-session', '-']);
  assert.equal(call.stdin, 'Review images');
  assert.throws(() => invocation('claude-code', 'same-session', 'Review', files), /image_unsupported/);
});

test('native writer errors never appear as delivered and stale files are not locks', async () => {
  assert.equal(messageErrorCode('Error: thread abc already has an active writer (code -32600)'), 'active_writer');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-message-test-'));
  const id = '11111111-2222-3333-4444-555555555555';
  const directory = path.join(home, '.codex', 'thread-writer-locks');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${id}.lock`);
  await fs.writeFile(file, '');
  try {
    assert.equal(await codexWriterBusy(path.join(home, '.codex'), id), false);
    if (process.platform === 'win32') {
      const script = path.join(home, 'hold.ps1');
      await fs.writeFile(script, 'param([string]$Path)\n$s=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)\ntry { $s.Lock(0,1); "ready"; Start-Sleep -Seconds 8 } finally {$s.Dispose()}');
      const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-File',script,'-Path',file], { windowsHide: true });
      await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
      try { assert.equal(await codexWriterBusy(path.join(home, '.codex'), id), true); assert.equal((await fs.stat(file)).size, 0); }
      finally { child.kill(); await new Promise(resolve => child.once('close', resolve)); }
    }
  } finally {
    const resolved = path.resolve(home);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dashboard-message-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('resume transport preserves exact session and literal hostile text', () => {
  const text = '-m fake & echo hacked; $(whoami) `x`\nTürkçe "prompt"';
  for (const provider of ['codex', 'claude-code', 'opencode']) {
    const call = invocation(provider, 'session-123', text);
    assert.ok(call.args.includes('session-123'));
    assert.equal(provider === 'opencode' ? call.args.at(-1) : call.stdin, text);
    assert.ok(!call.args.some(arg => arg.includes('bypass') || arg.includes('skip-permissions')));
  }
  assert.throws(() => invocation('antigravity', 'id', text), /unsupported/);
});

test('only response text is exposed, and provider failure is not success', () => {
  assert.equal(parseOutput('codex', JSON.stringify({ type:'item.completed', item:{type:'command_execution', aggregated_output:'private tool output'} })), null);
  assert.equal(parseOutput('claude-code', JSON.stringify({ type:'result', is_error:true, errors:['auth failed'] })).error, 'auth failed');
  assert.equal(parseOutput('claude-code', JSON.stringify({ type:'stream_event', event:{type:'content_block_delta', delta:{type:'text_delta',text:'hello'}} })).text, 'hello');
});

async function runWorker(code, expectedStatus, cancel = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-message-test-'));
  try {
    const id = '00000000-0000-4000-8000-000000000001';
    const lockPath = path.join(root, 'target.lock');
    const fixture = path.join(root, 'fixture.mjs');
    await fs.writeFile(fixture, code);
    await fs.writeFile(lockPath, id);
    if (cancel) await fs.writeFile(path.join(root, 'cancel'), '');
    await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({id,targetKey:'target',provider:'codex',nativeId:'exact-native-id',message:'literal & $(x) Türkçe',cwd:root,command:process.execPath,prefix:[fixture],lockPath}));
    const child = spawn(process.execPath, [new URL('./session-message-worker.mjs',import.meta.url).pathname.replace(/^\/(?=[A-Z]:)/, ''), root], {shell:false,windowsHide:true,stdio:'pipe'});
    const exit = await new Promise((resolve,reject) => { child.on('error',reject); child.on('close',resolve); });
    assert.equal(exit,0);
    const state = JSON.parse(await fs.readFile(path.join(root,'status.json'),'utf8'));
    assert.equal(state.status,expectedStatus);
    await assert.rejects(fs.stat(lockPath),{code:'ENOENT'});
    return state;
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('dashboard-message-test-'));
    await fs.rm(root,{recursive:true,force:true});
  }
}
test('worker continues exact native ID and persists terminal status', async () => {
  const state = await runWorker(`let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{if(!process.argv.includes('exact-native-id')||input!=='literal & $(x) Türkçe') process.exit(2);process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'transport verified'}}));});`, 'completed');
  assert.equal(state.output,'transport verified');
});
test('provider JSON failure without trailing newline cannot appear completed', async () => {
  const state = await runWorker(`process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'turn.failed',error:{message:'permission denied'}})));`, 'failed');
  assert.equal(state.error,'permission denied');
});
test('cancel stops only the owned run and releases session lock', async () => {
  const state = await runWorker('process.stdin.resume();setInterval(()=>{},1000);', 'cancelled', true);
  assert.equal(state.error,'cancelled');
});
test('inherited console pipes cannot keep a completed CLI run locked', async () => {
  const state = await runWorker(`import {spawn} from 'node:child_process';process.stdin.resume();process.stdin.on('end',()=>{spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:'inherit',windowsHide:true}).unref();process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'done'}}));process.exit(0);});`, 'completed');
  assert.equal(state.output,'done');
});
