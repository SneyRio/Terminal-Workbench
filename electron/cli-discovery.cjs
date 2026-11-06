const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const platform=require('./platform.cjs');
const MIN_VERSION='2.1.318';
const supported=v=>v.split(/[.-]/).slice(0,3).map(Number).reduce((result,n,i)=>result||Math.sign(n-Number(MIN_VERSION.split('.')[i])),0)>=0;
function probeEnvironment(env){
 const allowed=new Set(['systemroot','windir','comspec','temp','tmp','userprofile','homedrive','homepath','appdata','localappdata','path','pathext']);
 return {...Object.fromEntries(Object.entries(env).filter(([key])=>allowed.has(key.toLowerCase()))),DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
}
class WindowsCliDiscovery{
 constructor({env=process.env,home=os.homedir(),arch=process.arch,io=fs,run=exec,clock=Date.now}={}){Object.assign(this,{env,home,arch,io,run,clock});this.cache=null;this.pending=new Map();}
 expand(text){return String(text).replace(/%([^%]+)%|\$\{([^}]+)\}/g,(_,a,b)=>platform.value(this.env,a||b)).replace(/^~(?=[\\/]|$)/,this.home).replace(/^"|"$/g,'').trim();}
 async paths(configured){
  const p=path.win32,env=this.env,home=this.home,candidates=[],seen=new Set(),add=(file,source)=>{file=this.expand(file);if(!p.isAbsolute(file)||seen.has(file.toLowerCase()))return;seen.add(file.toLowerCase());candidates.push({path:file,source});};
  if(configured)add(configured,'manual');
  add(p.join(home,'.local','bin','claude.exe'),'native');
  const roots=[platform.value(env,'LOCALAPPDATA'),platform.value(env,'ProgramFiles')].filter(Boolean);
  for(const root of roots){add(p.join(root,'Microsoft','WinGet','Links','claude.exe'),'winget');add(p.join(root,'WinGet','Links','claude.exe'),'winget');}
  const registry=await Promise.all([
   ['HKCU\\Environment','Path'],['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment','Path'],
   ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\claude.exe',null],['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\claude.exe',null]
  ].map(async([key,value])=>{try{const result=await this.run(p.join(platform.value(env,'SystemRoot')||'C:\\Windows','System32','reg.exe'),['query',key,...(value?['/v',value]:['/ve'])],{env:probeEnvironment(env),windowsHide:true,timeout:1500,maxBuffer:128*1024});return {value,text:result.stdout.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/)?.[1]||''};}catch{return {value,text:''};}}));
  const directories=[...new Set([...platform.searchPath(env,'win32',home).split(';'),...registry.filter(x=>x.value).flatMap(x=>x.text.split(';'))].map(d=>this.expand(d)).filter(d=>p.isAbsolute(d)))].slice(0,80);
  for(const entry of registry.filter(x=>!x.value&&x.text))add(entry.text,'registry');
  const prefixes=[platform.value(env,'APPDATA')&&p.join(platform.value(env,'APPDATA'),'npm'),platform.value(env,'NPM_CONFIG_PREFIX'),...directories].filter(Boolean);
  try{const file=p.join(home,'.npmrc');if((await this.io.stat(file)).size<256*1024){const text=await this.io.readFile(file,'utf8'),prefix=text.match(/^\s*prefix\s*=\s*([^\r\n]+)/mi)?.[1];if(prefix)prefixes.unshift(this.expand(prefix));}}catch{}
  for(const prefix of [...new Set(prefixes)]){
   const base=p.join(prefix,'node_modules','@anthropic-ai');
   for(const relative of ['claude-code/bin/claude.exe',`claude-code-win32-${this.arch}/claude.exe`,`claude-code-win32-${this.arch}/bin/claude.exe`,`claude-code/node_modules/@anthropic-ai/claude-code-win32-${this.arch}/claude.exe`])add(p.join(base,relative),'npm');
  }
  for(const directory of directories)add(p.join(directory,'claude.exe'),'path');
  for(const root of [platform.value(env,'SCOOP')||p.join(home,'scoop'),platform.value(env,'SCOOP_GLOBAL'),platform.value(env,'ProgramData')&&p.join(platform.value(env,'ProgramData'),'scoop')].filter(Boolean))add(p.join(root,'apps','claude-code','current','claude.exe'),'scoop');
  const chocolatey=platform.value(env,'ChocolateyInstall');if(chocolatey){add(p.join(chocolatey,'bin','claude.exe'),'chocolatey');add(p.join(chocolatey,'lib','claude-code','tools','claude.exe'),'chocolatey');}
  for(const root of roots)for(const folder of [p.join(root,'Microsoft','WinGet','Packages'),p.join(root,'WinGet','Packages')]){
   try{for(const entry of (await this.io.readdir(folder,{withFileTypes:true})).filter(x=>x.isDirectory()&&/^Anthropic\.ClaudeCode_/i.test(x.name)).slice(0,20))add(p.join(folder,entry.name,'claude.exe'),'winget');}catch{}
  }
  return {candidates,directories};
 }
 async detect(configured='',{refresh=false}={}){
  if(!refresh&&this.cache?.configured===configured&&this.clock()-this.cache.time<(this.cache.result.path?30000:5000)){
   if(!this.cache.result.path)return this.cache.result;
   try{const stat=await this.io.stat(this.cache.result.path);if(this.cache.signature===stat.size+':'+stat.mtimeMs)return this.cache.result;}catch{}
  }
  if(this.pending.has(configured))return this.pending.get(configured);
  const job=this.scan(configured).finally(()=>this.pending.delete(configured));this.pending.set(configured,job);return job;
 }
 async scan(configured){
  const {candidates,directories}=await this.paths(configured),issues=[];let outdated,probes=0;
  for(const candidate of candidates){
   let stat;try{stat=await this.io.stat(candidate.path);if(!stat.isFile())continue;}catch{if(candidate.source==='manual')issues.push({path:candidate.path,reason:'原配置文件不存在'});continue;}
   if(!/\.exe$/i.test(candidate.path)){issues.push({path:candidate.path,reason:'启动脚本不能代替实际可执行程序'});continue;}
   if(probes++>=8)break;
   try{
    const {stdout}=await this.run(candidate.path,['--version'],{env:probeEnvironment(this.env),windowsHide:true,timeout:3000,maxBuffer:64*1024});
    const version=stdout.match(/(?:^|\n)\s*(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s+\(Claude Code\b/i)?.[1]||stdout.match(/Claude Code[^\d\r\n]{0,10}(\d+\.\d+\.\d+(?:-[\w.-]+)?)/i)?.[1];
    if(!version)throw new Error('not-claude');
    if(!supported(version)){outdated||=version;issues.push({path:candidate.path,reason:'版本过旧：'+version});continue;}
    const result={status:'ready',path:candidate.path,source:candidate.source,version,recovered:!!configured&&candidate.path.toLowerCase()!==configured.toLowerCase(),message:'已自动找到可用的 Claude Code '+version,issues};
    this.cache={configured,time:this.clock(),signature:stat.size+':'+stat.mtimeMs,result};return result;
   }catch{issues.push({path:candidate.path,reason:'程序无法正常启动或版本信息无效'});}
  }
  for(const directory of directories)for(const name of ['claude.ps1','claude.cmd']){const file=path.win32.join(directory,name);try{if((await this.io.stat(file)).isFile())issues.push({path:file,reason:'发现启动脚本，未找到可运行的程序'});}catch{}}
  const status=outdated?'outdated':issues.length?'broken':'missing',message=outdated?'检测到 Claude Code '+outdated+'，请升级至 '+MIN_VERSION+' 或更新版本':issues.length?'检测到 Claude 启动入口，但没有可运行的程序，请修复安装后重新检测':'尚未检测到 Claude Code，请先安装，再点击重新检测';
  const result={status,path:'',message,issues};this.cache={configured,time:this.clock(),result};return result;
 }
}
module.exports={WindowsCliDiscovery,probeEnvironment,MIN_VERSION};
