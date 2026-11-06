const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function backupBeforeUpgrade(root,version){
 let raw,state;try{raw=await fs.readFile(path.join(root,'state.json'));state=JSON.parse(raw);}catch(e){if(e.code==='ENOENT')return null;throw new Error('本地状态文件不可读，未执行升级；请保留原文件和备份。');}
 if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('本地状态结构无效，原文件未修改');
 if((state.version||1)>1)throw new Error('数据来自更新版本，请安装相应版本后再打开');
 if(state.installVersion===version)return null;
 const parent=path.join(root,'backups.noindex'),dir=path.join(parent,'upgrade-'+Date.now()+'-'+crypto.randomUUID());await fs.mkdir(dir,{recursive:true,mode:0o700});
 try{await fs.writeFile(path.join(dir,'state.json'),raw,{mode:0o600});const vault=path.join(root,'accounts');let count=0;for(const entry of await fs.readdir(vault,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
  if(!entry.isDirectory())continue;for(const file of await fs.readdir(path.join(vault,entry.name))){if(!/^connection-key-[a-zA-Z0-9-]+\.enc$/.test(file))continue;const src=path.join(vault,entry.name,file);if(!(await fs.lstat(src)).isFile())continue;const dest=path.join(dir,'accounts',entry.name);await fs.mkdir(dest,{recursive:true,mode:0o700});await fs.writeFile(path.join(dest,file),await fs.readFile(src),{mode:0o600});count++;}}
 await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({from:state.installVersion||'legacy',to:version,time:Date.now(),encryptedFiles:count,stateSha256:crypto.createHash('sha256').update(raw).digest('hex'),scope:'Local recovery; original CLI history and project files remain in place. Encrypted keys require this Mac user and Keychain.'},null,2),{mode:0o600});
 }catch(e){await fs.rm(dir,{recursive:true,force:true});throw new Error('升级前备份失败，原数据未修改');}
 const backups=(await fs.readdir(parent)).filter(x=>/^upgrade-\d+-[a-z0-9-]+$/.test(x)).sort().reverse();for(const old of backups.slice(5))await fs.rm(path.join(parent,old),{recursive:true,force:true});return dir;
}
module.exports={backupBeforeUpgrade};
