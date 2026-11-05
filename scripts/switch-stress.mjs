import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),dirs=(await fs.readdir(path.join(root,'.test-data'))).filter(x=>x.startsWith('native-cli-')).sort();
const original=JSON.parse(await fs.readFile(path.join(root,'.test-data',dirs.at(-1),'data/state.json'),'utf8'));
const data=path.join(root,'.test-data','stress-'+Date.now());await fs.mkdir(data,{recursive:true});await fs.writeFile(path.join(data,'state.json'),JSON.stringify(original));
let source=original.sessions.find(s=>s.title.includes('claude-jemusbob'));const originalPath=source.transcript,originalHash=createHash('sha256').update(await fs.readFile(originalPath)).digest('hex');
const a=original.accounts.find(a=>a.command==='claude-jemusbob'),b=original.accounts.find(a=>a.command==='claude-tomton');
const app=await electron.launch({args:[root],env:{...process.env,ACCOUNTOR_DATA_DIR:data}}),checks=[];
try{
 const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'CLI 集成验证'})).toBeVisible();
 for(let i=0;i<20;i++){
   const target=i%2===0?b:a,started=Date.now();
   const next=await page.evaluate(p=>window.accountor.invoke('terminal:switch',p.sid,p.target,{reviewed:true}),{sid:source.id,target:target.id});
   await expect.poll(()=>page.evaluate(sid=>window.accountor.invoke('state:get').then(s=>s.sessions.find(r=>r.id===sid).claudeSessionId),next.id),{timeout:30000}).toBeTruthy();
   const current=await page.evaluate(sid=>window.accountor.invoke('state:get').then(s=>s.sessions.find(r=>r.id===sid)),next.id);
   expect(current.authVerified).toBe(true);expect(current.cwd).toBe(source.cwd);
   checks.push({iteration:i+1,target:target.command,authVerified:current.authVerified,cwdPreserved:true,elapsedMs:Date.now()-started});
   await page.waitForTimeout(1200);await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'/exit'),next.id);await page.waitForTimeout(300);await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'\r'),next.id);
   await expect.poll(()=>page.evaluate(sid=>window.accountor.invoke('state:get').then(s=>s.sessions.find(r=>r.id===sid).status),next.id),{timeout:20000}).toBe('exited');
   source=current;console.log('Switch',i+1,'/20 passed.');
 }
 const afterHash=createHash('sha256').update(await fs.readFile(originalPath)).digest('hex');expect(afterHash).toBe(originalHash);
 const timings=checks.map(c=>c.elapsedMs).sort((a,b)=>a-b);const report={passed:true,switches:20,originalUnchanged:true,checks,medianMs:timings[10],p95Ms:timings[18],scope:'两订阅入口、空闲/已退出源进程、启动至 SessionStart，不含模型响应时间'};
 await fs.writeFile(path.join(root,'test-results','switch-stress.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,switches:20,originalUnchanged:true,medianMs:report.medianMs,p95Ms:report.p95Ms}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
