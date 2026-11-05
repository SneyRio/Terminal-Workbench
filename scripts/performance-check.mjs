import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),testRoot=path.join(root,'.test-data','performance-'+Date.now()),project=path.join(testRoot,'project'),file=path.join(project,'notes.md'),data=path.join(testRoot,'data');
await fs.mkdir(project,{recursive:true});await fs.writeFile(file,'# Performance fixture\n\n'+Array.from({length:2000},(_,i)=>'Line '+i+' '+('a measured fixture '.repeat(4))).join('\n'));
const start=performance.now();const app=await electron.launch({executablePath:process.env.ACCOUNTOR_EXECUTABLE||'/Applications/终端工作站.app/Contents/MacOS/终端工作站',args:[],env:{...process.env,ACCOUNTOR_DATA_DIR:data}});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1024});await expect(page.getByRole('heading',{name:'你的工作空间',exact:true})).toBeVisible();const startupMs=Math.round(performance.now()-start);
 const invoke=(channel,...args)=>page.evaluate(({channel,args})=>window.accountor.invoke(channel,...args),{channel,args});
 await invoke('workspace:save',{name:'性能检查',projects:[{path:project}],backend:'embedded',rightOpen:true,rightWidth:440});await page.locator('.workspace-nav').click();await page.getByRole('button',{name:'notes.md',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.cm-content').click();await page.keyboard.press('Meta+End');
 await app.evaluate(({BrowserWindow},input)=>{
  const fs=process.getBuiltinModule('node:fs/promises');globalThis.perf={stateWrites:0,fileReads:0,fileReadBytes:0,terminalEvents:0,telemetryReads:0};
  const originalRename=fs.rename,originalRead=fs.readFile;fs.rename=async(...args)=>{if(String(args[1])===input.state)globalThis.perf.stateWrites++;return originalRename(...args);};
  fs.readFile=async(...args)=>{const result=await originalRead(...args);if(String(args[0])===input.file){globalThis.perf.fileReads++;globalThis.perf.fileReadBytes+=result.length;}return result;};
  const window=BrowserWindow.getAllWindows()[0],send=window.webContents.send.bind(window.webContents);window.webContents.send=(channel,...args)=>{if(channel==='terminal:data')globalThis.perf.terminalEvents++;return send(channel,...args);};
 },{file,state:path.join(data,'state.json')});
 const typingStart=performance.now();await page.keyboard.type('x'.repeat(100));await wait(700);await invoke('state:get');const typingMs=Math.round(performance.now()-typingStart),typing=await app.evaluate(()=>({...globalThis.perf}));
 await page.getByRole('button',{name:'账号与连接',exact:true}).click();await app.evaluate(()=>{globalThis.perf.fileReads=0;globalThis.perf.fileReadBytes=0;});await wait(6500);const hidden=await app.evaluate(()=>({...globalThis.perf}));
 await page.locator('.workspace-nav').click();await wait(500);await app.evaluate(()=>{globalThis.perf.fileReads=0;globalThis.perf.fileReadBytes=0;});await wait(6500);const unchanged=await app.evaluate(()=>({...globalThis.perf}));
 await invoke('settings:save',{shell:'/bin/sh'});const workspace=(await invoke('state:get')).workspaces[0],session=await invoke('terminal:start',{workspaceId:workspace.id,kind:'shell'});await wait(300);await app.evaluate(()=>{globalThis.perf.terminalEvents=0;});
 const outputStart=performance.now();await invoke('terminal:input',session.id,"i=0; while [ $i -lt 12000 ]; do printf '%s abcdefghijklmnopqrstuvwxyz0123456789\\n' $i; i=$((i+1)); done; printf 'DONE_'; printf 'PERF\\n'\r");
 await expect.poll(()=>invoke('terminal:buffer',session.id).then(b=>b.data.includes('DONE_PERF')),{timeout:30000}).toBe(true);await wait(250);const streamMs=Math.round(performance.now()-outputStart),output=await app.evaluate(()=>({...globalThis.perf}));
 const pingStart=performance.now();await invoke('state:get');const pingMs=Math.round(performance.now()-pingStart);
 const metrics=await app.evaluate(({app})=>({version:app.getVersion(),processes:app.getAppMetrics().map(p=>({type:p.type,cpu:p.cpu.percentCPUUsage,workingSetKiB:p.memory.workingSetSize}))}));
 const report={version:metrics.version,startupMs,typingCharacters:100,typingStateWrites:typing.stateWrites,typingMs,hiddenPanelFullReads:hidden.fileReads,hiddenPanelReadBytes:hidden.fileReadBytes,unchangedVisibleFullReads:unchanged.fileReads,unchangedVisibleReadBytes:unchanged.fileReadBytes,terminalLines:12000,terminalEvents:output.terminalEvents,streamMs,statePingMs:pingMs,processes:metrics.processes,scope:'isolated fixture; counts and wall time from one run; not a sustained CPU or memory benchmark'};
 await fs.writeFile(path.join(root,'test-results',process.env.ACCOUNTOR_PERF_REPORT||('performance-'+metrics.version+'.json')),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
