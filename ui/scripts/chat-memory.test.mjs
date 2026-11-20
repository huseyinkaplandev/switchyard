import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chatArchive, sampleChats, sampleGraphConfig } from './chat-archive-fixture.mjs';

const [first, second] = sampleChats;

function addFact(archive, session, values) {
  const db = archive.index();
  const fact = { subject: 'user', slot: 'commit_style', kind: 'preference', scope: 'user', project: '', status: 'active', ...values };
  try {
    const id = Number(db.prepare(`insert into facts (session_id, message_id, subject, slot, text, kind, scope, project, status, valid_from, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(session.id, `${session.id}:0`, fact.subject, fact.slot, fact.text, fact.kind, fact.scope, fact.project, fact.status, session.at, session.at).lastInsertRowid);
    db.prepare('insert into fact_fts (text, fact_id) values (?, ?)').run(fact.text, id);
    return id;
  } finally { db.close(); }
}

test('a handoff note is claimed by exactly one chat and leaves the brief once claimed', () => {
  const archive = chatArchive(sampleChats, sampleGraphConfig);
  try {
    archive.run('chat-graph', 'build');
    const added = archive.run('chat-memory', 'handoff', 'add', '--title', 'Finish the export fix', '--text', 'Tests are left', '--project', 'api', '--session', first.id);
    assert.deepEqual(archive.run('chat-memory', 'handoff', 'list', '--project', 'api').map((row) => row.title), ['Finish the export fix']);
    assert.match(archive.text('chat-memory', 'brief', '--cwd', '/work/api', '--session', 'new-chat'), new RegExp(`#${added.id} Finish the export fix: Tests are left`));

    const won = archive.run('chat-memory', 'handoff', 'claim', String(added.id), '--session', 'chat-one');
    assert.equal(won.claimed, true);
    assert.equal(won.claimed_by, 'chat-one');
    assert.deepEqual(archive.run('chat-memory', 'handoff', 'claim', String(added.id), '--session', 'chat-two'), { claimed: false, by: 'chat-one' });
    assert.deepEqual(archive.run('chat-memory', 'handoff', 'list', '--project', 'api'), []);
    assert.doesNotMatch(archive.text('chat-memory', 'brief', '--cwd', '/work/api', '--session', 'new-chat'), /Finish the export fix/);
  } finally { archive.close(); }
});

test('the brief lists recent chats of the folder and remembered preferences, and facts are searchable', () => {
  const archive = chatArchive(sampleChats, sampleGraphConfig);
  try {
    archive.run('chat-graph', 'build');
    assert.deepEqual(archive.run('chat-memory', 'facts').facts, []);
    addFact(archive, first, { text: 'Write imperative commit messages.' });
    addFact(archive, second, { text: 'Deploys go to staging first.', subject: 'project:web', slot: 'deploy_target', kind: 'decision', scope: 'project', project: 'web' });

    const brief = archive.text('chat-memory', 'brief', '--cwd', '/work/api', '--session', 'new-chat');
    assert.match(brief, /Recent chats in this project \(api\):/);
    assert.match(brief, /"Fix the invoice export": Fixed the off-by-one/);
    assert.match(brief, /- Write imperative commit messages\./);
    assert.doesNotMatch(brief, /Deploys go to staging first/);

    assert.deepEqual(archive.run('chat-memory', 'facts', '--query', 'staging').facts.map((fact) => fact.text), ['Deploys go to staging first.']);
    assert.deepEqual(archive.run('chat-memory', 'facts', '--entity', 'user').facts.map((fact) => fact.text), ['Write imperative commit messages.']);
    const page = archive.text('chat-memory', 'page', 'project:web');
    assert.match(page, /Deploys go to staging first\./);
    assert.match(page, /\*\*Plan the Acme rollout\*\*/);
  } finally { archive.close(); }
});

test('a preference seen in two chats becomes a proposal and reaches the rules file only when approved', () => {
  const archive = chatArchive(sampleChats);
  try {
    archive.run('chat-memory', 'facts');
    addFact(archive, first, { text: 'Write short commit messages.', status: 'superseded' });
    addFact(archive, second, { text: 'Write imperative commit messages.' });
    const rulesFile = path.join(archive.dataDir, 'memory', 'LEARNED_RULES.md');

    const { proposed } = archive.run('chat-memory', 'lessons');
    assert.deepEqual(proposed.map((rule) => [rule.text, rule.sessions]), [['Write imperative commit messages.', 2]]);
    assert.equal(fs.existsSync(rulesFile), false);

    archive.run('chat-memory', 'approve', String(proposed[0].id));
    assert.match(fs.readFileSync(rulesFile, 'utf8'), /Write imperative commit messages\./);
  } finally { archive.close(); }
});

test('extract refuses to run without an API key', () => {
  const archive = chatArchive(sampleChats);
  try {
    archive.run('chat-graph', 'build');
    assert.match(archive.run('chat-memory', 'extract').error, /ANTHROPIC_API_KEY/);
  } finally { archive.close(); }
});
