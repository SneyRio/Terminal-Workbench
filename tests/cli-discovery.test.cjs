const {test}=require('node:test'),assert=require('node:assert/strict'),p=require('node:path').win32;
const {WindowsCliDiscovery}=require('../electron/cli-discovery.cjs'),{discoveredShellArgs}=require('../electron/platform.cjs');
function fixture(extra={}){
 const home='C:\\Users\\测试',env={USERPROFILE:home,SystemRoot:'C:\\Windows',APPDATA:p.join(home,'AppData','Roaming'),LOCALAPPDATA:p.join(home,'AppData','Local'),Path:'D:\\npm;D:\\tools',ANTHROPIC_AUTH_TOKEN:'DO_NOT_FORWARD',AWS_SECRET_ACCESS_KEY:'DO_NOT_FORWARD',...extra.env};
 const files=new Map(),calls=[];const add=(file,options={})=>files.set(file.toLowerCase(),{path:file,version:'2.1.318',size:1000,mtimeMs:1,...options});
 const missing=()=>Object.assign(new Error('missing'),{code:'ENOENT'});
 const io={stat:async file=>{const f=files.get(file.toLowerCase());if(!f)throw missing();return {...f,isFile:()=>true};},readFile:async file=>{const f=files.get(file.toLowerCase());if(!f)throw missing();return f.text||'';},readdir:async dir=>{const names=new Set();for(const f of files.values()){const rel=p.relative(dir,f.path);if(!rel.startsWith('..')&&rel.includes('\\'))names.add(rel.split('\\')[0]);}return [...names].map(name=>({name,isDirectory:()=>true}));}};
 const run=async(file,args,options)=>{calls.push({file,args,env:options.env});if(file.endsWith('reg.exe'))return {stdout:extra.registry?.[args[1]]||''};const f=files.get(file.toLowerCase());if(!f||f.broken)throw new Error('CANNOT_EXECUTE');return {stdout:f.stdout??`${f.version} (Claude Code)\n`};};
 return {home,env,files,calls,add,discovery:new WindowsCliDiscovery({env,home,arch:'x64',io,run})};
}
test('automatic native discovery recovers a stale configured npm script without executing that script',async()=>{
 const f=fixture(),native=p.join(f.home,'.local/bin/claude.exe'),shim='D:\\npm\\claude.ps1';f.add(native);f.add(shim);const found=await f.discovery.detect(shim);assert.equal(found.path,native);assert.equal(found.status,'ready');assert.equal(found.recovered,true);assert(found.issues.some(x=>x.path===shim));assert(!f.calls.some(x=>x.file===shim));
});
test('a broken npm command alone is reported as broken rather than a ready CLI',async()=>{
 const f=fixture();f.add('D:\\npm\\claude.ps1');f.add('D:\\npm\\claude.cmd');const found=await f.discovery.detect();assert.equal(found.status,'broken');assert.equal(found.path,'');assert.match(found.message,/没有可运行/);assert.equal(f.calls.filter(x=>!x.file.endsWith('reg.exe')).length,0);
});
test('custom npm prefix and optional native dependency are detected without exposing npm credentials',async()=>{
 const f=fixture(),native='E:\\custom npm\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe';f.add(p.join(f.home,'.npmrc'),{text:'//registry.npmjs.org/:_authToken=PRIVATE_NPM_TOKEN\nprefix=E:\\custom npm\n'});f.add(native);const found=await f.discovery.detect();assert.equal(found.path,native);assert.equal(found.source,'npm');assert(!JSON.stringify(found).includes('PRIVATE_NPM_TOKEN'));for(const call of f.calls){assert.equal(call.env.ANTHROPIC_AUTH_TOKEN,undefined);assert.equal(call.env.AWS_SECRET_ACCESS_KEY,undefined);}
});
test('fresh registry PATH and per-user WinGet package locations work without inherited PATH entries',async()=>{
 const f=fixture({registry:{'HKCU\\Environment':'Path REG_EXPAND_SZ E:\\new-install'}});f.add('E:\\new-install\\claude.exe');assert.equal((await f.discovery.detect()).path,'E:\\new-install\\claude.exe');
 const g=fixture(),native=p.join(g.env.LOCALAPPDATA,'Microsoft/WinGet/Packages/Anthropic.ClaudeCode_test/claude.exe');g.add(native);assert.equal((await g.discovery.detect()).path,native);
});
test('unusable and outdated binaries are skipped; valid results cache and disappearances rescan immediately',async()=>{
 const f=fixture(),bad='D:\\tools\\broken.exe',old=p.join(f.home,'.local/bin/claude.exe'),npm='D:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';f.add(bad,{stdout:'not a Claude CLI'});f.add(old,{version:'2.0.0'});f.add(npm);const found=await f.discovery.detect(bad);assert.equal(found.path,npm);const count=f.calls.length;await f.discovery.detect(bad);assert.equal(f.calls.length,count);f.files.delete(npm.toLowerCase());const missing=await f.discovery.detect(bad);assert.equal(missing.status,'outdated');assert.equal(missing.path,'');f.add(old);assert.equal((await f.discovery.detect(bad,{refresh:true})).path,old);
});
test('PowerShell bootstrap uses exact native argv, preserves user aliases/functions and requires no global PATH edits',()=>{
 const file="D:\\用户 O'Brien & $x\\claude.exe",args=discoveredShellArgs('C:\\Windows\\powershell.exe',file,'win32'),script=Buffer.from(args.at(-1),'base64').toString('utf16le');assert(args.includes('-NoExit'));assert(script.includes("O''Brien"));assert(script.includes(' @args'));assert(script.includes("@('Alias','Function','Filter')"));assert(!script.includes('SetEnvironmentVariable'));assert.deepEqual(discoveredShellArgs('C:\\Windows\\cmd.exe',file,'win32'),['/d','/q']);assert.deepEqual(discoveredShellArgs('/bin/zsh',file,'darwin'),['-l']);
});
