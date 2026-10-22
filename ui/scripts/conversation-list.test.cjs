const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const mod={exports:{}};
new Function('exports',ts.transpile(fs.readFileSync('app/_lib/conversationList.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(mod.exports);
const list=mod.exports.conversationList;

test('rotated CLI histories represent one Desktop conversation, including all-runs mode',()=>{
 const threads=[thread('old','2026-10-14'),thread('current','2026-10-13')];
 const metadata={old:meta('old',{key:'old',desktopId:'local-chat',currentSourceId:'current',chatType:'normal',scheduledTaskId:null}),current:meta('current',{key:'current',desktopId:'local-chat',currentSourceId:'current',chatType:'normal',scheduledTaskId:null})};
 for(const allRuns of [false,true]) {
  assert.deepEqual(list(threads,metadata,'active','all',allRuns).threads.map(t=>t.id),['current']);
  assert.deepEqual(mod.exports.latestScheduledCandidates(Object.values(metadata),allRuns).map(t=>t.sourceId),['current']);
 }
});

test('Desktop aliases inherit archived state; same title and other accounts remain distinct',()=>{
 const threads=[thread('old'),thread('current'),thread('other')];
 const metadata={old:meta('old',{key:'old',desktopId:'chat',currentSourceId:'current',archived:true}),current:meta('current',{key:'current',desktopId:'chat',currentSourceId:'current',archived:true}),other:meta('other',{key:'other',desktopId:'chat',sourceAccount:'b',chatType:'normal',scheduledTaskId:null})};
 assert.deepEqual(list(threads,metadata,'active','all',true).threads.map(t=>t.id),['other']);
 assert.deepEqual(list(threads,metadata,'archived','all',true).threads.map(t=>t.id),['current']);
 assert.equal(list([thread('a'),thread('b')],{},'active','all',false).threads.length,2);
});

test('project identity normalizes Windows separators, case and trailing slash only',()=>{
 const normalize=mod.exports.normalizeProjectPath;
 assert.equal(normalize('C:\\Project\\'),normalize('c:/project/'));
 assert.notEqual(normalize('/home/Test'),normalize('/home/test'));
 const metadata={a:meta('a',{projectRoot:'C:\\Project',cwd:'C:\\Temp'}),b:meta('b',{projectRoot:'c:/project/',cwd:'C:\\Other'})};
 assert.equal(list([thread('a'),{...thread('b'),cwd:'C:\\Other'}],metadata,'active','all',false).threads.length,1);
});
test('Claude Desktop prior IDs keep native identity, account and archive metadata',async()=>{
 const os=require('node:os'),path=require('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dashboard-alias-test-'));
 const account=path.join(directory,'account','org');fs.mkdirSync(account,{recursive:true});
 const current='11111111-1111-4111-8111-111111111111',old='22222222-2222-4222-8222-222222222222';
 fs.writeFileSync(path.join(account,'local_chat.json'),JSON.stringify({sessionId:'local_chat',cliSessionId:current,priorCliSessionIds:[old,old,12,'bad'],cwd:'C:/Project',title:'Chat',isArchived:true}));
 const metadataModule={exports:{}};
 const compiled=ts.transpile(fs.readFileSync('app/_lib/desktopHandoff/claudeMetadata.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true});
 new Function('require','exports',compiled)(name=>name==='server-only'?{}:require(name),metadataModule.exports);
 try {
  const result=await metadataModule.exports.readClaudeDesktopMetadata(directory,'windows');
  assert.equal(result.map.size,2);assert.equal(result.map.get(old).length,1);
  assert.equal(result.map.get(old)[0].nativeId,current);
  assert.equal(result.map.get(old)[0].account,'account/org');
  assert.equal(result.map.get(old)[0].archived,true);
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
});

test('internal Codex sessions stay stored but disappear from the conversation catalog',()=>{
 const os=require('node:os'),path=require('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dashboard-internal-test-'));
 const archive={exports:{}};
 const compiled=ts.transpile(fs.readFileSync('app/_lib/agentArchiveDb.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true});
 new Function('require','exports',compiled+';exports.close=()=>db?.close();')(name=>name==='server-only'?{}:name==='./paths'?{getDataDir:()=>directory}:require(name),archive.exports);
 try {
  for(const [id,internal] of [['main',false],['child',true]]) archive.exports.archiveSessionUpsert({thread:{...thread(id),provider:'codex',title:'Work',project:'Project',internal},sourcePath:'missing.jsonl',sourceMtimeMs:1,sourceSizeBytes:1,messages:[{id:id+':message',sessionId:id,provider:'codex',role:'user',text:'Work',timestamp:'2026-10-14',kind:'text'}]});
  assert.deepEqual(archive.exports.archiveThreads().map(t=>t.id),['main']);
  assert.equal(archive.exports.archiveMessages('child').length,1);
  const database=new (require('node:sqlite').DatabaseSync)(path.join(directory,'data.db'),{readOnly:true});
  try {assert.equal(database.prepare('SELECT count(*) AS count FROM agent_sessions WHERE id=?').get('child').count,1);} finally {database.close();}
 } finally {archive.exports.close();fs.rmSync(directory,{recursive:true,force:true});}
});

const thread=(id,at='2026-10-09')=>({id,provider:'claude-code',cwd:'C:\\Project',updatedAt:at,promptCount:1,responseCount:1,archived:false});
const meta=(sourceId,extra={})=>({sourceId,scheduledTaskId:'daily',sourceAccount:'a',platform:'windows',chatType:'scheduled',archived:false,...extra});
test('handoff defaults to latest run while preserving full-history choice',()=>{
 const candidates=[meta('old',{key:'old',cwd:'C:/Project',provider:'claude-code',activityAt:'2026-10-08'}),meta('new',{key:'new',cwd:'C:/Project',provider:'claude-code',activityAt:'2026-10-09'})];
 assert.deepEqual(mod.exports.latestScheduledCandidates(candidates,false).map(c=>c.key),['new']);
 assert.equal(mod.exports.latestScheduledCandidates(candidates,true).length,2);
});
test('scheduled runs collapse by native task and newest activity, exact repeats once',()=>{
 const result=list([thread('old','2026-10-08'),thread('new'),thread('new')],{old:meta('old'),new:meta('new')},'active','all',false);
 assert.deepEqual(result.threads.map(t=>t.id),['new']); assert.equal(result.counts.new,2);
});
test('different accounts, projects and platforms remain separate',()=>{
 const threads=[thread('a'),thread('b'),{...thread('c'),cwd:'C:\\Other'},thread('d')];
 assert.equal(list(threads,{a:meta('a'),b:meta('b',{sourceAccount:'b'}),c:meta('c'),d:meta('d',{platform:'macos'})},'active','all',false).threads.length,4);
});
test('archive and run history controls preserve access without source deletion',()=>{
 const threads=[thread('old'),thread('new')], metadata={old:meta('old',{archived:true}),new:meta('new')};
 assert.deepEqual(list(threads,metadata,'active','all',true).threads.map(t=>t.id),['new']);
 assert.deepEqual(list(threads,metadata,'archived','all',true).threads.map(t=>t.id),['old']);
 assert.equal(list(threads,metadata,'all','all',true).threads.length,2);
 assert.equal(list(threads,metadata,'all','normal',true).threads.length,0);
});
