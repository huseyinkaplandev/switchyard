const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const script = fs.readFileSync('../scripts/claude-task-sync.mjs', 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('fileURLToPath(import.meta.url)', 'scriptFile');
const accountA = '11111111-1111-4111-8111-111111111111';
const accountB = '22222222-2222-4222-8222-222222222222';
const orgA = '33333333-3333-4333-8333-333333333333';
const orgB = '44444444-4444-4444-8444-444444444444';

function fixture(platform='win32') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-transfer-'));
  const root = path.join(base, 'schedules');
  const home = path.join(base, 'home');
  const appdata = path.join(base, 'appdata');
  const claude = platform==='darwin' ? path.join(home,'Library','Application Support','Claude') : path.join(appdata, 'Claude');
  const file = (a, o) => path.join(claude, 'claude-code-sessions', a, o, 'scheduled-tasks.json');
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value)); };
  write(path.join(claude, 'config.json'), {lastKnownAccountUuid:accountA});
  for (const [a,o] of [[accountA,orgA],[accountB,orgB]]) {
    write(path.join(path.dirname(file(a,o)), 'local_chat.json'), {cliSessionId:'native',sessionId:'local_chat'});
    write(file(a,o), {scheduledTasks:[],recordedSkips:{keep:'yes'}});
  }
  const definition = {id:'daily',displayName:'Daily',cronExpression:'0 9 * * *',enabled:true,cwd:'{{ROOT}}',model:'test-model'};
  write(path.join(root, 'state', 'claude-task-manifest.json'), {tasks:[definition],retired:['old']});
  fs.mkdirSync(path.join(root, 'task-prompts'), {recursive:true});
  fs.writeFileSync(path.join(root, 'task-prompts', 'daily.md'), 'Work in {{ROOT}}; home {{HOME}}');
  fs.mkdirSync(path.join(base,'AnthropicClaude'),{recursive:true});
  fs.writeFileSync(path.join(base,'AnthropicClaude','claude.exe'),'fixture');
  async function run(command, running=false, options={}) {
    let output='';
    const processStub={platform,env:{APPDATA:appdata,LOCALAPPDATA:base,SWITCHYARD_SCHEDULES_DIR:root},argv:['node','script',command,...(options.args || [])],stdout:{write:text=>{output+=text;}},pid:12345,exitCode:0};
    const keys=['execFileSync','spawn','copyFileSync','existsSync','mkdirSync','readFileSync','readdirSync','renameSync','statSync','writeFileSync','os','path','scriptFile','process','Atomics'];
    const args=[(command) => {
      if (command==='taskkill' || command==='osascript') { running=false; return ''; }
      return running?'claude.exe':'';
    },() => {
      const child=new (require('node:events').EventEmitter)();
      child.unref=()=>{};
      queueMicrotask(()=>{
        if(options.launchError) { child.emit('error',new Error('launch failed')); return; }
        running=true;
        options.onStart?.();
        child.emit('spawn');
      });
      return child;
    },...keys.slice(2,10).map(k=>fs[k]),{homedir:()=>home},path,path.join(root,'scripts','claude-task-sync.mjs'),processStub,{wait(){options.onWait?.();}}];
    await new AsyncFunction(...keys,script)(...args);
    return {value:JSON.parse(output),code:processStub.exitCode};
  }
  return {base,root,home,file,write,run,definition,close:()=>fs.rmSync(base,{recursive:true,force:true})};
}

test('account discovery ignores empty cross-account organization artifacts',async()=>{
  const f=fixture();try {
    f.write(f.file(accountA,orgB),{scheduledTasks:[]});
    f.write(f.file(accountB,orgA),{scheduledTasks:[]});
    const result=await f.run('status');
    assert.deepEqual(result.value.accounts.map(a=>a.key),[accountA+'/'+orgA,accountB+'/'+orgB]);
    assert.equal(result.value.liveAccount,accountA+'/'+orgA);
  }finally{f.close();}
});

