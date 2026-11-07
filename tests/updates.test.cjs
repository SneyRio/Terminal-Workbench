const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFile,spawn}=require('node:child_process');const exec=require('node:util').promisify(execFile);
const updates=require('../electron/updates.cjs'),install=require('../electron/update-install.cjs');
async function fixture(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'wbspace-update-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const name='WbSpace-0.6.0-mac-arm64-unsigned.zip',payload=Buffer.from('package-bytes');
const release=(over={})=>({tag_name:'v0.6.0',assets:[{name,size:payload.length},{name:'WbSpace-0.6.0-windows-x64-setup.exe',size:9},{name:'SHA256SUMS.txt',size:1}],...over});
function server({sums=`${sha(payload)}  ${name}\n`,body=payload,url}={}){return async target=>{
 if(target.endsWith('/releases/latest'))return new Response(JSON.stringify(release()));
 if(target.endsWith('/SHA256SUMS.txt'))return new Response(sums);
 const response=new Response(body);if(url)Object.defineProperty(response,'url',{value:url});return response;
};}
const params=dir=>({tag:'v0.6.0',asset:{name,size:payload.length},dir});

test('asset selection requires the exact platform package and a checksum list',()=>{
 assert.equal(updates.pickAsset(release(),'darwin','arm64').name,name);
 assert.equal(updates.pickAsset(release(),'win32','x64').name,'WbSpace-0.6.0-windows-x64-setup.exe');
 assert.equal(updates.pickAsset(release(),'darwin','x64'),null);
 assert.equal(updates.pickAsset(release(),'linux','x64'),null);
 assert.equal(updates.pickAsset(release({assets:[{name,size:5}]}),'darwin','arm64'),null);
 assert.equal(updates.pickAsset(release({assets:[{name:'WbSpace-0.5.9-mac-arm64-unsigned.zip',size:5},{name:'SHA256SUMS.txt',size:1}]}),'darwin','arm64'),null);
 assert.equal(updates.pickAsset(release({assets:[{name:'evil.zip',size:5},{name:'SHA256SUMS.txt',size:1}]}),'darwin','arm64'),null);
});
test('checksum parsing matches the exact file name only',()=>{
 const hash='a'.repeat(64);assert.equal(updates.parseChecksums(`${hash}  ${name}\r\n`,name),hash);assert.equal(updates.parseChecksums(`${hash} *${name}`,name),hash);
 assert.throws(()=>updates.parseChecksums(`${hash}  other-${name}`,name));
});
test('download keeps a verified package and discards anything that fails verification',async t=>{
 const dir=await fixture(t);const seen=[];
 const file=await updates.downloadPackage({...params(dir),fetcher:server(),onProgress:r=>seen.push(r)});
 assert.deepEqual(await fs.readFile(file),payload);assert.equal(seen.at(-1),payload.length);assert.equal(await fs.access(file+'.part').then(()=>1,()=>0),0);
 const cases=[[{sums:`${'0'.repeat(64)}  ${name}\n`},/校验失败/],[{sums:`${'0'.repeat(64)}  other.zip\n`},/校验清单/],[{body:Buffer.from('longer-than-the-declared-size')},/大小/],[{body:Buffer.from('x')},/不完整/],[{url:'https://evil.invalid/x'},/不受信任/]];
 for(const [options,message] of cases){const other=await fixture(t);await assert.rejects(()=>updates.downloadPackage({...params(other),fetcher:server(options)}),message);assert.deepEqual(await fs.readdir(other),[]);}
});
test('download URLs are always built from the fixed repository',()=>{assert.equal(updates.assetUrl('v1.0.0','a b.zip'),'https://github.com/SneyRio/Terminal-Workbench/releases/download/v1.0.0/a%20b.zip');});
test('updater moves through the flow, returns to available on failure and cancel, and exposes no download details',async t=>{
 const dir=await fixture(t);const states=[];const auto=()=>({mode:'auto',target:'/x'});
 const make=(fetcher,prepare=async f=>f+'!')=>updates.createUpdater({current:'0.5.0',dir,fetcher,emit:s=>states.push(s.phase),resolveInstall:auto,prepare,platform:'darwin',arch:'arm64'});
 let u=make(server());await assert.rejects(()=>u.download());
 const found=await u.check();assert.equal(found.phase,'available');assert.equal(found.mode,'auto');assert.equal(found.size,payload.length);assert.equal(found.asset,undefined);assert.equal(found.tag,undefined);
 const done=await u.download();assert.equal(done.phase,'ready');assert.equal(u.artifact(),path.join(dir,name)+'!');assert.deepEqual([...new Set(states)],['available','downloading','preparing','ready']);
 assert.equal((await u.check()).phase,'ready');
 u=make(server({sums:`${'0'.repeat(64)}  ${name}\n`}));await u.check();const failed=await u.download();assert.equal(failed.phase,'available');assert.match(failed.error,/校验失败/);assert.equal(u.artifact(),null);
 u=make(server(),async()=>{throw new Error('安装包与目标版本不符');});await u.check();assert.match((await u.download()).error,/不符/);
 let release_;const hanging=async(target,init)=>{if(target.endsWith('/releases/latest'))return server()(target);if(target.endsWith('/SHA256SUMS.txt'))return server()(target);return new Promise((_,reject)=>{release_=()=>reject(new Error('aborted'));init.signal.addEventListener('abort',release_);});};
 u=make(hanging);await u.check();const pending=u.download();await new Promise(r=>setTimeout(r,20));assert.equal(u.state().phase,'downloading');u.cancel();const cancelled=await pending;assert.equal(cancelled.phase,'available');assert.equal(cancelled.error,'');
});
test('updater falls back to the download page when no package or no safe install path exists',async t=>{
 const dir=await fixture(t);const noAsset=async()=>new Response(JSON.stringify(release({assets:[]})));
 let u=updates.createUpdater({current:'0.5.0',dir,fetcher:noAsset,resolveInstall:()=>{throw new Error('must not resolve');},prepare:async()=>'',platform:'darwin',arch:'arm64'});
 const missing=await u.check();assert.equal(missing.mode,'manual');assert.match(missing.reason,/尚未上传/);await assert.rejects(()=>u.download());
 u=updates.createUpdater({current:'0.5.0',dir,fetcher:server(),resolveInstall:()=>({mode:'manual',reason:'portable'}),prepare:async()=>'',platform:'darwin',arch:'arm64'});
 assert.equal((await u.check()).reason,'portable');await assert.rejects(()=>u.download());
});
test('install target detection refuses copies that cannot replace themselves',()=>{
 const mac=(exePath,over={})=>install.resolveInstall({platform:'darwin',arch:'arm64',isPackaged:true,exePath,writable:()=>true,...over});
 assert.deepEqual(mac('/Applications/WbSpace.app/Contents/MacOS/WbSpace'),{mode:'auto',target:'/Applications/WbSpace.app'});
 assert.equal(mac('/Volumes/WbSpace/WbSpace.app/Contents/MacOS/WbSpace').mode,'manual');
 assert.equal(mac('/private/var/folders/x/AppTranslocation/y/d/WbSpace.app/Contents/MacOS/WbSpace').mode,'manual');
 assert.equal(mac('/Applications/WbSpace.app/Contents/MacOS/WbSpace',{writable:()=>false}).mode,'manual');
 assert.equal(mac('/x',{isPackaged:false}).mode,'manual');
 const win=exists=>install.resolveInstall({platform:'win32',arch:'x64',isPackaged:true,exePath:'C:\\Apps\\WbSpace\\WbSpace.exe',exists:()=>exists});
 assert.equal(win(true).mode,'auto');assert.equal(win(false).mode,'manual');assert.match(win(false).reason,/解压版/);
 assert.equal(install.resolveInstall({platform:'linux',arch:'x64',isPackaged:true,exePath:'/x'}).mode,'manual');
});
test('previous helper result is reported once and leftovers are cleared',async t=>{
 const dir=path.join(await fixture(t),'updates');await fs.mkdir(dir);await fs.writeFile(path.join(dir,install.resultFile),'{"ok":false,"reason":"permission"}');await fs.writeFile(path.join(dir,'old.zip'),'x');
 assert.equal((await install.consumeResult(dir)).reason,'permission');assert.equal(await install.consumeResult(dir),null);assert.equal(await fs.access(dir).then(()=>1,()=>0),0);
});
test('macOS helper swaps the bundle, and restores it when replacement fails',{skip:process.platform==='win32'},async t=>{
 const root=await fixture(t);const script=path.join(root,'helper.sh');await fs.writeFile(script,install.macHelper.replaceAll('/usr/bin/open','/usr/bin/true'));
 const run=async(target,staged,result)=>{const dead=spawn('/usr/bin/true');await new Promise(r=>dead.once('exit',r));await exec('/bin/sh',[script,String(dead.pid),target,staged,result,'0.6.0']).catch(()=>{});return JSON.parse(await fs.readFile(result,'utf8'));};
 const layout=async name=>{const base=path.join(root,name),apps=path.join(base,'Applications'),target=path.join(apps,'WbSpace 中文 & test.app'),staged=path.join(base,'stage/WbSpace.app');await fs.mkdir(target,{recursive:true});await fs.mkdir(staged,{recursive:true});await fs.writeFile(path.join(target,'v'),'old');await fs.writeFile(path.join(staged,'v'),'new');return {base,apps,target,staged,result:path.join(base,'result.json')};};
 let l=await layout('ok');assert.deepEqual(await run(l.target,l.staged,l.result),{version:'0.6.0',ok:true,reason:'installed'});assert.equal(await fs.readFile(path.join(l.target,'v'),'utf8'),'new');assert.deepEqual(await fs.readdir(l.apps),[path.basename(l.target)]);
 l=await layout('missing');await fs.rm(l.staged,{recursive:true});assert.equal((await run(l.target,l.staged,l.result)).reason,'replace');assert.equal(await fs.readFile(path.join(l.target,'v'),'utf8'),'old');assert.deepEqual(await fs.readdir(l.apps),[path.basename(l.target)]);
 l=await layout('locked');await fs.chmod(l.apps,0o555);t.after(()=>fs.chmod(l.apps,0o755).catch(()=>{}));assert.equal((await run(l.target,l.staged,l.result)).reason,'permission');assert.equal(await fs.readFile(path.join(l.target,'v'),'utf8'),'old');await fs.chmod(l.apps,0o755);
});
test('macOS helper does not touch the bundle while the app is still running',{skip:process.platform==='win32'},async t=>{
 const root=await fixture(t),target=path.join(root,'A.app'),result=path.join(root,'r.json'),script=path.join(root,'h.sh');await fs.mkdir(target);
 await fs.writeFile(script,install.macHelper.replaceAll('/usr/bin/open','/usr/bin/true').replace('-gt 300','-gt 1').replace('sleep 0.2','sleep 0.01'));
 await exec('/bin/sh',[script,String(process.pid),target,path.join(root,'none'),result,'1.0.0']).catch(()=>{});
 assert.equal(JSON.parse(await fs.readFile(result,'utf8')).reason,'timeout');assert.equal(await fs.access(target).then(()=>1,()=>0),1);
});
test('update proxy accepts plain and full addresses and rejects anything else',()=>{
 assert.equal(updates.normalizeProxy(''),'');assert.equal(updates.normalizeProxy('  '),'');
 assert.equal(updates.normalizeProxy('127.0.0.1:7897'),'http://127.0.0.1:7897');
 assert.equal(updates.normalizeProxy(' http://127.0.0.1:7897/ '),'http://127.0.0.1:7897');
 assert.equal(updates.normalizeProxy('socks5://localhost:1080'),'socks5://localhost:1080');
 for(const bad of ['ftp://x:1','http://user:pw@x:1','127.0.0.1','http://x:1/path','http://x:1?a=1','not a url'])assert.throws(()=>updates.normalizeProxy(bad),undefined,bad);
});
test('a large download does not pile up listeners while waiting on the disk',async t=>{
 const dir=await fixture(t),warnings=[],watch=w=>warnings.push(w.name);process.on('warning',watch);t.after(()=>process.off('warning',watch));
 const size=64*1024*1024,big=Buffer.alloc(size,7),chunks=64,part=size/chunks;
 const sum=sha(big),asset='big.zip';
 const fetcher=async target=>{if(target.endsWith('/SHA256SUMS.txt'))return new Response(`${sum}  ${asset}\n`);let i=0;return new Response(new ReadableStream({pull(c){if(i>=chunks){c.close();return;}c.enqueue(big.subarray(i*part,(i+1)*part));i++;}}));};
 const file=await updates.downloadPackage({tag:'v1.0.0',asset:{name:asset,size},dir,fetcher});
 assert.equal((await fs.stat(file)).size,size);await new Promise(r=>setImmediate(r));assert.deepEqual(warnings.filter(w=>w==='MaxListenersExceededWarning'),[]);
});
test('update traffic may only reach GitHub over HTTPS',()=>{
 for(const good of ['https://api.github.com/repos/x','https://github.com/a/b/releases/download/v1/f.zip','https://release-assets.githubusercontent.com/x','https://objects.githubusercontent.com/x'])assert.equal(updates.isTrustedUpdateUrl(good),true,good);
 for(const bad of ['http://github.com/a','https://evil.invalid/a','https://github.com.evil.invalid/a','https://user@evil.invalid/github.com','file:///etc/passwd','nonsense',''])assert.equal(updates.isTrustedUpdateUrl(bad),false,bad);
});
