const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
function legacyActivity(output,legacyPath){
  const commands=output.split('\n').map(line=>line.trim().replace(/^\d+\s+/,''));
  const prefix=legacyPath+'/Contents/MacOS/Claude Accountor';
  return {inUse:commands.some(cmd=>cmd.includes(legacyPath+'/')),mainRunning:commands.some(cmd=>cmd.startsWith(prefix)&&!cmd.includes('--type=')&&!cmd.includes('.cjs')&&!cmd.includes('--settings'))};
}
async function inspectLegacy(legacyPath){
  const {stdout}=await promisify(execFile)('/bin/ps',['-axo','pid=,command='],{maxBuffer:4*1024*1024});
  return legacyActivity(stdout,legacyPath);
}
async function retireLegacy(legacyPath,backupPath){
  try{await fs.lstat(legacyPath);}catch(error){if(error.code==='ENOENT')return {retired:false};throw error;}
  const activity=await inspectLegacy(legacyPath);
  if(activity.inUse)return {retired:false,deferred:true};
  await fs.mkdir(path.dirname(backupPath),{recursive:true});await fs.rename(legacyPath,backupPath);
  return {retired:true,backup:backupPath};
}
module.exports={legacyActivity,inspectLegacy,retireLegacy};