test('freshly signed-in account without Code sessions is live via its skills cache org',async()=>{
  const f=fixture();try {
    const accountC='55555555-5555-4555-8555-555555555555', orgC='66666666-6666-4666-8666-666666666666';
    const claude=path.dirname(path.dirname(path.dirname(path.dirname(f.file(accountA,orgA)))));
    f.write(path.join(claude,'config.json'),{lastKnownAccountUuid:accountC});
    f.write(path.join(claude,'local-agent-mode-sessions','skills-plugin',orgC,accountC,'manifest.json'),{skills:[]});
    const status=await f.run('status');
    assert.equal(status.value.liveAccount,accountC+'/'+orgC);
    const applied=await f.run('apply',false,{args:['--restart']});
    assert.equal(applied.value.ok,true);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.file(accountC,orgC),'utf8')).scheduledTasks.map(t=>t.id),['daily']);
  }finally{f.close();}
});

test('transfer preserves runtime state, repairs duplicate IDs and is idempotent',async()=>{
  const f=fixture();try {
    const saved={...f.definition,cwd:f.root,filePath:'old',createdAt:123,lastRunAt:'2026-10-14T10:00:00Z',lastSessionId:'keep-session'};
    f.write(f.file(accountB,orgB),{scheduledTasks:[{...saved,lastRunAt:'2026-10-13T10:00:00Z'},saved,{id:'old',enabled:true,filePath:'old',createdAt:1}],recordedSkips:{keep:'yes'}});
    const first=await f.run('apply');assert.equal(first.code,0);
    const data=JSON.parse(fs.readFileSync(f.file(accountB,orgB)));
    assert.equal(data.scheduledTasks.filter(t=>t.id==='daily').length,1);
    const task=data.scheduledTasks.find(t=>t.id==='daily');
    assert.equal(task.lastSessionId,'keep-session');assert.equal(task.createdAt,123);
    assert.equal(task.model,'test-model');assert.equal(task.cwd,f.root);
    assert.equal(task.lastRunAt,saved.lastRunAt);assert.equal(data.recordedSkips.keep,'yes');
    assert.equal(data.scheduledTasks.find(t=>t.id==='old').enabled,false);
    const before=fs.readFileSync(f.file(accountB,orgB),'utf8');
    const second=await f.run('apply');assert.equal(second.code,0);
    assert.deepEqual(second.value.prompts,[]);assert.deepEqual(second.value.results[accountB+'/'+orgB],[]);
    assert.equal(fs.readFileSync(f.file(accountB,orgB),'utf8'),before);
  }finally{f.close();}
});

test('running Desktop account is never rewritten by background transfer',async()=>{
  const f=fixture();try {
    const before=fs.readFileSync(f.file(accountA,orgA),'utf8');
    const result=await f.run('apply',true);
    assert.equal(fs.readFileSync(f.file(accountA,orgA),'utf8'),before);
    assert.match(result.value.results[accountA+'/'+orgA],/^skipped:/);
    assert.equal(JSON.parse(fs.readFileSync(f.file(accountB,orgB))).scheduledTasks.length,1);
  }finally{f.close();}
});

test('partial transfer failure produces a failing exit code and retains invalid target',async()=>{
  const f=fixture();try {
    f.write(f.file(accountB,orgB),{scheduledTasks:[{id:'foreign',enabled:true,filePath:'x',createdAt:null}]});
    const before=fs.readFileSync(f.file(accountB,orgB),'utf8');
    const result=await f.run('apply');assert.equal(result.code,1);assert.equal(result.value.ok,false);
    assert.match(result.value.results[accountB+'/'+orgB],/^error:/);
    assert.equal(fs.readFileSync(f.file(accountB,orgB),'utf8'),before);
  }finally{f.close();}
});

test('status detects definition and prompt drift rather than claiming readiness',async()=>{
  const f=fixture();try {
    await f.run('apply');
    const file=f.file(accountB,orgB),data=JSON.parse(fs.readFileSync(file));
    data.scheduledTasks[0].cronExpression='0 1 * * *';f.write(file,data);
    const status=await f.run('status');
    const account=status.value.accounts.find(a=>a.key===accountB+'/'+orgB);
    assert.equal(account.valid,false);assert.ok(account.problems.some(p=>p.includes('cronExpression')));
    fs.writeFileSync(path.join(f.home,'.claude','scheduled-tasks','daily','SKILL.md'),'wrong prompt');
    const changed=await f.run('status');
    assert.ok(changed.value.accounts.every(a=>a.problems.some(p=>p.includes('prompt differs'))));
  }finally{f.close();}
});

