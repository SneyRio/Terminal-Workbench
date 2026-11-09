// MCP servers and command-line tools shared by every agent. Both are configured once in WbSpace and applied when a
// session starts, without changing any agent's own configuration files.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const AGENT_IDS=['claude-code','codex-cli','qoder-cli','opencode'];
const NAME=/^[A-Za-z0-9_-]{1,64}$/;
const KEY=/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const clean=(v,max=4096)=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,max);
const agentsOf=list=>{const a=[...new Set((Array.isArray(list)?list:[]).filter(x=>AGENT_IDS.includes(x)))];return a.length===AGENT_IDS.length?[]:a;};
const appliesTo=(entry,agentId)=>entry.enabled!==false&&(!entry.agents?.length||entry.agents.includes(agentId));
const id=()=>crypto.randomUUID();

/* ---------- MCP servers ---------- */

function cleanMap(map,label){
 const out={};
 for(const [k,v] of Object.entries(map&&typeof map==='object'?map:{})){
  if(!KEY.test(k))throw new Error(`${label}名称无效：${k}`);
  out[k]=clean(v,16384);
 }
 return out;
}
// The public part of a server; secret values (env, headers) are kept separately and encrypted.
function normalizeServer(input,{existing}={}){
 const name=clean(input?.name,64).trim();
 if(!NAME.test(name))throw new Error('MCP 名称只能包含字母、数字、下划线和短横线（最多 64 个字符）');
 const type=input?.type==='http'?'http':'stdio';
 const server={id:typeof input?.id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(input.id)?input.id:id(),name,type,enabled:input?.enabled!==false,agents:agentsOf(input?.agents),source:clean(input?.source||existing?.source||'manual',40),note:clean(input?.note||'',200)};
 if(type==='stdio'){
  server.command=clean(input?.command,1024).trim();if(!server.command)throw new Error(`「${name}」缺少启动命令`);
  server.args=(Array.isArray(input?.args)?input.args:[]).map(a=>clean(a,4096)).slice(0,64);
 }else{
  // ${VAR} references are expanded at launch, so they are checked with a placeholder value.
  const raw=clean(input?.url,2048).trim();let url;
  try{url=new URL(raw.replace(/\$\{[^}]*\}/g,'x'));}catch{throw new Error(`「${name}」的地址不是有效 URL`);}
  if(!['http:','https:'].includes(url.protocol))throw new Error(`「${name}」的地址必须是 HTTP(S)`);
  server.url=/\$\{/.test(raw)?raw:url.toString();
 }
 return server;
}
function normalizeServers(list,secrets,previous=[]){
 if(!Array.isArray(list)||list.length>100)throw new Error('MCP 列表格式无效（最多 100 个）');
 const names=new Set(),nextSecrets={};
 const servers=list.map(input=>{
  const before=previous.find(p=>p.id===input?.id);
  const server=normalizeServer(input,{existing:before});
  if(names.has(server.name.toLowerCase()))throw new Error(`MCP 名称重复：${server.name}`);names.add(server.name.toLowerCase());
  // Secrets are only replaced when the caller sends them; otherwise the stored values stay.
  const old=secrets[server.id]||{env:{},headers:{}};
  nextSecrets[server.id]={env:input?.env!==undefined?cleanMap(input.env,'环境变量'):old.env||{},headers:input?.headers!==undefined?cleanMap(input.headers,'请求头'):old.headers||{}};
  if(server.type==='stdio')nextSecrets[server.id].headers={};else nextSecrets[server.id].env={};
  server.envKeys=Object.keys(nextSecrets[server.id].env);server.headerKeys=Object.keys(nextSecrets[server.id].headers);
  return server;
 });
 return {servers,secrets:nextSecrets};
}

class McpSecrets{
 constructor(file,vault){this.file=file;this.vault=vault;}
 async read(){
  try{return JSON.parse(this.vault.decryptString(await fs.readFile(this.file)));}
  catch(error){if(error.code==='ENOENT')return {};throw new Error('无法解密 MCP 密钥，请重新填写');}
 }
 async write(secrets){
  if(!this.vault.isEncryptionAvailable())throw new Error('系统安全存储不可用，未保存 MCP 密钥');
  await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
  const tmp=this.file+'.'+process.pid+'.tmp';
  try{await fs.writeFile(tmp,this.vault.encryptString(JSON.stringify(secrets)),{mode:0o600});await fs.rename(tmp,this.file);}finally{await fs.rm(tmp,{force:true});}
 }
}

