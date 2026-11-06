const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
// Only for reading records created before generic discovery; never advertised as new-user defaults.
const legacy={'claude-jemusbob':'.claude','claude-tomton':'.claude-tomton','claude-dp':'.claude-dp','claude-zmn':'.claude-zmn'};
function existingDirectory(account,home=os.homedir()){const dir=account.configDirectory||(legacy[account.command]&&path.join(home,legacy[account.command]));if(!dir||!path.isAbsolute(dir))throw new Error('原账号配置目录不可用，请重新导入配置');return dir;}
async function profile(directory){if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('请选择 CLI 配置目录');const real=await fs.realpath(directory);if(!(await fs.stat(real)).isDirectory())throw new Error('请选择 CLI 配置目录');let settings={};try{const file=path.join(real,'settings.json');if((await fs.stat(file)).size>2*1024*1024)throw new Error('配置文件过大');settings=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('配置目录中的 settings.json 无法解析');}const env=settings.env||{},custom=!!(env.ANTHROPIC_BASE_URL||env.ANTHROPIC_AUTH_TOKEN||env.ANTHROPIC_API_KEY);return {id:real,name:path.basename(real),configDirectory:real,provider:custom?'custom':'subscription',command:''};}
async function discover(home=os.homedir()){
 const dirs=(await fs.readdir(home,{withFileTypes:true})).filter(x=>(x.isDirectory()||x.isSymbolicLink())&&/^\.claude(?:$|[-_])/.test(x.name)).slice(0,80),profiles=[];
 for(const dir of dirs){try{const p=await profile(path.join(home,dir.name));if(!profiles.some(x=>x.id===p.id))profiles.push(p);}catch{}}
 return profiles;
}
module.exports={existingDirectory,profile,discover};
