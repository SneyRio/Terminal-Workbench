import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{configuredStatusLine,renderStatusLine}=require('../electron/statusline.cjs'),{cleanEnv}=require('../electron/core.cjs');
const root=process.cwd(),testRoot=path.join(root,'.test-data','hud-native-'+Date.now()),project=path.join(testRoot,'project');await fs.mkdir(project,{recursive:true});
const rows=[];
for(const [command,dir] of [['claude-jemusbob','.claude'],['claude-tomton','.claude-tomton'],['claude-dp','.claude-dp'],['claude-zmn','.claude-zmn']]){
 const configDirectory=path.join(os.homedir(),dir),file=path.join(configDirectory,'settings.json'),before=await fs.readFile(file,'utf8'),original=await configuredStatusLine(configDirectory);expect(original?.command).toBeTruthy();
 const env=cleanEnv(process.env,configDirectory);env.PATH=[path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin',process.env.PATH].join(path.delimiter);env.COLUMNS='120';
 const input=JSON.stringify({session_id:'hud-fixture',cwd:project,workspace:{current_dir:project,project_dir:project},model:{id:'claude-opus-4-6',display_name:'HUD fixture'},context_window:{context_window_size:200000,total_input_tokens:1000,total_output_tokens:100,used_percentage:25,remaining_percentage:75},cost:{total_cost_usd:0,total_duration_ms:1000,total_api_duration_ms:1000},rate_limits:{five_hour:{used_percentage:1,resets_at:Math.floor(Date.now()/1000)+3600},seven_day:{used_percentage:25,resets_at:Math.floor(Date.now()/1000)+86400}}});
 const preview=JSON.parse(input);delete preview.rate_limits;const output=await renderStatusLine(original.command,JSON.stringify(preview),{env,cwd:project});expect(output.trim()).not.toBe('');expect(await fs.readFile(file,'utf8')).toBe(before);rows.push({command,originalHudRendered:true,hasContextLabel:/上下文|Context|context/i.test(output),settingsUnchanged:true});
}
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,ACCOUNTOR_DATA_DIR:path.join(testRoot,'data')}});
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);const invoke=(channel,...args)=>page.evaluate(({channel,args})=>window.accountor.invoke(channel,...args),{channel,args});
 const account=await invoke('account:import','claude-jemusbob'),workspace=await invoke('workspace:save',{name:'原 HUD 实测',projects:[{path:project}],backend:'embedded',accountId:account.id});
 const session=await invoke('terminal:start',{workspaceId:workspace.id,kind:'claude'});let trusted=false,verified=false;const deadline=Date.now()+60000;
 while(Date.now()<deadline){
  const {data}=await invoke('terminal:buffer',session.id),plain=data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,' ');
  if(!trusted&&/trust this folder|trust.*files|Yes, I trust|Do you trust/i.test(plain)){await invoke('terminal:input',session.id,'\x1b[B\r');trusted=true;}
  const state=await invoke('state:get'),s=state.sessions.find(s=>s.id===session.id),usageFile=path.join(testRoot,'data','telemetry',session.id+'-usage.json');
  if(s?.status==='idle'&&await fs.access(usageFile).then(()=>true).catch(()=>false)&&/上下文|Context|context/i.test(plain)&&!plain.includes('HUD 暂不可用')){verified=true;break;}
  await new Promise(r=>setTimeout(r,500));
 }
 expect(verified).toBe(true);await page.locator('.workspace-nav').click();await page.locator('.session-nav-row').getByRole('button',{name:'Claude · claude-jemusbob',exact:true}).click();await page.screenshot({path:path.join(root,'test-results','hud-native.png')});
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await invoke('terminal:stop',session.id);await expect.poll(async()=>(await invoke('state:get')).sessions.find(s=>s.id===session.id).status).toBe('exited');
 const result={passed:true,packaged:!!process.env.ACCOUNTOR_EXECUTABLE,profiles:rows,nativeCliHud:true,telemetryStillRecorded:true,modelPrompts:0};await fs.writeFile(path.join(root,'test-results','hud-native-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