// Reads servers from each agent's user configuration. Returns full entries, secrets included.
const readJson=file=>fs.readFile(file,'utf8').then(text=>JSON.parse(text.replace(/^\s*\/\/.*$/gm,''))).catch(()=>null);
function fromClaudeStyle(map,source){
 return Object.entries(map&&typeof map==='object'?map:{}).map(([name,s])=>{
  const http=s?.url&&(s.type==='http'||s.type==='sse'||!s.command);
  return http?{name,type:'http',url:s.url,headers:s.headers||{},enabled:s.disabled!==true,source}:{name,type:'stdio',command:s?.command,args:s?.args||[],env:s?.env||{},enabled:s?.disabled!==true,source};
 });
}
function fromOpencode(map){
 return Object.entries(map&&typeof map==='object'?map:{}).map(([name,s])=>{
  if(s?.type==='remote')return {name,type:'http',url:s.url,headers:s.headers||{},enabled:s.enabled!==false,source:'OpenCode'};
  const [command,...args]=Array.isArray(s?.command)?s.command:[];
  return {name,type:'stdio',command,args,env:s?.environment||{},enabled:s?.enabled!==false,source:'OpenCode'};
 });
}
// Codex's own app tools depend on the Codex runtime (relative paths, forwarded variables), so they stay with Codex.
function fromCodex(list){
 const out=[];
 for(const s of Array.isArray(list)?list:[]){
  const t=s?.transport||{};
  if(t.type==='streamable_http'){if(t.url)out.push({name:s.name,type:'http',url:t.url,headers:t.http_headers||{},enabled:s.enabled!==false,source:'Codex'});continue;}
  if(t.type!=='stdio'||!t.command)continue;
  const text=[t.command,...(t.args||[])].join(' ');
  if(t.cwd||(t.env_vars||[]).length||/ChatGPT\.app|[\\/]\.codex[\\/]plugins|^\.{1,2}[\\/]/.test(text))continue;
  out.push({name:s.name,type:'stdio',command:t.command,args:t.args||[],env:t.env||{},enabled:s.enabled!==false,source:'Codex'});
 }
 return out;
}
async function scanMcp({home,codexList}={}){
 const found=[];
 // The default Claude config is ~/.claude.json; each CLAUDE_CONFIG_DIR such as ~/.claude-work keeps its own inside.
 let dirs=[];try{dirs=(await fs.readdir(home)).filter(n=>/^\.claude-[\w.-]+$/.test(n)).sort();}catch{}
 for(const file of [path.join(home,'.claude.json'),...dirs.map(d=>path.join(home,d,'.claude.json'))]){
  const data=await readJson(file);if(data?.mcpServers)found.push(...fromClaudeStyle(data.mcpServers,'Claude'));
 }
 const qoder=await readJson(path.join(home,'.qoder','mcp.json'));if(qoder?.mcpServers)found.push(...fromClaudeStyle(qoder.mcpServers,'Qoder'));
 for(const f of ['opencode.json','opencode.jsonc']){const data=await readJson(path.join(home,'.config','opencode',f));if(data?.mcp)found.push(...fromOpencode(data.mcp));}
 if(codexList)found.push(...fromCodex(codexList));
 const valid=[];
 for(const s of found){try{normalizeServer(s);valid.push(s);}catch{}}
 return valid;
}
// Adds servers not seen before. A name already in the list, or one the user removed, is left alone.
function mergeScanned(current,secrets,scanned,dismissed=[]){
 const servers=[...current],nextSecrets={...secrets},added=[];
 const taken=new Set(servers.map(s=>s.name.toLowerCase())),gone=new Set(dismissed.map(n=>n.toLowerCase()));
 for(const s of scanned){
  const key=s.name.toLowerCase();if(taken.has(key)||gone.has(key))continue;taken.add(key);
  const server=normalizeServer({...s,source:s.source,note:'自动扫描自 '+s.source});
  nextSecrets[server.id]={env:s.type==='stdio'?cleanMap(s.env,'环境变量'):{},headers:s.type==='http'?cleanMap(s.headers,'请求头'):{}};
  server.envKeys=Object.keys(nextSecrets[server.id].env);server.headerKeys=Object.keys(nextSecrets[server.id].headers);
  servers.push(server);added.push(server.name);
 }
 return {servers,secrets:nextSecrets,added};
}

