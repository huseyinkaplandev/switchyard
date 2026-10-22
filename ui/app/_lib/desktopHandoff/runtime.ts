import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { packageDirectory, readHandoffPackage } from './packages';
import type { DesktopRuntime } from './types';
import { isDemoMode } from '../paths';

function alive(pid: unknown) {
  if(typeof pid!=='number'||!Number.isInteger(pid)||pid<1)return false;
  try {process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
}
async function record(file:string):Promise<Record<string,unknown>> {
  try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return {};}
}
export async function getDesktopRuntime(id:string):Promise<DesktopRuntime> {
  const directory=packageDirectory(id),value=await record(path.join(directory,'runtime.json'));
  const lock=await record(path.join(directory,'controller.lock'));
  const running=alive(lock.pid)||(['launching','running'].includes(String(value.status))&&alive(value.pid));
  const status=typeof value.status==='string'?value.status:running?'running':'idle';
  return {status:!running&&['launching','running'].includes(status)?'waiting':status,running,pid:typeof value.pid==='number'?value.pid:undefined,error:typeof value.error==='string'?value.error:undefined,updatedAt:typeof value.updatedAt==='string'?value.updatedAt:undefined};
}
export async function startDesktopAction(id:string,action:'start'|'open',itemId?:string) {
  const pkg=await readHandoffPackage(id),directory=packageDirectory(id);
  const demo=isDemoMode();
  if(!demo&&(process.platform!=='win32'||pkg.targetProvider!=='claude-code'))throw new Error('Direct dispatch currently supports Windows Claude Desktop only');
  if(itemId!==undefined&&(typeof itemId!=='string'||!pkg.items.some(i=>i.id===itemId))||action==='open'&&!itemId)throw new Error('Invalid package item');
  const selected=itemId?pkg.items.filter(i=>i.id===itemId):pkg.items;
  if(!demo&&action==='start'&&selected.some(i=>i.source.platform!=='windows'))throw new Error('Source OS differs; project mapping required');
  const launchFile=path.join(directory,'launch.lock');
  let launch;
  try{launch=await fs.open(launchFile,'wx');}catch{
    const old=await record(launchFile),stat=await fs.stat(launchFile).catch(()=>null);
    if(alive(old.pid)||stat&&Date.now()-stat.mtimeMs<10000)throw new Error('Launch request already running; retry shortly');
    await fs.rm(launchFile,{force:true});launch=await fs.open(launchFile,'wx');
  }
  await launch.writeFile(JSON.stringify({pid:process.pid}));
  try {
    if((await getDesktopRuntime(id)).running)throw new Error('Package controller already running');
    const global=await record(path.join(path.dirname(directory),'.ui-worker.lock'));
    if(alive(global.pid))throw new Error('Another Desktop controller is running; stop it first');
    const manifest=await fs.readFile(path.join(directory,'manifest.json'));
    const hash=(await fs.readFile(path.join(directory,'manifest.sha256'),'utf8')).trim();
    if(crypto.createHash('sha256').update(manifest).digest('hex')!==hash)throw new Error('Manifest hash mismatch');
    // Demo mode replays the delivery states with a simulator instead of driving Claude Desktop.
    const script=path.resolve(process.cwd(),'scripts','desktop-handoff',demo?'demo-runner.mjs':'dashboard-runner.mjs');await fs.access(script);
    await fs.rm(path.join(directory,'stop'),{force:true});
    await fs.writeFile(path.join(directory,'runtime.json'),JSON.stringify({status:'launching',pid:process.pid,action,itemId:itemId??null,error:null,updatedAt:new Date().toISOString()}));
    const log=await fs.open(path.join(directory,'controller.log'),'a');
    try {
      const child=spawn(process.execPath,[script,directory,hash,action,...(itemId?[itemId]:[])],{detached:true,windowsHide:true,shell:false,stdio:['ignore',log.fd,log.fd]});
      await new Promise<void>((resolve,reject)=>{child.once('spawn',()=>resolve());child.once('error',reject);});child.unref();
      const current=await record(path.join(directory,'runtime.json'));
      if(current.pid===process.pid)await fs.writeFile(path.join(directory,'runtime.json'),JSON.stringify({...current,pid:child.pid}));
      return {started:true,pid:child.pid};
    }finally{await log.close();}
  } catch(error) {
    const current=await record(path.join(directory,'runtime.json'));
    if(current.pid===process.pid&&current.status==='launching')await fs.writeFile(path.join(directory,'runtime.json'),JSON.stringify({...current,status:'error',error:(error as Error).message}));
    throw error;
  }finally{await launch.close();await fs.rm(launchFile,{force:true});}
}
