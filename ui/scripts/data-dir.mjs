import os from 'node:os';
import path from 'node:path';

/** Same resolution as app/_lib/paths.ts, for plain Node scripts. */
export function dataDir() {
  if (process.env.SWITCHYARD_DEMO === '1') {
    return path.join(path.resolve(process.env.SWITCHYARD_DEMO_ROOT || path.join(process.cwd(), '..', '.demo')), 'data');
  }
  return path.resolve(process.env.SWITCHYARD_DATA_DIR || path.join(os.homedir(), '.switchyard'));
}
