import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyDesktop, readClaudeDesktopMetadata } from '../../app/_lib/desktopHandoff/claudeMetadata.ts';
test('Native account namespaces, full titles and worktrees survive joining',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-metadata-'));
  try{
    for(const account of ['old','new']){
      const dir=path.join(root,account,'org');await fs.mkdir(dir,{recursive:true});
      await fs.writeFile(path.join(dir,'local_1.json'),JSON.stringify({sessionId:'local_1',cliSessionId:'native-a',title:'Café menu — API / payments 🚀',cwd:'C:\\worktree',originCwd:'C:\\project',scheduledTaskId:account==='old'?'task-1':null}));
    }
    const {map}=await readClaudeDesktopMetadata(root,'windows');
    assert.equal(map.get('native-a').length,2);assert.equal(map.get('native-a')[0].cwd,'C:\\worktree');
    assert.equal(map.get('native-a')[0].title,'Café menu — API / payments 🚀');
    assert.equal(classifyDesktop(null),'unknown');
    assert.deepEqual(new Set(map.get('native-a').map(classifyDesktop)),new Set(['normal','scheduled']));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
