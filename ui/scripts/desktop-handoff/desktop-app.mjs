import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export async function discoverClaude(root=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'AnthropicClaude')) {
  const resolved=await fs.realpath(root).catch(()=>{throw new Error('Claude Desktop installation not found');});
  const versions=(await fs.readdir(resolved,{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&/^app-\d+(\.\d+)+$/.test(e.name)).map(e=>e.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  for(const candidate of [...versions.map(v=>path.join(resolved,v,'claude.exe')),path.join(resolved,'claude.exe')]) {
    try {const real=await fs.realpath(candidate);if(!path.relative(resolved,real).startsWith('..')&&(await fs.stat(real)).isFile())return real;}catch{/* Try other installed versions. */}
  }
  throw new Error('Claude Desktop executable not found');
}
async function visibleWindows() {
  const code="@(Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { try { $_.MainWindowHandle -ne 0 -and $_.MainModule.FileName -like '*\\AnthropicClaude\\*' } catch { $false } } | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress";
  const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',code],{windowsHide:true,timeout:10000});
  const value=stdout.trim()?JSON.parse(stdout):[];return Array.isArray(value)?value:[value];
}
export async function ensureClaudeDesktop() {
  if(process.platform!=='win32')throw new Error('Windows Claude Desktop dispatch only; macOS adapter is not verified');
  const executable=await discoverClaude();
  const before=await visibleWindows();
  if(before.length>1)throw new Error('Expected one Claude Desktop window');
  if(!before.length) {
    const child=spawn(executable,[],{detached:true,shell:false,windowsHide:false,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    for(let i=0;i<25;i++) {
      const windows=await visibleWindows();
      if(windows.length===1)return executable;
      if(windows.length>1)throw new Error('Expected one Claude Desktop window');
      await new Promise(r=>setTimeout(r,1000));
    }
    throw new Error('Claude started but no usable Desktop window appeared; open Claude manually and retry');
  }
  return executable;
}