test('macOS profiles use the same transfer and live-account protections',async()=>{
  const f=fixture('darwin');try {
    const result=await f.run('apply',true);
    assert.equal(result.value.restarted,false);assert.match(result.value.results[accountA+'/'+orgA],/^skipped:/);
    const status=await f.run('status');assert.equal(status.value.accounts.length,2);
    const task=JSON.parse(fs.readFileSync(f.file(accountB,orgB))).scheduledTasks[0];
    assert.equal(task.id,'daily');assert.ok(task.filePath.includes('.claude'));
  }finally{f.close();}
});

test('export keeps task model and portable prompt paths for the next account',async()=>{
  const f=fixture();try {
    await f.run('apply');await f.run('export');
    const manifest=JSON.parse(fs.readFileSync(path.join(f.root,'state','claude-task-manifest.json')));
    assert.equal(manifest.tasks[0].model,'test-model');assert.equal(manifest.tasks[0].cwd,'{{ROOT}}');
    assert.ok(fs.readFileSync(path.join(f.root,'task-prompts','daily.md'),'utf8').includes('{{ROOT}}'));
    assert.deepEqual(manifest.retired,['old']);
  }finally{f.close();}
});

test('invalid manifest is rejected before writing prompts or account records',async()=>{
  const f=fixture();try {
    f.write(path.join(f.root,'state','claude-task-manifest.json'),{tasks:[f.definition,f.definition]});
    const before=fs.readFileSync(f.file(accountA,orgA),'utf8');
    await assert.rejects(f.run('apply'),/duplicate task id/);
    assert.equal(fs.readFileSync(f.file(accountA,orgA),'utf8'),before);
    assert.equal(fs.existsSync(path.join(f.home,'.claude','scheduled-tasks','daily','SKILL.md')),false);
  }finally{f.close();}
});

test('restart install verifies both accounts after reopening Desktop',async()=>{
  const f=fixture();try {
    const result=await f.run('apply',true,{args:['--restart','--start']});
    assert.equal(result.code,0);assert.equal(result.value.verified,true);
    assert.equal(result.value.verifiedTasks,1);assert.equal(result.value.verifiedAccounts,2);
    assert.deepEqual(result.value.verificationErrors,[]);
  }finally{f.close();}
});

test('startup overwriting installed tasks fails verification instead of reporting success',async()=>{
  const f=fixture();try {
    const result=await f.run('apply',true,{args:['--restart','--start'],onStart(){
      f.write(f.file(accountA,orgA),{scheduledTasks:[]});
    }});
    assert.equal(result.code,1);assert.equal(result.value.ok,false);assert.equal(result.value.verified,false);
    assert.ok(result.value.verificationErrors.some(e=>e.includes('daily')));
  }finally{f.close();}
});

test('launcher failure never claims that Desktop restarted',async()=>{
  const f=fixture();try {
    const result=await f.run('apply',true,{args:['--restart','--start'],launchError:true});
    assert.equal(result.code,1);assert.equal(result.value.restarted,false);assert.equal(result.value.verified,false);
    assert.deepEqual(result.value.verificationErrors,['launch failed']);
  }finally{f.close();}
});

test('account switch during reopening invalidates installation confirmation',async()=>{
  const f=fixture();try {
    const result=await f.run('apply',true,{args:['--restart','--start'],onStart(){
      f.write(path.join(path.dirname(path.dirname(path.dirname(path.dirname(f.file(accountA,orgA))))),'config.json'),{lastKnownAccountUuid:accountB});
    }});
    assert.equal(result.code,1);assert.equal(result.value.verified,false);
    assert.ok(result.value.verificationErrors.some(e=>e.includes('account changed')));
  }finally{f.close();}
});

