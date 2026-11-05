import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),testRoot=path.join(root,'.test-data','native-cli-'+Date.now());
const project=path.join(testRoot,'project');await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'README.md'),'# CLI integration fixture\n');
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,ACCOUNTOR_DATA_DIR:path.join(testRoot,'data')}});
const reports=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1024});
 await expect(page.getByRole('heading',{name:'你的工作空间'})).toBeVisible();
 const accounts=[];
 for(const command of ['claude-jemusbob','claude-tomton','claude-dp','claude-zmn'])accounts.push(await page.evaluate(command=>window.accountor.invoke('account:import',command),command));
 const workspace=await page.evaluate(p=>window.accountor.invoke('workspace:save',p),{name:'CLI 集成验证',projects:[{path:project}],backend:'embedded',accountId:accounts[0].id,rightOpen:true});
 for(const a of accounts.filter(a=>!process.env.ACCOUNTOR_PROFILE_FILTER||a.command===process.env.ACCOUNTOR_PROFILE_FILTER)){
   console.log('Testing',a.command);
   const session=await page.evaluate(input=>window.accountor.invoke('terminal:start',input),{workspaceId:workspace.id,kind:'claude',accountId:a.id});
   let last='',sent=false,trust=false;const deadline=Date.now()+90000;
   while(Date.now()<deadline){
     const snapshot=await page.evaluate(sid=>window.accountor.invoke('terminal:buffer',sid),session.id);last=snapshot.data;
     const clean=last.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,' ');
     if(/trust this folder|trust.*files|Yes, I trust|Do you trust/i.test(clean)&&!trust){await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'\x1b[B\r'),session.id);trust=true;await wait(1500);continue;}
     if(/Choose.*text style|choose the text style|Let.s get started/i.test(clean)&&!trust){await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'\r'),session.id);await wait(1000);continue;}
     if(!sent&&(/for shortcuts|bypass permissions|Welcome back|Claude Code v|Opus|Sonnet|context left/i.test(clean))&&!/login required|Please log in/i.test(clean)){
       await wait(1500);await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'Reply with exactly ACCOUNTOR_NATIVE_OK. Do not use tools.\r'),session.id);sent=true;
     }
     const s=await page.evaluate(sid=>window.accountor.invoke('state:get').then(state=>state.sessions.find(s=>s.id===sid)),session.id);
     if(sent&&s.status==='idle'&&s.claudeSessionId){reports.push({command:a.command,tui:true,responseMarker:clean.includes('ACCOUNTOR_NATIVE_OK'),sessionHook:true,transcript:!!s.transcript,usageCaptured:!!(await page.evaluate(id=>window.accountor.invoke('state:get').then(state=>state.accounts.find(a=>a.id===id).usage),a.id))});break;}
     await wait(1500);
   }
   if(!reports.some(r=>r.command===a.command))reports.push({command:a.command,tui:false,timeout:true,trust,sent,lastScreen: last.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,' ').replace(/https?:\/\/\S+/g,'[url]').slice(-2500)});
   console.log(JSON.stringify(reports.at(-1)));
   await fs.writeFile(path.join(root,'test-results','native-cli-progress.json'),JSON.stringify(reports,null,2));
   await page.evaluate(sid=>window.accountor.invoke('terminal:input',sid,'/exit\r'),session.id).catch(()=>{});
   await wait(1000);
 }
 await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results',process.env.ACCOUNTOR_EXECUTABLE?'native-cli-packaged.json':'native-cli.json'),JSON.stringify({reports,testRoot},null,2));
 console.log(JSON.stringify(reports.map(({lastScreen,...r})=>r),null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