// ${VAR} and ${VAR:-default} as Claude Code writes them; Codex and OpenCode do not expand this syntax themselves.
function expandVars(value,lookup){
 return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,(match,name,fallback)=>{const v=lookup(name);return v!==undefined&&v!==''?v:fallback!==undefined?fallback:match;});
}
const expandMap=(map,lookup)=>Object.fromEntries(Object.entries(map||{}).map(([k,v])=>[k,expandVars(v,lookup)]));
const tomlKey=k=>/^[A-Za-z0-9_-]+$/.test(k)?k:JSON.stringify(k);
const tomlTable=map=>'{'+Object.entries(map).map(([k,v])=>`${tomlKey(k)}=${JSON.stringify(v)}`).join(',')+'}';
// How each agent receives the servers: Claude Code and Qoder read a JSON file, Codex takes session flags,
// OpenCode reads its config from the environment.
async function mcpLaunch(agentId,servers,secrets,{file,env={},lookup=()=>undefined}={}){
 const plan={args:[],env:{},file:''};
 const active=servers.filter(s=>appliesTo(s,agentId));
 if(!active.length)return plan;
 const full=active.map(s=>({...s,command:s.command&&expandVars(s.command,lookup),args:(s.args||[]).map(a=>expandVars(a,lookup)),url:s.url&&expandVars(s.url,lookup),env:expandMap(secrets[s.id]?.env,lookup),headers:expandMap(secrets[s.id]?.headers,lookup)}));
 if(agentId==='claude-code'||agentId==='qoder-cli'){
  const mcpServers=Object.fromEntries(full.map(s=>[s.name,s.type==='http'?{type:'http',url:s.url,...(Object.keys(s.headers).length?{headers:s.headers}:{})}:{type:'stdio',command:s.command,args:s.args,...(Object.keys(s.env).length?{env:s.env}:{})}]));
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  await fs.writeFile(file,JSON.stringify({mcpServers},null,2),{mode:0o600});
  plan.file=file;plan.args=['--mcp-config',file];
 }else if(agentId==='codex-cli'){
  for(const s of full){
   const base='mcp_servers.'+s.name;
   if(s.type==='http'){plan.args.push('-c',`${base}.url=${JSON.stringify(s.url)}`);if(Object.keys(s.headers).length)plan.args.push('-c',`${base}.http_headers=${tomlTable(s.headers)}`);}
   else{plan.args.push('-c',`${base}.command=${JSON.stringify(s.command)}`,'-c',`${base}.args=[${s.args.map(a=>JSON.stringify(a)).join(',')}]`);if(Object.keys(s.env).length)plan.args.push('-c',`${base}.env=${tomlTable(s.env)}`);}
  }
 }else if(agentId==='opencode'){
  let config={};try{config=env.OPENCODE_CONFIG_CONTENT?JSON.parse(env.OPENCODE_CONFIG_CONTENT):{};}catch{config={};}
  const mcp={...(config.mcp||{})};
  for(const s of full)mcp[s.name]=s.type==='http'?{type:'remote',url:s.url,enabled:true,...(Object.keys(s.headers).length?{headers:s.headers}:{})}:{type:'local',command:[s.command,...s.args],enabled:true,...(Object.keys(s.env).length?{environment:s.env}:{})};
  plan.env.OPENCODE_CONFIG_CONTENT=JSON.stringify({$schema:'https://opencode.ai/config.json',...config,mcp});
 }
 return plan;
}

/* ---------- Command-line tools ---------- */

