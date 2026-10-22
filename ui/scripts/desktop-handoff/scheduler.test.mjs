import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { dispatchDashboard } from './scheduler.mjs';
import { readProgress } from './controller.mjs';

async function fixture() {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-scheduler-'));
  const a=path.join(dir,'a'),b=path.join(dir,'b');await fs.mkdir(a);await fs.mkdir(b);
  const items=[];
  for(const [id,cwd,chatType] of [['a1',a,'normal'],['a2',a,'normal'],['b1',b,'scheduled']]) {
    const promptFile=path.join(dir,id+'.txt');await fs.writeFile(promptFile,id);
    items.push({id,promptFile,source:{cwd,title:id,sourceAccount:'old/org',platform:process.platform==='darwin'?'macos':'windows',chatType}});
  }
  const observed=new Map(),opens=[],titles=[];
  const adapter={
    verifyAccount:async()=> 'new/org',reconcile:async item=>observed.get(item.id)||null,
    openAndSubmit:async(item,prompt)=>{opens.push({id:item.id,prompt});const p={state:'sent',destinationId:'local_'+item.id,destinationAccount:'new/org'};observed.set(item.id,p);return p;},
    awaitSubmission:async item=>observed.get(item.id),
    setAndReadTitle:async item=>{titles.push(item.id);observed.get(item.id).titleVerified=true;return item.source.title;},
    openDestination:async()=>{}
  };
  return {dir,pkg:{items},adapter,observed,opens,titles};
}
test('Working chat queues its cwd but other project and scheduled submission advance; retry never resends',async()=>{
  const f=await fixture();try {
    await dispatchDashboard(f.pkg,f.dir,f.adapter,{maxRounds:1,pollMs:0});
    assert.deepEqual(f.opens.map(o=>o.id),['a1','b1']);
    assert.equal((await readProgress(f.dir,'a2')).state,'queued');
    assert.match(f.opens[1].prompt,/explicit approval/);
    await dispatchDashboard(f.pkg,f.dir,f.adapter,{maxRounds:1,pollMs:0});
    assert.equal(f.opens.length,2);
    f.observed.set('a1',{...f.observed.get('a1'),state:'reply-observed',titleVerified:true});
    await dispatchDashboard(f.pkg,f.dir,f.adapter,{maxRounds:1,pollMs:0});
    assert.deepEqual(f.opens.map(o=>o.id),['a1','b1','a2']);
  }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('Single-item request still waits behind existing active cwd; unrelated selected item runs',async()=>{
  const f=await fixture();try {
    await dispatchDashboard(f.pkg,f.dir,f.adapter,{itemIds:['a1'],maxRounds:1,pollMs:0});
    await dispatchDashboard(f.pkg,f.dir,f.adapter,{itemIds:['a2'],maxRounds:1,pollMs:0});
    assert.deepEqual(f.opens.map(o=>o.id),['a1']);
    await dispatchDashboard(f.pkg,f.dir,f.adapter,{itemIds:['b1'],maxRounds:1,pollMs:0});
    assert.deepEqual(f.opens.map(o=>o.id),['a1','b1']);
    await assert.rejects(dispatchDashboard(f.pkg,f.dir,f.adapter,{itemIds:['unknown']}),/item/);
  }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
test('Wrong destination account blocks all submissions',async()=>{
  const f=await fixture();try {
    await assert.rejects(dispatchDashboard(f.pkg,f.dir,{...f.adapter,verifyAccount:async()=> 'old/org'},{maxRounds:1}),/account/);
    assert.equal(f.opens.length,0);
  }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
