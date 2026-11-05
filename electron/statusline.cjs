const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
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
    const child=spawn('/bin/sh',['-c',command],{env,cwd,detached:true,stdio:['pipe','pipe','ignore']});
    const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}};
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
