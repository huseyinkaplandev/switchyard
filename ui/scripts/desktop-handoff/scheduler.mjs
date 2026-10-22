import fs from 'node:fs/promises';
import path from 'node:path';
import { desktopPrompt, readProgress, writeProgress } from './controller.mjs';
const cwdKey = cwd => process.platform==='win32' ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
const done = state => state.state==='reply-observed' && state.titleVerified;
const active = state => !done(state) && (state.destinationId || ['opening','opened','sent','uncertain'].includes(state.state));

export async function dispatchDashboard(pkg,directory,adapter,{itemIds=pkg.items.map(i=>i.id),maxRounds=900,pollMs=2000}={}) {
  if(!Array.isArray(itemIds)||!itemIds.length||new Set(itemIds).size!==itemIds.length||itemIds.some(id=>!pkg.items.some(i=>i.id===id)))throw new Error('Invalid selected package item');
  const selected=pkg.items.filter(i=>itemIds.includes(i.id));
  const account=await adapter.verifyAccount(pkg);
  if(selected.some(i=>!i.source.sourceAccount||i.source.sourceAccount===account))throw new Error('Destination account must differ from known source account');
  const platform=process.platform==='darwin'?'macos':'windows';
  if(selected.some(i=>i.source.platform!==platform))throw new Error('Source OS differs; explicit local project mapping required');
  for(let round=0;round<maxRounds;round++) {
    if(await fs.access(path.join(directory,'stop')).then(()=>true,()=>false))return {status:'stopped'};
    const states=new Map();
    // Observe all destinations: an unselected running chat still owns its cwd.
    for(const item of pkg.items) {
      let state=await readProgress(directory,item.id);
      if(state.destinationAccount && state.destinationAccount!==account && (state.destinationId||active(state)))throw new Error('Existing destination belongs to another account');
      if(itemIds.includes(item.id)||active(state)) {
        const recovered=await adapter.reconcile(item,account,state);
        if(recovered) { state={...state,...recovered};await writeProgress(directory,item.id,state); }
      }
      states.set(item.id,state);
    }
    const occupied=new Map();
    for(const item of pkg.items)if(active(states.get(item.id)))occupied.set(cwdKey(item.source.cwd),item.id);
    for(const item of selected) {
      if(await fs.access(path.join(directory,'stop')).then(()=>true,()=>false))return {status:'stopped'};
      let state=states.get(item.id);
      if(done(state))continue;
      const key=cwdKey(item.source.cwd),owner=occupied.get(key);
      if(owner && owner!==item.id) {
        if(!state.destinationId) { state={...state,state:'queued',blockedBy:owner,error:undefined};await writeProgress(directory,item.id,state);states.set(item.id,state); }
        continue;
      }
      if(!state.destinationId && ['opening','opened','sent','uncertain'].includes(state.state)) {
        state={...state,state:'uncertain',error:'Uncertain delivery: reconcile before opening another chat'};
        await writeProgress(directory,item.id,state);states.set(item.id,state);occupied.set(key,item.id);continue;
      }
      try {
        await fs.access(item.source.cwd);
        const created=!state.destinationId;
        if(created) {
          state={...state,state:'opening',destinationAccount:account,error:undefined,blockedBy:undefined};
          await writeProgress(directory,item.id,state);
          const submitted=await adapter.openAndSubmit(item,desktopPrompt(item,await fs.readFile(item.promptFile,'utf8')));
          state={...state,state:'opened',destinationId:submitted.destinationId};await writeProgress(directory,item.id,state);
          const evidence=await adapter.awaitSubmission(item,account,state);
          if(!evidence?.destinationId || !['sent','reply-observed'].includes(evidence.state))throw new Error('Native submitted message unavailable; do not resubmit');
          state={...state,...evidence};await writeProgress(directory,item.id,state);
        }
        if(!state.titleVerified) {
          if(!created)await adapter.openDestination(item,state.destinationId);
          state.titleVerified=(await adapter.setAndReadTitle(item,state.destinationId))===item.source.title;
          if(!state.titleVerified)throw new Error('Title mismatch after native rename');
          await writeProgress(directory,item.id,state);
        }
        states.set(item.id,state);
        if(!done(state))occupied.set(key,item.id);
        else if(occupied.get(key)===item.id)occupied.delete(key);
      } catch(error) {
        const beforeSend=!state.destinationId&&(state.state!=='opening'||error.preSubmit===true);
        state={...state,state:beforeSend?'failed':state.destinationId?state.state:'uncertain',error:error.message};
        await writeProgress(directory,item.id,state);
        // UI may be on a dialog or have lost focus. Do not inject into another item.
        throw error;
      }
    }
    if(selected.every(item=>done(states.get(item.id))))return {status:'finished'};
    if(round+1<maxRounds)await new Promise(r=>setTimeout(r,pollMs));
  }
  return {status:'waiting'};
}
