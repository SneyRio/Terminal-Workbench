const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const tools=require('../electron/platform.cjs'),{Connections}=require('../electron/account-connections.cjs');
test('Windows discovery uses case-insensitive Path and native executable locations',()=>{
 const env={Path:'C:\\Tools;D:\\Apps',SystemRoot:'C:\\Windows',APPDATA:'C:\\用户\\AppData\\Roaming',LOCALAPPDATA:'C:\\用户\\AppData\\Local'};
 const list=tools.executableCandidates('',env,'win32','C:\\用户');assert(list.includes('C:\\用户\\.local\\bin\\claude.exe'));assert(list.includes('C:\\Tools\\claude.exe'));assert(list.includes('D:\\Apps\\claude.exe'));assert(!list.some(x=>x.includes('/opt/')));assert.deepEqual(tools.executableCandidates('D:\\My CLI\\claude.exe',env,'win32','C:\\用户'),['D:\\My CLI\\claude.exe']);
});
test('Windows defaults select PowerShell or CMD with the appropriate argument list',()=>{
 const env={ProgramFiles:'C:\\Program Files',SystemRoot:'C:\\Windows',ComSpec:'C:\\Windows\\System32\\cmd.exe'};assert.equal(tools.defaultShell(env,'win32',p=>p.endsWith('pwsh.exe')),'C:\\Program Files\\PowerShell\\7\\pwsh.exe');assert.equal(tools.defaultShell(env,'win32',p=>p.endsWith('cmd.exe')),env.ComSpec);assert.deepEqual(tools.shellArgs(env.ComSpec,'win32'),['/d','/q']);assert.deepEqual(tools.shellArgs('C:\\Windows\\powershell.exe','win32'),['-NoLogo']);assert.deepEqual(tools.browserSettings('win32',env),{BROWSER:'C:\\Windows\\explorer.exe'});assert.equal(tools.browserSettings('darwin').BROWSER,'/usr/bin/open');
});
test('Windows hooks use exact executable argv and HUD encodes paths and delegated shell text safely',()=>{
 const runtime="C:\\Program Files\\用户 O'Brien & $x\\WbSpace.exe",script="C:\\项目\\telemetry.cjs",original={type:'command',command:'node "C:/user space/hud.js" --name "$model"',padding:2};const config=tools.hookSettings(runtime,script,original,'win32');assert.equal(config.event.command,runtime);assert.deepEqual(config.event.args,[script,'event']);const encoded=config.statusLine.command.split(' ').at(-1),decoded=Buffer.from(encoded,'base64').toString('utf16le');assert(decoded.includes("O''Brien"));assert(decoded.includes(runtime.replaceAll('\\','/').replaceAll("'","''")));assert(decoded.includes(Buffer.from(original.command).toString('base64')));assert(!decoded.includes(original.command));assert.equal(config.statusLine.padding,2);assert.equal(config.event.type,'command');
});
test('HUD chooses Git Bash when present and PowerShell when absent on Windows',()=>{
 assert.equal(tools.hudShell({ProgramFiles:'C:\\Program Files'},'win32',()=>true).file,'C:\\Program Files\\Git\\bin\\bash.exe');assert.equal(tools.hudShell({SystemRoot:'C:\\Windows'},'win32',()=>false).powershell,true);
});
test('Windows official account provision creates a safe cmd and Node launcher without storing auth',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wb-win-launcher-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const manager=new Connections(root,{}, {platform:'win32',runtime:'C:\\Program Files\\Wb 100%\\WbSpace.exe'}),account={id:'windows-account',name:'测试 & %account',provider:'subscription'};await manager.provision(account,'C:\\用户\\.local\\bin\\claude.exe');assert(account.launchPath.endsWith('.cmd'));const cmd=await fs.readFile(account.launchPath,'utf8'),script=await fs.readFile(account.launchPath+'.cjs','utf8');assert(cmd.includes('DisableDelayedExpansion'));assert(cmd.includes('Wb 100%%'));assert(cmd.includes('"%~f0.cjs" %*'));assert(script.includes('BROWSER'));assert(script.includes('explorer.exe'));assert(script.includes('ANTHROPIC_'));assert(!script.includes('sk-ant-'));new Function(script);await manager.cleanup(account);await assert.rejects(()=>fs.access(account.launchPath+'.cjs'));
});

