const fs=require('node:fs/promises');
const path=require('node:path');

const protocols=[
 {id:'messages',label:'Anthropic Messages（/v1/messages）',placeholder:'https://gateway.example.com/anthropic',suffix:/\/v1\/messages$/,hint:'/v1/messages'},
 {id:'chat',label:'OpenAI Chat Completions（/chat/completions）',placeholder:'https://gateway.example.com/v1',suffix:/\/chat\/completions$/,hint:'/chat/completions'},
 {id:'responses',label:'OpenAI Responses（/responses）',placeholder:'https://gateway.example.com/v1',suffix:/\/responses$/,hint:'/responses'},
];

// Support below was confirmed by pointing each CLI at a local capture server, not taken from documentation.
const agents=[
 {id:'claude-code',name:'Claude Code',bins:['claude'],protocols:['messages'],authTypes:['bearer','api-key'],login:true,install:{unix:'curl -fsSL https://claude.ai/install.sh | bash',win32:'irm https://claude.ai/install.ps1 | iex'},docs:'https://code.claude.com/docs/en/setup'},
 {id:'codex-cli',name:'Codex CLI',bins:['codex'],protocols:['responses'],authTypes:['bearer'],login:true,install:{unix:'npm install -g @openai/codex',win32:'npm install -g @openai/codex'},docs:'https://github.com/openai/codex'},
 {id:'qoder-cli',name:'Qoder CLI',bins:['qodercli','qoder'],protocols:[],authTypes:[],login:true,unavailable:'只支持官方账号登录，不支持自定义模型',install:{unix:'curl -fsSL https://qoder.com/install | bash',win32:'irm https://qoder.com/install.ps1 | iex'},docs:'https://docs.qoder.com/cli/installation'},
 {id:'opencode',name:'OpenCode',bins:['opencode'],protocols:['messages','chat','responses'],authTypes:['bearer','api-key'],login:true,install:{unix:'curl -fsSL https://opencode.ai/install | bash',win32:'npm install -g opencode-ai'},docs:'https://opencode.ai/docs/'},
];

const agent=id=>{const found=agents.find(a=>a.id===id);if(!found)throw new Error('未知的 Agent 工具');return found;};
const protocol=id=>{const found=protocols.find(p=>p.id===id);if(!found)throw new Error('不支持的 API 协议');return found;};
const supports=(agentId,protocolId)=>agent(agentId).protocols.includes(protocolId);

// Connections saved before the protocol field existed are read from their address.
function protocolOf(connection){
 if(connection?.protocol)return connection.protocol;
 return protocols.find(p=>p.suffix.test(connection?.baseUrl||''))?.id||'messages';
}

// A pasted full endpoint is accepted; each CLI appends its own path.
function normalizeBaseUrl(url,protocolId){
 const current=protocol(protocolId);
 const other=protocols.find(p=>p.id!==protocolId&&p.suffix.test(url));
 if(other)throw new Error(`此地址是 ${other.hint} 接口，与所选协议不符，请改选对应协议或修改地址`);
 return url.replace(current.suffix,'').replace(/\/$/,'');
}

const opencodePackage={messages:'@ai-sdk/anthropic',chat:'@ai-sdk/openai-compatible',responses:'@ai-sdk/openai'};
const opencodePrefix={messages:'/v1',chat:'',responses:''};
const keyVariable='WBSPACE_PROVIDER_KEY';

