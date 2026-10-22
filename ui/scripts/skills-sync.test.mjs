import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'skills-sync.mjs');
const accountOld = '11111111-1111-4111-8111-111111111111';
const accountNew = '22222222-2222-4222-8222-222222222222';
const orgOld = '33333333-3333-4333-8333-333333333333';
const orgNew = '44444444-4444-4444-8444-444444444444';

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-sync-'));
  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home');
  const appdata = path.join(base, 'appdata');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.copyFileSync(source, path.join(repo, 'scripts', 'skills-sync.mjs'));
  const claude = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude') : path.join(appdata, 'Claude');
  const cache = (account, org) => path.join(claude, 'local-agent-mode-sessions', 'skills-plugin', org, account);
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const skill = (name, description, body = '') => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
  const run = (command) => JSON.parse(execFileSync(process.execPath, [path.join(repo, 'scripts', 'skills-sync.mjs'), command],
    { env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: appdata, SWITCHYARD_SKILLS_BUNDLE: path.join(repo, 'skills') }, encoding: 'utf8' }));
  return { base, repo, home, cache, write, skill, run, close: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('save copies every skill to repo, ~/.claude/skills and each account as local skills', () => {
  const f = fixture();
  try {
    f.write(path.join(f.home, '.claude', 'skills', 'local-only', 'SKILL.md'), f.skill('local-only', 'From local'));
    f.write(path.join(f.home, '.claude', 'skills', 'local-only', 'refs', 'a.md'), 'ref');
    const oldCache = f.cache(accountOld, orgOld);
    f.write(path.join(oldCache, 'manifest.json'), JSON.stringify({ lastUpdated: 1, skills: [
      { skillId: 'skill_1', name: 'account-only', description: 'From account', creatorType: 'user', enabled: true },
      { skillId: 'docx', name: 'docx', description: 'built in', creatorType: 'anthropic', enabled: true },
    ] }));
    f.write(path.join(oldCache, 'skills', 'account-only', 'SKILL.md'), f.skill('account-only', '>-\n  Folded\n  text'));
    f.write(path.join(oldCache, 'skills', 'docx', 'SKILL.md'), f.skill('docx', 'built in'));
    const newCache = f.cache(accountNew, orgNew);
    f.write(path.join(newCache, 'manifest.json'), JSON.stringify({ lastUpdated: 1, skills: [] }));

    const result = f.run('save');
    assert.equal(result.ok, true);
    assert.equal(result.skills, 2);
    for (const name of ['local-only', 'account-only']) {
      assert.ok(fs.existsSync(path.join(f.repo, 'skills', name, 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(f.home, '.claude', 'skills', name, 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(newCache, 'skills', name, 'SKILL.md')));
    }
    assert.ok(fs.existsSync(path.join(f.repo, 'skills', 'local-only', 'refs', 'a.md')));
    const added = JSON.parse(fs.readFileSync(path.join(newCache, 'manifest.json'), 'utf8')).skills;
    assert.deepEqual(added.map((entry) => [entry.name, entry.creatorType, entry.syncManaged, entry.enabled]).sort(),
      [['account-only', 'user', false, true], ['local-only', 'user', false, true]]);
    assert.equal(added.find((entry) => entry.name === 'account-only').description, 'Folded text');
    assert.deepEqual(result.accounts[`${accountOld}/${orgOld}`].serverOwned, ['account-only']);
    assert.deepEqual(result.accounts[`${accountOld}/${orgOld}`].added, ['local-only']);

    const again = f.run('save');
    assert.deepEqual(again.repo.changed, []);
    assert.deepEqual(again.local.changed, []);
    for (const account of Object.values(again.accounts)) assert.deepEqual([account.added, account.updated], [[], []]);
  } finally { f.close(); }
});

test('the newest copy of a skill wins and reaches every store', () => {
  const f = fixture();
  try {
    const local = path.join(f.home, '.claude', 'skills', 'shared', 'SKILL.md');
    const bundled = path.join(f.repo, 'skills', 'shared', 'SKILL.md');
    f.write(local, f.skill('shared', 'old'));
    f.write(bundled, f.skill('shared', 'new'));
    const past = new Date(Date.now() - 86_400_000);
    fs.utimesSync(local, past, past);
    f.write(path.join(f.cache(accountNew, orgNew), 'manifest.json'), JSON.stringify({ skills: [] }));
    f.run('save');
    assert.match(fs.readFileSync(local, 'utf8'), /description: new/);
    assert.match(fs.readFileSync(path.join(f.cache(accountNew, orgNew), 'skills', 'shared', 'SKILL.md'), 'utf8'), /description: new/);
  } finally { f.close(); }
});
