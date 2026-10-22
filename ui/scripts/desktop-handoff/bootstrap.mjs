import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validatePackage } from './controller.mjs';
const directory=path.resolve(process.argv[2]||'');
const hash=process.argv[3]||'';
try {
  const pkg=await validatePackage(directory,hash);
  if(pkg.targetProvider!=='claude-code')throw new Error('Use receiving Codex Desktop host tools from instructions.md');
  const log=await fs.open(path.join(directory,'controller.log'),'a');
  const child=spawn(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'controller.mjs'),directory,hash],{detached:true,windowsHide:true,shell:false,stdio:['ignore',log.fd,log.fd]});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref();await log.close();
  console.log(JSON.stringify({packageId:pkg.id,controllerPid:child.pid,state:'controller-started',message:'Desktop delivery must be verified in package progress; this is not completion.'}));
} catch(error) { console.error(error.message);process.exitCode=1; }
