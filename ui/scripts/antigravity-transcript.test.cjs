const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const source=fs.readFileSync('app/_lib/agentArchive.ts','utf8');
const ast=ts.createSourceFile('archive.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['isRecord','cleanText','cleanAntigravityUserText','scrubEmbedded','clip','antigravityMessages']);
const functions=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.has(s.name?.text)).map(s=>s.getText(ast)).join('\n');
const parser=new Function(ts.transpile('const CONTROL_PREFIXES=[]; const TOOL_RESULT_LIMIT=24000;'+functions+';return antigravityMessages;', {target:ts.ScriptTarget.ES2022} ))();
test('Antigravity retains reasoning and tools when planner has no content',()=>{
 const result=parser([
  {source:'USER_EXPLICIT',type:'USER_INPUT',content:'<USER_REQUEST>Fix translations</USER_REQUEST>'},
  {source:'MODEL',type:'PLANNER_RESPONSE',thinking:'Review translations',tool_calls:[{name:'view_file',args:{AbsolutePath:'C:/project/home.html'}}],created_at:'2026-10-16T11:00:00Z'},
  {source:'MODEL',type:'GENERIC',content:'File contents'},
  {source:'SYSTEM',type:'SYSTEM_MESSAGE',content:'Internal notification'},
 ],'chat');
 assert.deepEqual(result.map(m=>m.kind??'text'),['text','thinking','tool_use','tool_result']);
 assert.equal(result[0].text,'Fix translations');assert.equal(result[2].toolName,'view_file');
 assert.ok(result[2].text.includes('C:/project/home.html'));assert.equal(result[1].timestamp,'2026-10-16T11:00:00Z');
 assert.equal(new Set(result.map(m=>m.id)).size,4);
});
test('Antigravity preserves final responses, ignores malformed steps and does not invent replies',()=>{
 const result=parser([{source:'MODEL',type:'PLANNER_RESPONSE',content:'Done',thinking:'Check',tool_calls:[null,{name:1}]},{source:'MODEL',type:'GENERIC',content:''}], 'chat');
 assert.deepEqual(result.map(m=>m.kind),['thinking','text']); assert.equal(result[1].text,'Done');
 assert.deepEqual(parser([{source:'MODEL',type:'PLANNER_RESPONSE',tool_calls:[]}],'chat'),[]);
});
