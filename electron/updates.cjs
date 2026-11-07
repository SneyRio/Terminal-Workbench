const crypto=require('node:crypto');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');

const repository='SneyRio/Terminal-Workbench';
const endpoint=`https://api.github.com/repos/${repository}/releases/latest`;
const releasePage=`https://github.com/${repository}/releases`;
const checksumAsset='SHA256SUMS.txt';
// GitHub serves release files from these hosts after redirecting; anything else is refused.
const downloadHosts=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
const updateHosts=new Set(['api.github.com',...downloadHosts]);
const maxPackageBytes=1024*1024*1024;
const stallTimeoutMs=60000;

function parseVersion(value){const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value||'');return m?m.slice(1).map(Number):null;}
function newer(a,b){a=parseVersion(a);b=parseVersion(b);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}

// Only the package built for this exact platform and version qualifies, and it must ship with checksums.
function pickAsset(data,platform,arch){
 const version=data.tag_name.replace(/^v/,'').replace(/\./g,'\\.');
 const pattern=platform==='win32'&&arch==='x64'?new RegExp(`^WbSpace-${version}-windows-x64-setup\\.exe$`):platform==='darwin'&&arch==='arm64'?new RegExp(`^WbSpace-${version}-mac-arm64(-[a-z-]+)?\\.zip$`):null;
 const assets=Array.isArray(data.assets)?data.assets:[];
 const found=pattern&&assets.find(a=>typeof a?.name==='string'&&pattern.test(a.name));
 if(!found||!assets.some(a=>a?.name===checksumAsset)||!Number.isSafeInteger(found.size)||found.size<=0||found.size>maxPackageBytes)return null;
 return {name:found.name,size:found.size};
}

async function check(current,fetcher=fetch,platform=process.platform,arch=process.arch){
 let response;try{response=await fetcher(endpoint,{headers:{Accept:'application/vnd.github+json','User-Agent':'Terminal-Workbench'},signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new Error('网络不可用或请求超时，请检查网络后重试，也可以在下方设置更新代理');}
 if(response.status===404)return {status:'unpublished',current,url:releasePage,message:'尚未发布可下载版本，源码提交不等于安装包发布。'};
 if(!response.ok)throw new Error(response.status===403||response.status===429?'更新服务请求受限，请稍后重试':'暂时无法检查更新');
 const body=await response.text();if(body.length>512*1024)throw new Error('更新信息过大');const data=JSON.parse(body);
 if(!parseVersion(data.tag_name)||data.draft||data.prerelease)throw new Error('更新服务未返回有效正式版本');
 const latest=data.tag_name.replace(/^v/,'');
 if(!newer(data.tag_name,current))return {status:'current',current,latest,url:releasePage,message:'当前版本无需更新。'};
 return {status:'available',current,latest,tag:data.tag_name,asset:pickAsset(data,platform,arch),url:releasePage,message:`发现新版本 ${latest}。`};
}

// Electron's fetch hides the address it was redirected to, so this is enforced on every request by the network layer.
function isTrustedUpdateUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&updateHosts.has(url.hostname);}catch{return false;}
}

