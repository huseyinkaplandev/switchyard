import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Same resolution as ui/app/_lib/paths.ts, for the scripts in this folder. */
export function dataDir() {
  if (process.env.SWITCHYARD_DEMO === '1') {
    return path.join(path.resolve(process.env.SWITCHYARD_DEMO_ROOT || path.join(repoRoot, '.demo')), 'data');
  }
  return path.resolve(process.env.SWITCHYARD_DATA_DIR || path.join(os.homedir(), '.switchyard'));
}

/** Link that opens one chat in the local dashboard. */
export function chatLink(provider, sessionId) {
  const port = process.env.SWITCHYARD_PORT || (process.env.SWITCHYARD_DEMO === '1' ? '3011' : '3010');
  return `http://127.0.0.1:${port}/?tab=codex&provider=${encodeURIComponent(provider)}&session=${encodeURIComponent(sessionId)}`;
}
