const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);

const resultFile='last-result.json';

const macHelper=`#!/bin/sh
# Runs detached after the app quits: swaps the bundle, restores it on failure, then relaunches.
pid="$1"; target="$2"; staged="$3"; result="$4"; version="$5"
report() { printf '{"version":"%s","ok":%s,"reason":"%s"}\\n' "$version" "$1" "$2" > "$result"; }
relaunch() {
  if [ -n "$ACCOUNTOR_DATA_DIR" ]; then /usr/bin/open --env "ACCOUNTOR_DATA_DIR=$ACCOUNTOR_DATA_DIR" "$target"; else /usr/bin/open "$target"; fi
}
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt 300 ]; then report false timeout; exit 1; fi
  sleep 0.2
done
backup="$target.update-old-$$"
if ! /bin/mv "$target" "$backup"; then report false permission; relaunch; exit 1; fi
if ! /bin/mv "$staged" "$target"; then
  /bin/rm -rf "$target"
  /bin/mv "$backup" "$target"
  report false replace
  relaunch
  exit 1
fi
/bin/rm -rf "$backup"
report true installed
relaunch
`;

const windowsHelper=`$ErrorActionPreference = 'Stop'
$exe = $env:WB_UPDATE_EXE
function Report($ok, $reason) {
  $json = @{ version = $env:WB_UPDATE_VERSION; ok = $ok; reason = $reason } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($env:WB_UPDATE_RESULT, $json)
}
try {
  $old = Get-Process -Id ([int]$env:WB_UPDATE_PID) -ErrorAction SilentlyContinue
  if ($old -and -not $old.WaitForExit(60000)) { Report $false 'timeout'; exit 1 }
  Start-Sleep -Milliseconds 500
  $dir = Split-Path -Parent $exe
  $installer = Start-Process -FilePath $env:WB_UPDATE_INSTALLER -ArgumentList "/S --updated /D=$dir" -PassThru -Wait
  if ($installer.ExitCode -ne 0) { Report $false ('installer-' + $installer.ExitCode) } else { Report $true 'installed' }
} catch {
  Report $false 'error'
}
Start-Process -FilePath $exe
`;

// Decides whether this copy can replace itself; anything else falls back to the download page.
function resolveInstall({platform,arch,isPackaged,exePath,exists=fs.existsSync,writable=isWritable}){
 const manual=reason=>({mode:'manual',reason});
 if(!isPackaged)return manual('开发环境不支持一键更新，请前往下载页。');
 if(platform==='win32'&&arch==='x64'){
  if(!exists(path.join(path.dirname(exePath),'Uninstall WbSpace.exe')))return manual('解压版不支持一键更新，请前往下载页下载新版本。');
  return {mode:'auto',target:exePath};
 }
 if(platform==='darwin'&&arch==='arm64'){
  const bundle=/^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath)?.[1];
  if(!bundle)return manual('无法定位应用包，请前往下载页手动更新。');
  if(bundle.startsWith('/Volumes/')||bundle.includes('/AppTranslocation/'))return manual('请先把 WbSpace 拖入“应用程序”并从那里打开，之后才能一键更新。');
  if(!writable(bundle)||!writable(path.dirname(bundle)))return manual('当前用户无权修改应用所在目录，请前往下载页手动更新。');
  return {mode:'auto',target:bundle};
 }
 return manual('当前平台不支持一键更新，请前往下载页。');
}
function isWritable(file){try{fs.accessSync(file,fs.constants.W_OK);return true;}catch{return false;}}

// Refuses a package that is not this same app at exactly the expected version.
async function prepareMacBundle(zip,dir,version,target){
 const stage=path.join(dir,'stage');
 await fsp.rm(stage,{recursive:true,force:true});await fsp.mkdir(stage,{recursive:true});
 try{await exec('/usr/bin/ditto',['-x','-k',zip,stage]);}catch{throw new Error('安装包无法解压，已停止更新');}
 const bundle=path.join(stage,'WbSpace.app'),plist=path.join(bundle,'Contents/Info.plist');
 const read=async(key,file=plist)=>(await exec('/usr/bin/plutil',['-extract',key,'raw','-o','-',file])).stdout.trim();
 let id,found,expectedId;
 try{id=await read('CFBundleIdentifier');found=await read('CFBundleShortVersionString');expectedId=await read('CFBundleIdentifier',path.join(target,'Contents/Info.plist'));}catch{throw new Error('安装包内容不完整，已停止更新');}
 if(id!==expectedId||found!==version)throw new Error('安装包与目标版本不符，已停止更新');
 try{await exec('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);}catch{throw new Error('安装包代码签名结构校验失败，已停止更新');}
 return bundle;
}

async function launchHelper({platform,target,artifact,dir,version,pid=process.pid,spawner=spawn}){
 const result=path.join(dir,resultFile);
 if(platform==='darwin'){
  const script=path.join(dir,'install-update.sh');
  await fsp.writeFile(script,macHelper,{mode:0o700});
  const child=spawner('/bin/sh',[script,String(pid),target,artifact,result,version],{detached:true,stdio:'ignore'});child.unref();return child;
 }
 if(platform==='win32'){
  const script=path.join(dir,'install-update.ps1');
  await fsp.writeFile(script,windowsHelper);
  const env={...process.env,WB_UPDATE_PID:String(pid),WB_UPDATE_EXE:target,WB_UPDATE_INSTALLER:artifact,WB_UPDATE_RESULT:result,WB_UPDATE_VERSION:version};
  const child=spawner('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{detached:true,windowsHide:true,stdio:'ignore',env});child.unref();return child;
 }
 throw new Error('当前平台不支持一键更新');
}

// Reads what the helper reported for the previous run and clears everything it left behind.
async function consumeResult(dir){
 let result=null;
 try{result=JSON.parse(await fsp.readFile(path.join(dir,resultFile),'utf8'));}catch{}
 await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});
 return result;
}

module.exports={resolveInstall,prepareMacBundle,launchHelper,consumeResult,macHelper,windowsHelper,resultFile};
