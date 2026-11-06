import {expect} from '@playwright/test';
// Windows launch uses cmd.exe. Detach the test-only Node inspector before normal
// quit, so the debugger cannot hold the Electron process open during shutdown.
export async function exitTestApp(instance){
 const launcher=instance.process(),pid=await instance.evaluate(()=>process.pid);
 await instance.evaluate(({app,dialog})=>{
  dialog.showMessageBoxSync=()=>1;
  setTimeout(()=>{process.getBuiltinModule('node:inspector').close();app.quit();},50);
 });
 await expect.poll(()=>launcher.exitCode,{timeout:15000}).toBe(0);
 await expect.poll(()=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}},{timeout:15000}).toBe(false);
 await instance.close().catch(()=>{});
 console.log('Verified Windows application and launcher exited normally: '+JSON.stringify({pid,launcher:launcher.pid,exitCode:launcher.exitCode}));
}
