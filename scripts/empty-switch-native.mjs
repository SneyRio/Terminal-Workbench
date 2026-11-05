import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),testRoot=path.join(root,'.test-data','empty-switch-'+Date.now()),project=path.join(testRoot,'project');
await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'README.md'),'# Empty session switch fixture\n');
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,ACCOUNTOR_DATA_DIR:path.join(testRoot,'data')}});
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);
 const invoke=(channel,...args)=>page.evaluate(({channel,args})=>window.accountor.invoke(channel,...args),{channel,args});
 const a=await invoke('account:import','claude-jemusbob'),b=await invoke('account:import','claude-tomton');
 const workspace=await invoke('workspace:save',{name:'空白会话实测',projects:[{path:project}],backend:'embedded',accountId:a.id});
 const source=await invoke('terminal:start',{workspaceId:workspace.id,kind:'claude'});
 async function ready(id){
  let trusted=false;const deadline=Date.now()+45000;
  while(Date.now()<deadline){
   const state=await invoke('state:get'),s=state.sessions.find(s=>s.id===id);
   if(s.status==='idle'&&s.claudeSessionId)return s;
   const {data}=await invoke('terminal:buffer',id);const text=data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,' ');
   if(!trusted&&/trust this folder|trust.*files|Yes, I trust|Do you trust/i.test(text)){await invoke('terminal:input',id,'\x1b[B\r');trusted=true;}
   await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('CLI did not report idle SessionStart');
 }
 await ready(source.id);
 const preview=await invoke('terminal:prepare-switch',source.id,b.id);expect(preview.mode).toBe('empty');
 const target=await invoke('terminal:switch',source.id,b.id,{mode:'empty',reviewed:true,expectedEventTime:preview.eventTime});
 await ready(target.id);expect((await invoke('state:get')).sessions.some(s=>s.id===source.id)).toBe(false);expect(target.accountId).toBe(b.id);expect(target.cwd).toBe(project);expect(target.recovery).toBeUndefined();
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await invoke('terminal:stop',target.id);
 await expect.poll(async()=>(await invoke('state:get')).sessions.find(s=>s.id===target.id).status).toBe('exited');
 const result={passed:true,packaged:!!process.env.ACCOUNTOR_EXECUTABLE,source:a.command,target:b.command,mode:'empty',modelPrompts:0,checks:['real CLI idle recognized at SessionStart','empty session switches accounts before first model turn','target identity and cwd preserved','source removed after successful switch; test target exited']};
 await fs.writeFile(path.join(root,'test-results','empty-switch-native.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
