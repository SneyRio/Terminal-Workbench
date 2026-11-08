const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const value=(env,key)=>Object.entries(env).find(([k])=>k.toLowerCase()===key.toLowerCase())?.[1]||'';
function searchPath(env=process.env,platform=process.platform,home=os.homedir()){
 const p=platform==='win32'?path.win32:path;
 const parts=platform==='win32'?[p.join(home,'.local','bin'),p.join(value(env,'SystemRoot')||'C:\\Windows','System32'),p.join(value(env,'SystemRoot')||'C:\\Windows','System32','WindowsPowerShell','v1.0'),value(env,'APPDATA')&&p.join(value(env,'APPDATA'),'npm'),value(env,'LOCALAPPDATA')&&p.join(value(env,'LOCALAPPDATA'),'Microsoft','WinGet','Links')]:[p.join(home,'.local','bin'),'/opt/homebrew/bin','/usr/local/bin'];
 return [...new Set([...parts,...value(env,'PATH').split(platform==='win32'?';':':')].filter(Boolean))].join(platform==='win32'?';':':');
}
function executableCandidates(configured,env=process.env,platform=process.platform,home=os.homedir()){
 if(configured)return [configured];const p=platform==='win32'?path.win32:path;
 return [...new Set(searchPath(env,platform,home).split(platform==='win32'?';':':').filter(Boolean).map(d=>p.join(d,platform==='win32'?'claude.exe':'claude')))];
}
function defaultShell(env=process.env,platform=process.platform,exists=fs.existsSync){
 if(platform!=='win32')return platform==='darwin'?'/bin/zsh':'/bin/bash';
 const p=path.win32,candidates=[value(env,'ProgramFiles')&&p.join(value(env,'ProgramFiles'),'PowerShell','7','pwsh.exe'),p.join(value(env,'SystemRoot')||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),value(env,'ComSpec')].filter(Boolean);return candidates.find(exists)||candidates[1];
}
function shellArgs(file,platform=process.platform){if(platform!=='win32')return ['-l'];if(/(?:^|[\\/])cmd\.exe$/i.test(file))return ['/d','/q'];if(/(?:pwsh|powershell)\.exe$/i.test(file))return ['-NoLogo'];if(/bash\.exe$/i.test(file))return ['-l'];return [];}
function discoveredShellArgs(file,cli,platform=process.platform){
 if(platform!=='win32'||!cli||!/(?:pwsh|powershell)\.exe$/i.test(file))return shellArgs(file,platform);
 const script='$env:Path = '+quotePowerShell(path.win32.dirname(cli)+';')+' + $env:Path; '+
  "$existing=Get-Command claude -ErrorAction SilentlyContinue; if(-not $existing -or @('Alias','Function','Filter') -notcontains $existing.CommandType.ToString()){ function global:claude { & "+quotePowerShell(cli)+' @args } }';
 return ['-NoLogo','-NoExit','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
}
function browserSettings(platform=process.platform,env=process.env){return platform==='darwin'?{BROWSER:'/usr/bin/open'}:platform==='win32'?{BROWSER:path.win32.join(value(env,'SystemRoot')||'C:\\Windows','explorer.exe')}:{};}
const quotePosix=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const quotePowerShell=s=>"'"+String(s).replaceAll("'","''")+"'";
function powershellCommand(script){return 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64');}
function hookSettings(runtime,script,original,platform=process.platform){
 if(platform!=='win32'){
  const command=quotePosix(runtime)+' '+quotePosix(script);
  return {event:{type:'command',command:command+' event'},statusLine:{...(original||{}),type:'command',command:command+' usage'+(original?' --delegate '+quotePosix(original.command):'')}};
 }
 const args=[script,'usage',...(original?['--delegate-base64',Buffer.from(original.command,'utf8').toString('base64')]:[])];
 const invocation='& '+quotePowerShell(runtime.replaceAll('\\','/'))+' '+args.map(quotePowerShell).join(' ');
 const encoding="[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $OutputEncoding = [Console]::OutputEncoding; ";
 return {event:{type:'command',command:runtime,args:[script,'event']},statusLine:{...(original||{}),type:'command',command:powershellCommand(encoding+'$input | Out-String | '+invocation)}};
}
function hudShell(env=process.env,platform=process.platform,exists=fs.existsSync){
 if(platform!=='win32')return {file:'/bin/sh',args:['-c'],detached:true};
 const base=value(env,'ProgramFiles')||'C:\\Program Files';const bash=[path.win32.join(base,'Git','bin','bash.exe'),value(env,'LOCALAPPDATA')&&path.win32.join(value(env,'LOCALAPPDATA'),'Programs','Git','bin','bash.exe')].filter(Boolean).find(exists);
 if(bash)return {file:bash,args:['-c'],detached:false};return {file:defaultShell(env,'win32',exists),args:['-NoLogo','-NoProfile','-NonInteractive','-Command'],detached:false,powershell:true};
}
// npm, pnpm and yarn install CLIs on Windows as .cmd shims; cmd.exe cannot pass quotes, % or line breaks through them.
// The shim's target is read instead, so the real program starts with an argument array: a .exe directly, a script with node.exe.
// Anything unrecognised returns null and the caller falls back to cmd.exe.
async function resolveCmdShim(file,env=process.env,{io=fs.promises,depth=0}={}){
 const p=path.win32;
 if(depth>2||!/\.(cmd|bat)$/i.test(file))return null;
 let text;try{const stat=await io.stat(file);if(!stat.isFile()||stat.size>64*1024)return null;text=await io.readFile(file,'utf8');}catch{return null;}
 const dir=p.dirname(file),exists=f=>io.stat(f).then(s=>s.isFile(),()=>false);
 const expand=t=>p.normalize(t.replace(/%~dp0%?|%dp0%/gi,dir+'\\'));
 for(const line of text.split(/\r?\n/).filter(l=>l.includes('%*'))){
  const tokens=[...line.matchAll(/"([^"]+)"/g)].map(m=>m[1]).filter(t=>/%~?dp0/i.test(t));
  if(!tokens.length)continue;
  const target=expand(tokens.at(-1));
  if(!await exists(target))return null;
  if(/\.exe$/i.test(target))return {file:target,args:[]};
  if(/\.(cmd|bat)$/i.test(target))return resolveCmdShim(target,env,{io,depth:depth+1});
  if(!/\.[cm]?js$/i.test(target))return null;
  const nodes=[p.join(dir,'node.exe'),...value(env,'PATH').split(';').map(d=>d.trim().replace(/^"|"$/g,'')).filter(d=>p.isAbsolute(d)).map(d=>p.join(d,'node.exe'))];
  for(const node of nodes)if(await exists(node))return {file:node,args:[target]};
  return null;
 }
 return null;
}
// Standard Windows argument quoting (the rules CommandLineToArgvW, the MSVC runtime, Rust and Node use to split a command line).
// node-pty's own quoting skips arguments that already start and end with a quote, which splits a prompt such as "a b".
function quoteWindowsArg(arg){
 const a=String(arg);
 if(a==='')return '""';
 if(!/[\s"]/.test(a))return a;
 let out='"',slashes=0;
 for(const ch of a){
  if(ch==='\\'){slashes++;continue;}
  out+=ch==='"'?'\\'.repeat(slashes*2+1)+'"':'\\'.repeat(slashes)+ch;slashes=0;
 }
 return out+'\\'.repeat(slashes*2)+'"';
}
const windowsCommandLine=args=>args.map(quoteWindowsArg).join(' ');
// One command line for `cmd.exe /d /s /c` running a .cmd/.bat shim. Inside quotes cmd leaves & | < > ( ) alone,
// but nothing can carry a double quote, % (expanded even inside quotes), ^ or a line break through it.
function cmdShimCommand(cli,args){
 if(/["%^\r\n]/.test(cli)||args.some(a=>/["%^\r\n]/.test(a)))throw new Error('无效的程序路径或参数');
 // Backslashes before the closing quote are doubled so the program does not read them as an escaped quote.
 const quote=a=>a===''||/[\s&|<>()]/.test(a)?'"'+a.replace(/(\\+)$/,'$1$1')+'"':a;
 return `/d /s /c ""${cli}"${args.map(a=>' '+quote(a)).join('')}"`;
}
module.exports={quoteWindowsArg,windowsCommandLine,resolveCmdShim,cmdShimCommand,value,searchPath,executableCandidates,defaultShell,shellArgs,discoveredShellArgs,browserSettings,quotePosix,quotePowerShell,powershellCommand,hookSettings,hudShell};