// Accepts `host:port` or a full proxy URL, and refuses anything that could carry credentials into saved settings.
function normalizeProxy(value){
 const text=typeof value==='string'?value.trim():'';
 if(!text)return '';
 let url;try{url=new URL(/^[a-z0-9]+:\/\//i.test(text)?text:'http://'+text);}catch{throw new Error('代理地址格式不正确，例如 http://127.0.0.1:7897');}
 if(!['http:','https:','socks5:'].includes(url.protocol))throw new Error('代理只支持 http、https 和 socks5');
 if(url.username||url.password)throw new Error('代理地址不能包含账号或密码');
 if(!url.hostname||!url.port||(url.pathname&&url.pathname!=='/')||url.search||url.hash)throw new Error('代理地址需要包含主机和端口，例如 http://127.0.0.1:7897');
 return `${url.protocol}//${url.hostname}:${url.port}`;
}

function assetUrl(tag,name){return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;}

async function fetchAsset(url,fetcher,signal){
 let response;
 try{response=await fetcher(url,{headers:{'User-Agent':'Terminal-Workbench'},signal,redirect:'follow'});}
 catch(error){if(signal?.aborted)throw error;throw new Error('下载失败，请检查网络后重试');}
 if(!response.ok)throw new Error(`下载失败（HTTP ${response.status}），请稍后重试`);
 if(response.url&&!downloadHosts.has(new URL(response.url).hostname))throw new Error('下载地址不受信任，已停止更新');
 return response;
}

function parseChecksums(text,name){
 for(const line of text.split(/\r?\n/)){const m=/^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());if(m&&m[2]===name)return m[1].toLowerCase();}
 throw new Error('校验清单中没有当前安装包，已停止更新');
}

async function downloadPackage({tag,asset,dir,fetcher=fetch,signal,onProgress=()=>{}}){
 const controller=new AbortController();const cancel=()=>controller.abort();
 if(signal?.aborted)cancel();signal?.addEventListener('abort',cancel,{once:true});
 let timer;const armStall=()=>{clearTimeout(timer);timer=setTimeout(cancel,stallTimeoutMs);};
 await fsp.mkdir(dir,{recursive:true});
 const file=path.join(dir,asset.name),partial=file+'.part';
 try{
  armStall();
  const listing=await fetchAsset(assetUrl(tag,checksumAsset),fetcher,controller.signal);
  const text=await listing.text();if(text.length>64*1024)throw new Error('校验清单过大');
  const expected=parseChecksums(text,asset.name);
  armStall();
  const response=await fetchAsset(assetUrl(tag,asset.name),fetcher,controller.signal);
  if(!response.body)throw new Error('下载失败，请稍后重试');
  const hash=crypto.createHash('sha256'),out=fs.createWriteStream(partial);let received=0,writeError=null,complete=false;
  out.on('error',error=>{writeError=error;});
  try{
   const reader=response.body.getReader();
   for(;;){
    armStall();
    const {done,value}=await reader.read();
    if(done)break;
    received+=value.length;
    if(received>asset.size)throw new Error('安装包大小与发布信息不符，已停止更新');
    hash.update(value);
    if(writeError)throw writeError;
    if(!out.write(value))await new Promise((resolve,reject)=>{
     const drained=()=>{out.off('error',failed);resolve();},failed=error=>{out.off('drain',drained);reject(error);};
     out.once('drain',drained);out.once('error',failed);
    });
    onProgress(received,asset.size);
   }
   complete=true;
  }finally{await new Promise(resolve=>{out.once('close',resolve);if(complete)out.end();else out.destroy();});}
  if(writeError)throw new Error('无法写入安装包，请检查磁盘空间后重试');
  if(received!==asset.size)throw new Error('安装包下载不完整，请重试');
  if(hash.digest('hex')!==expected)throw new Error('安装包校验失败，已丢弃下载内容');
  await fsp.rename(partial,file);
  return file;
 }catch(error){
  await fsp.rm(partial,{force:true}).catch(()=>{});
  if(controller.signal.aborted&&!signal?.aborted)throw new Error('下载长时间没有响应，请重试');
  throw error;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}

// Owns the update flow so the renderer can only request steps, never supply URLs, paths or hashes.
function createUpdater({current,dir,fetcher,emit=()=>{},resolveInstall,prepare,platform=process.platform,arch=process.arch}){
 let state={phase:'idle',current},release=null,artifact=null,controller=null;
 const publish=next=>{state={current,...next};emit(state);return state;};
 const manual=reason=>({mode:'manual',reason});
 return {
  state:()=>state,
  artifact:()=>artifact,
  async check(){
   if(state.phase==='downloading')return state;
   const result=await check(current,fetcher,platform,arch);
   if(result.status!=='available'){release=null;artifact=null;return publish({phase:'idle',...result});}
   if(state.phase==='ready'&&state.latest===result.latest)return state;
   const install=result.asset?resolveInstall():manual('新版本已发布，但当前平台的安装包尚未上传，请稍后再试或前往下载页。');
   const {asset,tag,...visible}=result;
   release=install.mode==='auto'?{tag,asset,latest:result.latest}:null;artifact=null;
   return publish({phase:'available',...visible,mode:install.mode,reason:install.reason||'',size:asset?.size||0});
  },
  async download(){
   if(state.phase!=='available'||!release)throw new Error('当前没有可下载的更新，请先检查更新');
   const base=state;controller=new AbortController();
   publish({...base,phase:'downloading',received:0,total:release.asset.size,error:''});
   let last=0;
   try{
    const file=await downloadPackage({tag:release.tag,asset:release.asset,dir,fetcher,signal:controller.signal,onProgress:(received,total)=>{const now=Date.now();if(now-last<200&&received<total)return;last=now;publish({...base,phase:'downloading',received,total,error:''});}});
    publish({...base,phase:'preparing',error:''});
    artifact=await prepare(file,release.latest);
    return publish({...base,phase:'ready',error:'',message:`新版本 ${release.latest} 已下载并通过校验。`});
   }catch(error){
    return publish({...base,phase:'available',error:controller.signal.aborted?'':error.message||'更新失败，请重试'});
   }finally{controller=null;}
  },
  cancel(){controller?.abort();},
 };
}

module.exports={isTrustedUpdateUrl,normalizeProxy,check,newer,parseVersion,pickAsset,parseChecksums,assetUrl,downloadPackage,createUpdater,releasePage,checksumAsset};
