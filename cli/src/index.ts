import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AGENTS } from './agents.js';
import { getDataDir } from './paths.js';

// Simple Levenshtein distance calculation
function levenshtein(a: string, b: string): number {
  const tmp: number[][] = [];
  for (let i = 0; i <= a.length; i++) tmp[i] = [i];
  for (let j = 0; j <= b.length; j++) tmp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

export async function run(args: string[]) {
  if (args.length < 3) {
    console.error('Usage: log-agent <agent-id> <role> "<message>"');
    process.exit(1);
  }

  const [agentIdInput, roleInput, messageInput] = args;

  // Validate agent ID
  const agentId = agentIdInput.trim().toLowerCase();
  const validAgentIds = AGENTS.map(a => a.id);

  if (!validAgentIds.includes(agentId as any)) {
    // Find closest valid ID using Levenshtein distance
    let closestId = '';
    let minDistance = Infinity;

    for (const id of validAgentIds) {
      const dist = levenshtein(agentId, id);
      if (dist < minDistance) {
        minDistance = dist;
        closestId = id;
      }
    }

    if (minDistance <= 2) {
      console.error(`✗ unknown agent: ${agentIdInput} (did you mean: ${closestId}?)`);
    } else {
      console.error(`✗ unknown agent: ${agentIdInput}`);
    }
    process.exit(1);
  }

  // Validate message
  const cleanedMessage = messageInput ? messageInput.replace(/\r?\n/g, ' ').trim() : '';
  if (!cleanedMessage) {
    console.error('✗ message cannot be empty');
    process.exit(1);
  }

  // Validate role
  const role = roleInput.trim().replace(/\r?\n/g, ' ').replace(/\s+/g, '-');
  if (!role) {
    console.error('✗ role cannot be empty');
    process.exit(1);
  }

  // Format log entry YYYY-MM-DD HH:MM
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  
  const tsStr = `${YYYY}-${MM}-${DD} ${HH}:${min}`;
  const formattedLine = `[${tsStr}] ${role}/${agentId}: ${cleanedMessage}\n`;

  // Write atomically using open, appendFile, sync, close
  const dataDir = getDataDir();
  const logPath = path.join(dataDir, 'LIVE_LOG.md');

  try {
    fsSync.mkdirSync(dataDir, { recursive: true });
    const handle = await fs.open(logPath, 'a');
    await handle.appendFile(formattedLine, 'utf-8');
    await handle.sync();
    await handle.close();

    // Also write to SQLite
    try {
      const dbPath = path.join(dataDir, 'data.db');
      fsSync.mkdirSync(dataDir, { recursive: true });
      const db = new DatabaseSync(dbPath);
      db.exec('PRAGMA journal_mode=WAL');
      db.exec(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        role TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        message TEXT NOT NULL,
        raw TEXT NOT NULL UNIQUE
      )`);
      db.prepare('INSERT OR IGNORE INTO logs (ts,role,agent_id,message,raw) VALUES (?,?,?,?,?)')
        .run(tsStr, role, agentId, cleanedMessage, formattedLine.trim());
      db.close();
    } catch {}

    console.log(`✓ logged: [${tsStr}] ${role}/${agentId}: ${cleanedMessage}`);
  } catch (error: any) {
    console.error(`✗ failed to write log: ${error?.message || error}`);
    process.exit(1);
  }
}
