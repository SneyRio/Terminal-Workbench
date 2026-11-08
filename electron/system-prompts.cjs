const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const path=require('node:path');

const AGENT_IDS=['claude-code','codex-cli','qoder-cli','opencode'];
const MAX_ENTRIES=30,MAX_NAME=60,MAX_TEXT=20000;

// Keeps line breaks and tabs; other control characters would break TOML strings and terminal arguments.
function cleanText(value){
 return String(value??'').replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
}

function normalizePrompts(input){
 if(!Array.isArray(input))throw new Error('系统提示词格式无效');
 if(input.length>MAX_ENTRIES)throw new Error(`最多保存 ${MAX_ENTRIES} 条系统提示词`);
 const seen=new Set();
 return input.map((entry,index)=>{
  const name=cleanText(entry?.name).replace(/\s+/g,' ').trim().slice(0,MAX_NAME)||`提示词 ${index+1}`;
  const text=cleanText(entry?.text);
  if(text.length>MAX_TEXT)throw new Error(`「${name}」超过 ${MAX_TEXT} 字`);
  let id=typeof entry?.id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(entry.id)?entry.id:crypto.randomUUID();
  if(seen.has(id))id=crypto.randomUUID();seen.add(id);
  // An empty list means the entry applies to every agent, including ones added later.
  const agents=[...new Set((Array.isArray(entry?.agents)?entry.agents:[]).filter(a=>AGENT_IDS.includes(a)))];
  return {id,name,text,enabled:entry?.enabled!==false,agents:agents.length===AGENT_IDS.length?[]:agents};
 });
}

const appliesTo=(entry,agentId)=>!entry.agents?.length||entry.agents.includes(agentId);

// Enabled entries for this agent, in the user's order, joined into one block.
function promptFor(prompts,agentId){
 return (Array.isArray(prompts)?prompts:[]).filter(e=>e&&e.enabled!==false&&appliesTo(e,agentId)&&String(e.text||'').trim()).map(e=>String(e.text).trim()).join('\n\n');
}

// TOML basic strings accept JSON escapes once DEL and other controls are gone.
const tomlString=text=>JSON.stringify(cleanText(text));

function mergeOpencodeInstructions(current,file){
 let config={};try{config=current?JSON.parse(current):{};}catch{config={};}
 const instructions=[...(Array.isArray(config.instructions)?config.instructions:[]),file];
 return JSON.stringify({$schema:'https://opencode.ai/config.json',...config,instructions});
}

async function writePromptFile(file,text){
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 await fs.writeFile(file,text.endsWith('\n')?text:text+'\n',{mode:0o600});
 return file;
}

const CODEX_MARKER='<!-- WbSpace 系统提示词：由“设置 → 系统提示词”自动生成，手动修改会被覆盖 -->';
const readText=file=>fs.readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});

// Codex reads $CODEX_HOME/AGENTS.md as global guidance; the account's CODEX_HOME belongs to WbSpace, but a file without the marker is left alone.
async function syncCodexAgents(home,text){
 if(!home)return false;
 const file=path.join(home,'AGENTS.md'),current=await readText(file);
 if(current!==null&&!current.startsWith(CODEX_MARKER)){
  if(text)throw new Error('Codex 配置目录中已有非 WbSpace 生成的 AGENTS.md（'+file+'），系统提示词无法写入，请移走该文件或在“设置 → 系统提示词”中取消对 Codex 生效');
  return false;
 }
 if(!text){if(current!==null)await fs.rm(file,{force:true});return false;}
 await writePromptFile(file,CODEX_MARKER+'\n\n'+text);
 return true;
}

/*
 * How each CLI receives the extra system prompt, verified against the installed versions:
 *  - Claude Code: --append-system-prompt-file (one file, so it also carries a handoff transcript)
 *  - Codex CLI:   -c developer_instructions="…" (a developer message; base instructions stay).
 *                 A Windows .cmd shim cannot carry quotes or line breaks, so there it goes to $CODEX_HOME/AGENTS.md.
 *  - Qoder CLI:   --append-system-prompt=… (the = form keeps node-pty from misreading a prompt wrapped in quotes)
 *  - OpenCode:    `instructions` in OPENCODE_CONFIG_CONTENT, which points at a file
 * Returns arguments to place before and after the existing ones, plus environment changes.
 */
async function launchPlan(agentId,text,{file,env={},handoffFile,shim=false}={}){
 const plan={before:[],after:[],env:{},file:''};
 if(agentId==='codex-cli'){
  if(await syncCodexAgents(env.CODEX_HOME,shim?text:''))plan.file=path.join(env.CODEX_HOME,'AGENTS.md');
  else if(text)plan.before=['-c','developer_instructions='+tomlString(text)];
  return plan;
 }
 if(!text)return plan;
 if(agentId==='claude-code'){
  let body=text;
  if(handoffFile)body+='\n\n'+await fs.readFile(handoffFile,'utf8');
  plan.file=await writePromptFile(file,body);plan.after=['--append-system-prompt-file',file];
 }else if(agentId==='qoder-cli')plan.after=['--append-system-prompt='+text];
 else if(agentId==='opencode'){
  plan.file=await writePromptFile(file,text);
  plan.env.OPENCODE_CONFIG_CONTENT=mergeOpencodeInstructions(env.OPENCODE_CONFIG_CONTENT,file);
 }
 return plan;
}

module.exports={CODEX_MARKER,AGENT_IDS,MAX_ENTRIES,MAX_TEXT,normalizePrompts,promptFor,tomlString,mergeOpencodeInstructions,launchPlan};
