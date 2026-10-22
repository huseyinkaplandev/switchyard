const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
function load(file,imports={}){const module={exports:{}};new Function('require','exports',ts.transpile(fs.readFileSync(file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}))(name=>name==='server-only'?{}:imports[name]||require(name),module.exports);return module.exports;}
const handoff=load('app/_lib/handoff.ts');
const parts=load('app/_lib/opencodeParts.ts').opencodeParts;
const message=(kind,text,toolName,provider='codex')=>({id:`${provider}:session:${crypto.randomUUID()}`,sessionId:'session',provider,role:'assistant',kind,text,toolName,timestamp:'2026-10-16T12:00:00Z'});
test('file evidence covers four provider tool formats and spaces',()=>{
 const messages=[message('tool_use','file_path: C:/Project with spaces/a.ts','Write','claude-code'),message('tool_use','*** Begin Patch\n*** Update File: src/b.ts\n*** End Patch','apply_patch'),message('tool_use',JSON.stringify({TargetFile:'C:\\Project with spaces\\c.ts'}),'replace_file_content','antigravity'),message('tool_use',JSON.stringify({filePath:'/project/d.ts'}),'edit','opencode'),message('tool_use',JSON.stringify({AbsolutePath:'C:/project/read.ts'}),'view_file','antigravity')];
 const files=handoff.collectTouchedFiles(messages);assert.equal(files.edited.length,4);assert.deepEqual(files.read,[['C:/project/read.ts',1]]);assert.ok(files.edited.some(([p])=>p==='C:/Project with spaces/a.ts'));
});
test('reasoning-only handoff exposes coverage, evidence, tools and no fabricated closing',()=>{
 const messages=[{...message('text','Fix issue'),role:'user'},message('thinking','Investigate failed lock'),message('tool_use','TargetFile: C:/project/a.ts','replace_file_content','antigravity'),message('tool_result','Edit failed: access denied')];
 const result=handoff.buildHandoffMarkdown({id:'session',provider:'antigravity',title:'Same title',cwd:'C:/project',project:'project',updatedAt:'2026-10-16',sourceAvailable:true},messages);
 assert.ok(result.includes('reasoning: 1'));assert.ok(result.includes('Investigate failed lock'));assert.ok(result.includes('access denied'));assert.ok(result.includes('C:/project/a.ts'));assert.ok(result.includes('not a lossless'));
 assert.equal(handoff.buildTurns(messages)[0].closing,'');
});
test('OpenCode retains reasoning, tool failures, attachment references and compaction',()=>{
 assert.equal(parts({type:'reasoning',text:'Reason'} )[0].kind,'thinking');
 const tool=parts({type:'tool',tool:'edit',state:{input:{filePath:'a.ts'},error:'failed',status:'error'}});assert.deepEqual(tool.map(p=>p.kind),['tool_use','tool_result']);assert.equal(tool[1].isError,true);
 assert.equal(parts({type:'file',url:'file:///a.png'})[0].kind,'attachment');assert.equal(parts({type:'compaction',auto:true})[0].kind,'compaction');
});
for(const provider of ['codex','claude-code','opencode','antigravity'])test(`${provider} snapshot preserves native evidence with verified hashes`,async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-evidence-'));
 let db;
 try{
  const source=path.join(base,'native.jsonl'),raw=JSON.stringify({content:'x'.repeat(40000),encrypted_content:'opaque-state'});fs.writeFileSync(source,raw);
  let sourcePath=source;
  if(provider==='opencode'){
   const {DatabaseSync}=require('node:sqlite');sourcePath=path.join(base,'opencode.db');db=new DatabaseSync(sourcePath);db.exec('CREATE TABLE session(id TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,session_id TEXT,time_created INTEGER,data TEXT)');db.prepare('INSERT INTO session VALUES (?)').run('session');db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('m','session',1,'{"role":"assistant"}');db.prepare('INSERT INTO part VALUES (?,?,?,?)').run('p','session',1,raw);sourcePath+='#session';
  }
  const messages=[{...message('text','Continue',undefined,provider),role:'user'},message('thinking','Reason',undefined,provider),message('tool_result','truncated … (+999 chars)',undefined,provider)];
  const mod=load('app/_lib/handoffSnapshot.ts',{'./paths':{getDataDir:()=>base},'./agentArchive':{getAgentThread:()=>({id:'session',title:'Same name',provider,cwd:base,project:'test',sourcePath}),getAgentThreadMessages:()=>messages,getAgentSourcePaths:async()=>[source]},'./sessions':{},'./handoff':handoff,'./workspaceGit':{readWorkspaceGitState:async()=>({available:false})}});
  const snapshot=await mod.createContextSnapshot('session'),manifestBytes=fs.readFileSync(path.join(snapshot.directory,'manifest.json'));
  assert.equal(crypto.createHash('sha256').update(manifestBytes).digest('hex'),snapshot.manifestHash);
  const manifest=JSON.parse(manifestBytes);for(const [name,info]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshot.directory,name))).digest('hex'),info.sha256);
  assert.equal(snapshot.report.messageCount,3);assert.equal(snapshot.report.sources.length,1);assert.ok(snapshot.report.warnings.some(w=>w.includes('truncation')));
  assert.ok(fs.readFileSync(path.join(snapshot.directory,provider==='opencode'?'native-opencode.json':'native-0.jsonl'),'utf8').includes('opaque-state'));
  if(provider!=='opencode')assert.equal(fs.readFileSync(path.join(snapshot.directory,'native-0.jsonl'),'utf8'),raw);
 }finally{db?.close();fs.rmSync(base,{recursive:true,force:true});}
});
test('missing native source is reported as archive-only, never complete',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-missing-'));
 try{
  const mod=load('app/_lib/handoffSnapshot.ts',{'./paths':{getDataDir:()=>base},'./agentArchive':{getAgentThread:()=>({id:'session',title:'Old',provider:'codex',cwd:base}),getAgentThreadMessages:()=>[message('text','Existing reply')],getAgentSourcePaths:async()=>[path.join(base,'missing')]},'./sessions':{},'./handoff':handoff,'./workspaceGit':{readWorkspaceGitState:async()=>({available:false})}});
  const snapshot=await mod.createContextSnapshot('session');assert.equal(snapshot.report.preservation,'archive-only');assert.ok(snapshot.report.warnings.some(w=>w.includes('No native')));
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
