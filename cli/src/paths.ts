import os from 'node:os';
import path from 'node:path';

export function getDataDir(): string {
  const envDir = process.env.SWITCHYARD_DATA_DIR;
  if (envDir) {
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), '.switchyard');
}
