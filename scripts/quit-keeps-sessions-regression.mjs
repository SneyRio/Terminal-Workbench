// Quitting or updating the app ends the built-in terminals, but those sessions were not ended by the user: after the
// next launch they are still in the session list, marked interrupted and ready to restore, even though the CLI
// reports SessionEnd through its hooks as it exits.
import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'.test-data','quit-sessions-'+Date.now()),project=path.join(dir,'project'),data=path.join(dir,'data'),fixture=path.join(dir,'claude-fixture');
await fs.mkdir(project,{recursive:true});await fs.mkdir(data,{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
await fs.writeFile(path.join(data,'state.json'),JSON.stringify({onboarding:{completedAt:1},accounts:[],sessions:[],workspaces:[]}));
await fs.writeFile(fixture,`#!${process.execPath}
if(process.argv.includes('status')){console.log(JSON.stringify({loggedIn:true}));process.exit(0);}
// Like the real CLI, report SessionStart and, when ended by a signal, SessionEnd through the telemetry hooks.
const fs=require('node:fs'),path=require('node:path'),sid=require('node:crypto').randomUUID();
const report=event=>fs.mkdirSync(process.env.ACCOUNTOR_TELEMETRY_DIR,{recursive:true})||fs.writeFileSync(path.join(process.env.ACCOUNTOR_TELEMETRY_DIR,process.env.ACCOUNTOR_RUN_ID+'-event.json'),JSON.stringify({time:Date.now(),event,sessionId:sid,cwd:process.cwd()}));
report('SessionStart');for(const signal of ['SIGHUP','SIGTERM'])process.on(signal,()=>{report('SessionEnd');process.exit(129);});
console.log('INTERACTIVE_READY');if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();
`,{mode:0o700});
const env={...process.env,ACCOUNTOR_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env});
const checks=[];let app=await launch(),page;
try{
 page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);
 let invoke=(c,...a)=>page.evaluate(({c,a})=>window.accountor.invoke(c,...a),{c,a});
 await invoke('settings:save',{claudePath:fixture,shell:'/bin/sh'});
 const account=await invoke('account:add','退出账号'),w=await invoke('workspace:save',{name:'退出工作区',projects:[{path:project}],backend:'embedded',accountId:account.id});
 const live=await invoke('terminal:start',{workspaceId:w.id,accountId:account.id,cwd:project});
 const ended=await invoke('terminal:start',{workspaceId:w.id,accountId:account.id,cwd:project});
 await expect.poll(async()=>(await invoke('state:get')).sessions.filter(s=>['running','idle'].includes(s.status)).length,{timeout:15000}).toBe(2);
 await invoke('terminal:stop',ended.id);await expect.poll(async()=>(await invoke('state:get')).sessions.find(s=>s.id===ended.id).status,{timeout:10000}).toBe('exited');
 const done=app.waitForEvent('close');await app.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;setImmediate(()=>app.quit());});await done;
 const saved=JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8'));
 expect(saved.sessions.find(s=>s.id===live.id).status).not.toBe('exited');expect(saved.sessions.find(s=>s.id===ended.id).status).toBe('exited');
 checks.push('quitting does not record a running session as ended by the user');
 app=await launch();page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);
 invoke=(c,...a)=>page.evaluate(({c,a})=>window.accountor.invoke(c,...a),{c,a});
 const after=await invoke('state:get');expect(after.sessions.find(s=>s.id===live.id).status).toBe('interrupted');
 await expect(page.locator('[data-session-id="'+live.id+'"]')).toBeVisible();await expect(page.locator('[data-session-id="'+ended.id+'"]')).toHaveCount(0);
 checks.push('after the next launch the session is listed as interrupted, while the one the user ended stays hidden');
 const result={passed:true,checks};await fs.writeFile(path.join(root,'test-results','quit-keeps-sessions-regression.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await page?.screenshot({path:path.join(root,'test-results','quit-keeps-sessions-failure.png')}).catch(()=>{});console.error(JSON.stringify({passed:false,checks},null,2));console.error(error);process.exitCode=1;}
finally{await app.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;setImmediate(()=>app.quit());}).catch(()=>{});await app.close().catch(()=>{});}
