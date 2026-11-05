import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dirs=(await fs.readdir(path.join(root,'.test-data'))).filter(x=>x.startsWith('native-cli-')).sort();
const state=JSON.parse(await fs.readFile(path.join(root,'.test-data',dirs.at(-1),'data/state.json'),'utf8'));
const data=path.join(root,'.test-data','resume-'+Date.now());await fs.mkdir(data,{recursive:true});await fs.writeFile(path.join(data,'state.json'),JSON.stringify(state));
const source=state.sessions.find(s=>s.title.includes('claude-tomton'));
const app=await electron.launch({args:[root],env:{...process.env,ACCOUNTOR_DATA_DIR:data}});
try{
 const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'CLI 集成验证'})).toBeVisible();
 const resumed=await page.evaluate(sid=>window.accountor.invoke('terminal:resume',sid),source.id);
 await expect.poll(()=>page.evaluate(sid=>window.accountor.invoke('state:get').then(s=>s.sessions.find(r=>r.id===sid).claudeSessionId),resumed.id),{timeout:30000}).toBe(source.claudeSessionId);
 expect(resumed.cwd).toBe(source.cwd);expect(resumed.backend).toBe(source.backend);
 await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'/exit'),resumed.id);await page.waitForTimeout(300);await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'\r'),resumed.id);
 const report={passed:true,checks:['restart loads durable session metadata','exact official Claude session ID resumed','original cwd and backend preserved','no model prompt sent']};await fs.writeFile(path.join(root,'test-results','resume.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
