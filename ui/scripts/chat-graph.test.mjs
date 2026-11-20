import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chatArchive, sampleChats, sampleGraphConfig } from './chat-archive-fixture.mjs';

test('chat graph builds one digest per chat and links chats through projects, files and configured kinds', () => {
  const archive = chatArchive(sampleChats, sampleGraphConfig);
  try {
    const built = archive.run('chat-graph', 'build');
    assert.equal(built.built, 2);
    assert.equal(built.digests, 2);

    const ticket = archive.run('chat-graph', 'who', 'ticket:OPS-42');
    assert.deepEqual(ticket.hits.map((hit) => hit.session).sort(), sampleChats.map((chat) => chat.id).sort());
    const customer = archive.run('chat-graph', 'who', 'customer:Acme');
    assert.equal(customer.hits.length, 1);
    assert.equal(customer.hits[0].asked, sampleChats[1].messages[0][1]);
    assert.equal(customer.hits[0].answered, sampleChats[1].messages[1][1]);

    const shown = archive.run('chat-graph', 'show', 'aaaa1111');
    assert.deepEqual(shown.entities, ['file:scripts/export-invoices.ts', 'project:api', 'ticket:OPS-42']);
    assert.deepEqual(shown.neighbours.map((row) => row.session ?? row.session_id), [sampleChats[1].id]);

    const brief = archive.text('chat-graph', 'find', 'rollout', '--brief').trim().split('\n');
    assert.equal(brief.length, 1);
    assert.match(brief[0], /\| codex \| Plan the Acme rollout \|/);
    assert.equal(archive.text('chat-graph', 'last', '--brief').trim().split('\n').length, 2);

    assert.equal(archive.run('chat-graph', 'build').built, 0);
  } finally { archive.close(); }
});

test('chat graph rebuilds when chat-graph.json changes and has no custom kinds without it', () => {
  const archive = chatArchive(sampleChats);
  try {
    archive.run('chat-graph', 'build');
    assert.deepEqual(archive.run('chat-graph', 'entities').map((row) => row.kind).filter((kind) => !['project', 'file'].includes(kind)), []);
    fs.writeFileSync(path.join(archive.dataDir, 'chat-graph.json'), JSON.stringify(sampleGraphConfig));
    assert.equal(archive.run('chat-graph', 'build').built, 2);
    assert.ok(archive.run('chat-graph', 'entities', '--kind', 'customer').some((row) => row.entity === 'customer:Acme'));
  } finally { archive.close(); }
});
