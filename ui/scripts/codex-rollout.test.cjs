const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpile(fs.readFileSync('app/_lib/codexRollout.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true });
const loaded = { exports: {} };
new Function('require', 'exports', source)(require, loaded.exports);
const { codexRolloutId, groupCodexRollouts } = loaded.exports;
const chat = '0000c0de-0000-7000-8000-000000000001';
const writer = '0000c0de-0000-7000-8000-000000000002';
const original = `rollout-2026-09-29T17-28-05-${chat}.jsonl`;
const resumed = `rollout-2026-10-07T10-59-24-${chat}_${writer}.jsonl`;

test('writer suffix preserves original native chat identity', () => {
  assert.equal(codexRolloutId(original), chat);
  assert.equal(codexRolloutId(resumed), chat);
  assert.equal(codexRolloutId('unknown.jsonl'), undefined);
});
test('resumed chat retains old segment and selects latest writer for tailing', () => {
  const groups = groupCodexRollouts([{ filePath: resumed, modified: 20 }, { filePath: original, modified: 10 }]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(file => file.filePath), [original, resumed]);
});
test('different chats never share persistence segments', () => {
  const other = `rollout-2026-10-09T12-00-00-${writer}.jsonl`;
  assert.equal(groupCodexRollouts([{ filePath: original, modified: 10 }, { filePath: resumed, modified: 20 }, { filePath: other, modified: 30 }]).length, 2);
});
