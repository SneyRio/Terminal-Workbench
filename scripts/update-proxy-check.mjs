// Sends a real update check and a real release download through a local proxy using the packaged app's network stack.
// Usage: WB_PROXY=http://127.0.0.1:7897 ACCOUNTOR_EXECUTABLE=... node scripts/update-proxy-check.mjs
import {_electron as electron} from 'playwright';import fs from 'node:fs/promises';import path from 'node:path';
const proxy=process.env.WB_PROXY,binary=process.env.ACCOUNTOR_EXECUTABLE,root=process.cwd();if(!proxy||!binary)throw new Error('WB_PROXY and ACCOUNTOR_EXECUTABLE are required');
const data=path.join(root,'.test-data','update-proxy-'+Date.now());await fs.mkdir(data,{recursive:true});await fs.writeFile(path.join(data,'state.json'),JSON.stringify({accounts:[],workspaces:[],sessions:[],onboarding:{completedAt:1},settings:{theme:'dark'}}));
const env={...process.env,ACCOUNTOR_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:binary,args:['--use-mock-keychain'],env});
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);const invoke=(c,...a)=>page.evaluate(({c,a})=>window.accountor.invoke(c,...a),{c,a});
 await invoke('updates:set-proxy',proxy);
 const check=await invoke('updates:check');
 const file=await app.evaluate(async({session})=>{const r=await session.fromPartition('wbspace-updates').fetch('https://github.com/SneyRio/Terminal-Workbench/releases/download/v1.0.0/SHA256SUMS.txt',{redirect:'follow'});const reader=r.body.getReader();let bytes=0;for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;}let blocked=false;try{await session.fromPartition('wbspace-updates').fetch('https://example.com/');}catch{blocked=true;}return {status:r.status,bytes,blocked};});
 const report={passed:['current','available'].includes(check.status)&&file.status===200&&file.bytes>0&&file.blocked,check:{status:check.status,latest:check.latest},download:file};
 await fs.writeFile(path.join(root,'test-results/update-proxy-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await fs.rm(data,{recursive:true,force:true}).catch(()=>{});}
process.exit(process.exitCode||0);
