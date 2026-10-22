#!/usr/bin/env node
// Starts Switchyard in demo mode on bundled synthetic data.
//
//   npm run demo                       build if needed, generate .demo/, start on http://127.0.0.1:3011
//   SWITCHYARD_PORT=4000 npm run demo  another port
//
// Demo mode never reads your real home directory: every reader is pointed at .demo/home, and actions that
// would touch your machine (restarting Claude Desktop, resuming a CLI, opening apps, skill sync, Ollama)
// return a "Demo mode" message instead.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemo } from '../fixtures/demo/build.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(repo, 'ui');
const root = path.resolve(process.env.SWITCHYARD_DEMO_ROOT || path.join(repo, '.demo'));
const port = process.env.SWITCHYARD_PORT || '3011';
const base = `http://127.0.0.1:${port}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(path.join(ui, '.next-build', 'BUILD_ID'))) {
  console.log('No production build found; running npm run build first.');
  const build = spawnSync(npm, ['run', 'build'], { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const { home } = buildDemo(root);
console.log(`Synthetic demo data generated in ${root}`);

const env = { ...process.env, SWITCHYARD_DEMO: '1', SWITCHYARD_DEMO_ROOT: root, SWITCHYARD_PORT: port,
  HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local') };
for (const name of ['CODEX_HOME', 'ANTIGRAVITY_HOME', 'OPENCODE_HOME', 'OPENCODE_DATA_DIR', 'SWITCHYARD_DATA_DIR', 'SWITCHYARD_MAC_HOME']) delete env[name];

const server = spawn(process.execPath, [path.join(ui, 'scripts', 'run-next.mjs'), 'start'], { cwd: ui, env, stdio: ['ignore', 'pipe', 'inherit'] });
server.stdout.pipe(process.stdout);
const stop = () => { server.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', code => process.exit(code ?? 0));

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(`${base}/api/agent/sync`)).ok) return; } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Switchyard did not start');
}

async function seed() {
  await waitForServer();
  await fetch(`${base}/api/agent/sync`, { method: 'POST' });
  await fetch(`${base}/api/schedules`);
  // A sample handoff package: the two Claude Code chats from account A, prepared for account B.
  const catalog = await (await fetch(`${base}/api/handoff/catalog?time=all`)).json();
  const keys = (catalog.candidates || [])
    .filter(candidate => candidate.provider === 'claude-code' && candidate.chatType === 'normal' && candidate.sourceAccount?.startsWith('acc00000-0000-4000-8000-00000000000a'))
    .slice(0, 2).map(candidate => candidate.key);
  if (keys.length) {
    const response = await fetch(`${base}/api/handoff/packages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ keys, targetProvider: 'claude-code', time: 'all' }) });
    if (!response.ok) console.warn(`Sample handoff package not created: ${(await response.json()).error}`);
  }
  console.log(`\nSwitchyard demo is running at ${base}/`);
  console.log('Run "npm run demo:live" in another terminal to watch a conversation stream in.');
}

seed().catch(error => { console.error(error.message); stop(); });
