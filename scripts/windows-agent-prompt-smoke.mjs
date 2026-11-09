// Windows: agents installed as npm .cmd shims receive system prompts with quotes, %, ^, &, < > | and line breaks intact.
// Stand-in CLIs record their argv and environment; nothing signs in or leaves the machine.
import {exitTestApp} from './windows-test-app.mjs';
import {_electron as electron} from 'playwright';import {expect} from '@playwright/test';import fs from 'node:fs/promises';import path from 'node:path';
if(process.platform!=='win32')throw new Error('Native Windows runtime is required');
const root=process.cwd(),dir=path.join(root,'.test-data','Windows 提示词 '+Date.now()),data=path.join(dir,'data'),project=path.join(dir,'project'),npm=path.join(dir,'npm 全局'),dump=path.join(dir,'launch.jsonl'),reports=path.join(root,'test-results'),checks=[];
await fs.mkdir(data,{recursive:true});await fs.mkdir(project);await fs.mkdir(npm);await fs.mkdir(reports,{recursive:true});

// The exact layout `npm install -g` writes for a package whose bin is a Node script.
const npmShim=target=>'@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\'+target+'" %*\r\n';
const script=name=>`const fs=require('node:fs'),path=require('node:path'),e=process.env,a=process.argv.slice(2).filter((x,i,all)=>!(x==='-c'&&/^hooks[.]/.test(all[i+1]||''))&&!(/^hooks[.]/.test(x)&&all[i-1]==='-c'));
if(a[0]==='--version'){console.log('8.8.8');process.exit(0);}
if(a[0]==='login'&&a[1]==='status'){console.error('Logged in using ChatGPT');process.exit(0);}
if(a[0]==='status'){console.log(JSON.stringify({logged_in:true,email:'fixture@example.invalid',username:'fixture',login_method:'fixture'}));process.exit(0);}
if(a[0]==='app-server'||a[0]==='stats'){process.exit(1);}
let opencode=null;try{const c=JSON.parse(e.OPENCODE_CONFIG_CONTENT||'{}');opencode=(c.instructions||[]).map(f=>fs.readFileSync(f,'utf8'));}catch(error){opencode=String(error);}
const agents=e.CODEX_HOME&&fs.existsSync(path.join(e.CODEX_HOME,'AGENTS.md'));
fs.appendFileSync(${JSON.stringify(dump)},JSON.stringify({name:${JSON.stringify(name)},argv:a,agentsMd:!!agents,opencode})+'\\n');
console.log('ready');setInterval(()=>{},1000);
`;
const install=async(name,target,shim)=>{const file=path.join(npm,target);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,script(name));await fs.writeFile(path.join(npm,name+'.cmd'),shim);return path.join(npm,name+'.cmd');};
const codex=await install('codex','node_modules\\@openai\\codex\\bin\\codex.js',npmShim('node_modules\\@openai\\codex\\bin\\codex.js'));
const qoder=await install('qodercli','node_modules\\@qoder-ai\\qodercli\\bin\\qodercli.js',npmShim('node_modules\\@qoder-ai\\qodercli\\bin\\qodercli.js'));
// A shim WbSpace cannot read still starts through cmd.exe; OpenCode takes its prompt from a file, so nothing is lost.
const opencode=await install('opencode','oc.js','@SET "WB_OC=%~dp0oc.js"\r\n@node "%WB_OC%" %*\r\n');

const tricky='第一行 "引号" 100% ^caret & <b> | (x) !bang!\n第二行 C:\\路径\\',quoted='"整段 引号" & 100% "尾"';
const prompts=[{id:'shared',name:'共用',text:tricky,enabled:true,agents:['codex-cli','opencode']},{id:'qoder',name:'Qoder',text:quoted,enabled:true,agents:['qoder-cli']}];
const installed=file=>({installed:true,path:file,version:'8.8.8',issue:'',scannedAt:Date.now()});
const account=(id,tool)=>({id,agentToolId:tool,name:tool+' 测试',source:'managed',provider:'subscription',status:'valid',email:'',createdAt:1,usage:null});
await fs.mkdir(path.join(data,'accounts/oc/opencode/data/opencode'),{recursive:true});await fs.writeFile(path.join(data,'accounts/oc/opencode/data/opencode/auth.json'),'{"fixture":{}}');
await fs.writeFile(path.join(data,'state.json'),JSON.stringify({onboarding:{completedAt:1},accounts:[account('cx','codex-cli'),account('qd','qoder-cli'),account('oc','opencode')],workspaces:[{id:'w',name:'提示词',projects:[{path:project,name:'project'}],backend:'embedded',accountId:'cx',rightOpen:false,rightWidth:360}],selectedWorkspace:'w',sessions:[],settings:{theme:'dark',systemPrompts:prompts},agentInstalls:{'codex-cli':installed(codex),'qoder-cli':installed(qoder),'opencode':installed(opencode)}}));

