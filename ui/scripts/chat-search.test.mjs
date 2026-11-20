import test from 'node:test';
import assert from 'node:assert/strict';
import { chatArchive, sampleChats } from './chat-archive-fixture.mjs';

test('chat search indexes the archive once and finds messages by ANDed, accent-folded words', () => {
  const archive = chatArchive(sampleChats);
  try {
    const first = archive.run('chat-search', 'invoice export');
    assert.equal(first.indexed, 4);
    assert.equal(first.added, 4);
    assert.equal(first.hits[0].sessionId, sampleChats[0].id);
    assert.match(first.hits[0].snippet, /«invoice»/);
    assert.equal(first.hits[0].link, `http://127.0.0.1:3010/?tab=codex&provider=claude-code&session=${sampleChats[0].id}`);

    const folded = archive.run('chat-search', 'cafe staging');
    assert.equal(folded.added, 0);
    assert.deepEqual(folded.hits.map((hit) => hit.sessionId), [sampleChats[1].id]);

    assert.deepEqual(archive.run('chat-search', 'invoice rollout').hits, []);
    assert.deepEqual(archive.run('chat-search', 'OPS-42', '--provider', 'codex').hits.map((hit) => hit.provider), ['codex']);
    assert.deepEqual(archive.run('chat-search', 'rollout', '--role', 'assistant').hits.map((hit) => hit.role), ['assistant']);
  } finally { archive.close(); }
});
