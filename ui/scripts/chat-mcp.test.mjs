import test from 'node:test';
import assert from 'node:assert/strict';
import { chatArchive, sampleChats, sampleGraphConfig } from './chat-archive-fixture.mjs';

test('the MCP server lists its tools and runs them against the archive', () => {
  const archive = chatArchive(sampleChats, sampleGraphConfig);
  try {
    archive.run('chat-graph', 'build');
    const added = archive.run('chat-memory', 'handoff', 'add', '--title', 'Finish the export fix', '--text', 'Tests are left', '--project', 'api');
    const replies = archive.mcp([
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'chat_search', arguments: { query: 'rollout', limit: 1 } } },
      { id: 4, method: 'tools/call', params: { name: 'chat_who', arguments: { entity: 'ticket:OPS-42' } } },
      { id: 5, method: 'tools/call', params: { name: 'handoff_claim', arguments: { id: added.id, session: 'chat-one' } } },
      { id: 6, method: 'tools/call', params: { name: 'handoff_claim', arguments: { id: added.id } } },
      { id: 7, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
      { id: 8, method: 'resources/list' },
    ]);

    assert.equal(replies[1].result.protocolVersion, '2025-06-18');
    assert.equal(replies[1].result.serverInfo.name, 'chat-memory');
    assert.deepEqual(replies[2].result.tools.map((tool) => tool.name), ['chat_search', 'chat_find', 'chat_who', 'chat_show', 'chat_facts',
      'chat_entity_page', 'chat_brief', 'handoff_add', 'handoff_list', 'handoff_claim']);
    assert.ok(replies[2].result.tools.every((tool) => tool.inputSchema.type === 'object' && tool.description));

    assert.equal(replies[3].result.isError, false);
    assert.equal(JSON.parse(replies[3].result.content[0].text).hits[0].sessionId, sampleChats[1].id);
    assert.equal(replies[4].result.content[0].text.trim().split('\n').length, 2);
    assert.equal(JSON.parse(replies[5].result.content[0].text).claimed, true);
    assert.equal(replies[6].result.isError, true);
    assert.match(replies[6].result.content[0].text, /missing: session/);
    assert.ok(replies[7].error ?? replies[7].result.isError);
    assert.equal(replies[8].error.code, -32601);
  } finally { archive.close(); }
});
