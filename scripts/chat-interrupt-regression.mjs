// Interrupting a chat turn with Esc, with the focus outside the message box: the turn ends and the session goes back
// to idle, even though the UserPromptSubmit hook reports after the interrupted turn has already ended (an interrupted
// turn fires no Stop hook, so that late report used to leave the session working for good).
// Then "send now" while working: the message is queued, the running turn interrupted, and the CLI starts the next turn
// with it on its own; the view shows that turn as working until it ends.
import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'.test-data','chat-interrupt-'+Date.now()),project=path.join(dir,'project'),data=path.join(dir,'data'),fixture=path.join(dir,'claude-fixture');
await fs.mkdir(project,{recursive:true});await fs.mkdir(data,{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
await fs.writeFile(path.join(data,'state.json'),JSON.stringify({onboarding:{completedAt:1},accounts:[],sessions:[],workspaces:[]}));
// A stream-json CLI that, like the real one, queues messages sent while a turn runs and starts the next turn with them
// after an interrupt. Messages starting with 一直 run until interrupted, those starting with 慢 take three seconds, others one. It reports
// UserPromptSubmit through the telemetry hook a second after the message, as a slow hook would.
await fs.writeFile(fixture,`#!${process.execPath}
if(process.argv.includes('status')){console.log(JSON.stringify({loggedIn:true}));process.exit(0);}
const fs=require('node:fs'),path=require('node:path'),sid=require('node:crypto').randomUUID();
const report=event=>{fs.mkdirSync(process.env.ACCOUNTOR_TELEMETRY_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.ACCOUNTOR_TELEMETRY_DIR,process.env.ACCOUNTOR_RUN_ID+'-event.json'),JSON.stringify({time:Date.now(),event,sessionId:sid,cwd:process.cwd()}));};
const out=e=>process.stdout.write(JSON.stringify(e)+'\\n');
report('SessionStart');
let buffer='';
process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())handle(JSON.parse(line));}});
process.stdin.on('end',()=>process.exit(0));
function handle(m){
  if(m.type==='control_request'&&m.request.subtype==='initialize')return out({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{commands:[]}}});
  if(m.type==='control_request'&&m.request.subtype==='interrupt'){
    out({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{still_queued:[]}}});
    if(!running)return;
    clearTimeout(running);running=null;fs.appendFileSync(process.env.ACCOUNTOR_TELEMETRY_DIR+'/interrupts.log','x');
    out({type:'result',subtype:'error_during_execution',is_error:true,session_id:sid});
    if(queue.length)start(queue.shift());
    return;
  }
  if(m.type==='control_request')return out({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{}}});
  if(m.type==='user'){if(running)queue.push(m);else start(m);}
}
let running=null;const queue=[];
function start(m){
  const text=m.message.content;
  out({type:'system',subtype:'init',session_id:sid});setTimeout(()=>report('UserPromptSubmit'),1000);
  out({type:'user',message:m.message,parent_tool_use_id:null,session_id:sid});
  running=text.startsWith('一直')?setInterval(()=>{},1000):setTimeout(()=>{running=null;out({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'收到：'+text}]},parent_tool_use_id:null,session_id:sid});out({type:'result',subtype:'success',result:'ok',session_id:sid});if(queue.length)start(queue.shift());},text.startsWith('慢')?3000:1000);
}
`,{mode:0o700});
const env={...process.env,ACCOUNTOR_DATA_DIR:data,ACCOUNTOR_CLAUDE_VIEW:'chat'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env});
const checks=[];let page;
try{
  page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);
  const invoke=(c,...a)=>page.evaluate(({c,a})=>window.accountor.invoke(c,...a),{c,a});
  await invoke('settings:save',{claudePath:fixture,shell:'/bin/sh'});
  const account=await invoke('account:add','打断账号'),w=await invoke('workspace:save',{name:'打断工作区',projects:[{path:project}],backend:'embedded',accountId:account.id,rightOpen:false});
  await invoke('workspace:select',w.id);
  await page.getByRole('button',{name:/新建 .* 会话/}).click();
  await expect(page.locator('.chat-pane')).toBeVisible({timeout:30000});
  const session=(await invoke('state:get')).sessions.at(-1);expect(session.view).toBe('chat');
  const status=async()=>(await invoke('state:get')).sessions.find(r=>r.id===session.id).status;
  await expect.poll(status,{timeout:15000}).toBe('idle');
  const composer=page.locator('.chat-composer textarea');
  await composer.fill('一直做下去');await composer.press('Enter');
  await expect(page.locator('.chat-stop')).toBeVisible();
  // Focus outside the message box, then Esc.
  await page.locator('.chat-scroll').click();await expect(composer).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.chat-stop')).toBeHidden({timeout:5000});
  checks.push('Esc outside the message box interrupts the turn');
  // The hook report arrives a second later and the telemetry poll runs every two seconds.
  await new Promise(resolve=>setTimeout(resolve,4500));
  expect(await status()).toBe('idle');await expect(page.locator('.chat-stop')).toBeHidden();await expect(page.locator('.chat-working')).toHaveCount(0);
  checks.push('a late UserPromptSubmit hook report does not put the interrupted session back to working');
  await composer.fill('一直做下去');await composer.press('Enter');
  await expect(page.locator('.chat-stop')).toBeVisible();
  await composer.fill('插队消息');
  await expect(page.locator('.chat-send-now')).toBeVisible();
  await composer.press(process.platform==='darwin'?'Meta+Enter':'Control+Enter');
  await expect(composer).toHaveValue('');
  await expect(page.locator('.chat-assistant').filter({hasText:'收到：插队消息'})).toBeVisible({timeout:5000});
  expect(await fs.readFile(path.join(data,'telemetry','interrupts.log'),'utf8').catch(()=>'')).toBe('xx');
  checks.push('send now interrupts the running turn and the message is answered right away');
  await expect(page.locator('.chat-stop')).toBeHidden({timeout:5000});await expect.poll(status,{timeout:5000}).toBe('idle');
  // Queued with Enter while working: no interrupt, and the turn the CLI starts with it afterwards shows as working.
  await composer.fill('一直做下去');await composer.press('Enter');await expect(page.locator('.chat-stop')).toBeVisible();
  await composer.fill('慢排队消息');await composer.press('Enter');await expect(composer).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect.poll(async()=>(await fs.readFile(path.join(data,'telemetry','interrupts.log'),'utf8')).length).toBe(3);
  await new Promise(resolve=>setTimeout(resolve,800));
  expect(await status()).toBe('busy');await expect(page.locator('.chat-stop')).toBeVisible();
  checks.push('the turn the CLI starts on its own with the queued message shows as working');
  await expect(page.locator('.chat-assistant').filter({hasText:'收到：慢排队消息'})).toBeVisible({timeout:6000});
  checks.push('a message queued with Enter runs after the interrupted turn');
  const fresh=await fs.readFile(path.join(data,'telemetry','interrupts.log'),'utf8');expect(fresh).toBe('xxx');
  await expect.poll(status,{timeout:5000}).toBe('idle');
  const result={passed:true,checks};await fs.writeFile(path.join(root,'test-results','chat-interrupt-regression.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await page?.screenshot({path:path.join(root,'test-results','chat-interrupt-failure.png')}).catch(()=>{});console.error(JSON.stringify({passed:false,checks},null,2));console.error(error);process.exitCode=1;}
finally{await app.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;setImmediate(()=>app.quit());}).catch(()=>{});await app.close().catch(()=>{});}
