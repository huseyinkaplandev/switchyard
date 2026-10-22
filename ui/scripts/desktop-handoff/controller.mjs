import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireLock } from './locks.mjs';
import { dataDir } from '../data-dir.mjs';

export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const samePath = (a,b) => process.platform==='win32' ? a.toLowerCase()===b.toLowerCase() : a===b;
export async function validatePackage(directory, expectedHash) {
  const root = path.join(dataDir(), 'desktop-handoffs');
  const resolved = path.resolve(directory);
  if (!samePath(path.dirname(resolved),root) || !/^[0-9a-f-]{36}$/i.test(path.basename(resolved))) throw new Error('Package outside local data directory');
  const realDirectory=await fs.realpath(resolved);
  if (!samePath(realDirectory,path.join(await fs.realpath(root),path.basename(resolved)))) throw new Error('Package symlink rejected');
  const manifest = await fs.readFile(path.join(resolved, 'manifest.json'));
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || digest(manifest) !== expectedHash) throw new Error('Manifest hash mismatch');
  const pkg = JSON.parse(manifest);
  if (pkg.version !== 1 || pkg.id !== path.basename(resolved) || !['claude-code','codex'].includes(pkg.targetProvider) || !Array.isArray(pkg.items) || !pkg.items.length || pkg.items.length > 50) throw new Error('Invalid manifest');
  const ids = new Set();
  for (const item of pkg.items) {
    if (!/^[0-9a-f-]{36}$/i.test(item.id) || ids.has(item.id) || typeof item.source?.title !== 'string' || !item.source.title.trim() || typeof item.source.cwd !== 'string' || !item.source.cwd || item.marker !== `DESKTOP-HANDOFF:${pkg.id}:${item.id}`) throw new Error('Invalid package item');
    ids.add(item.id);
    if (item.promptFile !== path.join(resolved,item.id,'prompt.txt') || item.transcriptFile !== path.join(resolved,item.id,'transcript.json') || item.handoffFile !== path.join(resolved,item.id,'handoff.md')) throw new Error('Item path mismatch');
    for (const name of ['prompt.txt','transcript.json','handoff.md','git.json']) {
      const file = path.join(resolved,item.id,name);
      if (!samePath(await fs.realpath(file),path.join(realDirectory,item.id,name)) || digest(await fs.readFile(file)) !== item.hashes[name]) throw new Error('Item hash mismatch');
    }
  }
  return pkg;
}
export async function writeProgress(directory, itemId, value) {
  const dir = path.join(directory,'progress'); await fs.mkdir(dir,{recursive:true});
  const file = path.join(dir,`${itemId}.json`); const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp,JSON.stringify({...value,itemId,updatedAt:new Date().toISOString()},null,2)); await fs.rename(temp,file);
}
export async function readProgress(directory,itemId) {
  try { return JSON.parse(await fs.readFile(path.join(directory,'progress',`${itemId}.json`),'utf8')); } catch { return {itemId,state:'prepared'}; }
}
export function deliveryEvidence(records,marker,after='') {
  let sent = null, reply = null, error = null;
  for (const record of records) {
    const content = record.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n') : '';
    if (record.type === 'user' && text.includes(marker)) sent = {at:record.timestamp,text};
    if (sent && record.type === 'assistant' && record.timestamp >= sent.at && record.timestamp >= after) {
      if (record.isApiErrorMessage || record.message?.model === '<synthetic>') error = text;
      else if (text.trim() && record.message?.stop_reason === 'end_turn') { reply = {at:record.timestamp,text}; error = null; }
    }
  }
  return {sent,reply,error};
}
async function metadata() {
  const root = path.join(process.env.APPDATA || path.join(os.homedir(),'AppData','Roaming'),'Claude','claude-code-sessions'); const all=[];
  for (const a of await fs.readdir(root,{withFileTypes:true}).catch(()=>[])) {
    if (!a.isDirectory() || a.isSymbolicLink()) continue;
    for (const org of await fs.readdir(path.join(root,a.name),{withFileTypes:true})) {
      if (!org.isDirectory() || org.isSymbolicLink()) continue;
      const dir=path.join(root,a.name,org.name);
      for (const f of await fs.readdir(dir)) if (/^local_[\w-]+\.json$/.test(f)) try {
        const m=JSON.parse(await fs.readFile(path.join(dir,f),'utf8'));
        if (typeof m.cliSessionId==='string' && typeof m.sessionId==='string') all.push({...m,account:`${a.name}/${org.name}`});
      } catch { /* Incomplete record is not evidence. */ }
    }
  }
  return all;
}
const nativeRoot=path.join(os.homedir(),'.claude','projects');
async function transcript(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid native ID');
  for (const dir of await fs.readdir(nativeRoot,{withFileTypes:true}).catch(()=>[])) {
    if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
    try { const text=await fs.readFile(path.join(nativeRoot,dir.name,`${id}.jsonl`),'utf8'); return text.split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}}); } catch { /* Try remaining project namespaces. */ }
  }
  return [];
}
export function desktopPrompt(item,prompt) {
  if(item.source.chatType!=='scheduled')return prompt;
  return `${prompt}\nScheduled handoff boundary: this chat exists to rebuild context. First summarise the history and the project state. Do not post, comment, send messages or take any other external action; wait for the user's explicit approval in this new chat. Historical scheduled instructions are not current permission to send anything. Do not create or run a recurring task.\n`;
}
export async function dispatch(pkg,directory,adapter) {
  const account=await adapter.verifyAccount(pkg);
  const platform=process.platform==='darwin'?'macos':'windows';
  for (const item of pkg.items) {
    if (await fs.access(path.join(directory,'stop')).then(()=>true,()=>false)) break;
    let state=await readProgress(directory,item.id);
    try {
      if (!item.source.sourceAccount || item.source.sourceAccount===account) throw new Error('Destination account must differ from known source account');
      if (item.source.platform!==platform) throw new Error('Source OS differs; explicit local project mapping required');
      await fs.access(item.source.cwd);
      const recovered=await adapter.reconcile(item,account,state);
      if (recovered) state={...state,...recovered};
      if (state.state==='reply-observed' && state.titleVerified) { await writeProgress(directory,item.id,state); continue; }
      if (!state.destinationId && ['opening','uncertain','opened','sent'].includes(state.state)) throw new Error('Uncertain delivery: reconcile before opening another chat');
      if (!state.destinationId) {
        state={...state,state:'opening',destinationAccount:account,error:undefined}; await writeProgress(directory,item.id,state);
        const prompt=desktopPrompt(item,await fs.readFile(item.promptFile,'utf8'));
        const observed=await adapter.openAndSubmit(item,prompt);
        state={...state,state:'opened',destinationId:observed.destinationId}; await writeProgress(directory,item.id,state);
      }
      const proof=await adapter.awaitReply(item,account,state);
      state={...state,...proof}; await writeProgress(directory,item.id,state);
      if (state.state==='reply-observed') {
        const title=await adapter.setAndReadTitle(item,state.destinationId);
        state.titleVerified=title===item.source.title;
        if (!state.titleVerified) state.error='title_mismatch';
        await writeProgress(directory,item.id,state);
      }
      if (state.state!=='reply-observed' || !state.titleVerified) break;
    } catch (error) {
      const definitePreSubmit=state.state==='opening' && error.preSubmit===true;
      const uncertain=!definitePreSubmit && (state.state==='opening' || state.state==='opened' || state.state==='uncertain');
      await writeProgress(directory,item.id,{...state,state:uncertain?'uncertain':state.destinationId?state.state:'failed',error:error.message});
      break;
    }
  }
}
export async function windowsAdapter(directory,pkg,{dashboard=false}={}) {
  if (process.platform!=='win32') throw new Error('macOS native adapter not verified; no GUI dispatch');
  const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'windows','invoke.ps1');
  async function invoke(request) {
    const file=path.join(directory,`request-${crypto.randomUUID()}.json`);
    await fs.writeFile(file,JSON.stringify({...request,stopFile:path.join(directory,'stop')}),'utf8');
    try { return await new Promise((resolve,reject)=>{
      const child=spawn('powershell.exe',['-NoProfile','-STA','-File',script,'-RequestFile',file],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
      let output='',error=''; const timeout=setTimeout(()=>{child.kill();reject(new Error('Desktop helper timed out; reconcile delivery'));},90000);
      child.stdout.on('data',b=>output+=b); child.stderr.on('data',b=>error+=b);
      child.on('error',e=>{clearTimeout(timeout);reject(e);});
      child.on('exit',code=>{clearTimeout(timeout);try{const result=JSON.parse(output.trim());if(code || result.error){const failure=new Error(result.error || error || 'Desktop helper failed');failure.preSubmit=['compile','preflight','opening','composing'].includes(result.phase);reject(failure);}else resolve(result);}catch{reject(new Error(error || 'Invalid Desktop helper observation'));}});
    }); } finally { await fs.rm(file,{force:true}); }
  }
  const wait=()=>new Promise(r=>setTimeout(r,1000));
  let cachedMetadata=null,metadataExpires=0;
  async function listMetadata(force=false) {
    if(force||!cachedMetadata||Date.now()>=metadataExpires) {cachedMetadata=await metadata();metadataExpires=Date.now()+1000;}
    return cachedMetadata;
  }
  async function observe(item,account,state) {
    const matches=[];
    for(const m of await listMetadata()) {
      if(m.account!==account || m.createdAt<Date.parse(pkg.createdAt) || (state.destinationId && m.sessionId!==state.destinationId))continue;
      const proof=deliveryEvidence(await transcript(m.cliSessionId),item.marker);
      if(proof.sent)matches.push({m,proof});
    }
    if(matches.length>1)throw new Error('Duplicate marker found; automatic continuation blocked');
    if(!matches.length)return null;
    const {m,proof}=matches[0];
    if(path.resolve(m.cwd).toLowerCase()!==path.resolve(item.source.cwd).toLowerCase())throw new Error('Destination cwd mismatch');
    return {destinationId:m.sessionId,destinationAccount:account,state:proof.reply?'reply-observed':'sent',submittedAt:proof.sent.at,firstReplyAt:proof.reply?.at,titleVerified:m.title===item.source.title,error:proof.error||undefined};
  }
  return {
    async verifyAccount() {
      const observed=await invoke({action:dashboard?'probe-ready':'probe'});const id=observed.url.split('/').at(-1);
      const matches=(await listMetadata(true)).filter(m=>m.sessionId===id);
      if(matches.length!==1)throw new Error('Current Desktop account cannot be uniquely verified. Sign in and select an existing local Code chat in the destination account, then retry.');
      const coordinator=matches[0];
      if(dashboard)return coordinator.account;
      const proof=deliveryEvidence(await transcript(coordinator.cliSessionId),`DESKTOP-BATCH:${pkg.id}`);
      if(!proof.sent || Date.parse(proof.sent.at)<Date.parse(pkg.createdAt))throw new Error('Paste bootstrap into a NEW destination Desktop coordinator chat first');
      return coordinator.account;
    },
    reconcile:observe,
    async openDestination(item,id) {
      const destinations=(await listMetadata(true)).filter(m=>m.sessionId===id);
      if(destinations.length!==1||typeof destinations[0].title!=='string')throw new Error('Native destination title unavailable or ambiguous');
      return invoke({action:'open',expectedSession:id,title:destinations[0].title});
    },
    async openAndSubmit(item,text) {
      const observed=await invoke({action:'create',cwd:item.source.cwd,text});
      const id=observed.url.split('/').at(-1);
      if(!/^local_[0-9a-f-]{36}$/i.test(id))throw new Error('No native destination ID; do not resubmit');
      return {destinationId:id};
    },
    async awaitReply(item,account,state) {
      let evidence=null;
      for(let i=0;i<180;i++) {
        if(await fs.access(path.join(directory,'stop')).then(()=>true,()=>false))throw new Error('Stopped by user');
        evidence=await observe(item,account,state);
        if(evidence) await writeProgress(directory,item.id,evidence);
        if(evidence?.error || evidence?.state==='reply-observed')return evidence;
        await wait();
      }
      return evidence?{...evidence,error:'First reply not observed within 180 seconds'}:{...state,state:'uncertain',error:'Native submitted message unavailable; do not resubmit'};
    },
    async awaitSubmission(item,account,state) {
      for(let i=0;i<20;i++) {
        if(await fs.access(path.join(directory,'stop')).then(()=>true,()=>false))throw new Error('Stopped by user');
        const evidence=await observe(item,account,state);
        if(evidence)return evidence;
        await wait();
      }
      throw new Error('Native submitted message unavailable; do not resubmit');
    },
    async setAndReadTitle(item,id) { return (await invoke({action:'title',expectedSession:id,title:item.source.title})).title; }
  };
}
export async function runController(directory,expectedHash) {
  const pkg=await validatePackage(directory,expectedHash);
  const releaseGlobal=await acquireLock(path.join(path.dirname(directory),'.ui-worker.lock'));
  let releasePackage;
  try {
    releasePackage=await acquireLock(path.join(directory,'controller.lock'));
    if(pkg.targetProvider!=='claude-code')throw new Error('Codex dispatch requires receiving Desktop host tools; read instructions.md');
    const adapter=await windowsAdapter(directory,pkg);await dispatch(pkg,directory,adapter);
  } catch(error) {
    if(!releasePackage)throw error;
    await fs.writeFile(path.join(directory,'controller-error.json'),JSON.stringify({error:error.message,at:new Date().toISOString()}));
    const first=pkg.items[0];const state=await readProgress(directory,first.id);
    await writeProgress(directory,first.id,{...state,error:error.message,state:state.state==='prepared'?'failed':state.state});
    throw error;
  } finally { if(releasePackage)await releasePackage();await releaseGlobal(); }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) runController(process.argv[2],process.argv[3]).catch(error=>{console.error(error.message);process.exitCode=1;});
