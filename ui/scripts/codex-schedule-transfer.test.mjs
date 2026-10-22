import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cronToRrule, adaptClaudePrompt, copyClaudeSchedules } from '../app/_lib/codexScheduleTransfer.mjs';

const source = { id: 'daily', source: 'claude', platform: process.platform === 'darwin' ? 'macos' : 'windows', account: 'account/org', name: 'Daily (Claude)', schedule: '30 5,10,13 * * *', enabled: true, workingDirectory: 'C:\\Work\\Example', prompt: 'Review open pull requests in the Acme repositories (Claude).\nSummarise failing checks.' };

test('daily, weekly and multiple slots preserve calendar semantics', () => {
  assert.equal(cronToRrule(source.schedule), 'FREQ=DAILY;BYHOUR=5,10,13;BYMINUTE=30;BYSECOND=0');
  assert.equal(cronToRrule('30 11 * * 2,5'), 'FREQ=WEEKLY;BYDAY=TU,FR;BYHOUR=11;BYMINUTE=30;BYSECOND=0');
  assert.equal(cronToRrule('0 20 * * 0,7'), 'FREQ=WEEKLY;BYDAY=SU;BYHOUR=20;BYMINUTE=0;BYSECOND=0');
  for (const schedule of ['', '0 9 1 * *', '* * * * *', '60 9 * * *', '0 24 * * *', '0 9 * 1 *']) assert.throws(() => cronToRrule(schedule));
});

test('Codex prompts carry the source marker, working directory and the original work', () => {
  const prompt = adaptClaudePrompt(source);
  assert.ok(prompt.startsWith('Copied from: claude:account/org:daily\n'));
  assert.ok(prompt.includes('C:\\Work\\Example'));
  assert.ok(prompt.includes('Summarise failing checks.'));
  assert.ok(prompt.includes('(Codex)'));
  assert.ok(!prompt.includes('(Claude)'));
  assert.throws(() => adaptClaudePrompt({ ...source, prompt: ' ' }), /Prompt missing/);
});

test('native records are idempotent, preserve bindings, pause state, backups and unrelated automations', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-schedules-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const unrelated = path.join(home, '.codex', 'automations', 'nightly-report');
  await fs.mkdir(unrelated, { recursive: true });
  await fs.writeFile(path.join(unrelated, 'automation.toml'), 'unchanged');
  const first = await copyClaudeSchedules([source], { home });
  const file = path.join(home, '.codex', 'automations', first.tasks[0].id, 'automation.toml');
  const original = await fs.readFile(file, 'utf8');
  assert.ok(original.includes('kind = "cron"'));
  assert.ok(original.includes('status = "ACTIVE"'));
  assert.ok(!original.includes('model = '));
  const nativeBinding = original.replace('target = { type = "projectless" }', 'target = { type = "project", project_id = "native-project" }');
  await fs.writeFile(file, nativeBinding);
  const second = await copyClaudeSchedules([{ ...source, enabled: false, prompt: 'Updated work' }], { home });
  assert.equal(second.tasks[0].id, first.tasks[0].id);
  assert.equal(second.tasks[0].updated, true);
  const updated = await fs.readFile(file, 'utf8');
  assert.ok(updated.includes('status = "PAUSED"'));
  assert.ok(updated.includes('project_id = "native-project"'));
  assert.equal(updated.match(/^created_at = .*/m)[0], original.match(/^created_at = .*/m)[0]);
  assert.equal(await fs.readFile(path.join(unrelated, 'automation.toml'), 'utf8'), 'unchanged');
  assert.equal((await fs.readdir(path.join(home, '.codex', 'automations'))).length, 2);
  assert.equal((await fs.readdir(path.join(home, '.codex', 'schedule-transfer-backups'))).length, 1);
});

test('an explicit model and reasoning effort are written only when given', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-schedules-model-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const result = await copyClaudeSchedules([source], { home, model: 'example-model', reasoningEffort: 'high' });
  const text = await fs.readFile(path.join(home, '.codex', 'automations', result.tasks[0].id, 'automation.toml'), 'utf8');
  assert.ok(text.includes('model = "example-model"'));
  assert.ok(text.includes('reasoning_effort = "high"'));
});

test('invalid batch is rejected before any target write', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-schedules-invalid-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await assert.rejects(copyClaudeSchedules([source, { ...source, id: 'bad', schedule: '0 9 1 * *' }], { home }));
  await assert.rejects(fs.stat(path.join(home, '.codex', 'automations')), { code: 'ENOENT' });
});
