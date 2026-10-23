#!/usr/bin/env node
// Regenerates src/mock/demo-snapshot.json: what the real Switchyard server returns in demo mode.
//
//   npm run playground:snapshot
//
// It builds the synthetic demo world from fixtures/demo into a temporary folder, loads the real server
// actions and API route handlers from ui/app through Vite's SSR loader, calls them the same way the
// browser and scripts/demo.mjs do, replays scripts/demo-live.mjs, and records every response. Paths
// inside the temporary folder are rewritten to a neutral demo home before the file is written.
// Run it on Windows: the recorded paths and the handoff panel then show the Windows delivery flow.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed zone so the snapshot does not depend on (or reveal) the machine's time zone.
process.env.TZ = 'UTC';
process.env.SWITCHYARD_TIMEZONE = 'UTC';

const playground = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(playground, '..');
const ui = path.join(repo, 'ui');
const output = path.join(playground, 'src', 'mock', 'demo-snapshot.json');
const origin = 'http://127.0.0.1:3011';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'switchyard-playground-'));
const realRoot = fs.realpathSync.native(root);
const { buildDemo } = await import('../../fixtures/demo/build.mjs');
const generatedAt = Date.now();
const { home } = buildDemo(root, generatedAt);
const content = await import('../../fixtures/demo/content.mjs');

Object.assign(process.env, {
  SWITCHYARD_DEMO: '1', SWITCHYARD_DEMO_ROOT: root, HOME: home, USERPROFILE: home,
  APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
});
for (const name of ['CODEX_HOME', 'ANTIGRAVITY_HOME', 'OPENCODE_HOME', 'OPENCODE_DATA_DIR', 'SWITCHYARD_DATA_DIR', 'SWITCHYARD_MAC_HOME']) delete process.env[name];
process.chdir(ui);

