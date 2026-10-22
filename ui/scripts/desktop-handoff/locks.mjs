import fs from 'node:fs/promises';
import crypto from 'node:crypto';
export function pidAlive(pid) {
  if(!Number.isInteger(pid)||pid<1)return false;
  try {process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
export async function acquireLock(file) {
  const token=crypto.randomUUID();
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const handle=await fs.open(file,'wx');
      try {await handle.writeFile(JSON.stringify({pid:process.pid,token,at:new Date().toISOString()}));}finally{await handle.close();}
      return async()=>{const current=JSON.parse(await fs.readFile(file,'utf8').catch(()=> '{}'));if(current.token===token)await fs.rm(file,{force:true});};
    } catch(error) {
      if(error.code!=='EEXIST')throw error;
      let existing;try{existing=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw new Error('Controller lock is being initialized; retry shortly');}
      if(pidAlive(existing.pid))throw new Error('Desktop controller already running');
      // Serialize stale-lock cleanup and re-read: another process may have
      // replaced the stale lock since our first observation.
      const reapFile=file+'.reap';let reap;
      try {reap=await fs.open(reapFile,'wx');}catch{throw new Error('Stale controller lock recovery in progress; retry shortly');}
      try {
        const latest=JSON.parse(await fs.readFile(file,'utf8').catch(()=> '{}'));
        if(pidAlive(latest.pid))throw new Error('Desktop controller already running');
        await fs.rm(file,{force:true});
      }finally{await reap.close();await fs.rm(reapFile,{force:true});}
    }
  }
  throw new Error('Could not acquire Desktop controller lock');
}