test('a Windows .cmd shim command line quotes cmd metacharacters and rejects what cmd cannot carry',()=>{
 const cli='C:\\Users\\张 三\\AppData\\Roaming\\npm\\qodercli.cmd';
 assert.equal(tools.cmdShimCommand(cli,['-i','中文提示']),`/d /s /c ""${cli}" -i 中文提示"`);
 // Unquoted, & < > | would let cmd run or redirect part of the prompt.
 assert.equal(tools.cmdShimCommand(cli,['--append-system-prompt=用中文&calc','a<b>c','x|y','a b','']),`/d /s /c ""${cli}" "--append-system-prompt=用中文&calc" "a<b>c" "x|y" "a b" """`);
 assert.equal(tools.cmdShimCommand(cli,['C:\\dir with space\\']),`/d /s /c ""${cli}" "C:\\dir with space\\\\""`);
 for(const bad of ['a"b','100%','a^b','第一行\n第二行','x\r'])assert.throws(()=>tools.cmdShimCommand(cli,[bad]),/无效的程序路径或参数/);
 assert.throws(()=>tools.cmdShimCommand('C:\\a"b.cmd',[]),/无效/);
});

// Reference splitter following the MSVC runtime rules, to check quoting round-trips on any platform.
function splitWindows(line){
 const out=[];let i=0;
 while(i<line.length){
  while(line[i]===' '||line[i]==='\t')i++;if(i>=line.length)break;
  let arg='',quoted=false;
  for(;i<line.length;i++){
   const c=line[i];
   if(c==='\\'){let n=0;while(line[i]==='\\'){n++;i++;}if(line[i]==='"'){arg+='\\'.repeat(n>>1);if(n%2){arg+='"';continue;}i--;continue;}arg+='\\'.repeat(n);i--;continue;}
   if(c==='"'){if(quoted&&line[i+1]==='"'){arg+='"';i++;continue;}quoted=!quoted;continue;}
   if(!quoted&&(c===' '||c==='\t'))break;
   arg+=c;
  }
  out.push(arg);
 }
 return out;
}

test('Windows argument quoting round-trips prompts with quotes, spaces, backslashes and line breaks',async()=>{
 const samples=['', 'plain', '中文提示', 'a b', '"a b"', '"带 引号"', 'say "hi"', 'C:\\dir with space\\', 'C:\\x\\"y', 'back\\\\', 'line1\nline2 "q" 100% ^ & <b> | (x)', '\t', '--append-system-prompt=第一行\n第二行', 'developer_instructions="a \\"b\\"\\nc"', '{"statusLine":{"command":"x y"}}'];
 assert.deepEqual(splitWindows(tools.windowsCommandLine(samples)),samples);
 assert.equal(tools.quoteWindowsArg('plain'),'plain');assert.equal(tools.quoteWindowsArg('a b'),'"a b"');assert.equal(tools.quoteWindowsArg(''),'""');
 for(let n=0;n<300;n++){const chars=['a','"','\\',' ','\n','中','%','&'],arg=Array.from({length:n%12},(_,i)=>chars[(n*7+i*13)%chars.length]).join('');assert.deepEqual(splitWindows(tools.windowsCommandLine(['x',arg])),['x',arg]);}
 if(process.platform==='win32'){
  // The real parser: Node splits its own command line the same way the agents do.
  const child=require('node:child_process').spawnSync(process.execPath,['-e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" -- '+tools.windowsCommandLine(samples)],{argv0:'node',windowsVerbatimArguments:true,encoding:'utf8'});
  assert.deepEqual(JSON.parse(child.stdout),samples);
 }
});

