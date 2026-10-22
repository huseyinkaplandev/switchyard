import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ui = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const next = createRequire(path.join(ui, 'package.json')).resolve('next/dist/bin/next');
const args = [next, 'dev', '--turbopack', '--port', process.env.SWITCHYARD_PORT || '3010', '--hostname', '127.0.0.1'];
const child = spawn(process.execPath, args, { cwd: ui, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
