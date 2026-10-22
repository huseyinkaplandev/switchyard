const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpile(fs.readFileSync('app/_lib/assistantMessage.ts', 'utf8'), { module: ts.ModuleKind.CommonJS });
const adapted = { exports: {} };
new Function('require', 'exports', source)(require, adapted.exports);
const convert = adapted.exports.assistantMessage;

test('native message identity, role and timestamp survive adaptation', () => {
  const message = convert({ id: 'native-user-id', role: 'user', text: 'same text', timestamp: '2026-10-09T09:00:00Z' });
  assert.equal(message.id, 'native-user-id'); assert.equal(message.role, 'user');
  assert.equal(message.content[0].text, 'same text');
  assert.equal(message.createdAt.toISOString(), '2026-10-09T09:00:00.000Z');
});
test('repeated text does not collapse distinct native messages', () => {
  const left = convert({ id: 'first', role: 'assistant', text: 'OK' });
  const right = convert({ id: 'second', role: 'assistant', text: 'OK' });
  assert.notEqual(left.id, right.id);
});
test('live and completed answers expose truthful status', () => {
  assert.equal(convert({ id: 'live', role: 'assistant', text: 'part', live: true }).status.type, 'running');
  assert.equal(convert({ id: 'done', role: 'assistant', text: 'full' }).status.type, 'complete');
});
test('legacy tool text remains inspectable without inventing a runnable tool', () => {
  const tool = convert({ id: 'tool', role: 'tool', text: 'native output' });
  assert.equal(tool.content[0].type, 'text'); assert.equal(tool.metadata.custom.originalRole, 'tool');
});
test('malformed native dates cannot break the message renderer', () => {
  assert.ok(Number.isFinite(convert({ id: 'date', role: 'system', text: 'checkpoint', timestamp: 'invalid' }).createdAt.getTime()));
});
