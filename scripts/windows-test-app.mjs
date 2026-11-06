import {expect} from '@playwright/test';
// A Windows descendant may retain the Playwright launch pipes after the main process exits.
// Verify the actual app's exit first, then release test-owned transport streams.
export async function exitTestApp(instance){
 const child=instance.process();
 const quit=instance.evaluate(({app})=>app.exit(0)).catch(()=>{});
 await expect.poll(()=>child.exitCode,{timeout:15000}).toBe(0);
 for(const stream of [child.stdin,child.stdout,child.stderr])stream?.destroy();
 child.unref();
 await Promise.race([quit,new Promise(resolve=>setTimeout(resolve,250))]);
 await Promise.race([instance.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,250))]);
 console.log('Verified Windows app main-process exit: 0');
}
