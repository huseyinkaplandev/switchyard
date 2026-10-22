import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export function messageErrorCode(error) {
  return /already has an active writer|already has a live local writer/i.test(error || '') ? 'active_writer' : error;
}
export async function codexWriterBusy(codexHome, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return false;
  const file = path.join(codexHome, 'thread-writer-locks', `${id}.lock`);
  if (!fs.existsSync(file)) return false;
  try {
    if (process.platform === 'win32') {
      const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const deployed = path.resolve(process.cwd(), 'scripts/probe-codex-writer.ps1');
      const script = fs.existsSync(deployed) ? deployed : fileURLToPath(new URL('./probe-codex-writer.ps1', import.meta.url));
      const { stdout } = await run(shell, ['-NoProfile', '-NonInteractive', '-File', script, '-Path', file], { windowsHide: true, timeout: 4000 });
      return stdout.trim() === 'busy';
    }
    const { stdout } = await run('/usr/sbin/lsof', ['-F', 'p', '--', file], { timeout: 2000 });
    return /^p\d+/m.test(stdout);
  } catch { return false; }
}
