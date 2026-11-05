import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile);
const root=process.cwd();
const cwd=path.join(root,'.test-data','profile-check');await fs.mkdir(cwd,{recursive:true});
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const env={...process.env,BROWSER:'/usr/bin/open'};
for(const k of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_CONFIG_DIR$)/.test(k))delete env[k];
const entries=['claude-jemusbob','claude-tomton','claude-dp','claude-zmn'];
function category(e){const s=String(e.stderr||e.stdout||e.message);return /login|auth|credential|sign in|expired|401|403/i.test(s)?'authentication':/timeout|timed out|abort/i.test(s)?'timeout':/connect|network|ENOTFOUND|ECONN/i.test(s)?'network':/budget/i.test(s)?'budget':'cli-error';}
const results=await Promise.all(entries.map(async(command)=>{
  const start=Date.now(),file=path.join(os.homedir(),'.local/bin',command);const result={command,provider:['claude-dp','claude-zmn'].includes(command)?'custom':'subscription'};
  try{const v=await exec(file,['--version'],{cwd,env,timeout:15000,maxBuffer:65536});result.version=v.stdout.trim().slice(0,80);}catch(e){result.error=category(e);return result;}
  try{const a=await exec(file,['auth','status','--json'],{cwd,env,timeout:20000,maxBuffer:262144});const status=JSON.parse(a.stdout);result.auth={loggedIn:status.loggedIn,method:status.authMethod};}catch(e){result.auth={error:category(e)};}
  try{
    const r=await exec(file,['--safe-mode','--system-prompt','Reply with only the requested test marker.','-p','Reply with exactly ACCOUNTOR_TEST_OK. Do not use any tools.','--tools','','--max-turns','1','--max-budget-usd','0.10','--no-session-persistence','--output-format','json'],{cwd,env,timeout:180000,maxBuffer:1024*1024});
    const response=JSON.parse(r.stdout);result.responseOk=String(response.result||'').includes('ACCOUNTOR_TEST_OK');result.modelError=!!response.is_error;result.costUsd=response.total_cost_usd;result.durationMs=Date.now()-start;
  }catch(e){result.responseOk=false;result.error=category(e);result.durationMs=Date.now()-start;}
  console.log(JSON.stringify(result));return result;
}));
await fs.writeFile(path.join(root,'test-results','profiles.json'),JSON.stringify({time:new Date().toISOString(),results},null,2));
if(results.some(r=>!r.responseOk))process.exitCode=1;
