#!/usr/bin/env node
// One-click skill sync for every Claude account on this machine (Windows + macOS). Plain ESM, Node 22+.
//
//   node scripts/skills-sync.mjs status    what each store has and which copy would win
//   node scripts/skills-sync.mjs save      newest copy of every skill -> the bundle folder, ~/.claude/skills and every
//                                          Claude Desktop account's skill cache
//
// Stores:
//   bundle                     <data dir>/skills by default (SWITCHYARD_SKILLS_BUNDLE overrides); put it in a synced
//                              folder or a git repository of your own to carry skills to another machine
//   ~/.claude/skills           Claude Code / Code tab / scheduled tasks; shared by every account on the machine
//   <Claude>/local-agent-mode-sessions/skills-plugin/<org>/<account>
//                              per-account "anthropic-skills" cache. Server-synced entries are replaced on every
//                              sync, but entries marked syncManaged:false are the app's own "local skills" and are
//                              kept across syncs, so that is how a skill is registered to an account offline.
// For each skill the copy with the newest file wins (ties: ~/.claude/skills, then the bundle, then account caches).
// File modification times are preserved when copying, so the comparison keeps reflecting real edits.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const dataDir = path.resolve(process.env.SWITCHYARD_DATA_DIR || path.join(home, '.switchyard'));
const bundleDir = path.resolve(process.env.SWITCHYARD_SKILLS_BUNDLE || path.join(dataDir, 'skills'));
const localDir = path.join(home, '.claude', 'skills');
const claudeData = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude')
  : path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude');
const cacheRoot = path.join(claudeData, 'local-agent-mode-sessions', 'skills-plugin');
const validName = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ignored = /(^|\/)(\.git|node_modules|__pycache__|\.DS_Store|Thumbs\.db)(\/|$)/;

const readJson = (file, fallback = null) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const dirs = (dir) => { try { return readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isDirectory()); } catch { return []; } };

function filesOf(dir, relative = '') {
  const full = path.join(dir, relative);
  return readdirSync(full).flatMap((name) => {
    const child = relative ? `${relative}/${name}` : name;
    if (ignored.test(child)) return [];
    return statSync(path.join(full, name)).isDirectory() ? filesOf(dir, child) : [child];
  });
}

// Git may rewrite line endings per checkout, so text compares with normalized newlines.
function fingerprint(dir) {
  const hash = createHash('sha256');
  for (const file of filesOf(dir).sort()) {
    const bytes = readFileSync(path.join(dir, file));
    hash.update(file).update('\0').update(bytes.includes(0) ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n')).update('\0');
  }
  return hash.digest('hex');
}

function describe(dir, store) {
  const files = filesOf(dir);
  return { dir, store, newest: Math.max(0, ...files.map((file) => statSync(path.join(dir, file)).mtimeMs)), files: files.length };
}

function frontmatterDescription(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => /^description:/.test(line));
  if (start < 0) return '';
  const first = lines[start].replace(/^description:\s*/, '');
  if (/^[>|][-+]?\s*$/.test(first)) {
    const body = [];
    for (const line of lines.slice(start + 1)) { if (/^\S/.test(line)) break; body.push(line.trim()); }
    return body.join(first.startsWith('|') ? '\n' : ' ').trim();
  }
  return first.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
}

function accountCaches() {
  const result = [];
  for (const org of dirs(cacheRoot)) {
    for (const account of dirs(path.join(cacheRoot, org))) {
      const root = path.join(cacheRoot, org, account);
      if (existsSync(path.join(root, 'manifest.json'))) result.push({ key: `${account}/${org}`, account, org, root });
    }
  }
  return result;
}

function candidates() {
  const all = new Map();
  const add = (name, dir, store) => {
    if (!validName.test(name) || !existsSync(path.join(dir, 'SKILL.md'))) return;
    if (!all.has(name)) all.set(name, []);
    all.get(name).push(describe(dir, store));
  };
  for (const name of dirs(localDir)) add(name, path.join(localDir, name), 'local');
  for (const name of dirs(bundleDir)) add(name, path.join(bundleDir, name), 'repo');
  for (const cache of accountCaches()) {
    for (const entry of readJson(path.join(cache.root, 'manifest.json'), {}).skills ?? []) {
      if (entry.creatorType === 'user') add(entry.name, path.join(cache.root, 'skills', entry.name), `account:${cache.key}`);
    }
  }
  const rank = (store) => store === 'local' ? 0 : store === 'repo' ? 1 : 2;
  return new Map([...all].map(([name, list]) => [name, list.sort((a, b) => b.newest - a.newest || rank(a.store) - rank(b.store))[0]]));
}