test('export captures new one-shot tasks, edits and default-model removal',async()=>{
 const f=fixture();try {
  await f.run('apply');
  const data=JSON.parse(fs.readFileSync(f.file(accountA,orgA)));
  delete data.scheduledTasks[0].model;
  data.scheduledTasks[0].enabled=false;data.scheduledTasks[0].displayName='Renamed';data.scheduledTasks[0].cronExpression='15 10 * * *';
  const extra=path.join(f.home,'new-task.md');fs.writeFileSync(extra,'New prompt');
  data.scheduledTasks.push({id:'new-task',displayName:'One shot',enabled:true,fireAt:Date.now()+3600000,createdAt:1,filePath:extra,useWorktree:false,userSelectedFolders:[f.home]});f.write(f.file(accountA,orgA),data);
  const captured=await f.run('export');assert.equal(captured.value.exported.length,2);
  const manifest=JSON.parse(fs.readFileSync(path.join(f.root,'state','claude-task-manifest.json')));
  assert.equal(manifest.tasks[0].model,undefined);assert.equal(manifest.tasks[0].enabled,false);
  await f.run('apply',true);
  const target=JSON.parse(fs.readFileSync(f.file(accountB,orgB))).scheduledTasks;
  assert.equal(target.find(t=>t.id==='daily').model,undefined);assert.equal(target.find(t=>t.id==='daily').displayName,'Renamed');
  assert.equal(target.find(t=>t.id==='daily').enabled,false);assert.equal(target.find(t=>t.id==='new-task').fireAt,manifest.tasks[1].fireAt);
  assert.deepEqual(target.find(t=>t.id==='new-task').userSelectedFolders,[f.home]);
 }finally{f.close();}
});

test('deleted source task retires the old destination and retained task keeps running',async()=>{
 const f=fixture();try{
  await f.run('apply');
  const source=JSON.parse(fs.readFileSync(f.file(accountA,orgA)));
  const extra=path.join(f.home,'new-task.md');fs.writeFileSync(extra,'New prompt');
  source.scheduledTasks=[{id:'replacement',enabled:true,cronExpression:'0 1 * * *',filePath:extra,createdAt:1}];f.write(f.file(accountA,orgA),source);
  await f.run('export');await f.run('apply',true);
  const target=JSON.parse(fs.readFileSync(f.file(accountB,orgB))).scheduledTasks;
  assert.equal(target.find(t=>t.id==='daily').enabled,false);assert.equal(target.find(t=>t.id==='replacement').enabled,true);
 }finally{f.close();}
});

test('explicit previous-account export captures logout-flushed state after switching',async()=>{
 const f=fixture();try{
  await f.run('apply');
  const result=await f.run('export',true,{args:['--account',accountB+'/'+orgB]});
  assert.equal(result.value.from,accountB+'/'+orgB);
  await assert.rejects(f.run('export',false,{args:['--account','unknown']}),/source account not found/);
 }finally{f.close();}
});

test('empty source never wipes central definitions',async()=>{
 const f=fixture();try{
  const before=fs.readFileSync(path.join(f.root,'state','claude-task-manifest.json'),'utf8');
  await assert.rejects(f.run('export'),/Empty source export refused/);
  assert.equal(fs.readFileSync(path.join(f.root,'state','claude-task-manifest.json'),'utf8'),before);
 }finally{f.close();}
});

test('automatic export retains extra manifest metadata',async()=>{
 const f=fixture();try{
  await f.run('apply');
  const file=path.join(f.root,'state','claude-task-manifest.json');const manifest=JSON.parse(fs.readFileSync(file));
  manifest.tasks[0].agent={name:'Worker',role:'Editor'};manifest.tasks[0].requires=['browser'];f.write(file,manifest);
  await f.run('export');const next=JSON.parse(fs.readFileSync(file));
  assert.deepEqual(next.tasks[0].agent,{name:'Worker',role:'Editor'});assert.deepEqual(next.tasks[0].requires,['browser']);
 }finally{f.close();}
});
