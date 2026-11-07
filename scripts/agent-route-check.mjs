// Starts each installed CLI with the settings WbSpace generates and records what it sends to a local server.
// Nothing leaves the machine: the server rejects every request, and each CLI runs from a throwaway home.
import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),catalog=require('../electron/agent-catalog.cjs'),{connection}=require('../electron/account-connections.cjs');
const hits=[];let label='';
const server=http.createServer((q,r)=>{q.resume();q.on('end',()=>{const auth=q.headers.authorization?'bearer':q.headers['x-api-key']?'x-api-key':q.headers['x-goog-api-key']?'x-goog-api-key':'none';hits.push({label,path:q.url.split('?')[0],auth,secret:[q.headers.authorization,q.headers['x-api-key'],q.headers['x-goog-api-key']].some(v=>v?.includes(KEY))});r.writeHead(400,{'content-type':'application/json'});r.end('{"error":{"message":"route-check","type":"invalid_request_error"}}');});});
const KEY='route-check-key';await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const work=await fs.mkdtemp(path.join(os.tmpdir(),'wbspace-route-'));
const cases=[
 ['codex-cli','responses','bearer','/v1',['codex',['exec','--skip-git-repo-check','hi']],'/v1/responses'],
 ['opencode','chat','bearer','/v1',['opencode',['run','hi']],'/v1/chat/completions'],
 ['opencode','responses','bearer','/v1',['opencode',['run','hi']],'/v1/responses'],
 ['opencode','messages','bearer','',['opencode',['run','hi']],'/v1/messages'],
 ['opencode','messages','api-key','',['opencode',['run','hi']],'/v1/messages'],
];
const results=[];
try{for(const [agentToolId,protocol,authType,suffix,[bin,args],expected] of cases){
 label=[agentToolId,protocol,authType].join('/');const home=path.join(work,label.replaceAll('/','-'));await fs.mkdir(home,{recursive:true});
 const c=connection({providerName:'route',baseUrl:base+suffix,protocol,agentToolId,authType,models:['m1'],defaultModel:'m1'});
 const launch=await catalog.prepareLaunch(agentToolId,c,KEY,path.join(home,'agent'));
 const env={PATH:process.env.PATH,HOME:home,TERM:'dumb',XDG_CONFIG_HOME:home+'/c',XDG_DATA_HOME:home+'/d',XDG_STATE_HOME:home+'/s',XDG_CACHE_HOME:home+'/k',...launch};
 await new Promise(resolve=>{const child=spawn(bin,args,{env,cwd:home,stdio:'ignore',detached:true});const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},Number(process.env.WB_ROUTE_TIMEOUT||40000));child.on('close',()=>{clearTimeout(timer);resolve();});child.on('error',()=>{clearTimeout(timer);resolve();});});
 const mine=hits.filter(h=>h.label===label);const hit=mine.find(h=>h.path===expected);
 results.push({agent:agentToolId,protocol,authType,expected,passed:!!hit&&hit.secret,sent:hit?.auth||'none',paths:[...new Set(mine.map(h=>h.path))]});
}}finally{server.close();await fs.rm(work,{recursive:true,force:true});}
const report={passed:results.every(r=>r.passed),results};await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/agent-route-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,1));process.exit(report.passed?0:1);
