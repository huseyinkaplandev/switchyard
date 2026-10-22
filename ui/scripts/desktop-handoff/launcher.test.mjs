import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireLock } from './locks.mjs';
import { discoverClaude } from './desktop-app.mjs';
test('Global UI lock excludes another worker and recovers a stale owner',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-lock-')),file=path.join(root,'worker.lock');let release;
  try{
    release=await acquireLock(file);await assert.rejects(acquireLock(file),/already running/);await release();release=null;
    await fs.writeFile(file,JSON.stringify({pid:99999999}));release=await acquireLock(file);
    assert.equal(JSON.parse(await fs.readFile(file)).pid,process.pid);
  }finally{if(release)await release();await fs.rm(root,{recursive:true,force:true});}
});
test('Discovery chooses newest installed version, then falls back to launcher; missing install fails',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-app-'));
  try {
    for(const version of ['app-2.9.0','app-2.10.0']){await fs.mkdir(path.join(root,version));await fs.writeFile(path.join(root,version,'claude.exe'),'fixture');}
    await fs.writeFile(path.join(root,'claude.exe'),'fixture');
    assert.equal(await discoverClaude(root),path.join(await fs.realpath(root),'app-2.10.0','claude.exe'));
    await fs.rm(path.join(root,'app-2.10.0','claude.exe'));await fs.rm(path.join(root,'app-2.9.0','claude.exe'));
    assert.equal(await discoverClaude(root),path.join(await fs.realpath(root),'claude.exe'));
    await assert.rejects(discoverClaude(path.join(root,'absent')),/not found/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