test('npm, pnpm and yarn .cmd shims resolve to the program behind them',async()=>{
 const files=new Map(),io={stat:async f=>{if(!files.has(f))throw Object.assign(new Error('missing'),{code:'ENOENT'});return {isFile:()=>true,size:files.get(f).length};},readFile:async f=>files.get(f)};
 const npm='C:\\Users\\张 三\\AppData\\Roaming\\npm',codexJs=npm+'\\node_modules\\@openai\\codex\\bin\\codex.js',opencodeExe=npm+'\\node_modules\\opencode-ai\\bin\\opencode.exe',node='C:\\Program Files\\nodejs\\node.exe';
 files.set(npm+'\\codex.cmd','@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
 files.set(codexJs,'');files.set(node,'');
 files.set(npm+'\\opencode.cmd','@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n');files.set(opencodeExe,'');
 const env={Path:'C:\\Windows\\System32;"C:\\Program Files\\nodejs"'};
 assert.deepEqual(await tools.resolveCmdShim(npm+'\\codex.cmd',env,{io}),{file:node,args:[codexJs]});
 assert.deepEqual(await tools.resolveCmdShim(npm+'\\opencode.cmd',env,{io}),{file:opencodeExe,args:[]});
 // A node.exe next to the shim wins over PATH.
 files.set(npm+'\\node.exe','');assert.deepEqual(await tools.resolveCmdShim(npm+'\\codex.cmd',env,{io}),{file:npm+'\\node.exe',args:[codexJs]});files.delete(npm+'\\node.exe');
 const pnpm='C:\\Users\\me\\AppData\\Local\\pnpm',pnpmJs=pnpm+'\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js';
 files.set(pnpm+'\\codex.CMD','@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n)\r\n');files.set(pnpmJs,'');
 assert.deepEqual(await tools.resolveCmdShim(pnpm+'\\codex.CMD',env,{io}),{file:node,args:[pnpmJs]});
 const yarn='C:\\Users\\me\\AppData\\Local\\Yarn\\bin';
 files.set(yarn+'\\opencode.cmd','@"%~dp0\\..\\..\\..\\Roaming\\npm\\opencode.cmd"   %*\r\n');
 assert.equal((await tools.resolveCmdShim(yarn+'\\opencode.cmd',env,{io}))?.file,undefined,'yarn path resolves outside the fake tree');
 files.set(yarn+'\\codex.cmd','@"%~dp0\\..\\..\\..\\Roaming\\npm\\codex.cmd"   %*\r\n');
 const viaYarn='C:\\Users\\me\\AppData\\Roaming\\npm';files.set(viaYarn+'\\codex.cmd',files.get(npm+'\\codex.cmd'));files.set(viaYarn+'\\node_modules\\@openai\\codex\\bin\\codex.js','');
 assert.deepEqual(await tools.resolveCmdShim(yarn+'\\codex.cmd',env,{io}),{file:node,args:[viaYarn+'\\node_modules\\@openai\\codex\\bin\\codex.js']});
 // Missing targets, missing node, unknown layouts and non-shims fall back to cmd.exe.
 assert.equal(await tools.resolveCmdShim(npm+'\\codex.cmd',{Path:'C:\\Windows'},{io}),null);
 files.set(npm+'\\custom.cmd','@echo off\r\npowershell -File "%~dp0\\run.ps1" %*\r\n');files.set(npm+'\\run.ps1','');
 assert.equal(await tools.resolveCmdShim(npm+'\\custom.cmd',env,{io}),null);
 assert.equal(await tools.resolveCmdShim(npm+'\\gone.cmd',env,{io}),null);
 assert.equal(await tools.resolveCmdShim('C:\\x\\codex.exe',env,{io}),null);
 files.delete(codexJs);assert.equal(await tools.resolveCmdShim(npm+'\\codex.cmd',env,{io}),null);
});
