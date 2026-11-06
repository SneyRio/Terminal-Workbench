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
module.exports={value,searchPath,executableCandidates,defaultShell,shellArgs,discoveredShellArgs,browserSettings,quotePosix,quotePowerShell,powershellCommand,hookSettings,hudShell};