const { createServer } = await import('vite');
const empty = path.join(playground, 'src', 'shims', 'empty.ts');
const server = await createServer({
  configFile: false, root: ui, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: [{ find: /^server-only$/, replacement: empty }, { find: /^@\//, replacement: `${ui}/` }] },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (file) => server.ssrLoadModule(path.join(ui, 'app', file));

try {
  const actions = await load('_actions/index.ts');
  const syncRoute = await load('api/agent/sync/route.ts');
  const schedulesRoute = await load('api/schedules/route.ts');
  const catalogRoute = await load('api/handoff/catalog/route.ts');
  const packagesRoute = await load('api/handoff/packages/route.ts');
  const packageRoute = await load('api/handoff/packages/[id]/route.ts');
  const snapshotRoute = await load('api/handoff/snapshot/route.ts');
  const focusRoute = await load('api/agent/focus/route.ts');
  const messageRoute = await load('api/agent/message/route.ts');

  const request = (url, init = {}) => new Request(`${origin}${url}`, { ...init, headers: { 'Content-Type': 'application/json', Origin: origin, Host: '127.0.0.1:3011', ...init.headers } });
  const json = async (responsePromise) => {
    const response = await responsePromise;
    return { status: response.status, body: await response.json() };
  };
  const post = (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) });

  // Same seed sequence as scripts/demo.mjs.
  await syncRoute.POST();
  await schedulesRoute.GET();
  const seedCatalog = (await json(catalogRoute.GET(request('/api/handoff/catalog?time=all')))).body;
  const keys = (seedCatalog.candidates || [])
    .filter(candidate => candidate.provider === 'claude-code' && candidate.chatType === 'normal' && candidate.sourceAccount?.startsWith(content.accounts.a.account))
    .slice(0, 2).map(candidate => candidate.key);
  const created = await json(packagesRoute.POST(post('/api/handoff/packages', { keys, targetProvider: 'claude-code', time: 'all' })));
  if (created.status !== 201) throw new Error(`Sample handoff package not created: ${created.body.error}`);

  const threads = await actions.listCodexThreads();
  const messages = {}, threadSnapshots = {}, handoffSnapshots = {}, composer = {};
  for (const thread of threads) {
    messages[thread.id] = await actions.getCodexThreadMessages(thread.id);
    threadSnapshots[thread.id] = await actions.getAgentThreadSnapshot(thread.id);
    handoffSnapshots[thread.id] = await json(snapshotRoute.POST(post('/api/handoff/snapshot', { id: thread.id })));
    composer[thread.id] = await json(messageRoute.GET(request(`/api/agent/message?kind=archive&id=${encodeURIComponent(thread.id)}`)));
  }
  const gitStates = {};
  for (const cwd of new Set(threads.map(thread => thread.cwd))) gitStates[cwd] = await actions.getWorkspaceGitState(cwd);
  const focus = {};
  for (const provider of ['codex', 'claude-code', 'opencode', 'antigravity']) focus[provider] = await json(focusRoute.POST(post('/api/agent/focus', { provider })));

  const packages = (await json(packagesRoute.GET())).body;
  const packageDetails = {};
  for (const pkg of packages.packages) packageDetails[pkg.id] = (await json(packageRoute.GET(request(`/api/handoff/packages/${pkg.id}`), { params: Promise.resolve({ id: pkg.id }) }))).body;

  const midnight = new Date(generatedAt); midnight.setHours(0, 0, 0, 0);
  const snapshot = {
    generatedAt,
    // build.mjs squeezes "today" items into the minutes since midnight; the browser undoes and redoes that.
    todaySpanMinutes: Math.max(6, Math.floor((generatedAt - midnight.getTime()) / 60_000) - 2),
    liveConversationId: content.liveConversationId,
    threads,
    messages,
    threadSnapshots,
    handoffSnapshots,
    composer,
    gitStates,
    focus,
    archiveStatus: await actions.getAgentArchiveHealth(),
    syncStatus: (await json(syncRoute.GET())).body,
    syncResult: (await json(syncRoute.POST())).body,
    catalog: (await json(catalogRoute.GET(request('/api/handoff/catalog')))).body,
    packages,
    packageDetails,
    schedules: (await json(schedulesRoute.GET())).body,
    schedulesInstall: await json(schedulesRoute.POST(post('/api/schedules', { action: 'install' }))),
    schedulesSaveSkills: await json(schedulesRoute.POST(post('/api/schedules', { action: 'save-skills' }))),
    state: await actions.getState(),
    tasks: await actions.listTasks(),
  };
  // Mutating calls last, so everything above reflects the untouched demo world.
  snapshot.schedulesCopyToCodex = await json(schedulesRoute.POST(post('/api/schedules', { action: 'copy-to-codex' })));
  snapshot.schedulesAfterCopy = (await json(schedulesRoute.GET())).body;

  console.log('Replaying scripts/demo-live.mjs (about 25 seconds)...');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repo, 'scripts', 'demo-live.mjs')], { env: process.env, stdio: 'ignore' });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`demo-live exited with ${code}`)));
  });
  await actions.syncAgentArchive();
  const liveMessages = await actions.getCodexThreadMessages(content.liveConversationId);
  const known = new Set(messages[content.liveConversationId].map(message => message.id));
  snapshot.live = {
    messages: liveMessages.filter(message => !known.has(message.id)),
    state: await actions.getState(),
  };

  const text = JSON.stringify(sanitize(snapshot), null, 1) + '\n';
  for (const secret of [os.userInfo().username, os.homedir(), root, realRoot, os.tmpdir()]) {
    if (secret && text.toLowerCase().includes(secret.toLowerCase())) throw new Error(`Snapshot still contains a local value: ${secret}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text);
  console.log(`Wrote ${path.relative(repo, output)} (${Math.round(text.length / 1024)} KB)`);
} finally {
  await server.close();
  // The archive database stays open in this process on Windows; leftover synthetic files are harmless.
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { console.log(`Temporary demo folder left at ${root}`); }
}

/** Rewrites the temporary demo folder to a neutral home so no local path ends up in the bundle. */
function sanitize(value) {
  const windows = process.platform === 'win32';
  const neutralHome = windows ? 'C:\\Users\\demo' : '/home/demo';
  const replacements = [];
  for (const base of new Set([root, realRoot])) {
    for (const [from, to] of [[path.join(base, 'home'), neutralHome], [path.join(base, 'data'), path.join(neutralHome, '.switchyard')], [base, path.join(neutralHome, '.switchyard-demo')]]) {
      replacements.push([from, to], [from.replace(/\\/g, '/'), to.replace(/\\/g, '/')], [from.replace(/\\/g, '\\\\'), to.replace(/\\/g, '\\\\')]);
    }
  }
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = replacements.map(([from, to]) => [new RegExp(escape(from), 'gi'), to]);
  const clean = (text) => patterns.reduce((result, [pattern, to]) => result.replace(pattern, () => to), text);
  const walk = (item) => {
    if (typeof item === 'string') return clean(item);
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [clean(key), walk(entry)]));
    return item;
  };
  return walk(JSON.parse(JSON.stringify(value)));
}