const binary=process.env.ACCOUNTOR_EXECUTABLE||path.join(root,'release/builds.noindex/WbSpace-win32-x64/WbSpace.exe'),quitReport=path.join(dir,'quit.json'),env={...process.env,ACCOUNTOR_DATA_DIR:data,ACCOUNTOR_QUIT_DIAGNOSTICS:quitReport};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:binary,args:[],env});
const deadline=setTimeout(()=>{console.error('Windows prompt smoke timeout after: '+JSON.stringify(checks));app.process().kill();setTimeout(()=>process.exit(1),500);},150000);
const lines=async()=>(await fs.readFile(dump,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse);
const launched=async name=>{await expect.poll(async()=>(await lines()).some(l=>l.name===name),{timeout:30000}).toBe(true);return (await lines()).filter(l=>l.name===name).at(-1);};
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);const invoke=(c,...a)=>page.evaluate(({c,a})=>window.accountor.invoke(c,...a),{c,a});
 for(const id of ['cx','qd','oc'])await invoke('terminal:start',{kind:'agent',workspaceId:'w',accountId:id});
 const cx=await launched('codex');
 expect(cx.argv).toEqual(['-c','developer_instructions='+JSON.stringify(tricky)]);expect(cx.agentsMd).toBe(false);
 checks.push('Codex npm shim is bypassed and receives the prompt as one -c argument, no AGENTS.md fallback');
 const qd=await launched('qodercli');
 expect(qd.argv.at(-1)).toBe('--append-system-prompt='+quoted);expect(qd.argv[0]).toBe('--settings');
 checks.push('Qoder npm shim keeps a prompt wrapped in quotes and its status line settings');
 const oc=await launched('opencode');
 expect(oc.argv).toEqual([]);expect(oc.opencode).toEqual([tricky+'\n']);
 checks.push('unrecognised OpenCode shim still runs through cmd.exe and reads the prompt file');
 // Scheduled runs pass the user's prompt as an argument too.
 await invoke('terminal:start',{kind:'agent',workspaceId:'w',accountId:'cx',headless:{prompt:'任务 "带引号"\n第二行 50%',permission:'read'}});
 await expect.poll(async()=>(await lines()).filter(l=>l.name==='codex').length,{timeout:30000}).toBe(2);
 expect((await lines()).filter(l=>l.name==='codex').at(-1).argv).toEqual(['-c','developer_instructions='+JSON.stringify(tricky),'exec','--skip-git-repo-check','-s','read-only','任务 "带引号"\n第二行 50%']);
 checks.push('scheduled Codex prompt with quotes, % and a line break arrives intact');
 const result={passed:true,platform:process.platform,checks};
 await fs.writeFile(path.join(reports,'windows-agent-prompts.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 await exitTestApp(app);
}catch(error){
 const failure={passed:false,platform:process.platform,checks,error:String(error.message||error).slice(0,1500),quit:await fs.readFile(quitReport,'utf8').then(JSON.parse).catch(e=>String(e.code||e)),launches:(await lines().catch(()=>[])).map(l=>({name:l.name,argc:l.argv.length})),sessions:await app.windows()[0]?.evaluate(async()=>(await window.accountor.invoke('state:get')).sessions.map(s=>({kind:s.kind,accountId:s.accountId,status:s.status,error:s.error,exitCode:s.exitCode}))).catch(e=>String(e))};
 await fs.writeFile(path.join(reports,'windows-agent-prompts.json'),JSON.stringify(failure,null,2));
 // Job logs need a signed-in viewer; an annotation shows the failure on the public run page.
 console.log('::error title=windows-agent-prompt-smoke::'+JSON.stringify(failure).slice(0,30000).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));
 console.error(error);app.process().kill();process.exitCode=1;
}finally{clearTimeout(deadline);}
process.exit(process.exitCode||0);