// Common tools an agent can use once it knows they are installed. Users add their own as well.
const CLI_CATALOG=[
 ['gh','GitHub CLI：仓库、Pull Request、Issue、Actions'],['glab','GitLab CLI：仓库、Merge Request、流水线'],['git','Git 版本控制'],
 ['docker','Docker：镜像与容器'],['kubectl','Kubernetes 集群操作'],['helm','Kubernetes 包管理'],['terraform','Terraform 基础设施即代码'],
 ['aws','AWS CLI'],['gcloud','Google Cloud CLI'],['az','Azure CLI'],['aliyun','阿里云 CLI'],
 ['jq','JSON 处理'],['yq','YAML 处理'],['rg','ripgrep：快速全文搜索'],['fd','快速查找文件'],['fzf','模糊查找'],['httpie','HTTP 客户端'],['curl','HTTP 请求'],
 ['node','Node.js'],['pnpm','pnpm 包管理'],['yarn','Yarn 包管理'],['bun','Bun 运行时'],['deno','Deno 运行时'],['python3','Python 3'],['uv','Python 包与环境管理'],
 ['go','Go 工具链'],['cargo','Rust 工具链'],['java','Java'],['mvn','Maven'],['gradle','Gradle'],
 ['psql','PostgreSQL 客户端'],['mysql','MySQL 客户端'],['redis-cli','Redis 客户端'],['mongosh','MongoDB Shell'],['sqlite3','SQLite'],
 ['ffmpeg','音视频处理'],['pandoc','文档格式转换'],['make','Make 构建']
].map(([command,description])=>({command,description}));

async function findOnPath(command,dirs,{platform=process.platform,access=fs.access}={}){
 const p=platform==='win32'?path.win32:path.posix,names=platform==='win32'?['.exe','.cmd','.bat'].map(e=>command+e):[command];
 for(const dir of dirs)for(const name of names){const file=p.join(dir,name);try{await access(file,platform==='win32'?undefined:1);return file;}catch{}}
 return '';
}
async function scanCli(dirs,opts){
 const out=[];
 for(const t of CLI_CATALOG){const file=await findOnPath(t.command,dirs,opts);if(file)out.push({...t,path:file});}
 return out;
}
function normalizeTools(list){
 if(!Array.isArray(list)||list.length>200)throw new Error('CLI 列表格式无效（最多 200 个）');
 const seen=new Set();
 return list.map(input=>{
  const command=clean(input?.command,64).trim();
  if(!/^[A-Za-z0-9_.+-]{1,64}$/.test(command))throw new Error('命令名只能包含字母、数字和 _ . + -');
  if(seen.has(command))throw new Error('命令重复：'+command);seen.add(command);
  const file=clean(input?.path,2048).trim();
  if(file&&!path.isAbsolute(file)&&!path.win32.isAbsolute(file))throw new Error(`「${command}」的路径必须是绝对路径`);
  return {id:typeof input?.id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(input.id)?input.id:id(),command,path:file,description:clean(input?.description,500).trim(),enabled:input?.enabled===true,agents:agentsOf(input?.agents),source:input?.source==='scan'?'scan':'manual'};
 });
}
function mergeScannedTools(current,found){
 const tools=[...current],have=new Set(current.map(t=>t.command)),added=[];
 for(const f of found){
  const known=tools.find(t=>t.command===f.command);
  if(known){if(!known.path)known.path=f.path;continue;}
  if(have.has(f.command))continue;have.add(f.command);
  tools.push({id:id(),command:f.command,path:f.path,description:f.description,enabled:false,agents:[],source:'scan'});added.push(f.command);
 }
 return {tools,added};
}
// PATH additions and a short note so the agent knows the tools exist.
function cliLaunch(tools,agentId,platform=process.platform){
 const active=(tools||[]).filter(t=>appliesTo(t,agentId)&&t.enabled);
 const p=platform==='win32'?path.win32:path.posix;
 const dirs=[...new Set(active.filter(t=>t.path).map(t=>p.dirname(t.path)))];
 const prompt=active.length?'本机已安装以下命令行工具，需要时可直接在终端中调用：\n'+active.map(t=>`- ${t.command}${t.path?`（${t.path}）`:''}${t.description?'：'+t.description:''}`).join('\n'):'';
 return {dirs,prompt};
}

module.exports={expandVars,AGENT_IDS,normalizeServer,normalizeServers,McpSecrets,scanMcp,fromClaudeStyle,fromOpencode,fromCodex,mergeScanned,mcpLaunch,CLI_CATALOG,findOnPath,scanCli,normalizeTools,mergeScannedTools,cliLaunch};
