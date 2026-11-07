const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const catalog=require('./agent-catalog.cjs');
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
function text(v,label,max=200){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))throw new Error('请填写有效的'+label);return v.trim();}
function connection(input){
 const providerName=text(input.providerName,'供应商名称',80),raw=text(input.baseUrl,'服务地址',2048);let url;try{url=new URL(raw);}catch{throw new Error('服务地址必须是完整的 HTTP(S) URL');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('服务地址需使用 HTTP(S)，且不能包含账号、查询参数或片段');
 const models=[...new Set((Array.isArray(input.models)?input.models:[]).map(m=>text(m,'模型 ID',200)))];if(!models.length||models.length>40)throw new Error('请添加 1–40 个模型 ID');
 const defaultModel=text(input.defaultModel,'默认模型');if(!models.includes(defaultModel))throw new Error('默认模型必须在模型列表中');
 const protocol=input.protocol||'messages';catalog.protocol(protocol);
 const agentId=input.agentToolId||'claude-code';if(!catalog.supports(agentId,protocol))throw new Error(`${catalog.agent(agentId).name} 不支持 ${catalog.protocol(protocol).hint} 协议`);
 const authType=input.authType||'bearer';if(!catalog.agent(agentId).authTypes.includes(authType))throw new Error('不支持的认证方式');
 return {providerName,baseUrl:catalog.normalizeBaseUrl(url.toString().replace(/\/$/,''),protocol),protocol,models,defaultModel,authType};
}
class Connections{
 constructor(root,vault,{platform=process.platform,runtime=process.execPath}={}){this.root=root;this.vault=vault;this.platform=platform;this.runtime=runtime;}
 dir(id){if(!/^[a-zA-Z0-9-]+$/.test(id))throw new Error('无效账号 ID');return path.join(this.root,'accounts',id);}
 secret(id,version='current'){if(!/^[a-zA-Z0-9-]+$/.test(version))throw new Error('无效密钥版本');return path.join(this.dir(id),'connection-key-'+version+'.enc');}
 async writeKey(id,key,version){if(typeof key!=='string'||!key.trim()||key.length>16384||/[\x00-\x1f]/.test(key))throw new Error('请填写有效的 API Key / Token');if(!this.vault.isEncryptionAvailable())throw new Error('系统安全存储不可用，未保存密钥');await fs.mkdir(this.dir(id),{recursive:true,mode:0o700});const file=this.secret(id,version),tmp=file+'.'+crypto.randomUUID();try{await fs.writeFile(tmp,this.vault.encryptString(key.trim()),{mode:0o600,flag:'wx'});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}}
 async env(account){if(!account.connection)return {};const agentId=account.agentToolId||'claude-code';if(agentId==='claude-code'&&catalog.protocolOf(account.connection)!=='messages')throw new Error(`Claude Code 不支持 ${catalog.protocol(catalog.protocolOf(account.connection)).hint} 协议，请编辑连接并选择支持该协议的 Agent`);let key;try{key=this.vault.decryptString(await fs.readFile(this.secret(account.id,account.keyVersion)));}catch{throw new Error('无法解密此连接的密钥，请编辑连接并重新保存密钥');}const c=account.connection;if(agentId!=='claude-code')return catalog.prepareLaunch(agentId,c,key,path.join(this.dir(account.id),agentId));return {ANTHROPIC_BASE_URL:c.baseUrl,[c.authType==='api-key'?'ANTHROPIC_API_KEY':'ANTHROPIC_AUTH_TOKEN']:key,ANTHROPIC_MODEL:c.defaultModel,ANTHROPIC_DEFAULT_OPUS_MODEL:c.defaultModel,ANTHROPIC_DEFAULT_SONNET_MODEL:c.defaultModel,ANTHROPIC_DEFAULT_HAIKU_MODEL:c.defaultModel,CLAUDE_CODE_SUBAGENT_MODEL:c.defaultModel};}
 officialHome(id,agentId){return path.join(this.dir(id),agentId);}
 async provision(account,cli){
  await fs.mkdir(this.dir(account.id),{recursive:true,mode:0o700});
  if(account.provider==='custom'||(account.agentToolId&&account.agentToolId!=='claude-code'))return;
  const bin=path.join(this.root,'bin');await fs.mkdir(bin,{recursive:true,mode:0o700});
  const slug=account.name.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'account';
  account.launchPath=path.join(bin,'claude-'+slug+'-'+account.id+(this.platform==='win32'?'.cmd':''));
  if(this.platform==='win32'){
   const helper=account.launchPath+'.cjs';
   const body="const {spawn}=require('node:child_process');const env={...process.env};for(const key of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|CLAUDECODE$|ACCOUNTOR_|BROWSER$|ELECTRON_RUN_AS_NODE$)/i.test(key))delete env[key];env.CLAUDE_CONFIG_DIR="+JSON.stringify(this.dir(account.id))+";env.BROWSER="+JSON.stringify(require('./platform.cjs').browserSettings('win32').BROWSER)+";const child=spawn("+JSON.stringify(cli)+",process.argv.slice(2),{env,stdio:'inherit'});child.on('error',()=>{console.error('Unable to start Claude CLI; check its executable path.');process.exit(1);});child.on('exit',code=>process.exit(code??1));\n";
   await fs.writeFile(helper,body,{mode:0o700,flag:'wx'});
   const runtime=this.runtime.replaceAll('%','%%');if(/[\x00-\x1f\x22]/.test(runtime))throw new Error('无效运行时路径');
   const script='@echo off\r\nsetlocal DisableDelayedExpansion\r\nfor /f "tokens=2 delims=:" %%C in (\'chcp\') do set "WB_PREVIOUS_CP=%%C"\r\nchcp 65001 >nul\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"'+runtime+'" "%~f0.cjs" %*\r\nset "WB_EXIT_CODE=%ERRORLEVEL%"\r\nchcp %WB_PREVIOUS_CP% >nul\r\nexit /b %WB_EXIT_CODE%\r\n';
   await fs.writeFile(account.launchPath,script,{mode:0o700,flag:'wx'});return;
  }
  const script='#!/bin/sh\n# Generated by Terminal Workbench. Official CLI manages authentication.\nfor key in $(/usr/bin/env | /usr/bin/sed -En \'s/^(ANTHROPIC_[A-Z_]*|CLAUDE_CODE_[A-Z_]*|CLAUDE_CONFIG_DIR|CLAUDECODE)=.*/\\1/p\'); do unset "$key"; done\nexport CLAUDE_CONFIG_DIR='+quote(this.dir(account.id))+'\nexport BROWSER=/usr/bin/open\nexec '+quote(cli)+' "$@"\n';
  await fs.writeFile(account.launchPath,script,{mode:0o700,flag:'wx'});
 }
 async cleanup(account){if(account.launchPath&&path.dirname(account.launchPath)===path.join(this.root,'bin')){await fs.rm(account.launchPath,{force:true});await fs.rm(account.launchPath+'.cjs',{force:true});}await fs.rm(this.dir(account.id),{recursive:true,force:true});}
}
module.exports={connection,Connections};