function copyTree(source, target) {
  const temporary = `${target}.${process.pid}.tmp`;
  rmSync(temporary, { recursive: true, force: true });
  for (const file of filesOf(source)) {
    const from = path.join(source, file);
    const to = path.join(temporary, file);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    const { atime, mtime } = statSync(from);
    utimesSync(to, atime, mtime);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(temporary, target);
}

const isLink = (target) => { try { return lstatSync(target).isSymbolicLink(); } catch { return false; } };
const sameTree = (a, b) => existsSync(path.join(b, 'SKILL.md')) && fingerprint(a) === fingerprint(b);

function installTo(winners, baseDir) {
  const changed = [];
  const skipped = [];
  mkdirSync(baseDir, { recursive: true });
  for (const [name, winner] of winners) {
    const target = path.join(baseDir, name);
    if (path.resolve(winner.dir) === path.resolve(target) || sameTree(winner.dir, target)) continue;
    // Linked skills belong to an installer (npx skills -> ~/.agents/skills); never write through the link.
    if (isLink(target)) { skipped.push(`${name}: linked`); continue; }
    copyTree(winner.dir, target);
    changed.push(name);
  }
  return { changed, skipped };
}

function registerInAccount(cache, winners) {
  const manifestFile = path.join(cache.root, 'manifest.json');
  const manifest = readJson(manifestFile);
  if (!Array.isArray(manifest?.skills)) return { error: 'manifest unreadable' };
  const added = [];
  const updated = [];
  const serverOwned = [];
  for (const [name, winner] of winners) {
    const entry = manifest.skills.find((skill) => skill.name === name);
    const target = path.join(cache.root, 'skills', name);
    if (entry && entry.syncManaged !== false) { serverOwned.push(name); continue; }
    const description = frontmatterDescription(readFileSync(path.join(winner.dir, 'SKILL.md'), 'utf8'));
    if (entry && entry.description === description && sameTree(winner.dir, target)) continue;
    if (path.resolve(winner.dir) !== path.resolve(target)) copyTree(winner.dir, target);
    const record = { skillId: name, name, description, creatorType: 'user', syncManaged: false,
      updatedAt: new Date().toISOString(), enabled: entry?.enabled ?? true };
    if (entry) { Object.assign(entry, record); updated.push(name); } else { manifest.skills.push(record); added.push(name); }
  }
  if (added.length || updated.length) {
    manifest.lastUpdated = Date.now();
    const temporary = `${manifestFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(manifest, null, 2));
    renameSync(temporary, manifestFile);
  }
  return { added, updated, serverOwned };
}

const command = process.argv[2] ?? 'status';
const winners = candidates();

if (command === 'status') {
  const caches = accountCaches();
  print({
    platform: process.platform, bundle: bundleDir, local: localDir,
    skills: [...winners].map(([name, winner]) => ({ name, winner: winner.store,
      local: existsSync(path.join(localDir, name, 'SKILL.md')), repo: existsSync(path.join(bundleDir, name, 'SKILL.md')),
      accounts: caches.filter((cache) => (readJson(path.join(cache.root, 'manifest.json'), {}).skills ?? []).some((skill) => skill.name === name)).map((cache) => cache.account.slice(0, 8)) })),
    accounts: caches.map((cache) => cache.key),
  });
} else if (command === 'save') {
  if (!winners.size) throw new Error('No skills found (~/.claude/skills and the bundle folder are empty).');
  const repoResult = installTo(winners, bundleDir);
  const localResult = installTo(winners, localDir);
  const accounts = {};
  for (const cache of accountCaches()) {
    try { accounts[cache.key] = registerInAccount(cache, winners); } catch (error) { accounts[cache.key] = { error: error.message }; }
  }
  const failures = Object.entries(accounts).filter(([, result]) => result.error);
  print({ skills: winners.size, repo: repoResult, local: localResult, accounts,
    note: 'New sessions see the skills right away; start a new session for sessions that are already open.', ok: !failures.length });
  if (failures.length) process.exitCode = 1;
} else {
  print({ error: 'usage: skills-sync.mjs status | save' });
  process.exit(1);
}
