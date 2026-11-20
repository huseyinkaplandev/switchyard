import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'archive-merge.mjs');
const run = (dataDir, ...args) => JSON.parse(execFileSync(process.execPath, ['--no-warnings', script, ...args], { env: { ...process.env, SWITCHYARD_DATA_DIR: dataDir, SWITCHYARD_DEMO: '' }, encoding: 'utf8' }));

function computer(base, name, sessions, exclusions = []) {
  const dataDir = path.join(base, name);
  run(dataDir, 'merge', path.join(base, `${name}-empty.db`));
  const db = new DatabaseSync(path.join(dataDir, 'data.db'));
  for (const [id, updatedAt, text] of sessions) {
    db.prepare("INSERT INTO agent_sessions (id,provider,title,source_path,first_seen_at,updated_at,last_synced_at,prompt_count) VALUES (?,'claude-code',?,?,?,?,?,1)").run(id, `${name} ${id}`, `/${name}/${id}.jsonl`, updatedAt, updatedAt, updatedAt);
    db.prepare("INSERT INTO agent_messages (id,session_id,provider,role,text,timestamp,ordinal) VALUES (?,?,'claude-code','user',?,?,0)").run(`${id}:0`, id, text, updatedAt);
  }
  for (const id of exclusions) db.prepare("INSERT INTO agent_session_exclusions VALUES (?,'claude-code','2026-10-01')").run(id);
  db.close();
  return dataDir;
}

test('merge adds the other computer chats, keeps the newer copy and local-only chats, respects deletions', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merge-'));
  try {
    const windows = computer(base, 'windows', [['a', '2026-10-20', 'only on windows'], ['b', '2026-10-25', 'newer on windows'], ['c', '2026-10-21', 'deleted on mac']], ['d']);
    const mac = computer(base, 'mac', [['b', '2026-10-24', 'older on mac'], ['m', '2026-10-26', 'mac only'], ['d', '2026-10-22', 'deleted on windows']], ['c']);
    const exported = run(windows, 'export', path.join(base, 'windows.db'));
    assert.equal(exported.sessions, 3);
    fs.writeFileSync(path.join(base, 'windows.db.gz'), gzipSync(fs.readFileSync(path.join(base, 'windows.db'))));

    const result = run(mac, 'merge', path.join(base, 'windows.db.gz'));
    assert.deepEqual([result.added, result.updated, result.removedDeleted], [1, 1, 1]);

    const db = new DatabaseSync(path.join(mac, 'data.db'), { readOnly: true });
    const texts = Object.fromEntries(db.prepare('SELECT session_id AS id, text FROM agent_messages').all().map(row => [row.id, row.text]));
    assert.deepEqual(texts, { a: 'only on windows', b: 'newer on windows', m: 'mac only' });
    db.close();

    assert.deepEqual([run(mac, 'merge', path.join(base, 'windows.db')).added, run(mac, 'merge', path.join(base, 'windows.db')).updated], [0, 0]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
