const fs=require('node:fs/promises');
const nodePath=require('node:path');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const execPromise=promisify(execFile);

const logLimit=8000;
const installTimeoutMs=10*60*1000;

const pathFor=platform=>platform==='win32'?nodePath.win32:nodePath.posix;

function knownDirectories(home,platform){
 if(platform==='win32')return [];
 const path=pathFor(platform);
 return [path.join(home,'.local/bin'),'/opt/homebrew/bin','/usr/local/bin',path.join(home,'.opencode/bin'),path.join(home,'.qoder/bin'),path.join(home,'.qoder/entry'),path.join(home,'.npm-global/bin')];
}

// GUI apps start with a minimal PATH, so the login shell is asked as well.
async function candidates(bins,{platform,home,shell,searchPath,run,access}){
 const path=pathFor(platform),found=[];
 const add=file=>{if(file&&path.isAbsolute(file)&&!found.includes(file))found.push(file);};
 if(platform==='win32'){
  for(const bin of bins){
   const out=await run('where.exe',[bin],{windowsHide:true,timeout:8000,env:{...process.env,Path:searchPath}}).then(r=>r.stdout,()=>'');
   const lines=out.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
   for(const line of [...lines.filter(l=>/\.exe$/i.test(l)),...lines.filter(l=>/\.cmd$/i.test(l))])add(line);
  }
  return found;
 }
 for(const bin of bins){
  add(await run(shell,['-lc',`command -v -- ${bin}`],{timeout:8000}).then(r=>r.stdout.trim().split('\n').pop(),()=>''));
  for(const dir of [...searchPath.split(':'),...knownDirectories(home,platform)]){
   const file=path.join(dir,bin);
   if(dir&&await access(file,1).then(()=>true,()=>false))add(file);
  }
 }
 return found;
}

// The first candidate that actually runs wins; a file that merely exists does not count as installed.
async function scan(agent,{platform=process.platform,home,shell=process.env.SHELL||'/bin/zsh',searchPath,run=execPromise,access=fs.access}){
 const path=pathFor(platform),issues=[];
 for(const file of await candidates(agent.bins,{platform,home,shell,searchPath,run,access})){
  const env={...process.env,[platform==='win32'?'Path':'PATH']:[path.dirname(file),searchPath].join(platform==='win32'?';':':')};
  delete env.ELECTRON_RUN_AS_NODE;
  const command=platform==='win32'&&/\.cmd$/i.test(file)?[process.env.ComSpec||'cmd.exe',['/d','/c',file,'--version']]:[file,['--version']];
  try{
   const {stdout}=await run(command[0],command[1],{env,windowsHide:true,timeout:15000,maxBuffer:256*1024});
   return {installed:true,path:file,version:/\d+\.\d+[\w.-]*/.exec(stdout)?.[0]||'',issue:'',scannedAt:Date.now()};
  }catch{issues.push(file);}
 }
 return {installed:false,path:'',version:'',issue:issues.length?`找到但无法运行：${issues[0]}`:'',scannedAt:Date.now()};
}

function installCommand(agent,{platform=process.platform,shell=process.env.SHELL||'/bin/zsh'}={}){
 const text=platform==='win32'?agent.install.win32:agent.install.unix;
 return {text,file:platform==='win32'?'powershell.exe':shell,args:platform==='win32'?['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',text]:['-lc',text]};
}

function runInstall(command,{onLog=()=>{},spawner=spawn,timeoutMs=installTimeoutMs}={}){
 return new Promise((resolve,reject)=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawner(command.file,command.args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='',settled=false;
  const finish=fn=>value=>{if(settled)return;settled=true;clearTimeout(timer);fn(value);};
  const done=finish(resolve),fail=finish(reject);
  const timer=setTimeout(()=>{child.kill();fail(new Error('安装超时，请检查网络后重试'));},timeoutMs);
  const append=chunk=>{log=(log+chunk.toString()).slice(-logLimit);onLog(log);};
  child.stdout?.on('data',append);child.stderr?.on('data',append);
  child.on('error',error=>fail(new Error(error.code==='ENOENT'?'缺少安装所需的命令行工具':'无法启动安装程序')));
  child.on('close',code=>{if(code===0)done(log);else fail(new Error(/npm: (command )?not found|npm.*not recognized/i.test(log)?'安装需要 Node.js / npm，请先安装后重试，或查看官方安装说明':`安装失败（退出码 ${code}），详见日志`));});
 });
}

module.exports={scan,candidates,installCommand,runInstall};
