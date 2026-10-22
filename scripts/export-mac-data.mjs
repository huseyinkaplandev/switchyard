import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('Run this exporter on macOS.');
}
if (!process.argv[2]) {
  throw new Error('Usage: node scripts/export-mac-data.mjs /path/to/synced/mac-home');
}

const home = os.homedir();
const destination = path.resolve(process.argv[2]);
const sources = [
  '.codex/sessions',
  '.codex/archived_sessions',
  '.codex/automations',
  '.claude/projects',
  '.claude/scheduled-tasks',
  '.gemini/antigravity/conversations',
  '.gemini/config/sidecars',
  'Library/Application Support/Claude/claude-code-sessions',
  'Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db',
  'Library/Application Support/Cursor/User/globalStorage/state.vscdb',
  'Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions',
  '.local/share/opencode/opencode.db',
];

for (const relative of sources) {
  const source = path.join(home, relative);
  try {
    await fs.access(source);
    await fs.cp(source, path.join(destination, relative), {
      recursive: true,
      force: true,
      filter: async file => !(await fs.lstat(file)).isSymbolicLink(),
    });
    process.stdout.write(`Copied ${relative}\n`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

// Copy only Insiders chat records, not unrelated workspace settings.
const insidersRoot = path.join(home, 'Library/Application Support/Code - Insiders/User/workspaceStorage');
async function copyInsidersChats(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await copyInsidersChats(file);
    else if (entry.name.endsWith('.jsonl') && path.basename(path.dirname(file)) === 'chatSessions') {
      const relative = path.relative(home, file);
      const target = path.join(destination, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file, target);
    }
  }
}
await copyInsidersChats(insidersRoot);

// Export only sidecar enable flags; full config can contain private settings.
try {
  const config = JSON.parse(await fs.readFile(path.join(home, '.gemini/config/config.json'), 'utf8'));
  const target = path.join(destination, '.gemini/config/config.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify({ sidecars: config.sidecars || {} }, null, 2));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
