import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dispatch, desktopPrompt, deliveryEvidence, readProgress, writeProgress, validatePackage, digest } from './controller.mjs';
test('Scheduled delivery restores context without inheriting external send permission',()=>{
  const source='historical scheduled prompt';
  assert.equal(desktopPrompt({source:{chatType:'normal'}},source),source);
  const guarded=desktopPrompt({source:{chatType:'scheduled'}},source);
  assert.ok(guarded.startsWith(source));assert.match(guarded,/explicit approval/);assert.match(guarded,/Do not create or run a recurring task/);
});
test('Delivery proof excludes synthetic errors and intermediate commentary',()=>{
  const records=[{type:'user',timestamp:'2026-10-07T08:00:00Z',message:{content:'marker'}},{type:'assistant',timestamp:'2026-10-07T08:00:01Z',isApiErrorMessage:true,message:{model:'<synthetic>',content:[{type:'text',text:'limit'}]}},{type:'assistant',timestamp:'2026-10-07T08:00:02Z',message:{stop_reason:'tool_use',content:[{type:'text',text:'working'}]}}];
  assert.equal(deliveryEvidence(records,'marker').reply,null);
  assert.equal(deliveryEvidence(records,'marker').error,'limit');
  records.push({type:'assistant',timestamp:'2026-10-07T08:00:03Z',message:{stop_reason:'end_turn',content:[{type:'text',text:'done'}]}});
  assert.equal(deliveryEvidence(records,'marker').reply.text,'done');assert.equal(deliveryEvidence(records,'marker').error,null);
});
test('Repeated package does not duplicate sends; interrupted delivery reconciles',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-dispatch-'));
  const items=[];for(const title of ['Acme storefront demo','Café menu — API / payments 🚀','Acme storefront demo']){
    const id=crypto.randomUUID(),promptFile=path.join(directory,id+'.txt');await fs.writeFile(promptFile,'marker:'+id);
    items.push({id,promptFile,source:{title,cwd:directory,sourceAccount:'old/org',platform:process.platform==='darwin'?'macos':'windows'}});
  }
  const pkg={items};let opens=0;const evidence=new Map();
  const adapter={verifyAccount:async()=> 'new/org',reconcile:async item=>evidence.get(item.id)||null,openAndSubmit:async item=>{opens++;const state={destinationId:'local_'+item.id,state:'sent'};evidence.set(item.id,state);return state;},awaitReply:async(item,_account,state)=>({...state,state:'reply-observed'}),setAndReadTitle:async item=>item.source.title};
  try{
    await dispatch(pkg,directory,adapter);await dispatch(pkg,directory,adapter);assert.equal(opens,3);
    assert.equal((await readProgress(directory,items[0].id)).titleVerified,true);
    const extra={...items[0],id:crypto.randomUUID()};evidence.set(extra.id,{destinationId:'local_recovered',state:'sent'});
    await writeProgress(directory,extra.id,{state:'opening'});await dispatch({items:[extra]},directory,adapter);assert.equal(opens,3);
    const uncertain={...items[0],id:crypto.randomUUID()};await writeProgress(directory,uncertain.id,{state:'opening'});await dispatch({items:[uncertain]},directory,adapter);assert.equal(opens,3);assert.equal((await readProgress(directory,uncertain.id)).state,'uncertain');
    const wrong={...items[0],id:crypto.randomUUID()};await dispatch({items:[wrong]},directory,{...adapter,verifyAccount:async()=> 'old/org'});assert.equal(opens,3);assert.match((await readProgress(directory,wrong.id)).error,/account/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('Manifest and snapshot tampering fails before native UI actions',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-package-'));const previous=process.env.SWITCHYARD_DATA_DIR;process.env.SWITCHYARD_DATA_DIR=root;
  try{
    const id=crypto.randomUUID(),itemId=crypto.randomUUID(),directory=path.join(root,'desktop-handoffs',id),base=path.join(directory,itemId);await fs.mkdir(base,{recursive:true});
    const files={'transcript.json':'[{"text":"earlier than seven days"}]','handoff.md':'context','prompt.txt':'prompt','git.json':'{}'},hashes={};for(const [name,text] of Object.entries(files)){await fs.writeFile(path.join(base,name),text);hashes[name]=digest(text);}
    const pkg={version:1,id,targetProvider:'claude-code',items:[{id:itemId,source:{title:'source title',cwd:root},marker:`DESKTOP-HANDOFF:${id}:${itemId}`,promptFile:path.join(base,'prompt.txt'),transcriptFile:path.join(base,'transcript.json'),handoffFile:path.join(base,'handoff.md'),hashes}]};const manifest=JSON.stringify(pkg);await fs.writeFile(path.join(directory,'manifest.json'),manifest);
    assert.equal((await validatePackage(directory,digest(manifest))).items.length,1);
    await fs.writeFile(path.join(base,'prompt.txt'),'tampered');await assert.rejects(validatePackage(directory,digest(manifest)),/hash mismatch/);
    await assert.rejects(validatePackage(directory,'0'.repeat(64)),/Manifest hash mismatch/);
  }finally{if(previous===undefined)delete process.env.SWITCHYARD_DATA_DIR;else process.env.SWITCHYARD_DATA_DIR=previous;await fs.rm(root,{recursive:true,force:true});}
});
