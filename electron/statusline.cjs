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
function renderStatusLine(command,input,{env=process.env,cwd=process.cwd(),timeout=8000,signal}={}){
  return new Promise(resolve=>{
    let output='',done=false,overflow=false;
    const spec=hudShell(env);const text=spec.powershell?'[Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; '+command:command;
    const child=spawn(spec.file,[...spec.args,text],{env,cwd,detached:spec.detached,windowsHide:true,stdio:['pipe','pipe','ignore']});
    const kill=()=>{if(child.pid)try{if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});else process.kill(-child.pid,'SIGTERM');}catch{}};
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
module.exports={configuredStatusLine,renderStatusLine};
