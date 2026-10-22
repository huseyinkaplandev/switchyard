// Demo-mode stand-in for dashboard-runner.mjs. It validates the package exactly like the real runner, then
// walks each selected item through the delivery states with short pauses so the panel shows the flow.
// It never starts, focuses or types into any application.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePackage, readProgress, writeProgress } from './controller.mjs';
import { acquireLock } from './locks.mjs';

const [directory, hash, action, itemId] = process.argv.slice(2);
const runtimeFile = path.join(directory, 'runtime.json');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stopped = () => fs.access(path.join(directory, 'stop')).then(() => true, () => false);

async function runtime(value) {
  const previous = JSON.parse(await fs.readFile(runtimeFile, 'utf8').catch(() => '{}'));
  const temp = `${runtimeFile}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ ...previous, ...value, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2));
  await fs.rename(temp, runtimeFile);
}

let releasePackage;
try {
  if (process.env.SWITCHYARD_DEMO !== '1') throw new Error('demo-runner.mjs only runs in demo mode');
  const pkg = await validatePackage(directory, hash);
  releasePackage = await acquireLock(path.join(directory, 'controller.lock'));
  await runtime({ status: 'running', error: null, action, itemId: itemId || null });
  const account = 'demo-destination/demo-org';
  const items = itemId ? pkg.items.filter(item => item.id === itemId) : pkg.items;
  const busyCwd = new Set();
  for (const item of items) {
    if (await stopped()) { await runtime({ status: 'stopped' }); process.exit(0); }
    let state = await readProgress(directory, item.id);
    if (state.state === 'reply-observed' && state.titleVerified) continue;
    if (busyCwd.has(item.source.cwd.toLowerCase())) {
      await writeProgress(directory, item.id, { ...state, state: 'queued', blockedBy: 'same working directory' });
      await pause(900);
    }
    busyCwd.add(item.source.cwd.toLowerCase());
    const destinationId = `local_demo-${item.id.slice(0, 8)}`;
    for (const next of ['opening', 'opened', 'sent']) {
      state = { ...state, state: next, destinationAccount: account, blockedBy: undefined, ...(next === 'opening' ? {} : { destinationId }), ...(next === 'sent' ? { submittedAt: new Date().toISOString() } : {}) };
      await writeProgress(directory, item.id, state);
      await pause(700);
    }
    state = { ...state, state: 'reply-observed', firstReplyAt: new Date().toISOString(), titleVerified: true };
    await writeProgress(directory, item.id, state);
    busyCwd.delete(item.source.cwd.toLowerCase());
    await pause(500);
  }
  await runtime({ status: 'finished' });
} catch (error) {
  await runtime({ status: 'error', error: error.message }).catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (releasePackage) await releasePackage();
}
