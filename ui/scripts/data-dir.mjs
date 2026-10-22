import os from 'node:os';
import path from 'node:path';

/** Same resolution as app/_lib/paths.ts, for plain Node scripts. */
export function dataDir() {
  return path.resolve(process.env.SWITCHYARD_DATA_DIR || path.join(os.homedir(), '.switchyard'));
}
