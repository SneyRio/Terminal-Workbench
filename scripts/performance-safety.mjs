import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),fixture=path.join(root,'.test-data','performance-safety-'+Date.now()),data=path.join(fixture,'data'),project=path.join(fixture,'project'),file=path.join(project,'draft.txt');
await fs.mkdir(data,{recursive:true});await fs.mkdir(project);await fs.writeFile(file,'original');
await fs.writeFile(path.join(data,'state.json'),JSON.stringify({sessions:Array.from({length:500},(_,i)=>({id:'ended-'+i,kind:'claude',status:'exited',createdAt:1})),accounts:[]}));
const app=await electron.launch({executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[],env:{...process.env,ACCOUNTOR_DATA_DIR:data}}),checks=[];
let closed=false;
try{
 const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'你的工作空间',exact:true})).toBeVisible();
 await expect(page.locator('.brand-icon img')).toHaveJSProperty('naturalWidth',128);checks.push('packaged brand image loads at native resolution');
 await app.evaluate(()=>{const fs=process.getBuiltinModule('node:fs/promises'),read=fs.readFile;globalThis.telemetryReads=0;fs.readFile=async(...args)=>{if(String(args[0]).includes('/telemetry/ended-'))globalThis.telemetryReads++;return read(...args);};});
 await new Promise(r=>setTimeout(r,4400));expect(await app.evaluate(()=>globalThis.telemetryReads)).toBe(0);checks.push('500 ended sessions cause no recurring telemetry reads');
 await page.evaluate(file=>{void window.accountor.invoke('draft:save',file,{text:'latest unsaved content',baseText:'original',time:Date.now()});},file);
 const done=app.waitForEvent('close');await app.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;setImmediate(()=>app.quit());});await done;closed=true;
 const stored=JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8'));expect(stored.drafts[file].text).toBe('latest unsaved content');expect(await fs.readFile(file,'utf8')).toBe('original');checks.push('normal quit flushes pending batch and preserves original project file');
 await fs.writeFile(path.join(root,'test-results','performance-safety.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{if(!closed)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
