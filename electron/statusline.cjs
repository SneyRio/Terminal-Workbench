const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {hudShell}=require('./platform.cjs');
async function configuredStatusLine(configDirectory){
  try{
    const settings=JSON.parse(await fs.readFile(path.join(configDirectory,'settings.json'),'utf8'));
    const value=settings.statusLine;
    if(value?.type==='command'&&typeof value.command==='string'&&value.command.trim()&&!value.command.includes('claude-telemetry.cjs'))return value;
    return null;
  }catch(e){if(e.code==='ENOENT')return null;throw new Error('无法读取账号状态栏配置，请检查 settings.json');}
}
function renderStatusLine(command,input,{env=process.env,...options}={}){
  const spec=hudShell(env);const text=spec.powershell?'[Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; '+command:command;
  return renderProcess(spec.file,[...spec.args,text],input,{env,detached:spec.detached,...options});
}
// The built-in HUD is a script run by WbSpace's own runtime, so no shell or quoting is involved.
function renderBuiltinHud(script,input,{env=process.env,...options}={}){
  return renderProcess(process.execPath,[script],input,{env:{...env,ELECTRON_RUN_AS_NODE:'1'},detached:process.platform!=='win32',...options});
}
function renderProcess(file,args,input,{env=process.env,cwd=process.cwd(),timeout=8000,signal,detached=false}={}){
  return new Promise(resolve=>{
    let output='',done=false,overflow=false;
    const child=spawn(file,args,{env,cwd,detached,windowsHide:true,stdio:['pipe','pipe','ignore']});
    const kill=()=>{if(child.pid)try{if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});else process.kill(detached?-child.pid:child.pid,'SIGTERM');}catch{}};
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);resolve(value);};
    const cancel=()=>{kill();finish('');};
    const timer=setTimeout(cancel,timeout);
    if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});
    child.stdin.on('error',()=>{});child.stdin.end(input);child.stdout.setEncoding('utf8');
    child.stdout.on('data',data=>{if(Buffer.byteLength(output)+Buffer.byteLength(data)>128*1024){overflow=true;cancel();}else output+=data.toString();});
    child.once('error',()=>finish(''));
    child.once('close',code=>finish(code===0&&!overflow&&output.trim()?output:''));
  });
}
// A new account starts with an empty config directory. Without a status line of its own it uses the one from the
// default Claude profile, and that HUD runs with the default directory so it finds its plugins and settings there.
async function inheritedStatusLine(accountDirectory,defaultDirectory){
  const own=await configuredStatusLine(accountDirectory);
  if(own||!defaultDirectory||path.resolve(defaultDirectory)===path.resolve(accountDirectory))return {statusLine:own,configDir:null};
  const shared=await configuredStatusLine(defaultDirectory).catch(()=>null);
  return {statusLine:shared,configDir:shared?defaultDirectory:null};
}
const BUILTIN_HUD=path.join(__dirname,'..','vendor','claude-hud','dist','index.js');
// Shown in Chinese unless the account already has its own claude-hud.json; written only into directories WbSpace owns.
async function prepareBuiltinHud(configDirectory){
  const file=path.join(configDirectory,'claude-hud.json');
  try{await fs.writeFile(file,JSON.stringify({language:'zh-Hans'},null,2)+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
}
module.exports={BUILTIN_HUD,configuredStatusLine,inheritedStatusLine,prepareBuiltinHud,renderStatusLine,renderBuiltinHud};
