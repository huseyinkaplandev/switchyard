import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePackage, windowsAdapter, readProgress } from './controller.mjs';
import { dispatchDashboard } from './scheduler.mjs';
import { ensureClaudeDesktop } from './desktop-app.mjs';
import { acquireLock } from './locks.mjs';
const [directory,hash,action,itemId]=process.argv.slice(2);
let releaseGlobal,releasePackage,validated=false;
const runtimeFile=path.join(directory,'runtime.json');
async function runtime(value) {
  const previous=JSON.parse(await fs.readFile(runtimeFile,'utf8').catch(()=> '{}'));
  const temp=runtimeFile+'.'+process.pid+'.tmp';
  await fs.writeFile(temp,JSON.stringify({...previous,...value,pid:process.pid,updatedAt:new Date().toISOString()},null,2));await fs.rename(temp,runtimeFile);
}
try {
  const pkg=await validatePackage(directory,hash);
  validated=true;
  if(pkg.targetProvider!=='claude-code')throw new Error('Use native Codex Desktop host tools; direct Codex dispatch is not verified');
  if(!['start','open'].includes(action)||itemId&&!pkg.items.some(i=>i.id===itemId)||action==='open'&&!itemId)throw new Error('Invalid Desktop action or item');
  releaseGlobal=await acquireLock(path.join(path.dirname(directory),'.ui-worker.lock'));
  releasePackage=await acquireLock(path.join(directory,'controller.lock'));
  await runtime({status:'launching',error:null,action,itemId:itemId||null});
  const claudePath=await ensureClaudeDesktop();
  await runtime({status:'running',claudePath});
  const adapter=await windowsAdapter(directory,pkg,{dashboard:true});
  let result;
  if(action==='open') {
    const account=await adapter.verifyAccount(pkg),item=pkg.items.find(i=>i.id===itemId),state=await readProgress(directory,itemId);
    if(!state.destinationId||state.destinationAccount!==account)throw new Error('Destination unavailable in the currently selected Desktop account');
    await adapter.openDestination(item,state.destinationId);result={status:'finished'};
  } else result=await dispatchDashboard(pkg,directory,adapter,{...(itemId?{itemIds:[itemId],maxRounds:1}:{})});
  await runtime(result);
} catch(error) {
  if(validated)await runtime({status:'error',error:error.message}).catch(()=>{});console.error(error.message);process.exitCode=1;
} finally {if(releasePackage)await releasePackage();if(releaseGlobal)await releaseGlobal();}
