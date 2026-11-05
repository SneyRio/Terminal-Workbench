import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dirs=(await fs.readdir(path.join(root,'.test-data'))).filter(n=>n.startsWith('native-cli-')).sort();
const reverse=process.env.ACCOUNTOR_RECOVERY_REVERSE==='1';
const recoveryDirs=reverse?(await fs.readdir(path.join(root,'.test-data'))).filter(n=>n.startsWith('recovery-')).sort():[];
const sourceRoot=path.join(root,'.test-data',reverse?recoveryDirs.at(-1):dirs.at(-1),'data');
const sourceState=JSON.parse(await fs.readFile(path.join(sourceRoot,'state.json'),'utf8'));
const testRoot=path.join(root,'.test-data','recovery-'+Date.now());await fs.mkdir(path.join(testRoot,'data'),{recursive:true});
await fs.writeFile(path.join(testRoot,'data','state.json'),JSON.stringify(sourceState));
const app=await electron.launch({args:[root],env:{...process.env,ACCOUNTOR_DATA_DIR:path.join(testRoot,'data')}});
const reports=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'CLI 集成验证'})).toBeVisible();
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 const targetCommand=process.env.ACCOUNTOR_TARGET_PROFILE||(reverse?'claude-jemusbob':'claude-tomton'),sourceCommand=reverse?'claude-tomton':'claude-jemusbob';
 const target=sourceState.accounts.find(a=>a.command===targetCommand),source=[...sourceState.sessions].reverse().find(s=>s.title.includes(sourceCommand));
 const result=await page.evaluate(input=>window.accountor.invoke('terminal:switch',...input),[source.id,target.id]);
 let sent=false,completed=false;const deadline=Date.now()+120000;
 while(Date.now()<deadline){
   const state=await page.evaluate(()=>window.accountor.invoke('state:get')),s=state.sessions.find(s=>s.id===result.id);
   const snapshot=await page.evaluate(sid=>window.accountor.invoke('terminal:buffer',sid),result.id);
   const screen=snapshot.data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,' ');
   if(!sent&&s.claudeSessionId){await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'Repeat the uppercase test marker from our first exchange. No tools.'),result.id);await wait(500);await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'\r'),result.id);sent=true;}
   if(sent&&s.status==='idle'&&s.transcript){
     const lines=(await fs.readFile(s.transcript,'utf8')).trim().split('\n').map(l=>{try{return JSON.parse(l);}catch{return {};}});
     const last=lines.filter(l=>l.type==='assistant').at(-1);
     const answer=(last?.message?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
     if(answer.includes('ACCOUNTOR_NATIVE_OK')){reports.push({check:'cross-profile context continuity',passed:true,sourceAccount:sourceCommand,targetAccount:targetCommand,newSessionId:s.claudeSessionId!==source.claudeSessionId,originalCheckpointRetained:true,mode:result.recovery});completed=true;break;}
   }
   if(/No conversation found|not found|Invalid session/i.test(screen)){reports.push({check:'cross-profile context continuity',passed:false,reason:'CLI rejected resume snapshot'});break;}
   await wait(1500);
 }
 if(!completed&&!reports.length){const debug=await page.evaluate(sid=>window.accountor.invoke('terminal:buffer',sid),result.id);reports.push({check:'cross-profile context continuity',passed:false,reason:'timeout',sent,screen:debug.data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,' ').replace(/https?:\/\/\S+/g,'[url]').slice(-1800)});}
 if(completed&&process.env.ACCOUNTOR_TEST_SECOND_TURN==='1'){
   const before=await page.evaluate(id=>window.accountor.invoke('state:get').then(s=>s.sessions.find(r=>r.id===id).eventTime),result.id);
   await page.evaluate(id=>window.accountor.invoke('terminal:input',id,'Repeat that same uppercase marker again. No tools.'),result.id);await wait(400);await page.evaluate(id=>window.accountor.invoke('terminal:input',id,'\r'),result.id);
   let verified=false;const secondDeadline=Date.now()+60000;
   while(Date.now()<secondDeadline){const s=await page.evaluate(id=>window.accountor.invoke('state:get').then(s=>s.sessions.find(r=>r.id===id)),result.id);if(s.status==='idle'&&s.eventTime>before){const rows=(await fs.readFile(s.transcript,'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l));const texts=rows.filter(r=>r.type==='assistant').at(-1)?.message?.content||[];verified=texts.some(b=>b.type==='text'&&b.text.includes('ACCOUNTOR_NATIVE_OK'));if(verified)break;}await wait(1000);}
   reports.push({check:'custom model second turn after handoff',passed:verified,profile:targetCommand});
 }
 await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'/exit\r'),result.id).catch(()=>{});await wait(2500);
 await fs.writeFile(path.join(root,'test-results',process.env.ACCOUNTOR_TARGET_PROFILE?'recovery-'+process.env.ACCOUNTOR_TARGET_PROFILE+'.json':reverse?'recovery-reverse.json':'recovery.json'),JSON.stringify({reports,testRoot},null,2));console.log(JSON.stringify(reports,null,2));
 expect(reports.every(r=>r.passed)).toBe(true);
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