// Codex keeps its own state in config.toml (trusted folders, hook trust, model choices), so only WbSpace's lines are
// replaced: the top-level model and model_provider, and the [model_providers.wbspace] table (moved to the end).
function mergeCodexProvider(text,{model,baseUrl}){
 const lines=String(text||'').split('\n'),kept=[];let table=null,topLevel=true;
 for(const line of lines){
  const header=/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
  if(header){topLevel=false;table=header[1].replace(/\s+/g,'');}
  if(header&&/^model_providers\.(wbspace|"wbspace")(\.|$)/.test(table))continue;
  if(table&&/^model_providers\.(wbspace|"wbspace")(\.|$)/.test(table))continue;
  if(topLevel&&(/^\s*(model|model_provider)\s*=/.test(line)||/^#\s*WbSpace:/.test(line)))continue;
  kept.push(line);
 }
 const rest=kept.join('\n').replace(/^\s+|\s+$/g,'');
 return `# WbSpace: 自定义连接生成的模型与供应商，其余内容由 Codex 维护\nmodel = ${JSON.stringify(model)}\nmodel_provider = "wbspace"\n${rest?'\n'+rest+'\n':''}\n[model_providers.wbspace]\nname = "WbSpace"\nbase_url = ${JSON.stringify(baseUrl)}\nwire_api = "responses"\nenv_key = "${keyVariable}"\n`;
}

// Writes only non-secret settings to disk; the key reaches the CLI through its environment.
async function prepareLaunch(agentId,connection,key,home){
 const id=protocolOf(connection);
 if(!supports(agentId,id))throw new Error(`${agent(agentId).name} 不支持 ${protocol(id).hint} 协议，请编辑连接并选择支持该协议的 Agent`);
 const {baseUrl,defaultModel,authType,models}=connection;
 await fs.mkdir(home,{recursive:true,mode:0o700});
 if(agentId==='codex-cli'){
  if(authType==='api-key')throw new Error('Codex CLI 只支持 Bearer Token，请编辑连接修改认证方式');
  const file=path.join(home,'config.toml'),current=await fs.readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  const next=mergeCodexProvider(current,{model:defaultModel,baseUrl});
  if(next!==current){const tmp=file+'.'+process.pid+'.tmp';try{await fs.writeFile(tmp,next,{mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}}
  return {CODEX_HOME:home,[keyVariable]:key};
 }
 if(agentId==='opencode'){
  const token=`{env:${keyVariable}}`,options={baseURL:baseUrl+opencodePrefix[id],apiKey:token};
  if(id==='messages'&&authType==='bearer')options.headers={Authorization:'Bearer '+token};
  if(id!=='messages'&&authType==='api-key')options.headers={'x-api-key':token};
  const provider={npm:opencodePackage[id],name:connection.providerName,options,models:Object.fromEntries(models.map(m=>[m,{name:m}]))};
  return {OPENCODE_CONFIG_CONTENT:JSON.stringify({$schema:'https://opencode.ai/config.json',provider:{wbspace:provider},model:'wbspace/'+defaultModel}),[keyVariable]:key};
 }
 throw new Error('该 Agent 工具不支持自定义供应商');
}

// Reads `qodercli status -o json`; anything unparseable counts as signed out rather than as a valid session.
function parseQoderStatus(stdout){
 let data;try{data=JSON.parse(stdout);}catch{return {loggedIn:false};}
 if(data?.logged_in!==true)return {loggedIn:false};
 return {loggedIn:true,email:typeof data.email==='string'?data.email:'',username:typeof data.username==='string'?data.username:'',method:typeof data.login_method==='string'?data.login_method:'',org:typeof data.org_id==='string'?data.org_id:''};
}

function parseCodexStatus(code,text){
 if(code!==0||!/logged in/i.test(text)||/not logged in/i.test(text))return {loggedIn:false};
 return {loggedIn:true,email:'',username:'',method:/using\s+(.+)/i.exec(text)?.[1]?.trim()||'',org:''};
}
const readJson=file=>fs.readFile(file,'utf8').then(JSON.parse).catch(()=>null);

// How each CLI signs in with its own account: where it keeps credentials, and what would override them.
const officialProfiles={
 'qoder-cli':{loginArgs:['login'],clearEnv:['QODER_PERSONAL_ACCESS_TOKEN'],env:home=>({QODER_CONFIG_DIR:home}),status:async(run)=>{const {stdout}=await run(['status','-o','json']);return parseQoderStatus(stdout);}},
 'codex-cli':{loginArgs:['login'],logoutArgs:['logout'],clearEnv:['OPENAI_API_KEY','CODEX_API_KEY','OPENAI_BASE_URL'],env:home=>({CODEX_HOME:home}),status:async(run)=>{const {code,stdout,stderr}=await run(['login','status']);return parseCodexStatus(code,stdout+stderr);}},
 // OpenCode resells nothing itself here: `auth login` lets the user pick which provider account to connect.
 'opencode':{loginArgs:['auth','login'],clearEnv:[],env:home=>({XDG_DATA_HOME:path.join(home,'data')}),status:async(_run,home)=>{const auth=await readJson(path.join(home,'data/opencode/auth.json'));const providers=auth&&typeof auth==='object'?Object.keys(auth):[];return providers.length?{loggedIn:true,email:'',username:providers.join('、'),method:providers.join('、'),org:''}:{loggedIn:false};}},
};
const officialProfile=id=>{const found=officialProfiles[id];if(!found)throw new Error('该 Agent 工具不支持官方登录');return found;};
async function prepareOfficial(agentId,home){
 const profile=officialProfile(agentId);
 await fs.mkdir(home,{recursive:true,mode:0o700});
 await profile.prepare?.(home);
 return {env:profile.env(home),clearEnv:profile.clearEnv,loginArgs:profile.loginArgs};
}

module.exports={mergeCodexProvider,parseQoderStatus,parseCodexStatus,officialProfile,prepareOfficial,protocols,agents,agent,protocol,supports,protocolOf,normalizeBaseUrl,prepareLaunch,keyVariable};
