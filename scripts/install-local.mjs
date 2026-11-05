import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const {retireLegacy}=createRequire(import.meta.url)('../electron/app-migration.cjs');
const root=process.cwd(),source=path.join(root,'release/builds.noindex/终端工作站-darwin-arm64/终端工作站.app');
const destination='/Applications/终端工作站.app';
const stage='/Applications/.Terminal-Workbench-update-'+crypto.randomUUID()+'.app';
const backup=path.join(root,'release','backups.noindex','Terminal Workbench-before-'+Date.now()+'.app');
await promisify(execFile)('/usr/bin/ditto',[source,stage]);
let files=0;
async function verify(from,to){
 for(const entry of await fs.readdir(from,{withFileTypes:true})){
  const a=path.join(from,entry.name),b=path.join(to,entry.name);
  if(entry.isSymbolicLink()){if(await fs.readlink(a)!==await fs.readlink(b))throw new Error('Symlink mismatch: '+b);}
  else if(entry.isDirectory())await verify(a,b);
  else {const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');if(hash(await fs.readFile(a))!==hash(await fs.readFile(b)))throw new Error('File mismatch: '+b);files++;}
 }
}
await verify(source,stage);
await fs.mkdir(path.dirname(backup),{recursive:true});
let moved=false;
try{
 try{await fs.rename(destination,backup);moved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.rename(stage,destination);
}catch(e){if(moved)await fs.rename(backup,destination);throw e;}
const legacy=await retireLegacy('/Applications/Claude Accountor.app',path.join(root,'release/backups.noindex','Claude Accountor-before-rebrand-'+Date.now()+'.app')).catch(e=>({deferred:true,reason:e.message}));
console.log(JSON.stringify({legacy,installed:destination,verifiedFiles:files,backup:moved?backup:null,runningSessions:'untouched'}));
