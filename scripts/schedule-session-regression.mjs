// A scheduled Claude task keeps one session in its workspace: each run continues the previous conversation, the
// finished session stays open for reading, and "继续对话" resumes it interactively without losing the task link.
import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'.test-data','schedule-session-'+Date.now()),project=path.join(dir,'project'),data=path.join(dir,'data'),fixture=path.join(dir,'claude-fixture'),runs=path.join(dir,'runs.jsonl');
await fs.mkdir(project,{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
await fs.mkdir(data,{recursive:true});await fs.writeFile(path.join(data,'state.json'),JSON.stringify({onboarding:{completedAt:1},accounts:[],sessions:[],workspaces:[]}));
// Stand-in Claude: print mode answers and exits, interactive mode waits. Both report the session through the hook files.
await fs.writeFile(fixture,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),a=process.argv.slice(2);
if(a.includes('status')){console.log(JSON.stringify({loggedIn:true}));process.exit(0);}
fs.appendFileSync(${JSON.stringify(runs)},JSON.stringify({args:a,cwd:process.cwd()})+'\\n');
const dir=path.join(process.env.CLAUDE_CONFIG_DIR,'projects','fixture');fs.mkdirSync(dir,{recursive:true});
const at=a.indexOf('--resume'),resumed=at<0?null:a[at+1];
if(resumed&&!fs.existsSync(path.join(dir,resumed+'.jsonl'))){console.error('No conversation found');process.exit(3);}
const sid=resumed||crypto.randomUUID(),file=path.join(dir,sid+'.jsonl'),p=a.indexOf('-p');
fs.appendFileSync(file,JSON.stringify({type:'user',message:{role:'user',content:p>=0?a[p+1]:'interactive'}})+'\\n');
function event(name){const out=path.join(process.env.ACCOUNTOR_TELEMETRY_DIR,process.env.ACCOUNTOR_RUN_ID+'-event.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out+'.tmp',JSON.stringify({event:name,time:Date.now(),sessionId:sid,transcript:file}));fs.renameSync(out+'.tmp',out);}
event('SessionStart');
if(p>=0){const turns=fs.readFileSync(file,'utf8').trim().split('\\n').length;console.log('RUN_OUTPUT turns='+turns);setTimeout(()=>process.exit(0),400);}
else{console.log('INTERACTIVE_READY');if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();}
`,{mode:0o700});
const env={...process.env,ACCOUNTOR_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env});
const checks=[],errors=[];let page;
try{
 page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:960});
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 const invoke=(c,...a)=>page.evaluate(({c,a})=>window.accountor.invoke(c,...a),{c,a}),state=()=>invoke('state:get');
 const lines=async()=>(await fs.readFile(runs,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 const runOf=async id=>(await state()).scheduleRuns.find(r=>r.id===id);
 const pinned=async task=>(await state()).sessions.filter(s=>s.scheduleId===task);
 await invoke('settings:save',{claudePath:fixture,shell:'/bin/sh'});
 const account=await invoke('account:add','定时账号'),w=await invoke('workspace:save',{name:'定时工作区',projects:[{path:project}],backend:'embedded',accountId:account.id});
 const task=await invoke('schedules:save',{name:'巡检',prompt:'CHECK 一下',workspaceId:w.id,accountId:account.id,rule:{type:'interval',every:60}});

 let run=await invoke('schedules:run-now',task.id);await expect.poll(async()=>(await runOf(run.id))?.status,{timeout:20000}).toBe('success');
 let first=(await lines()).at(-1);expect(first.args).toContain('-p');expect(first.args).not.toContain('--resume');
 let sessions=await pinned(task.id);expect(sessions).toHaveLength(1);const firstSession=sessions[0];expect(firstSession.status).toBe('exited');expect(firstSession.claudeSessionId).toBeTruthy();
 checks.push('the first run starts a new conversation and leaves one session tied to the task');

 run=await invoke('schedules:run-now',task.id);await expect.poll(async()=>(await runOf(run.id))?.status,{timeout:20000}).toBe('success');
 const second=(await lines()).at(-1);expect(second.args.slice(second.args.indexOf('--resume'),second.args.indexOf('--resume')+2)).toEqual(['--resume',firstSession.claudeSessionId]);expect(second.args).toContain('-p');
 sessions=await pinned(task.id);expect(sessions).toHaveLength(1);expect(sessions[0].id).not.toBe(firstSession.id);expect(sessions[0].groupId).toBe(firstSession.groupId);expect(sessions[0].claudeSessionId).toBe(firstSession.claudeSessionId);
 expect((await runOf(run.id)).continued).toBe(true);expect((await state()).sessions.some(s=>s.id===firstSession.id)).toBe(false);
 checks.push('the next run resumes the same Claude conversation and replaces the previous run in the same tab');

 await page.getByRole('button',{name:'定时任务',exact:true}).click();
 await page.getByRole('button',{name:'打开任务会话'}).click();
 const header=page.locator('.pane-header').filter({hasText:'本次运行已结束'});await expect(header).toBeVisible();await expect(page.locator('.terminal-tabs')).toContainText('定时 · 巡检');
 await expect(page.locator('.terminal-frame.focused')).toContainText('RUN_OUTPUT turns=2');
 await page.screenshot({path:path.join(root,'test-results','schedule-session-finished.png')});
 checks.push('the finished run stays open in its workspace with its output, reachable from the task card');

 await header.getByRole('button',{name:'继续对话'}).click();
 await expect.poll(async()=>(await pinned(task.id))[0]?.status,{timeout:20000}).toBe('idle');
 const interactive=(await lines()).at(-1);expect(interactive.args).toContain('--resume');expect(interactive.args).toContain(firstSession.claudeSessionId);expect(interactive.args).not.toContain('-p');
 sessions=await pinned(task.id);expect(sessions).toHaveLength(1);expect(sessions[0].groupId).toBe(firstSession.groupId);
 await expect(page.locator('.terminal-frame.focused')).toContainText('INTERACTIVE_READY');
 checks.push('"继续对话" resumes the conversation interactively and the session stays tied to the task');

 run=await invoke('schedules:run-now',task.id);expect(run.status).toBe('skipped');expect(run.reason).toContain('正在使用');
 checks.push('a run while the task session is open is skipped rather than taking it over');

 await invoke('terminal:stop',sessions[0].id);await expect.poll(async()=>(await pinned(task.id))[0]?.status,{timeout:10000}).toBe('exited');
 run=await invoke('schedules:run-now',task.id);await expect.poll(async()=>(await runOf(run.id))?.status,{timeout:20000}).toBe('success');
 const third=(await lines()).at(-1);expect(third.args).toContain('--resume');expect(third.args).toContain(firstSession.claudeSessionId);
 await expect(page.locator('.terminal-frame.focused')).toContainText('RUN_OUTPUT turns=4');
 checks.push('after the user ends the conversation, the next run continues it again');
 expect(errors).toEqual([]);
 const result={passed:true,checks};await fs.writeFile(path.join(root,'test-results','schedule-session-regression.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){
 await page?.screenshot({path:path.join(root,'test-results','schedule-session-failure.png')}).catch(()=>{});
 console.error(JSON.stringify({passed:false,checks,errors},null,2));console.error(error);process.exitCode=1;
}finally{await app.close().catch(()=>{});}
