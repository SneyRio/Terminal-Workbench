import {expect} from '@playwright/test';
// Playwright launches Windows Electron through cmd.exe. Its close() disconnects the
// Node inspector before waiting for that launcher; waiting for exit first can deadlock.
export async function exitTestApp(instance){
 const launcher=instance.process(),pid=await instance.evaluate(()=>process.pid);
 await instance.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;});
 await instance.close();
 await expect.poll(()=>launcher.exitCode,{timeout:15000}).toBe(0);
 await expect.poll(()=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}},{timeout:15000}).toBe(false);
 console.log('Verified Windows application and launcher exited normally: '+JSON.stringify({pid,launcher:launcher.pid,exitCode:launcher.exitCode}));
}
