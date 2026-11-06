import {expect} from '@playwright/test';
// A Windows descendant may retain the Playwright launch pipes after the main process exits.
// Verify the actual app's exit first, then release test-owned transport streams.
export async function exitTestApp(instance){
 const child=instance.process();
 const remotePid=await instance.evaluate(()=>process.pid);expect(remotePid).toBe(child.pid);
 const quit=instance.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;app.quit();}).catch(error=>console.log('Quit transport closed: '+error.message));
 await expect.poll(()=>child.exitCode!==null||child.signalCode!==null,{timeout:15000}).toBe(true);
 if(child.signalCode)expect(['SIGTERM','SIGKILL']).toContain(child.signalCode);else expect(child.exitCode).toBe(0);
 for(const stream of [child.stdin,child.stdout,child.stderr])stream?.destroy();
 child.unref();
 await Promise.race([quit,new Promise(resolve=>setTimeout(resolve,250))]);
 await Promise.race([instance.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,250))]);
 console.log('Verified test-owned Windows app process closed: '+JSON.stringify({pid:child.pid,exitCode:child.exitCode,signal:child.signalCode}));
}
