import {expect} from '@playwright/test';
import {spawn} from 'node:child_process';
// Playwright's Windows process() is a cmd.exe launcher. Observe the actual GUI
// process via an OS handle, and dispose that test launcher only after normal exit.
export async function exitTestApp(instance){
 const launcher=instance.process(),pid=await instance.evaluate(()=>process.pid);
 const script="$p=[Diagnostics.Process]::GetProcessById([int]$env:WB_APP_PROCESS); $null=$p.Handle; [Console]::Out.WriteLine('WB_READY'); [Console]::Out.Flush(); $p.WaitForExit(); $code=$p.ExitCode; [Console]::Out.WriteLine('WB_EXIT:'+$code); exit $code";
 const observer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,WB_APP_PROCESS:String(pid)},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';observer.stdout.on('data',data=>{output+=data;});observer.stderr.on('data',data=>{output+=data;});
 try{
  await expect.poll(()=>output,{timeout:10000}).toContain('WB_READY');
  await instance.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;setTimeout(()=>{process.getBuiltinModule('node:inspector').close();app.quit();},50);});
  try{await expect.poll(()=>observer.exitCode,{timeout:15000}).toBe(0);}catch(error){console.error('OS exit observer: '+JSON.stringify({pid,launcher:launcher.pid,output,launcherExit:launcher.exitCode,launcherSignal:launcher.signalCode}));throw error;}
  expect(output).toContain('WB_EXIT:0');
  await expect.poll(()=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}},{timeout:10000}).toBe(false);
  if(launcher.exitCode===null&&launcher.signalCode===null)launcher.kill();
  await instance.close().catch(()=>{});
  console.log('Verified Windows GUI process exit via OS handle: '+JSON.stringify({pid,exitCode:0,launcher:launcher.pid}));
 }finally{if(observer.exitCode===null&&observer.signalCode===null)observer.kill();}
}
