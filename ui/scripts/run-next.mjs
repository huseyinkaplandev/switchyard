import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mode = process.argv[2];
if (mode !== 'build' && mode !== 'start') throw new Error('Expected build or start');
const ui = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const next = createRequire(path.join(ui, 'package.json')).resolve('next/dist/bin/next');
const args = [next, mode];
// The server only ever listens on the loopback interface.
if (mode === 'start') args.push('--port', process.env.SWITCHYARD_PORT || '3010', '--hostname', '127.0.0.1');
args.push(...process.argv.slice(3));
const child = spawn(process.execPath, args, {
  cwd: ui, stdio: 'inherit', env: { ...process.env, NEXT_DIST_DIR: '.next-build' },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
