// Drives a real packaged app through the update button and replaces it in /Applications.
// Never touches /Applications/WbSpace.app: it uses its own bundle name, an isolated data directory and
// its own bundle identifier. A copy sharing the real identifier makes macOS open it in place of the real app.
import {_electron as electron} from 'playwright';import {expect} from '@playwright/test';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),root=process.cwd(),next='9.9.9',source=path.join(root,'release/builds.noindex/WbSpace-darwin-arm64/WbSpace.app'),target=process.env.WB_E2E_TARGET||'/Applications/WbSpace-UpdateTest.app',testBundleId='local.wbspace.update-test',dir=path.join(root,'.test-data','update-e2e-'+Date.now()),
// Outside ~/Documents: the relaunched app would otherwise wait on a system folder permission prompt.
data=await fs.mkdtemp(path.join(os.tmpdir(),'wbspace-update-e2e-')),binary=path.join(target,'Contents/MacOS/WbSpace'),checks=[];
if(path.resolve(target)==='/Applications/WbSpace.app')throw new Error('Refusing to replace the installed app');
if(await fs.access(target).then(()=>true,()=>false))throw new Error('Test bundle already exists: '+target);
const {version:current}=JSON.parse(await fs.readFile('package.json','utf8'));
await fs.mkdir(dir,{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const pack=path.join(dir,'pack'),packed=path.join(pack,'WbSpace.app'),asset=`WbSpace-${next}-mac-arm64-unsigned.zip`,zip=path.join(dir,asset);
await fs.mkdir(pack);await exec('/usr/bin/ditto',[source,packed]);
const manifest=path.join(packed,'Contents/Resources/app/package.json');await fs.writeFile(manifest,JSON.stringify({...JSON.parse(await fs.readFile(manifest,'utf8')),version:next}));
const rebrand=async(bundle,version)=>{const plist=path.join(bundle,'Contents/Info.plist');await exec('/usr/bin/plutil',['-replace','CFBundleIdentifier','-string',testBundleId,plist]);if(version)await exec('/usr/bin/plutil',['-replace','CFBundleShortVersionString','-string',version,plist]);await exec('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements',bundle]);};
await rebrand(packed,next);
await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',packed,zip]);
const bytes=await fs.readFile(zip),goodSum=crypto.createHash('sha256').update(bytes).digest('hex');
await exec('/usr/bin/ditto',[source,target]);
await rebrand(target);
await fs.writeFile(path.join(data,'state.json'),JSON.stringify({accounts:[],workspaces:[],sessions:[],onboarding:{completedAt:1},drafts:{e2e:{text:'UNSAVED',baseText:'BASE',workspaceId:'',time:Date.now()}},settings:{claudePath:path.join(dir,'missing-cli'),theme:'dark'}}));
const stubNetwork=(app,sum)=>app.evaluate(({session},cfg)=>{const fs=process.getBuiltinModule('node:fs');session.fromPartition('wbspace-updates').fetch=async url=>{
 if(url.endsWith('/releases/latest'))return new Response(JSON.stringify({tag_name:'v'+cfg.next,assets:[{name:cfg.asset,size:cfg.size},{name:'SHA256SUMS.txt',size:1}]}));
 if(url.endsWith('/SHA256SUMS.txt'))return new Response(cfg.sum+'  '+cfg.asset+'\n');
 if(url.endsWith('/'+cfg.asset))return new Response(fs.readFileSync(cfg.zip));
 throw new Error('Unexpected request '+url);
};},{next,asset,size:bytes.length,zip,sum});
// Matches the executable exactly: a command-line search would also hit any shell mentioning this path.
const relaunched=async()=>(await exec('/bin/ps',['-axo','pid=,comm='],{maxBuffer:8*1024*1024})).stdout.split('\n').filter(l=>l.trim().replace(/^\d+\s+/,'')===binary).map(l=>l.trim().split(/\s+/)[0]);
let app;
try{
 const env={...process.env,ACCOUNTOR_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:binary,args:[],env});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);
 expect((await page.evaluate(()=>window.accountor.invoke('system:info'))).version).toBe(current);
 await page.getByRole('button',{name:'设置',exact:true}).click();const panel=page.locator('.release-settings');await expect(panel).toContainText('正式版 · 安装包尚未签名/公证');
 await stubNetwork(app,'0'.repeat(64));
 await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:`下载并更新到 ${next}`,exact:true}).click();await expect(panel).toContainText('安装包校验失败',{timeout:120000});checks.push('tampered package is rejected and the update stays retryable');
 expect(await fs.access(path.join(data,'updates.noindex',asset+'.part')).then(()=>true,()=>false)).toBe(false);
 await stubNetwork(app,goodSum);
 await page.getByRole('button',{name:`下载并更新到 ${next}`,exact:true}).click();await expect(page.getByRole('button',{name:'重启并更新',exact:true})).toBeVisible({timeout:180000});checks.push('valid package downloads, passes checksum and bundle validation and offers restart');await page.screenshot({path:path.join(root,'test-results/update-ready.png')});
 await app.evaluate(({dialog})=>{globalThis.__prompts=[];dialog.showMessageBoxSync=(_w,o)=>{globalThis.__prompts.push(o.message);return 0;};});
 await page.getByRole('button',{name:'重启并更新',exact:true}).click();await expect.poll(()=>app.evaluate(()=>globalThis.__prompts.length)).toBe(1);expect(await app.evaluate(()=>globalThis.__prompts[0])).toBe('重启并更新 WbSpace？');await expect(page.getByRole('button',{name:'重启并更新',exact:true})).toBeVisible();
 expect(JSON.parse(await exec('/usr/bin/plutil',['-convert','json','-o','-',path.join(target,'Contents/Info.plist')]).then(r=>r.stdout)).CFBundleShortVersionString).toBe(current);checks.push('declining the unsaved-work prompt keeps the app running and unchanged');
 await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;});
 await page.getByRole('button',{name:'重启并更新',exact:true}).click().catch(()=>{});
 await expect.poll(async()=>JSON.parse((await exec('/usr/bin/plutil',['-convert','json','-o','-',path.join(target,'Contents/Info.plist')])).stdout).CFBundleShortVersionString,{timeout:90000}).toBe(next);checks.push(`bundle in /Applications is replaced with ${next} after confirmation`);
 await expect.poll(async()=>(await relaunched()).length,{timeout:30000}).toBeGreaterThan(0);
 await expect.poll(async()=>JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8')).installVersion,{timeout:45000}).toBe(next);checks.push('app relaunches on its own as the new version using the same data directory');
 const state=JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8'));expect(state.drafts.e2e.text).toBe('UNSAVED');const backups=await fs.readdir(path.join(data,'backups.noindex'));const notes=await Promise.all(backups.map(f=>fs.readFile(path.join(data,'backups.noindex',f,'manifest.json'),'utf8').then(JSON.parse)));expect(notes.some(n=>n.to===next)).toBe(true);checks.push('unsaved drafts survive and the normal upgrade snapshot is taken');
 await expect.poll(()=>fs.access(path.join(data,'updates.noindex')).then(()=>true,()=>false),{timeout:15000}).toBe(false);expect((await fs.readdir(path.dirname(target))).filter(f=>f.startsWith(path.basename(target)+'.update-old'))).toEqual([]);checks.push('downloaded package, staged bundle and old bundle are all cleaned up');
 await exec('/usr/bin/codesign',['--verify','--deep','--strict',target]);const quarantine=await exec('/usr/bin/xattr',['-p','com.apple.quarantine',target]).then(()=>true,()=>false);expect(quarantine).toBe(false);checks.push('replaced bundle keeps a valid signature structure and carries no quarantine flag');
 const report={passed:true,checks,from:current,to:next,target,modelPrompts:0};await fs.writeFile(path.join(root,'test-results/update-e2e-mac.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
 await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});
 for(const pid of await relaunched())try{process.kill(Number(pid),'SIGTERM');}catch{}
 await new Promise(r=>setTimeout(r,1500));for(const pid of await relaunched())try{process.kill(Number(pid),'SIGKILL');}catch{}
 await fs.rm(data,{recursive:true,force:true}).catch(()=>{});
 for(const name of await fs.readdir(path.dirname(target)))if(name===path.basename(target)||name.startsWith(path.basename(target)+'.update-old'))await fs.rm(path.join(path.dirname(target),name),{recursive:true,force:true});
}
await exec('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',target]).catch(()=>{});
process.exit(0);
