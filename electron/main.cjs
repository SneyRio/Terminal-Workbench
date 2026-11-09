const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, safeStorage, session, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const {pathToFileURL}=require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const pty = require('node-pty');
const gitView=require('./git.cjs');
const {nextWorkspaceOrder}=require('./workspace-order.cjs');
const {tools:agentTools,requireTool}=require('./agent-tools.cjs');
const agentCatalog=require('./agent-catalog.cjs');
const agentInstall=require('./agent-install.cjs');
const agentUsage=require('./agent-usage.cjs');
const agentTranscripts=require('./agent-transcripts.cjs');
const schedules=require('./schedules.cjs');
const systemPrompts=require('./system-prompts.cjs');
const agentStatus=require('./agent-status.cjs');
const integrations=require('./integrations.cjs');
const {inspectLegacy,retireLegacy}=require('./app-migration.cjs');
const {taskText,defaultTitle,migrateTitle,applyTaskTitle,copyTitle,transcriptTitle}=require('./session-titles.cjs');
const {pruneDeleted,findDeleted,forgetDeleted,archiveSession,replaceSession,deduplicateRecovered}=require('./session-history.cjs');
const restoringJobs=new Map(),deletingSessions=new Set();
const {BUILTIN_HUD,inheritedStatusLine,prepareBuiltinHud}=require('./statusline.cjs');
const {DraftBatch,TerminalHistory,appendTerminal,flushTerminal}=require('./performance.cjs');
const { Store, atomicJson, id, inside, cleanEnv, buildHandoff } = require('./core.cjs');
const exec = promisify(execFile);
const profileDiscovery=require('./profile-discovery.cjs');
const {backupBeforeUpgrade}=require('./release-support.cjs');
const updates=require('./updates.cjs');
const updateInstall=require('./update-install.cjs');
const platformTools=require('./platform.cjs');
const {WindowsCliDiscovery}=require('./cli-discovery.cjs');
const windowsCli=new WindowsCliDiscovery();
const {prepareTrash}=require('./file-trash.cjs');
const {Connections,connection}=require('./account-connections.cjs');
const root = path.resolve(__dirname, '..');
// Keep the established safeStorage/Keychain namespace across the public rebrand.
app.setName('终端工作站');
app.setAboutPanelOptions({applicationName:'WbSpace'});
const legacyDataRoot=path.join(app.getPath('appData'),'Claude Accountor');
const workbenchDataRoot=path.join(app.getPath('appData'),'Terminal Workbench');
const dataRoot = process.env.ACCOUNTOR_DATA_DIR || (app.isPackaged ? (existsSync(path.join(legacyDataRoot,'state.json'))?legacyDataRoot:existsSync(path.join(workbenchDataRoot,'state.json'))?workbenchDataRoot:path.join(app.getPath('appData'),'WbSpace')) : path.join(root, '.local-app-data'));
app.setPath('userData', dataRoot);
const store = new Store(dataRoot);
const connections=new Connections(dataRoot,safeStorage);
const mcpSecrets=new integrations.McpSecrets(path.join(dataRoot,'mcp-secrets.enc'),safeStorage);
const terminals = new Map();
let win, quitting = false;
const notify = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const pushState = () => notify('state:changed', store.state);
// Sessions started outside any workspace run here. Isolated test data keeps its own copy so tests never touch the home folder.
const DEFAULT_WORKSPACE_ID='default';
const defaultWorkspaceDir=process.env.ACCOUNTOR_DATA_DIR?path.join(dataRoot,'wbspace'):path.join(os.homedir(),'wbspace');
async function ensureDefaultWorkspace(){
  await fs.mkdir(defaultWorkspaceDir,{recursive:true});
  const real=await fs.realpath(defaultWorkspaceDir);
  await store.update(s=>{
    const project={path:real,name:path.basename(real)};
    let w=s.workspaces.find(w=>w.id===DEFAULT_WORKSPACE_ID);
    if(!w){
      const claude=s.accounts.find(a=>(a.agentToolId||'claude-code')==='claude-code'&&a.status!=='login');
      w={id:DEFAULT_WORKSPACE_ID,name:'无工作空间会话',group:'',pinned:false,lastUsedAt:Date.now(),projects:[project],backend:'embedded',accountId:claude?.id||s.accounts[0]?.id||'',rightOpen:false,rightWidth:360,createdAt:Date.now(),createdOrder:0};
      s.workspaces.push(w);
    }
    // Always last, so it never shifts the user's own workspaces.
    s.workspaces=[...s.workspaces.filter(x=>x.id!==DEFAULT_WORKSPACE_ID),Object.assign(w,{builtIn:true,projects:[project]})];
  });
}
const updateDir=path.join(dataRoot,'updates.noindex');
const updateTarget=()=>updateInstall.resolveInstall({platform:process.platform,arch:process.arch,isPackaged:app.isPackaged,exePath:app.getPath('exe')});
// Update traffic has its own session: a chosen proxy reaches nothing else, and only trusted hosts can be contacted, redirects included.
let updateSessionGuarded=false,appliedUpdateProxy='';
async function updateFetch(...args){
  const updateSession=session.fromPartition('wbspace-updates');
  if(!updateSessionGuarded){updateSession.webRequest.onBeforeRequest((details,done)=>done({cancel:!updates.isTrustedUpdateUrl(details.url)}));updateSessionGuarded=true;}
  const proxy=store.state.settings.updateProxy||'';
  if(appliedUpdateProxy!==proxy){await updateSession.setProxy(proxy?{proxyRules:proxy}:{mode:'system'});await updateSession.closeAllConnections();appliedUpdateProxy=proxy;}
  return updateSession.fetch(...args);
}
const updater=updates.createUpdater({current:app.getVersion(),dir:updateDir,fetcher:updateFetch,emit:state=>notify('updates:state',state),resolveInstall:updateTarget,prepare:(file,version)=>process.platform==='darwin'?updateInstall.prepareMacBundle(file,updateDir,version,updateTarget().target):file});
let pendingUpdate=false;
const draftWrites=new DraftBatch(store,pushState);
const accountDir = accountId => { const a=store.state.accounts.find(a=>a.id===accountId);return a?.source==='existing' ? profileDiscovery.existingDirectory(a) : path.join(dataRoot,'accounts',accountId); };
const accountExecutable = async account => account.source==='existing'&&account.command ? (path.isAbsolute(account.command)?account.command:path.join(os.homedir(),'.local/bin',account.command)) : executable();
const telemetryDir = path.join(dataRoot, 'telemetry');
// Claude CLI version per executable, read once; '' when it cannot be read, so version-gated settings are left out.
const claudeVersions=new Map();
async function claudeVersion(file,env){
  let key=file;try{const stat=await fs.stat(file);key=file+':'+stat.mtimeMs;}catch{}
  if(!claudeVersions.has(key))claudeVersions.set(key,exec(file,['--version'],{env,windowsHide:true,timeout:15000,maxBuffer:64*1024}).then(r=>/(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1]||'',()=>''));
  return claudeVersions.get(key);
}
const versionAtLeast=(version,minimum)=>{if(!version)return false;const a=version.split('.').map(Number),b=minimum.split('.').map(Number);for(let i=0;i<3;i++)if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);return true;};
const argvString = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function cliEnv(configDirectory) {
  const env=cleanEnv(process.env,configDirectory);
  // Finder launches do not inherit the interactive shell's CLI search path.
  const expanded=platformTools.searchPath(process.env);for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env[process.platform==='win32'?'Path':'PATH']=expanded;
  return env;
}

async function executable() {
  const configured = store.state.settings.claudePath;
  if(process.platform==='win32'){const detected=await windowsCli.detect(configured);if(detected.path)return detected.path;throw new Error(detected.message);}
  if(configured){if(process.platform==='win32'&&!/\.exe$/i.test(configured))throw new Error('Windows 请选择原生 claude.exe；不直接执行 .cmd/.bat 启动脚本');try{await fs.access(configured,1);return configured;}catch{throw new Error('配置的 Claude CLI 路径不可执行，请在设置中修正');}}
  const options = platformTools.executableCandidates(configured);
  for (const option of options) { try { await fs.access(option, 1); return option; } catch {} }
  throw new Error('未找到 Claude CLI，请在设置中指定已安装的可执行文件');
}

const agentInstalling=new Map();
// Claude is already detected automatically elsewhere, so its row reflects that instead of waiting for a scan.
async function claudeScanState(){
  const known=store.state.agentInstalls?.['claude-code'];
  try{const file=await executable();return known?.path===file?known:{installed:true,path:file,version:'',issue:'',scannedAt:0};}
  catch{return known?.installed?null:known||null;}
}
async function agentList(){const claude=await claudeScanState();return {protocols:agentCatalog.protocols.map(({id,label,placeholder,hint})=>({id,label,placeholder,hint})),agents:agentCatalog.agents.map(a=>({id:a.id,name:a.name,protocols:a.protocols,authTypes:a.authTypes,login:!!a.login,unavailable:a.unavailable||'',docs:a.docs,command:agentInstall.installCommand(a).text,scan:a.id==='claude-code'?claude:store.state.agentInstalls?.[a.id]||null,install:agentInstalling.get(a.id)||null}))};}
// How to run an agent CLI for a one-off command: a Windows npm shim is bypassed when possible, otherwise cmd.exe runs it.
async function agentCommand(cli,args,env){
  if(process.platform!=='win32'||/\.exe$/i.test(cli))return [cli,args];
  const direct=await platformTools.resolveCmdShim(cli,env);
  return direct?[direct.file,[...direct.args,...args]]:[process.env.ComSpec||'cmd.exe',['/d','/c',cli,...args]];
}
// MCP servers and CLI tools shared by all agents (see integrations.cjs).
const pathSep=process.platform==='win32'?';':':';
// An app started from the Dock or Finder misses what the login shell exports (PATH, tokens used by MCP configs).
let loginEnvironment=null;
function loginEnv(){
  if(!loginEnvironment)loginEnvironment=process.platform==='win32'?Promise.resolve({}):exec(process.env.SHELL||'/bin/zsh',['-lc','env -0'],{timeout:8000,maxBuffer:4*1024*1024}).then(r=>Object.fromEntries(r.stdout.split('\0').filter(Boolean).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];})),()=>({}));
  return loginEnvironment;
}
async function mcpLookup(){const login=await loginEnv();return name=>process.env[name]??login[name];}
async function toolSearchDirs(){
  const loginPath=(await loginEnv()).PATH||'';
  return [...new Set([...platformTools.searchPath(process.env).split(pathSep),...loginPath.split(pathSep)].filter(d=>d&&path.isAbsolute(d)))];
}
async function scanMcpServers(){
  let codexList=null;
  // Only a Codex already found is asked; the scan must not start an install check of its own.
  const known=store.state.agentInstalls?.['codex-cli'];
  if(known?.installed&&known.path)try{const cli=known.path;const env=cliEnv(null);delete env.CODEX_HOME;const [file,args]=await agentCommand(cli,['mcp','list','--json'],env);codexList=JSON.parse((await exec(file,args,{env,windowsHide:true,timeout:20000,maxBuffer:4*1024*1024})).stdout);}catch{}
  const scanned=await integrations.scanMcp({home:process.env.ACCOUNTOR_SCAN_HOME||os.homedir(),codexList});
  const secrets=await mcpSecrets.read().catch(()=>({}));
  const merged=integrations.mergeScanned(store.state.mcpServers||[],secrets,scanned,store.state.mcpDismissed||[]);
  if(merged.added.length){await mcpSecrets.write(merged.secrets);await store.update(s=>{s.mcpServers=merged.servers;});pushState();}
  await store.update(s=>{s.mcpScannedAt=Date.now();});pushState();
  return {added:merged.added,found:scanned.length};
}
async function scanCliTools(){
  const found=await integrations.scanCli(await toolSearchDirs());
  const merged=integrations.mergeScannedTools(store.state.cliTools||[],found);
  await store.update(s=>{s.cliTools=merged.tools;s.cliScannedAt=Date.now();});pushState();
  return {added:merged.added,found:found.length};
}
// Codex hook trust per Codex build: hooks/list is asked once, then the result is reused.
const codexHookTrust=new Map();
async function codexStatusArgs(cli,env,cwd){
  const command=agentStatus.eventCommand(process.execPath,path.join(root,'scripts/claude-telemetry.cjs')),hookArgs=agentStatus.codexHookArgs(command);
  let key=cli;try{key+=':'+(await fs.stat(cli)).mtimeMs;}catch{}
  key+='\n'+command;
  if(!codexHookTrust.has(key))codexHookTrust.set(key,agentCommand(cli,[...hookArgs,'app-server'],env).then(cmd=>agentStatus.listCodexHooks(cmd,env,cwd)).then(hooks=>agentStatus.ownCodexHooks(hooks,command),()=>[]));
  const entries=await codexHookTrust.get(key);
  // Without trust Codex would only list the hooks as needing review, so they are left out entirely.
  if(!entries.length||!env.CODEX_HOME)return [];
  try{await agentStatus.writeCodexTrust(env.CODEX_HOME,entries);}catch{return [];}
  return hookArgs;
}
async function scanAgent(id){
  const agent=agentCatalog.agent(id);
  let result;
  if(id==='claude-code'){
    try{const file=await executable();const {stdout}=await exec(file,['--version'],{env:cliEnv(null),windowsHide:true,timeout:15000,maxBuffer:256*1024});result={installed:true,path:file,version:/\d+\.\d+[\w.-]*/.exec(stdout)?.[0]||'',issue:'',scannedAt:Date.now()};}
    catch{result=null;}
  }
  result||=await agentInstall.scan(agent,{home:os.homedir(),searchPath:platformTools.searchPath(process.env)});
  await store.update(s=>{s.agentInstalls={...s.agentInstalls,[id]:result};});
  notify('agents:state',await agentList());
  return result;
}
const usageRefreshed=new Map();
// Runs in the background so a slow usage service never delays a status check or a session start.
async function refreshOfficialUsage(account,cli,env,force=false){
  const reader=account.agentToolId==='codex-cli'?async()=>agentUsage.readCodexUsage(cli,env,{command:await agentCommand(cli,['app-server'],env)}):account.agentToolId==='opencode'?async()=>{const [file,args]=await agentCommand(cli,['stats'],env);const {stdout}=await exec(file,args,{env,windowsHide:true,timeout:20000,maxBuffer:1024*1024});return agentUsage.parseOpencodeStats(stdout);}:null;
  if(!reader)return;
  if(!force&&Date.now()-(usageRefreshed.get(account.id)||0)<30000)return;
  usageRefreshed.set(account.id,Date.now());
  const usage=await reader().catch(()=>null);
  if(!usage)return;
  await store.update(s=>{const a=s.accounts.find(a=>a.id===account.id);if(a)a.usage={...usage,time:Date.now()};});pushState();
}
const usesOfficialCli=account=>(account?.agentToolId||'claude-code')!=='claude-code'&&!account.connection;
// Applies one account's isolated sign-in; inherited credentials would otherwise take precedence over it.
async function officialEnv(account,cli){
  const prepared=await agentCatalog.prepareOfficial(account.agentToolId,connections.officialHome(account.id,account.agentToolId));
  const env=cliEnv(null);
  delete env.CLAUDE_CONFIG_DIR;for(const name of prepared.clearEnv)delete env[name];
  Object.assign(env,prepared.env);
  const key=process.platform==='win32'?'Path':'PATH';env[key]=[path.dirname(cli),env[key]].join(process.platform==='win32'?';':':');
  return {env,loginArgs:prepared.loginArgs,clearEnv:prepared.clearEnv};
}
async function agentExecutable(id){
  const known=store.state.agentInstalls?.[id];
  if(known?.path&&await fs.access(known.path,1).then(()=>true,()=>false))return known.path;
  const result=await scanAgent(id);
  if(!result.installed)throw new Error(`未检测到 ${agentCatalog.agent(id).name}，请到“账号与连接 → Agent 工具”扫描或下载`);
  return result.path;
}
// Credentials may live outside the account directory, such as in the system keychain, so the CLI clears its own first.
async function signOutManaged(account){
  if(account.connection)return;
  try{
    const claude=(account.agentToolId||'claude-code')==='claude-code';
    const args=claude?['auth','logout']:agentCatalog.officialProfile(account.agentToolId).logoutArgs;
    if(!args)return;
    const cli=claude?await executable():await agentExecutable(account.agentToolId);
    const env=claude?cliEnv(connections.dir(account.id)):(await officialEnv(account,cli)).env;
    const [file,command]=await agentCommand(cli,args,env);
    await exec(file,command,{env,windowsHide:true,timeout:15000,maxBuffer:256*1024});
  }catch{}
}
async function installAgent(id){
  const agent=agentCatalog.agent(id);
  if(agentInstalling.get(id)?.running)throw new Error('正在安装，请稍候');
  const command=agentInstall.installCommand(agent);
  const {response}=await dialog.showMessageBox(win,{type:'question',message:`下载并安装 ${agent.name}？`,detail:`将在本机执行以下官方安装命令：\n\n${command.text}\n\n来源：${agent.docs}`,buttons:['取消','下载并安装'],defaultId:1,cancelId:0});
  if(response!==1)return false;
  const update=next=>{agentInstalling.set(id,next);void agentList().then(list=>notify('agents:state',list));};
  update({running:true,log:'',error:''});
  let log='';
  try{await agentInstall.runInstall(command,{onLog:text=>{log=text;update({running:true,log,error:''});}});update({running:false,log,error:''});}
  catch(error){update({running:false,log,error:error.message});return false;}
  const result=await scanAgent(id);
  if(!result.installed)update({running:false,log,error:'安装命令已结束，但未扫描到可运行的程序，可能需要重新打开终端后再扫描'});
  return result.installed;
}

// ---- Scheduled tasks: run only while the app is running; each run is an ordinary session that can be resumed.
const runTimers=new Map();
const gitAt=(dir,args,timeout=60000)=>exec('git',['-C',dir,...args],{windowsHide:true,timeout,maxBuffer:4*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).then(r=>r.stdout.trim());
const scheduleRuns=()=>store.state.scheduleRuns||[];
async function recordRun(run){
  await store.update(s=>{
    s.scheduleRuns||=[];const i=s.scheduleRuns.findIndex(r=>r.id===run.id);if(i<0)s.scheduleRuns.push(run);else s.scheduleRuns[i]={...s.scheduleRuns[i],...run};
  });
  await pruneRuns(run.scheduleId);pushState();
}
// Keeps the latest 20 runs per task; worktrees of dropped runs are removed with them.
async function pruneRuns(scheduleId){
  const runs=scheduleRuns().filter(r=>r.scheduleId===scheduleId&&r.status!=='running').sort((a,b)=>b.startedAt-a.startedAt),drop=runs.slice(20);
  for(const run of drop)await removeRunWorktree(run).catch(()=>{});
  if(drop.length)await store.update(s=>{const ids=new Set(drop.map(r=>r.id));s.scheduleRuns=s.scheduleRuns.filter(r=>!ids.has(r.id));});
}
async function removeRunWorktree(run){
  if(!run.worktree)return;
  if(!inside(path.join(dataRoot,'worktrees'),run.worktree))throw new Error('无效的工作树路径');
  await gitAt(run.repo,['worktree','remove','--force',run.worktree]).catch(async()=>{await fs.rm(run.worktree,{recursive:true,force:true});await gitAt(run.repo,['worktree','prune']).catch(()=>{});});
  await store.update(s=>{const r=(s.scheduleRuns||[]).find(r=>r.id===run.id);if(r){r.worktreeRemoved=true;}});
}
function notifyRun(task,title,body){if(task.notify&&Notification.isSupported())new Notification({title:'定时任务 · '+task.name,body:title+(body?'：'+body:'')}).show();}
async function runSchedule(scheduleId,trigger){
  const task=(store.state.schedules||[]).find(t=>t.id===scheduleId);if(!task)throw new Error('定时任务不存在');
  const run={id:id(),scheduleId,trigger,startedAt:Date.now(),status:'running'};
  const skip=async reason=>{await recordRun({...run,status:'skipped',finishedAt:Date.now(),reason});notifyRun(task,'已跳过',reason);return store.state.scheduleRuns.find(r=>r.id===run.id);};
  if(scheduleRuns().some(r=>r.scheduleId===scheduleId&&r.status==='running'))return skip('上一次运行尚未结束');
  let workspace,account;try{workspace=store.workspace(task.workspaceId);account=store.account(task.accountId);}catch(e){return skip(e.message);}
  const tool=account.agentToolId||'claude-code';
  if(tool==='claude-code'||usesOfficialCli(account)){await statusAccount(account.id).catch(()=>{});if(store.account(account.id).status==='login')return skip('账号需要重新登录');}
  const blocked=schedules.quotaBlocked(store.account(account.id).usage);if(blocked)return skip(blocked);
  // The task's fixed session: a run never takes it over while it is open (still running, or continued by the user).
  const pinned=schedules.pinnedSession(store.state.sessions,task.id),pinnedRuntime=pinned&&terminals.get(pinned.id);
  if(pinnedRuntime&&!pinnedRuntime.closed)return skip('定时任务的会话正在使用，结束该会话后才会继续定时运行');
  const project=workspace.projects[0]?.path;if(!project)return skip('工作空间没有项目');
  let cwd=project;
  if(task.worktree){
    let repo='';try{repo=await fs.realpath(await gitAt(project,['rev-parse','--show-toplevel']));}catch{}
    if(!repo)return skip('项目不是 Git 仓库，无法创建独立工作树');
    const worktree=path.join(dataRoot,'worktrees',run.id),branch=schedules.worktreeBranch(task.name,run.startedAt);
    await fs.mkdir(path.dirname(worktree),{recursive:true,mode:0o700});
    try{await gitAt(repo,['worktree','add','-b',branch,worktree,'HEAD']);}catch(e){return skip('创建工作树失败：'+String(e.stderr||e.message).trim().split('\n')[0]);}
    Object.assign(run,{repo,worktree,branch,base:await gitAt(worktree,['rev-parse','HEAD'])});
    cwd=path.join(worktree,path.relative(repo,await fs.realpath(project)));
  }
  const resumeId=schedules.continuation(pinned,{agentId:tool,accountId:account.id,cwd:await fs.realpath(cwd).catch(()=>cwd),worktree:!!task.worktree,transcriptExists:!!pinned?.transcript&&existsSync(pinned.transcript)});
  await recordRun(run);
  try{
    const stamp=new Date(run.startedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    const started=await startSession({workspaceId:workspace.id,accountId:account.id,kind:'claude',resumeCwd:cwd,headless:{prompt:task.prompt,permission:task.permission},title:'定时 · '+task.name+' · '+stamp,scheduleRunId:run.id,scheduleId:task.id,...(resumeId?{resumeId}:{}),...(pinned?{groupId:pinned.groupId,orientation:pinned.orientation}:{})});
    // The new run takes the place of the previous one in the same tab.
    if(pinned&&pinned.id!==started.id){await store.update(s=>{const next=s.sessions.find(r=>r.id===started.id);replaceSession(s,pinned.id,next);});terminals.delete(pinned.id);for(const name of ['event.json','usage.json','prompt.md','mcp.json'])await fs.rm(path.join(telemetryDir,pinned.id+'-'+name),{force:true}).catch(()=>{});pushState();}
    await recordRun({id:run.id,scheduleId,sessionId:started.id,...(resumeId?{continued:true}:{})});
    runTimers.set(run.id,setTimeout(()=>{const t=terminals.get(started.id);void recordRun({id:run.id,scheduleId,timedOut:true});if(t&&!t.closed)try{t.proc.kill();}catch{}},task.timeoutMinutes*60000));
    return store.state.scheduleRuns.find(r=>r.id===run.id);
  }catch(e){
    await recordRun({id:run.id,scheduleId,status:'failed',finishedAt:Date.now(),reason:e.message});notifyRun(task,'启动失败',e.message);
    if(run.worktree)await removeRunWorktree(run).catch(()=>{});
    return store.state.scheduleRuns.find(r=>r.id===run.id);
  }
}
async function finishScheduledRun(sessionId,exitCode){
  // Matched through the session itself, since a very short run can exit before its session id is recorded.
  const runId=store.state.sessions.find(r=>r.id===sessionId)?.scheduleRunId;
  const run=scheduleRuns().find(r=>r.id===runId&&r.status==='running');if(!run)return;
  clearTimeout(runTimers.get(run.id));runTimers.delete(run.id);
  const result={id:run.id,scheduleId:run.scheduleId,finishedAt:Date.now(),exitCode,status:run.timedOut?'timeout':exitCode===0?'success':'failed'};
  if(run.worktree){
    const changed=(await gitAt(run.worktree,['status','--porcelain']).catch(()=>'')).split('\n').filter(Boolean).length;
    const commits=Number(await gitAt(run.worktree,['rev-list','--count',run.base+'..HEAD']).catch(()=>'0'))||0;
    Object.assign(result,{changedFiles:changed,commits});
  }
  await recordRun(result);
  const task=(store.state.schedules||[]).find(t=>t.id===run.scheduleId);
  if(task)notifyRun(task,result.status==='success'?'已完成':result.status==='timeout'?'已超时并结束':'运行失败',result.changedFiles||result.commits?`改动 ${result.changedFiles} 个文件、${result.commits} 个提交，见分支 ${run.branch}`:result.status==='failed'?'退出码 '+exitCode:'');
}
// Checked twice a minute; a due task runs once and its next time is computed from now, so a sleeping Mac never queues a backlog.
async function tickSchedules(){
  const now=Date.now();
  for(const task of store.state.schedules||[]){
    if(!task.enabled||!task.nextRunAt||task.nextRunAt>now)continue;
    await store.update(s=>{const t=s.schedules.find(t=>t.id===task.id);if(t)t.nextRunAt=schedules.nextRun(t.rule,now);});pushState();
    void runSchedule(task.id,'schedule').catch(()=>{});
  }
}
async function startSchedules(){
  const now=Date.now();
  await store.update(s=>{
    s.schedules||=[];s.scheduleRuns||=[];
    for(const r of s.scheduleRuns)if(r.status==='running')Object.assign(r,{status:'interrupted',finishedAt:r.finishedAt||now,reason:'应用退出时仍在运行'});
    // Missed while the app was closed: run once now if allowed, otherwise wait for the next time.
    for(const t of s.schedules)if(t.enabled&&(!t.nextRunAt||t.nextRunAt<=now))t.nextRunAt=t.catchUp&&t.nextRunAt?now:schedules.nextRun(t.rule,now);
  });
  setInterval(()=>{void tickSchedules().catch(()=>{});},30000).unref();
  setTimeout(()=>{void tickSchedules().catch(()=>{});},5000).unref();
}

async function installTelemetry(accountId) {
  const dir = accountDir(accountId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const settingsFile = path.join(dir, 'settings.json');
  let settings = {};
  try { settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // Hooks are passed per launch, so the user's profile hooks are never overwritten.
  return settings;
}

const statusChecks = new Map(),configuringAccounts=new Set();
function statusAccount(accountId) {
  if(statusChecks.has(accountId))return statusChecks.get(accountId);
  const check=checkAccount(accountId).finally(()=>statusChecks.delete(accountId));
  statusChecks.set(accountId,check);return check;
}
async function checkAccount(accountId) {
  if(configuringAccounts.has(accountId))throw new Error('连接配置正在保存，请稍后重试');
  requireTool(store.account(accountId).agentToolId);
  try {
    const account=store.account(accountId);
    if(usesOfficialCli(account)){
      const tool=account.agentToolId,cli=await agentExecutable(tool),{env}=await officialEnv(account,cli),home=connections.officialHome(accountId,tool);
      const run=async args=>{try{const [file,command]=await agentCommand(cli,args,env);const {stdout,stderr}=await exec(file,command,{env,windowsHide:true,timeout:15000,maxBuffer:256*1024});return {code:0,stdout,stderr};}catch(error){if(typeof error.code!=='number')throw error;return {code:error.code,stdout:error.stdout||'',stderr:error.stderr||''};}};
      const data=await agentCatalog.officialProfile(tool).status(run,home);
      await store.update(s=>{const a=s.accounts.find(a=>a.id===accountId);if(!a)return;const identity=data.loggedIn&&data.email?tool+'|'+data.email.toLowerCase()+'|'+data.org:'';Object.assign(a,{status:data.loggedIn?'valid':'login',email:data.email||data.username||'',authMethod:data.method||'',identity,duplicateOf:identity?s.accounts.find(other=>other.id!==accountId&&other.identity===identity)?.id:undefined,checkedAt:Date.now(),error:''});});
      pushState();
      if(data.loggedIn)void refreshOfficialUsage(account,cli,env);
      return store.account(accountId);
    }
    if(account.connection){await connections.env(account);if(account.agentToolId&&account.agentToolId!=='claude-code')await agentExecutable(account.agentToolId);else await accountExecutable(account);await store.update(s=>Object.assign(s.accounts.find(a=>a.id===accountId),{status:'valid',authMethod:'custom-config',checkedAt:Date.now(),error:''}));pushState();return store.account(accountId);}
    const { stdout } = await exec(await accountExecutable(store.account(accountId)), ['auth', 'status', '--json'], { env: cliEnv(accountDir(accountId)), windowsHide:true,timeout: 15000, maxBuffer: 256 * 1024 });
    const data = JSON.parse(stdout);
    if(typeof data.loggedIn!=='boolean')throw new Error('Invalid auth status');
      await store.update(s => { const a=s.accounts.find(a => a.id === accountId);if(!a)return;const identity=data.accountId||data.accountUuid||(data.email?data.email.toLowerCase()+'|'+(data.orgId||''):'');Object.assign(a,{status:data.loggedIn?'valid':'login',email:data.email||'',authMethod:data.authMethod,identity,duplicateOf:identity?s.accounts.find(other=>other.id!==accountId&&other.identity===identity)?.id:undefined,checkedAt:Date.now(),error:''}); });
  } catch (e) {
    let data;
    try { data = JSON.parse(e.stdout); } catch {}
    const needsLogin=data?.loggedIn===false;
    await store.update(s => {const a=s.accounts.find(a => a.id === accountId);if(a)Object.assign(a, { status: needsLogin ? 'login' : 'unknown', checkedAt: Date.now(), error: needsLogin ? '' : e.killed ? '检查超时，请确认 CLI 可运行后重试' : '无法读取 CLI 登录状态，请确认启动入口可用后重试' });});
  }
  pushState();
  return store.state.accounts.find(a=>a.id===accountId);
}

async function sourceTranscript(source){
  if(source.transcript){
    try{const real=await fs.realpath(source.transcript),allowed=await fs.realpath(path.join(accountDir(source.accountId),'projects'));if(!inside(allowed,real))throw new Error('会话记录不在账号项目范围内');return real;}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  if(source.checkpoint){const real=await fs.realpath(source.checkpoint);if(inside(path.join(dataRoot,'checkpoints'),real))return real;}
  throw new Error('尚无可恢复的会话记录，请先完成一个回合或新建目标账号的会话');
}

const accountLabel=account=>(agentTools.find(t=>t.id===(account.agentToolId||'claude-code'))?.name||'Claude Code')+' · '+account.name;
async function sourceHandoff(source,file){return handoffFromRaw(source,file?await fs.readFile(file,'utf8'):'',!!file&&file===source.checkpoint);}
async function handoffFromRaw(source,raw,fromCheckpoint){
  const context={accountName:accountLabel(store.account(source.accountId)),cwd:source.cwd,projects:source.projects||store.workspace(source.workspaceId).projects};
  const bundle=raw?buildHandoff(raw,context):{text:'',truncated:false};
  if(source.handoffFile&&inside(path.join(dataRoot,'handoffs'),source.handoffFile)){
    const inherited=await fs.readFile(source.handoffFile,'utf8');
    return {text:inherited+(fromCheckpoint||!raw?'':'\n\n# 交接后的新增会话\n\n'+bundle.text),truncated:bundle.truncated};
  }
  return bundle;
}
// Finds what this session's agent recorded since it was launched, converted to the Claude transcript shape.
async function agentRaw(source){
  const account=store.account(source.accountId),tool=account.agentToolId,home=connections.officialHome(account.id,tool),since=(source.createdAt||0)-5000;
  if(tool==='codex-cli'){const file=await agentTranscripts.findCodexTranscript(home,source.cwd,since);return file?agentTranscripts.codexToClaude(await fs.readFile(file,'utf8')):'';}
  if(tool==='qoder-cli'){const file=await agentTranscripts.findQoderTranscript(home,source.cwd,since);return file?fs.readFile(file,'utf8'):'';}
  if(tool==='opencode'){
    const cli=await agentExecutable(tool);
    const env=usesOfficialCli(account)?(await officialEnv(account,cli)).env:{...cliEnv(null),...(await connections.env(account))};delete env.CLAUDE_CONFIG_DIR;
    const run=async args=>{const [file,command]=await agentCommand(cli,args,env);return exec(file,command,{env,cwd:source.cwd,windowsHide:true,timeout:30000,maxBuffer:64*1024*1024});};
    const listed=JSON.parse((await run(['session','list','--format','json'])).stdout||'[]');
    const sessionId=agentTranscripts.pickOpencodeSession(listed,source.cwd,since);if(!sessionId)return '';
    const out=(await run(['export',sessionId])).stdout;return agentTranscripts.opencodeToClaude(JSON.parse(out.slice(out.indexOf('{'))));
  }
  return '';
}
const switchableStatus=source=>source.kind==='claude'?['idle','exited'].includes(source.status):source.kind==='agent'&&source.status!=='starting';
// Claude-to-Claude can resume natively; anything involving another agent carries a handoff instead.
async function switchSource(source){
  if(source.kind==='claude'){const empty=await sourceIsEmpty(source);const file=empty?null:await sourceTranscript(source);return {empty,raw:file?await fs.readFile(file,'utf8'):'',file};}
  const raw=await agentRaw(source).catch(()=>'');
  const usable=agentTranscripts.hasTurns(raw)?raw:'';
  return {empty:!usable&&!source.handoffFile,raw:usable,file:null};
}

async function sourceIsEmpty(source){
  if(source.lastEvent!=='SessionStart'||source.hasSubmittedPrompt||source.checkpoint||source.handoffFile)return false;
  let file;
  try{file=await sourceTranscript(source);}catch(e){if(e.message.startsWith('尚无可恢复的会话记录'))return true;throw e;}
  const lines=(await fs.readFile(file,'utf8')).split('\n').filter(Boolean);
  return lines.every(line=>{try{const row=JSON.parse(line);return !['user','assistant','summary'].includes(row.type)&&!row.isCompactSummary;}catch{return false;}});
}

async function startSession(input) {
  let kind = ['claude', 'shell', 'login', 'agent'].includes(input.kind) ? input.kind : 'claude';
  const workspace = kind === 'login' ? null : store.workspace(input.workspaceId);
  const backend = 'embedded';
  const projects=kind==='login'?[]:(input.resumeProjects || workspace.projects);
  const acct = kind === 'shell' ? null : store.account(input.accountId || workspace?.accountId);
  if(acct)requireTool(acct.agentToolId);
  if(kind==='login'&&acct?.connection)throw new Error('自定义供应商使用 API Key / Token，请在连接详情中编辑');
  if(acct&&kind!=='shell'&&kind!=='login')kind=(acct.agentToolId||'claude-code')==='claude-code'?'claude':'agent';
  if(kind==='agent'&&usesOfficialCli(acct)){await statusAccount(acct.id);if(store.account(acct.id).status==='login')throw new Error('该账号需要重新登录，请在账号中心通过系统默认浏览器授权');}
  if(kind==='claude'){await statusAccount(acct.id);if(store.account(acct.id).status==='login')throw new Error('该账号需要重新登录，请在账号中心通过系统默认浏览器授权');}
  if(workspace&&!projects.length)throw new Error('请先在工作空间设置中添加本地项目');
  const cwd = workspace ? await fs.realpath(input.resumeCwd || projects[0]?.path || '') : accountDir(acct.id);
  if (!cwd || !(await fs.stat(cwd)).isDirectory()) throw new Error('主项目根目录不可用');
  const sessionId = id();
  const metadataPath = path.join(telemetryDir, sessionId + '-event.json');
  const promptFile=path.join(telemetryDir,sessionId+'-prompt.md'),mcpFile=path.join(telemetryDir,sessionId+'-mcp.json');
  const env = {...cliEnv(acct ? accountDir(acct.id) : null),...(acct?await connections.env(acct):{})};
  // Login must use the user's macOS default browser, never an embedded webview or a named browser.
  Object.assign(env,platformTools.browserSettings());
  let file = store.state.settings.shell || platformTools.defaultShell(), args = platformTools.shellArgs(file);
  if(kind==='shell'&&process.platform==='win32'){
    const cli=await executable().catch(()=>null);
    if(cli){env.Path=path.dirname(cli)+';'+platformTools.value(env,'PATH');args=platformTools.discoveredShellArgs(file,cli);}
  }
  const official=usesOfficialCli(acct);
  if(kind==='agent'||(kind==='login'&&official)){
    const cli=await agentExecutable(acct.agentToolId);
    delete env.CLAUDE_CONFIG_DIR;
    // On Windows an npm .cmd shim is bypassed when its target can be found, so arguments never pass through cmd.exe.
    const shimmed=process.platform==='win32'&&!/\.exe$/i.test(cli),direct=shimmed?await platformTools.resolveCmdShim(cli,env):null,viaCmd=shimmed&&!direct;
    let cliArgs=[];
    if(official){const prepared=await officialEnv(acct,cli);for(const name of prepared.clearEnv)delete env[name];Object.assign(env,prepared.env);if(kind==='login')cliArgs=prepared.loginArgs;
      // Qoder hands its account balance to the status line; cmd.exe cannot carry this JSON safely.
      else if(acct.agentToolId==='qoder-cli'&&!viaCmd){
        env.ELECTRON_RUN_AS_NODE='1';env.ACCOUNTOR_ACCOUNT_PROVIDER='custom';env.ACCOUNTOR_RUN_ID=sessionId;env.ACCOUNTOR_TELEMETRY_DIR=telemetryDir;
        const script=path.join(root,'scripts/claude-telemetry.cjs');
        cliArgs=['--settings',JSON.stringify({statusLine:platformTools.hookSettings(process.execPath,script,null).statusLine,hooks:agentStatus.qoderHooks(process.execPath,script)})];
      }}
    // Working / waiting status: each agent reports turns into the same event file as the Claude hooks.
    let statusArgs=[];
    if(kind==='agent'&&!viaCmd){
      env.ACCOUNTOR_RUN_ID=sessionId;env.ACCOUNTOR_TELEMETRY_DIR=telemetryDir;
      if(acct.agentToolId==='codex-cli')statusArgs=await codexStatusArgs(cli,env,cwd);
      if(acct.agentToolId==='opencode')env.OPENCODE_CONFIG_CONTENT=agentStatus.mergeOpencodePlugin(env.OPENCODE_CONFIG_CONTENT,await agentStatus.opencodePlugin(path.join(dataRoot,'agent-status')));
    }
    // YOLO: interactive sessions skip every permission prompt when the user turned it on for this agent.
    // Scheduled runs keep the permission level chosen for the task.
    let yoloArgs=[];
    if(kind==='agent'&&!input.headless&&(store.state.settings.yoloAgents||[]).includes(acct.agentToolId)){
      if(acct.agentToolId==='codex-cli')yoloArgs=['--dangerously-bypass-approvals-and-sandbox'];
      else if(acct.agentToolId==='qoder-cli')yoloArgs=['--dangerously-skip-permissions'];
      else if(acct.agentToolId==='opencode')env.OPENCODE_CONFIG_CONTENT=schedules.mergeOpencodeConfig(env.OPENCODE_CONFIG_CONTENT,schedules.opencodeFullPermission);
    }
    if(kind==='agent'&&input.headless){
      const headless=schedules.headlessArgs(acct.agentToolId,input.headless.prompt,input.headless.permission);
      cliArgs=acct.agentToolId==='qoder-cli'?[...cliArgs,...headless.args]:headless.args;
      if(headless.opencodePermission)env.OPENCODE_CONFIG_CONTENT=schedules.mergeOpencodeConfig(env.OPENCODE_CONFIG_CONTENT,headless.opencodePermission);
    }
    else if(kind==='agent'&&input.handoffFile)cliArgs=[...cliArgs,...agentTranscripts.handoffArgs(acct.agentToolId,input.handoffFile)];
    let promptArgs=[],toolDirs=[];
    if(kind==='agent'){
      const tools=integrations.cliLaunch(store.state.cliTools,acct.agentToolId);toolDirs=tools.dirs;
      const text=[systemPrompts.promptFor(store.state.settings.systemPrompts,acct.agentToolId),tools.prompt].filter(Boolean).join('\n\n');
      const plan=await systemPrompts.launchPlan(acct.agentToolId,text,{file:promptFile,env,shim:viaCmd});Object.assign(env,plan.env);
      // cmd.exe cannot carry the quoted Codex MCP flags; the other agents take a file or the environment (built on top of the prompt's).
      const mcp=viaCmd&&acct.agentToolId==='codex-cli'?{args:[],env:{}}:await integrations.mcpLaunch(acct.agentToolId,store.state.mcpServers||[],await mcpSecrets.read().catch(()=>({})),{file:mcpFile,env,lookup:await mcpLookup()});
      cliArgs=[...statusArgs,...yoloArgs,...(acct.agentToolId==='codex-cli'?mcp.args:[]),...plan.before,...cliArgs,...plan.after,...(acct.agentToolId==='codex-cli'?[]:mcp.args)];Object.assign(env,mcp.env);promptArgs=[...plan.before,...plan.after];
    }
    const pathKey=process.platform==='win32'?'Path':'PATH';env[pathKey]=[path.dirname(cli),...toolDirs,env[pathKey]].join(pathSep);
    file=direct?.file||cli;args=[...(direct?.args||[]),...cliArgs];
    if(viaCmd&&promptArgs.some(a=>/["%^\r\n]/.test(a)))throw new Error((agentTools.find(t=>t.id===acct.agentToolId)?.name||'该 Agent')+' 的启动脚本无法识别，只能经 cmd.exe 启动，传不了含引号、%、^ 或换行的系统提示词，请在“设置 → 系统提示词”中调整或取消对它生效');
    if(viaCmd){file=process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe';args=platformTools.cmdShimCommand(cli,cliArgs);}
    else if(process.platform==='win32')args=platformTools.windowsCommandLine(args);
  }else if (acct) {
    if(acct.source!=='existing')await installTelemetry(acct.id);
    file = await accountExecutable(acct);
    const telemetryScript=path.join(root,'scripts/claude-telemetry.cjs');
    env.ELECTRON_RUN_AS_NODE = '1';
    env.ACCOUNTOR_ACCOUNT_PROVIDER = acct.provider || 'subscription';
    env.ACCOUNTOR_RUN_ID = sessionId; env.ACCOUNTOR_TELEMETRY_DIR = telemetryDir;
    if(kind==='login'&&acct.provider==='custom')throw new Error('自定义供应商使用 API Key / Token，请在连接详情中编辑');
    if (kind === 'login') args = ['--settings',JSON.stringify({env:platformTools.browserSettings()}),'auth', 'login', '--claudeai'];
    else {
      const settings = { hooks: {},...(backend==='embedded'?{tui:store.state.settings.terminalRenderer==='fullscreen'?'fullscreen':'default'}:{}),env:{...(backend==='embedded'&&store.state.settings.terminalRenderer!=='fullscreen'?{CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN:'1'}:{}),...platformTools.browserSettings(),...(acct.command==='claude-dp'?{ENABLE_TOOL_SEARCH:'false'}:{})} };
      // Test runs (ACCOUNTOR_DATA_DIR) must not pick up the developer's own status line.
      const defaultClaudeDir=!process.env.ACCOUNTOR_DATA_DIR||process.env.ACCOUNTOR_AUTO_SCAN==='1'?path.join(process.env.ACCOUNTOR_SCAN_HOME||os.homedir(),'.claude'):null;
      const hud=await inheritedStatusLine(accountDir(acct.id),defaultClaudeDir),originalStatusLine=hud.statusLine;
      if(hud.configDir)env.ACCOUNTOR_HUD_CONFIG_DIR=hud.configDir;
      // Nothing configured anywhere: the claude-hud bundled with WbSpace is shown instead.
      else if(!originalStatusLine&&existsSync(BUILTIN_HUD)){env.ACCOUNTOR_BUILTIN_HUD=BUILTIN_HUD;if(acct.source!=='existing')await prepareBuiltinHud(accountDir(acct.id)).catch(()=>{});}
      const telemetry=platformTools.hookSettings(process.execPath,telemetryScript,originalStatusLine);
      // A turn that ends on an API error such as the usage limit fires StopFailure instead of Stop (Claude Code 2.1.78+).
      const turnEnds=versionAtLeast(await claudeVersion(file,env),'2.1.78')?['Stop','StopFailure']:['Stop'];
      for(const event of ['SessionStart','UserPromptSubmit',...turnEnds,'SessionEnd'])settings.hooks[event]=[{hooks:[telemetry.event]}];
      settings.statusLine=telemetry.statusLine;
      args = ['--no-chrome','--settings', JSON.stringify(settings)];
      if(acct.connection)args.push('--model',acct.connection.defaultModel);
      const extra = [];
      for (const project of projects.slice(1)) {
        try { extra.push(await fs.realpath(project.path)); } catch { throw new Error('附加项目不可访问：' + project.path); }
      }
      const tools=integrations.cliLaunch(store.state.cliTools,'claude-code');
      if(tools.dirs.length){const key=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH';env[key]=[...tools.dirs,env[key]].join(pathSep);}
      args.push(...(await integrations.mcpLaunch('claude-code',store.state.mcpServers||[],await mcpSecrets.read().catch(()=>({})),{file:mcpFile,lookup:await mcpLookup()})).args);
      const appended=[systemPrompts.promptFor(store.state.settings.systemPrompts,'claude-code'),tools.prompt].filter(Boolean).join('\n\n');
      if(appended)args.push(...(await systemPrompts.launchPlan('claude-code',appended,{file:promptFile,handoffFile:input.handoffFile})).after);
      else if(input.handoffFile)args.push('--append-system-prompt-file',input.handoffFile);
      if(!input.handoffFile&&input.resumeFile) args.push('--resume', input.resumeFile, '--fork-session');
      else if(!input.handoffFile&&input.resumeId) args.push('--resume', input.resumeId);
      if (extra.length&&!input.headless) args.push('--add-dir', ...extra);
      if(input.headless)args.push(...schedules.headlessArgs('claude-code',input.headless.prompt,input.headless.permission).args);
      else if((store.state.settings.yoloAgents||[]).includes('claude-code'))args.push('--dangerously-skip-permissions');
    }
  }
  if(process.platform==='win32'&&acct&&kind!=='agent'&&!official&&!/\.exe$/i.test(file))throw new Error('Windows 请选择原生 Claude CLI 可执行文件 claude.exe');
  if(!path.isAbsolute(file))throw new Error('请设置终端可执行文件的绝对路径');
  try{await fs.access(file,1);}catch{throw new Error('终端可执行文件不存在或无执行权限：'+file);}
  const record = { id: sessionId, workspaceId: workspace?.id || '', accountId: acct?.id || '', kind, backend, cwd, projects, pendingRestore:input.restoreSourceId,checkpoint:input.resumeFile||input.checkpointFile, handoffFile:input.handoffFile||input.inheritedHandoffFile, title: kind === 'login' ? '登录 · ' + acct.name : kind === 'shell' ? 'Shell' : 'Claude · ' + acct.name, createdAt: Date.now(), status: 'starting', groupId: input.groupId || sessionId, orientation: input.orientation || 'horizontal', authVerified:acct?store.account(acct.id).status==='valid':false, recovery:input.handoffFile?'handoff':input.resumeId || input.resumeFile ? 'requested' : undefined };
  record.titleSource='default';record.titleToken=sessionId.replaceAll('-','').slice(-6).toUpperCase();record.title=defaultTitle(record);
  if(input.title){record.title=String(input.title).slice(0,120);record.titleSource='manual';}if(input.scheduleRunId)record.scheduleRunId=input.scheduleRunId;if(input.scheduleId)record.scheduleId=input.scheduleId;
  await store.update(s => { s.sessions.push(record); }); pushState();
  {
    try {
      const proc = pty.spawn(file, args, { ...(process.platform==='win32'?{useConptyDll:true}:{}),name: 'xterm-256color', cols: 100, rows: 32, cwd, env });
      const runtime = { proc,history:new TerminalHistory(),pending:[],pendingSize:0,outputTimer:null,seq:0,timer:null };
      terminals.set(sessionId, runtime);
      if(kind==='login')runtime.timer=setInterval(()=>{void statusAccount(acct.id).catch(()=>{});},3000);
      proc.onData(data=>{runtime.lastOutput=Date.now();appendTerminal(runtime,sessionId,data,notify);});
      proc.onExit(async ({ exitCode }) => {
        flushTerminal(runtime,sessionId,notify);runtime.closed=true;runtime.closedAt=Date.now();runtime.history.shrink(128*1024);
        const closed=[...terminals.entries()].filter(([,t])=>t.closed).sort((a,b)=>a[1].closedAt-b[1].closedAt);for(const [oldId] of closed.slice(0,-8))terminals.delete(oldId);
        if(acct)await pollTelemetry([sessionId]).catch(()=>{});
        clearInterval(runtime.timer);
        await store.update(s => { const r = s.sessions.find(s => s.id === sessionId); if (r) { r.status = 'exited'; r.exitCode = exitCode; } });
        notify('terminal:exit', { id: sessionId, exitCode }); pushState();
        void finishScheduledRun(sessionId,exitCode).catch(()=>{});
        if (acct) await statusAccount(acct.id).catch(()=>{});
      });
      await store.update(s => Object.assign(s.sessions.find(s => s.id === sessionId), { status: 'running', pid: proc.pid }));
    } catch (e) { await store.update(s => Object.assign(s.sessions.find(s => s.id === sessionId), { status: 'failed', error: e.message })); pushState(); throw e; }
  }
  pushState();
  return store.state.sessions.find(s => s.id === sessionId);
}

let titleWork=Promise.resolve();
function refreshTitles(ids){
  const job=titleWork.then(async()=>{
    const records=[...store.state.sessions,...(store.state.deletedWorkspaces||[]).flatMap(g=>g.sessions.map(row=>row.session))].filter(r=>!ids||ids.includes(r.id));
    const updates=[];
    for(const original of records){
      const r=structuredClone(original),changed=migrateTitle(r,store.state.accounts.find(a=>a.id===r.accountId));
      if(r.kind==='claude'&&r.titleSource==='default'){
        for(const candidate of [r.transcript,r.checkpoint].filter(Boolean)){
          try{
            const real=await fs.realpath(candidate);
            const roots=[path.join(dataRoot,'checkpoints'),path.join(accountDir(r.accountId),'projects')];
            const allowed=await Promise.all(roots.map(root=>fs.realpath(root).catch(()=>null)));
            if(!allowed.some(root=>root&&inside(root,real)))continue;
            if(applyTaskTitle(r,await transcriptTitle(real)))break;
          }catch{/* Missing or unavailable transcripts keep a distinct fallback title. */}
        }
      }
      if(changed||r.title!==original.title)updates.push({before:original,after:r});
    }
    if(!updates.length)return;
    await store.update(s=>{
      for(const {before,after} of updates){
        const current=s.sessions.find(r=>r.id===before.id)||findDeleted(s,before.id)?.row.session;
        if(current&&current.title===before.title&&current.titleSource===before.titleSource)copyTitle(after,current);
      }
    });
  });
  titleWork=job.catch(()=>{});return job;
}

async function expireDeleted(){
  const now=Date.now();
  if((store.state.deletedWorkspaces||[]).some(g=>g.sessions.some(r=>!Number.isFinite(r.deletedAt)||r.deletedAt+7*86400000<=now))){
    await store.update(s=>pruneDeleted(s,now));pushState();
  }
}

function restoreSession(sid,fromTrash){
  if(deletingSessions.has(sid))throw new Error('会话正在删除，请稍后重试');
  if(restoringJobs.has(sid))return restoringJobs.get(sid);
  const job=performRestore(sid,fromTrash).finally(()=>restoringJobs.delete(sid));
  restoringJobs.set(sid,job);return job;
}

async function performRestore(sid,fromTrash){
  await expireDeleted();
  const deleted=fromTrash?findDeleted(store.state,sid):null;
  const source=fromTrash?deleted?.row.session:store.state.sessions.find(s=>s.id===sid);
  if(!source)throw new Error(fromTrash?'删除记录不存在或已超过 7 天':'会话不存在');
  if(source.pendingRestore)throw new Error('此会话正在恢复，请等待完成');
  if(source.requiresExternalExit){const choice=await dialog.showMessageBox(win,{type:'warning',message:'在内置终端恢复历史会话？',detail:'此历史会话原本在外部终端运行。请先结束旧窗口中的 CLI，避免同时操作同一个原生对话。旧窗口不会由本工具关闭。',buttons:['取消','已结束旧 CLI，继续恢复'],defaultId:0,cancelId:0});if(choice.response!==1)return null;}
  const runtime=terminals.get(sid);
  if(!fromTrash&&runtime&&!runtime.closed&&source.status==='exited'){
    const deadline=Date.now()+5000;while(!runtime.closed&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
    if(!runtime.closed)throw new Error('原终端正在退出，请稍后再恢复');
  }
  if(!fromTrash&&((runtime&&!runtime.closed))){
    await store.update(s=>{const w=s.workspaces.find(w=>w.id===source.workspaceId);if(w){s.selectedWorkspace=w.id;w.selectedSession=sid;w.hiddenGroups=(w.hiddenGroups||[]).filter(g=>g!==source.groupId);}});pushState();return source;
  }
  if(source.kind!=='shell')store.account(source.accountId);
  let createdWorkspace=false,result;
  try{
    if(source.kind!=='login'&&!store.state.workspaces.some(w=>w.id===source.workspaceId)){
      const snapshot=deleted?.group.workspace;
      if(!snapshot)throw new Error('原工作空间已移除，无法恢复');
      // Validate archived paths before recreating a workspace reference.
      for(const project of snapshot.projects){const real=await fs.realpath(project.path);if(!(await fs.stat(real)).isDirectory())throw new Error('原项目目录已不可用');}
      if(!snapshot.projects.length)throw new Error('原工作空间没有可用项目');
      await store.update(s=>{if(!s.workspaces.some(w=>w.id===snapshot.id)){s.workspaces.push({...snapshot,selectedSession:'',hiddenGroups:[]});createdWorkspace=true;}});
    }
  if(source.kind==='claude'&&!source.claudeSessionId)throw new Error('未取得精确的 Claude 会话 ID，不能猜测恢复；删除记录将保留，可检查原 CLI 历史后重试');
    let restore={resumeId:source.claudeSessionId};
    if(source.kind==='claude'&&source.checkpoint){
      const actual=await fs.access(source.transcript||'').then(()=>true).catch(()=>false);
      if(!actual)restore=source.handoffFile?{handoffFile:source.handoffFile,checkpointFile:source.checkpoint}:{resumeFile:await sourceTranscript(source)};
    }
    result=await startSession({workspaceId:source.workspaceId,accountId:source.accountId,kind:source.kind,resumeCwd:source.cwd,resumeProjects:source.projects,resumeBackend:source.backend,checkpointFile:source.checkpoint,...restore,inheritedHandoffFile:source.handoffFile,restoreSourceId:sid});
    const deadline=Date.now()+30000;
    let ready;
    while(Date.now()<deadline){
      await pollTelemetry([result.id]);
      const target=store.state.sessions.find(s=>s.id===result.id);
      if(!target||['exited','failed'].includes(target.status))throw new Error('恢复进程启动失败，原会话或删除记录已保留');
      if(source.kind!=='claude'||target.claudeSessionId&&['idle','busy'].includes(target.status)){
        if(source.kind==='claude'&&restore.resumeId&&target.claudeSessionId!==restore.resumeId)throw new Error('CLI 未恢复指定的会话，原记录已保留');
        ready=target;break;
      }
      await new Promise(r=>setTimeout(r,200));
    }
    if(!ready)throw new Error('尚未确认 CLI 恢复就绪，原会话或删除记录已保留');
    await store.update(s=>{
      const target=s.sessions.find(r=>r.id===result.id);if(!target||['failed','exited'].includes(target.status))throw new Error('恢复进程已结束，原记录已保留');
      copyTitle(source,target);if(source.scheduleId)target.scheduleId=source.scheduleId;target.groupId=source.groupId||target.groupId;target.orientation=source.orientation;target.createdAt=source.createdAt;target.restoredAt=Date.now();delete target.pendingRestore;
      replaceSession(s,sid,target);if(fromTrash)forgetDeleted(s,sid);
      const w=s.workspaces.find(w=>w.id===source.workspaceId);if(w){s.selectedWorkspace=w.id;w.selectedSession=target.id;w.collapsed=false;w.hiddenGroups=(w.hiddenGroups||[]).filter(g=>g!==target.groupId);}
    });
    terminals.delete(sid);
    for(const name of ['event.json','usage.json','prompt.md','mcp.json'])await fs.rm(path.join(telemetryDir,sid+'-'+name),{force:true}).catch(()=>{});
    pushState();return store.state.sessions.find(r=>r.id===result.id);
  }catch(error){
    const targets=store.state.sessions.filter(r=>r.pendingRestore===sid);
    for(const target of targets){
      const t=terminals.get(target.id);
      if(t&&!t.closed){try{t.proc.kill();}catch{}const deadline=Date.now()+5000;while(!t.closed&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));}
      // Never hide an external or unconfirmed live process; keep it available for inspection.
      if(target.backend==='embedded'&&(!t||t.closed)){
        await store.update(s=>replaceSession(s,target.id));terminals.delete(target.id);
      }else await store.update(s=>{const r=s.sessions.find(r=>r.id===target.id);if(r){r.error=error.message;delete r.pendingRestore;}});
    }
    if(createdWorkspace)await store.update(s=>{if(!s.sessions.some(r=>r.workspaceId===source.workspaceId))s.workspaces=s.workspaces.filter(w=>w.id!==source.workspaceId);});
    pushState();throw error;
  }
}

function register(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win.webContents) throw new Error('无效请求来源');
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

function registerHandlers() {
  register('state:get',async()=>{await draftWrites.flush();await expireDeleted();return store.state;});
  register('clipboard:write',async text=>{if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024)throw new Error('复制内容超出限额');await clipboard.writeText(text);return true;});
  register('clipboard:copy-native',()=>win.webContents.copy());
  register('workspace:pick', async () => {
    const result = await dialog.showOpenDialog(win, { title: '选择工作空间的本地项目', properties: ['openDirectory', 'multiSelections'] });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async p => ({ path: await fs.realpath(p), name: path.basename(p) })));
  });
  register('workspace:save', async input => {
    if (!input.name?.trim() || !Array.isArray(input.projects)) throw new Error('请填写工作空间名称和项目');
    const projects = [], paths = new Set();
    for (const project of input.projects) {
      const real = await fs.realpath(project.path);
      if (!(await fs.stat(real)).isDirectory()) throw new Error('项目必须是文件夹');
      if (!paths.has(real)) { paths.add(real); projects.push({ path: real, name: path.basename(real) }); }
    }
    if(input.id===DEFAULT_WORKSPACE_ID){
      await store.update(s=>{const w=s.workspaces.find(w=>w.id===DEFAULT_WORKSPACE_ID);if(w){w.accountId=input.accountId||'';s.selectedWorkspace=w.id;}});pushState();return store.workspace(DEFAULT_WORKSPACE_ID);
    }
    const w = { id: input.id || id(), name: input.name.trim().slice(0,100), group:String(input.group||'').trim().slice(0,80),pinned:!!input.pinned,lastUsedAt:input.lastUsedAt||Date.now(),projects, backend: 'embedded', accountId: input.accountId || '', rightOpen: input.rightOpen ?? false, rightWidth: Math.max(280, Math.min(800, input.rightWidth || 360)) };
    await store.update(s => { const i = s.workspaces.findIndex(x => x.id === w.id); if (i < 0) {w.createdAt=Date.now();w.createdOrder=nextWorkspaceOrder(s);{const at=s.workspaces.findIndex(x=>x.id===DEFAULT_WORKSPACE_ID);s.workspaces.splice(at<0?s.workspaces.length:at,0,w);}} else s.workspaces[i] = { ...s.workspaces[i], ...w, createdAt:s.workspaces[i].createdAt,createdOrder:s.workspaces[i].createdOrder }; s.selectedWorkspace = w.id; }); pushState(); return store.workspace(w.id);
  });
  register('workspace:collapse',async(wid,collapsed)=>{store.workspace(wid);if(typeof collapsed!=='boolean')throw new Error('无效的展开状态');await store.update(s=>{s.workspaces.find(w=>w.id===wid).collapsed=collapsed;});pushState();});
  register('workspace:select', async wid => { store.workspace(wid); await store.update(s => { s.selectedWorkspace = wid;s.workspaces.find(w=>w.id===wid).lastUsedAt=Date.now(); }); pushState(); });
  register('workspace:tabs',async(wid,update)=>{store.workspace(wid);await store.update(s=>{const w=s.workspaces.find(w=>w.id===wid);if(Array.isArray(update.hiddenGroups))w.hiddenGroups=update.hiddenGroups.filter(g=>s.sessions.some(r=>r.groupId===g&&r.workspaceId===wid));if(update.selectedSession!==undefined)w.selectedSession=update.selectedSession;});pushState();});
  register('workspace:layout', async (wid, layout) => { store.workspace(wid); await store.update(s => Object.assign(s.workspaces.find(w => w.id === wid), { rightOpen: !!layout.rightOpen, rightWidth: Math.max(280, Math.min(800, Number(layout.rightWidth) || 360)) })); });
  register('workspace:preview-layout',async(wid,ratio)=>{
    store.workspace(wid);if(typeof ratio!=='number'||!Number.isFinite(ratio))throw new Error('无效的文件内容布局');
    await store.update(s=>{s.workspaces.find(w=>w.id===wid).previewSplit=Math.min(.75,Math.max(.15,ratio));});pushState();
  });
  register('workspace:remove', async wid => {
    if(wid===DEFAULT_WORKSPACE_ID)throw new Error('默认工作空间不能移除');
    if (store.state.sessions.some(s => s.workspaceId === wid && terminals.get(s.id) && ['running','busy','idle','starting'].includes(s.status))) throw new Error('请先结束该工作空间的运行中终端');
    await store.update(s => { s.workspaces = s.workspaces.filter(w => w.id !== wid); if (s.selectedWorkspace === wid) s.selectedWorkspace = s.workspaces[0]?.id || ''; }); pushState();
  });
  register('account:add', async input => {
    const spec=typeof input==='string'?{name:input}:input;
    if (!spec||typeof spec.name!=='string'||!spec.name.trim()) throw new Error('请输入账号别名');
    const custom=spec.provider==='custom';
    if(spec.provider&&!['subscription','custom'].includes(spec.provider))throw new Error('不支持的账号类型');
    const account = {agentToolId:custom?(spec.agentToolId||'claude-code'):spec.agentToolId&&agentCatalog.agent(spec.agentToolId).login?spec.agentToolId:'claude-code',id:id(),name:spec.name.trim().slice(0,80),source:'managed',provider:custom?'custom':'subscription',status:custom?'unknown':'login',email:'',createdAt:Date.now(),usage:null};
    if(custom){account.connection=connection(spec);account.keyVersion=id();}
    try{await connections.provision(account,custom||account.agentToolId!=='claude-code'?'':await executable());if(custom)await connections.writeKey(account.id,spec.apiKey,account.keyVersion);await store.update(s=>s.accounts.push(account));}
    catch(e){await connections.cleanup(account).catch(()=>{});throw e;}
    pushState();return account;
  });
  register('account:configure',async(accountId,input)=>{
    const account=store.account(accountId);if(!account.connection)throw new Error('现有脚本引用由原配置管理，请新建自定义连接');
    const config=connection({...input,agentToolId:input.agentToolId||account.agentToolId});
    if(configuringAccounts.has(accountId))throw new Error('连接配置正在保存，请稍后重试');
    configuringAccounts.add(accountId);
    try{
    // Versioned encrypted files let in-flight launches keep their original config/key pair.
    const keyVersion=input.apiKey?id():account.keyVersion;
    try{if(input.apiKey)await connections.writeKey(accountId,input.apiKey,keyVersion);await store.update(s=>{const a=s.accounts.find(a=>a.id===accountId);if(!a)throw new Error('连接已被移除');Object.assign(a,{connection:config,agentToolId:input.agentToolId||a.agentToolId||'claude-code',keyVersion,status:'unknown',checkedAt:undefined,error:'',usage:null});});}
    catch(e){if(input.apiKey)await fs.rm(connections.secret(accountId,keyVersion),{force:true});throw e;}
    pushState();return store.account(accountId);
    }finally{configuringAccounts.delete(accountId);}
  });
  register('account:status', statusAccount);
  register('account:rename',async(accountId,name)=>{store.account(accountId);if(!name?.trim())throw new Error('账号别名不能为空');await store.update(s=>{s.accounts.find(a=>a.id===accountId).name=name.trim().slice(0,80);});pushState();});
  register('terminal:rename',async(sid,title)=>{if(!title?.trim())throw new Error('会话名称不能为空');await store.update(s=>{const r=s.sessions.find(s=>s.id===sid);if(!r)throw new Error('会话不存在');r.title=title.trim().slice(0,100);r.titleSource='manual';});pushState();});
  register('account:discover',()=>profileDiscovery.discover());
  register('account:pick-profile',async()=>{
    const choice=await dialog.showOpenDialog(win,{title:'选择 Claude CLI 配置目录',properties:['openDirectory','showHiddenFiles']});
    return choice.canceled?null:profileDiscovery.profile(choice.filePaths[0]);
  });
  register('account:import', async input => {
    let spec;
    if(typeof input==='string'){
      // Compatibility for older UI clients; no shell content is evaluated.
      const configDirectory=profileDiscovery.existingDirectory({command:input});
      spec={...await profileDiscovery.profile(configDirectory),command:input,provider:['claude-dp','claude-zmn'].includes(input)?'custom':'subscription'};
    }else{
      const picked=await profileDiscovery.profile(input?.configDirectory);
      spec={...picked,provider:['subscription','custom'].includes(input.provider)?input.provider:picked.provider};
    }
    const old=store.state.accounts.find(a=>a.source==='existing'&&profileDiscovery.existingDirectory(a)===spec.configDirectory);if(old)return old;
    const a={agentToolId:'claude-code',id:id(),name:spec.command||spec.name,email:'',source:'existing',command:spec.command||'',configDirectory:spec.configDirectory,provider:spec.provider,status:'unknown',createdAt:Date.now(),usage:null};
    await store.update(s=>s.accounts.push(a));pushState();return a;
  });
  register('account:login', accountId => startSession({ kind: 'login', accountId }));
  register('terminal:close',async sid=>{
    const session=store.state.sessions.find(s=>s.id===sid);
    if(!session||session.kind!=='login')throw new Error('请选择登录会话');
    const runtime=terminals.get(sid);
    if(runtime&&!runtime.closed){
      const choice=await dialog.showMessageBox(win,{type:'question',message:'关闭登录会话？',detail:'将取消尚未结束的登录进程，已保存的认证信息不会删除。',buttons:['取消','关闭登录会话'],defaultId:0,cancelId:0});
      if(choice.response!==1)return false;
      clearInterval(runtime.timer);runtime.proc.kill();
    }
    await store.update(s=>{s.sessions.find(s=>s.id===sid).closedAt=Date.now();});pushState();return true;
  });
  register('terminal:reopen',async sid=>{
    const session=store.state.sessions.find(s=>s.id===sid);if(!session||session.kind!=='login')throw new Error('请选择登录会话');
    await store.update(s=>{delete s.sessions.find(s=>s.id===sid).closedAt;});pushState();return store.state.sessions.find(s=>s.id===sid);
  });
  register('terminal:delete',async sid=>{
    const session=store.state.sessions.find(s=>s.id===sid);if(!session)throw new Error('会话不存在');
    if(restoringJobs.has(sid)||session.pendingRestore||deletingSessions.has(sid))throw new Error('会话正在恢复或删除，请稍后重试');
    deletingSessions.add(sid);try{
    const runtime=terminals.get(sid),active=runtime&&!runtime.closed;
    const choice=await dialog.showMessageBox(win,{type:'warning',message:'删除会话“'+session.title+'”？',detail:(active?'运行中的内置终端将被结束。\n':'')+'移入最近删除，保留 7 天，可按工作空间恢复。项目文件和原始 CLI 历史保留。',buttons:['取消','删除会话'],defaultId:0,cancelId:0});
    if(choice.response!==1)return false;
    if(active){
      clearInterval(runtime.timer);runtime.proc.kill();
      const deadline=Date.now()+5000;
      while(!runtime.closed&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
      if(!runtime.closed)throw new Error('终端尚未结束，未删除会话，请稍后重试');
    }
    await pollTelemetry([sid]);
    let deletionCheckpoint;
    const captured=store.state.sessions.find(r=>r.id===sid);
    if(captured?.kind==='claude'&&captured.claudeSessionId){
      let transcript;try{transcript=await sourceTranscript(captured);}catch(error){if(!error.message.startsWith('尚无可恢复的会话记录'))throw error;}
      if(transcript){deletionCheckpoint=path.join(dataRoot,'checkpoints','deleted-'+id()+'.jsonl');await fs.mkdir(path.dirname(deletionCheckpoint),{recursive:true,mode:0o700});await fs.copyFile(transcript,deletionCheckpoint);await fs.chmod(deletionCheckpoint,0o600);}
    }
    await refreshTitles([sid]);
    await store.update(s=>{
      const latest=s.sessions.find(r=>r.id===sid);if(!latest)throw new Error('会话已被移除');
      archiveSession(s,deletionCheckpoint?{...latest,checkpoint:deletionCheckpoint}:latest);
      replaceSession(s,sid);
      s.operations=s.operations.filter(o=>o.source!==sid&&o.target!==sid);
      for(const w of s.workspaces){
        if(w.selectedSession===sid)w.selectedSession='';
        w.hiddenGroups=(w.hiddenGroups||[]).filter(g=>s.sessions.some(r=>r.workspaceId===w.id&&r.groupId===g));
      }
    });
    terminals.delete(sid);
    for(const name of ['event.json','usage.json','prompt.md','mcp.json'])await fs.rm(path.join(telemetryDir,sid+'-'+name),{force:true}).catch(()=>{});
    pushState();return true;
    }finally{deletingSessions.delete(sid);}
  });
  register('account:remove', async accountId => {
    const account=store.account(accountId);
    if (store.state.sessions.some(s => s.accountId === accountId && ['running','starting','busy','idle','external'].includes(s.status))) throw new Error('请先结束或解绑该账号的活动会话');
    // Referenced local profiles belong to the user; only directories this app created are deleted.
    const owned=account.source!=='existing';
    if(owned)await signOutManaged(account);
    await store.update(s => { s.accounts = s.accounts.filter(a => a.id !== accountId); for (const w of s.workspaces) if (w.accountId === accountId) w.accountId = ''; }); pushState();
    if(owned){try{await connections.cleanup(account);}catch{throw new Error('连接已移除，但本地目录未能删除，请手动删除：'+connections.dir(accountId));}}
  });
  register('terminal:start', startSession);
  register('terminal:buffer',sid=>{const t=terminals.get(sid);if(t)flushTerminal(t,sid,notify);return {data:t?.history.snapshot()||'',seq:t?.seq||0};});
  register('terminal:input', (sid, data) => { if (typeof data !== 'string' || data.length > 1024 * 1024) throw new Error('无效终端输入'); const r = terminals.get(sid); if (!r||r.closed) throw new Error('终端已结束'); r.proc.write(data); });
  register('terminal:resize', (sid, cols, rows) => { if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 1 && cols < 1000 && rows > 1 && rows < 500) try { terminals.get(sid)?.proc.resize(cols,rows); } catch {} });
  register('terminal:stop', async sid => {
    const session = store.state.sessions.find(s => s.id === sid);
    if (!session) throw new Error('会话不存在');
    const result = await dialog.showMessageBox(win, { type:'question', message:'结束此终端？', detail:'正在执行的命令将被中断。会话记录会保留。', buttons:['取消','结束终端'], defaultId:0, cancelId:0 });
    if (result.response !== 1) return false;
    const runtime=terminals.get(sid);if(runtime&&!runtime.closed)runtime.proc.kill(); return true;
  });
  register('terminal:resume',sid=>restoreSession(sid,false));
  register('trash:restore',sid=>restoreSession(sid,true));
  register('trash:delete',async sid=>{
    await expireDeleted();
    if(restoringJobs.has(sid)||deletingSessions.has(sid))throw new Error('会话正在恢复或删除，请稍后重试');
    const entry=findDeleted(store.state,sid);if(!entry)throw new Error('删除记录不存在或已过期');
    deletingSessions.add(sid);
    try{
      const choice=await dialog.showMessageBox(win,{type:'warning',message:'永久删除“'+entry.row.session.title+'”？',detail:'将清除本工具的恢复记录及未被其他会话使用的专用检查点，之后无法从本工具恢复。项目文件和 Claude 原始历史不会删除。',buttons:['取消','永久删除'],defaultId:0,cancelId:0});
      if(choice.response!==1)return {deleted:false};
      const checkpoint=entry.row.session.checkpoint;
      await store.update(s=>forgetDeleted(s,sid));pushState();
      let cleanupWarning='';
      const referenced=[...store.state.sessions,...store.state.deletedWorkspaces.flatMap(g=>g.sessions.map(row=>row.session)),...store.state.operations].some(r=>r.checkpoint===checkpoint);
      if(checkpoint&&!referenced&&path.dirname(path.resolve(checkpoint))===path.join(dataRoot,'checkpoints')&&/^deleted-[a-zA-Z0-9-]+\.jsonl$/.test(path.basename(checkpoint))){
        try{await fs.rm(checkpoint,{force:true});}catch{cleanupWarning='恢复记录已永久删除，但本地检查点缓存未能清理。';}
      }
      return {deleted:true,cleanupWarning};
    }finally{deletingSessions.delete(sid);}
  });
  register('terminal:prepare-switch',async(sid,targetAccountId)=>{
    await pollTelemetry();
    const source=store.state.sessions.find(s=>s.id===sid),target=store.account(targetAccountId);
    if(!source||!['claude','agent'].includes(source.kind))throw new Error('请选择一个 Agent 会话');
    if(source.accountId===targetAccountId)throw new Error('目标账号与当前相同');
    if(!switchableStatus(source))throw new Error('请等待当前回合结束后再切换');
    const names={sourceName:accountLabel(store.account(source.accountId)),targetName:accountLabel(target),sourceRunning:source.kind==='agent'&&source.status!=='exited'};
    const {empty,raw,file}=await switchSource(source);
    if(empty)return {mode:'empty',nativeSupported:false,eventTime:source.eventTime,...names};
    const bundle=await handoffFromRaw(source,raw,!!file&&file===source.checkpoint);
    const native=source.kind==='claude'&&(target.agentToolId||'claude-code')==='claude-code'&&!(target.command==='claude-dp'||!!target.connection)&&!source.handoffFile;
    return {...bundle,eventTime:source.eventTime,mode:native?'resume':'handoff',nativeSupported:native,...names};
  });
  register('terminal:handoff',async sid=>{const r=store.state.sessions.find(s=>s.id===sid);if(!r?.handoffFile||!inside(path.join(dataRoot,'handoffs'),r.handoffFile))throw new Error('没有可查看的交接资料');return fs.readFile(r.handoffFile,'utf8');});
  register('terminal:switch', async (sid, targetAccountId, options={}) => {
    if(restoringJobs.has(sid)||deletingSessions.has(sid)||store.state.sessions.find(s=>s.id===sid)?.pendingRestore)throw new Error('会话正在恢复或删除，请稍后重试');
    await pollTelemetry();
    const source = store.state.sessions.find(s => s.id === sid);
    if(options.expectedEventTime!==undefined&&options.expectedEventTime!==source?.eventTime)throw new Error('原会话已变化，请重新预览后切换');
    store.account(targetAccountId);
    if (!source || !['claude','agent'].includes(source.kind)) throw new Error('请选择一个 Agent 会话');
    if (source.accountId === targetAccountId) throw new Error('目标账号与当前相同');
    if (!switchableStatus(source)) throw new Error('请等待本轮结束；状态未知或运行中时不执行账号切换');
    const {empty,raw,file:transcript}=await switchSource(source);
    const target=store.account(targetAccountId);
    const native=source.kind==='claude'&&(target.agentToolId||'claude-code')==='claude-code';
    const mode=options.mode || (empty?'empty':!native||target.command==='claude-dp'||target.connection||source.handoffFile?'handoff':'resume');
    if(!['empty','resume','handoff'].includes(mode)||((mode==='empty')!==empty))throw new Error('会话内容已变化，请重新预览后切换');
    if(mode==='resume'&&!native)throw new Error('跨 Agent 或非 Claude 会话只能携带交接资料继续');
    if(mode==='resume'&&(target.command==='claude-dp'||target.connection))throw new Error('此自定义供应商请使用上下文交接，不能直接导入当前原生工具历史');
    const confirmed = options.reviewed ? {response:1} : await dialog.showMessageBox(win, { message:'切换此会话的账号？', detail:empty?'当前尚无对话记录，将保留工作目录与项目设置，以目标账号新建空白会话。':mode==='handoff'?'将保留原始会话并创建携带交接资料的新会话，不迁移原生工具运行状态。':'将保存原始会话快照并结束源 CLI，再用目标账号恢复一个分支。原始记录始终保留。', buttons:['取消',empty?'切换账号':'保存检查点并切换'], defaultId:0, cancelId:0 });
    if (confirmed.response !== 1) return null;
    const checkpoint = empty||!raw?undefined:path.join(dataRoot, 'checkpoints', id() + '.jsonl');
    if(checkpoint){await fs.mkdir(path.dirname(checkpoint), { recursive: true, mode:0o700 });
    if(transcript)await fs.copyFile(transcript, checkpoint);else await fs.writeFile(checkpoint,raw);await fs.chmod(checkpoint,0o600);}
    let handoffFile;
    if(mode==='handoff'){
      const bundle=await handoffFromRaw(source,raw,!!transcript&&transcript===source.checkpoint);
      const text=typeof options.handoffText==='string'?options.handoffText:bundle.text;
      if(Buffer.byteLength(text)>600*1024)throw new Error('交接资料超过 600 KiB，请精简后继续');
      handoffFile=path.join(dataRoot,'handoffs',id()+'.md');await fs.mkdir(path.dirname(handoffFile),{recursive:true,mode:0o700});await fs.writeFile(handoffFile,text,{mode:0o600});
    }
    await pollTelemetry();
    const current=store.state.sessions.find(s=>s.id===sid);
    if(!switchableStatus(current)||current.eventTime!==source.eventTime)throw new Error('原会话已开始新的活动，请等待结束后重新预览');
    const runtime = terminals.get(sid);
    if (runtime && !runtime.closed && source.status !== 'exited') {
      runtime.proc.kill();
      const deadline=Date.now()+5000;
      while (store.state.sessions.find(s=>s.id===sid)?.status !== 'exited' && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
      if (store.state.sessions.find(s=>s.id===sid)?.status !== 'exited') throw new Error('源进程尚未退出，检查点已保留，未启动目标进程');
    }
    const operation = { id:id(), source:sid, targetAccountId, time:Date.now(), checkpoint, status:'starting' };
    await store.update(s=>s.operations.push(operation));
    try {
      const result=await startSession({ workspaceId:source.workspaceId, accountId:targetAccountId, kind:'claude', ...(empty?{}:handoffFile?{handoffFile,checkpointFile:checkpoint}:{resumeFile:checkpoint}), resumeCwd:source.cwd, resumeProjects:source.projects, resumeBackend:source.backend });
      const readyDeadline=Date.now()+30000,launchedAt=Date.now();
      let ready=false;
      while(Date.now()<readyDeadline){
        await pollTelemetry();
        const currentTarget=store.state.sessions.find(r=>r.id===result.id);
        if(!currentTarget||['failed','exited'].includes(currentTarget.status))throw new Error('目标 CLI 未能保持运行，原会话条目与检查点已保留');
        // Other agents report no session events, so staying alive for a moment is the only readiness signal.
        if(currentTarget.kind==='agent'?['running','idle','busy'].includes(currentTarget.status)&&Date.now()-launchedAt>=2500:currentTarget.claudeSessionId&&['idle','busy'].includes(currentTarget.status)){ready=true;break;}
        await new Promise(r=>setTimeout(r,250));
      }
      if(!ready)throw new Error('尚未确认目标 CLI 就绪，原会话条目与检查点已保留，请检查目标终端');
      await store.update(s=>{
        Object.assign(s.operations.find(o=>o.id===operation.id),{status:empty?'empty':handoffFile?'handoff':'unverified',target:result.id});
        const target=s.sessions.find(r=>r.id===result.id);if(target)copyTitle(source,target);
        s.sessions=s.sessions.filter(r=>r.id!==sid);
        for(const w of s.workspaces){
          if(w.id===source.workspaceId)w.selectedSession=result.id;
          w.hiddenGroups=(w.hiddenGroups||[]).filter(g=>s.sessions.some(r=>r.workspaceId===w.id&&r.groupId===g));
        }
      });
      terminals.delete(sid);
      for(const name of ['event.json','usage.json','prompt.md','mcp.json'])await fs.rm(path.join(telemetryDir,sid+'-'+name),{force:true}).catch(()=>{});
      pushState();return store.state.sessions.find(r=>r.id===result.id);
    } catch(e) { await store.update(s=>{const op=s.operations.find(o=>o.id===operation.id);if(op)Object.assign(op,{status:'failed',error:e.message});const original=s.sessions.find(r=>r.id===sid);if(original?.status==='exited'){original.status='interrupted';original.error='账号切换未完成，原会话和检查点已保留，可重新恢复。';}}); pushState(); throw e; }
  });
  register('files:list', (wid, dir) => store.list(wid,dir));
  register('files:read', (wid, file) => store.read(wid,file));
  register('files:read-if-changed',(wid,file,previous)=>store.readIfChanged(wid,file,previous));
  register('files:save',async(wid,file,text,version)=>{await draftWrites.flush();return store.save(wid,file,text,version);});
  register('files:close-choice', async name => (await dialog.showMessageBox(win,{type:'question',message:'保存对 '+String(name).slice(0,150)+' 的修改？',detail:'取消可继续编辑；保存遇到冲突时会保留标签。',buttons:['取消','保存并关闭','放弃修改'],defaultId:1,cancelId:0})).response);
  register('files:trash',async(wid,file)=>{
    await draftWrites.flush();const target=await prepareTrash(store,wid,file);
    const choice=await dialog.showMessageBox(win,{type:'warning',message:'将“'+path.basename(target.path)+'”移入系统回收站？',detail:target.path+(target.directory?'\n文件夹及其中的内容将一起移入回收站。':'')+'\n可在系统回收站恢复；这不是会话的“最近删除”。',buttons:['取消','移入回收站'],defaultId:0,cancelId:0});
    if(choice.response!==1)return null;
    await draftWrites.flush();const current=await prepareTrash(store,wid,file);
    if(current.path!==target.path||current.identity!==target.identity)throw new Error('文件在确认期间发生变化，请刷新后重试');
    await shell.trashItem(target.path);return {path:target.path};
  });
  register('files:external', async (wid,file) => { const real=await store.resolveFile(wid,file); const error=await shell.openPath(real); if(error) throw new Error(error); });
  register('draft:save',(file,draft)=>{if(typeof file!=='string'||(draft&&typeof draft.text!=='string'))throw new Error('无效草稿');return draftWrites.enqueue(file,draft);});
  register('git:status',(wid,directory)=>gitView.snapshot(store,wid,directory));
  register('git:decorations',(wid,directory)=>gitView.snapshot(store,wid,directory,false));
  register('git:diff',(wid,directory,file,group)=>gitView.diff(store,wid,directory,file,group));
  register('git:branches',(wid,directory)=>gitView.branches(store,wid,directory));
  register('git:head',(wid,directory)=>gitView.head(store,wid,directory));
  const busyIn=wid=>store.state.sessions.some(s=>s.workspaceId===wid&&s.status==='busy'&&terminals.has(s.id));
  // Every write reports back so the panel, file tree and status bar refresh together.
  const gitWrite=(fn,{guard=''}={})=>async(wid,directory,...rest)=>{
    store.workspace(wid);
    if(guard&&busyIn(wid))throw new Error('有会话正在执行任务，请等它结束后再'+guard);
    try{return await fn(store,wid,directory,...rest);}finally{notify('git:changed',{workspaceId:wid});}
  };
  register('git:switch',gitWrite(gitView.switchBranch,{guard:'切换分支'}));
  register('git:pull',gitWrite(gitView.pull,{guard:'拉取'}));
  register('git:push',gitWrite(gitView.push));
  register('git:stage',gitWrite(gitView.stage));
  register('git:unstage',gitWrite(gitView.unstage));
  register('git:commit',gitWrite(gitView.commit));
  register('mcp:save',async list=>{
    const before=store.state.mcpServers||[],secrets=await mcpSecrets.read().catch(()=>({}));
    const next=integrations.normalizeServers(list,secrets,before);
    await mcpSecrets.write(next.secrets);
    // Imported servers the user removes are remembered, so the next scan does not bring them back.
    const removed=before.filter(b=>b.source!=='manual'&&!next.servers.some(n=>n.name.toLowerCase()===b.name.toLowerCase())).map(b=>b.name);
    await store.update(s=>{s.mcpServers=next.servers;s.mcpDismissed=[...new Set([...(s.mcpDismissed||[]),...removed])];});pushState();
    return store.state.mcpServers;
  });
  register('mcp:scan',()=>scanMcpServers());
  register('mcp:secret-keys',async serverId=>{const secret=(await mcpSecrets.read().catch(()=>({})))[serverId]||{};return {env:Object.keys(secret.env||{}),headers:Object.keys(secret.headers||{})};});
  register('cli:save',async list=>{const tools=integrations.normalizeTools(list);await store.update(s=>{s.cliTools=tools;});pushState();return tools;});
  register('cli:scan',()=>scanCliTools());
  register('settings:save', async input => {
    const prompts=input.systemPrompts!==undefined?systemPrompts.normalizePrompts(input.systemPrompts):undefined;
    const yolo=Array.isArray(input.yoloAgents)?[...new Set(input.yoloAgents.filter(id=>agentTools.some(t=>t.id===id)))]:undefined;
    await store.update(s=> { s.settings = { ...s.settings,...(prompts?{systemPrompts:prompts}:{}),...(yolo?{yoloAgents:yolo}:{}), theme:['light','dark','system'].includes(input.theme)?input.theme:s.settings.theme,navigationCollapsed:typeof input.navigationCollapsed==='boolean'?input.navigationCollapsed:s.settings.navigationCollapsed, opacity:Math.min(100,Math.max(0,Number(input.opacity??s.settings.opacity))), fontSize:Number.isFinite(Number(input.fontSize))?Math.min(32,Math.max(10,Number(input.fontSize))):s.settings.fontSize,fontFamily:['JetBrains Mono','system','Menlo','Monaco','Consolas'].includes(input.fontFamily)?input.fontFamily:s.settings.fontFamily,lineHeight:Number.isFinite(Number(input.lineHeight))?Math.min(2,Math.max(1,Number(input.lineHeight))):s.settings.lineHeight,terminalRenderer:['classic','fullscreen'].includes(input.terminalRenderer)?input.terminalRenderer:s.settings.terminalRenderer, ...(typeof input.claudePath==='string'?{claudePath:input.claudePath}:{}), ...(typeof input.shell==='string'?{shell:input.shell}:{}) }; }); pushState();
  });
  register('settings:background', async remove => {
    let file='';
    if(!remove) { const selected=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'背景图片',extensions:['png','jpg','jpeg','webp']}]}); if(selected.canceled)return; const src=selected.filePaths[0]; if((await fs.stat(src)).size>20*1024*1024)throw new Error('背景图最大支持 20 MiB'); file=path.join(dataRoot,'background'+path.extname(src).toLowerCase()); await fs.copyFile(src,file); }
    await store.update(s=>s.settings.background=file); pushState();
  });
  register('settings:background-data', async () => { const file=store.state.settings.background; if(!file)return ''; try { const ext=path.extname(file); return `data:image/${['.jpg','.jpeg'].includes(ext)?'jpeg':ext.slice(1)};base64,${(await fs.readFile(file)).toString('base64')}`; } catch { return ''; } });
  register('system:info', async (options={}) => {
    const detected=process.platform==='win32'?await windowsCli.detect(store.state.settings.claudePath,{refresh:!!options?.refreshCli}):null;
    return {version:app.getVersion(),tools:agentTools,platform:process.platform,arch:process.arch,claude:detected?detected.path:await executable().catch(()=>''),cliDetection:detected,dataRoot,profiles:await profileDiscovery.discover(),releaseChannel:require('../package.json').releaseChannel||'unsigned'};
  });
  register('setup:cli',async()=>{const pick=await dialog.showOpenDialog(win,{title:'选择 Claude CLI 可执行文件',properties:['openFile','showHiddenFiles']});if(pick.canceled)return null;const file=process.platform==='win32'?path.resolve(pick.filePaths[0]):await fs.realpath(pick.filePaths[0]);if(process.platform==='win32'){if(!/\.exe$/i.test(file))throw new Error('请选择 Claude 程序，不支持选择 .ps1/.cmd/.bat 启动脚本');const found=await windowsCli.detect(file,{refresh:true});if(found.path.toLowerCase()!==file.toLowerCase())throw new Error('所选程序未通过运行检查，请点击重新检测以自动查找');}await fs.access(file,1);if(!(await fs.stat(file)).isFile())throw new Error('请选择可执行文件');await store.update(s=>{s.settings.claudePath=file;});pushState();return file;});
  register('setup:finish',async()=>{await store.update(s=>{s.onboarding={completedAt:Date.now()};});pushState();});
  const scheduleTask=input=>schedules.normalizeTask(input,{workspaceExists:wid=>store.state.workspaces.some(w=>w.id===wid),accountExists:aid=>store.state.accounts.some(a=>a.id===aid)});
  register('schedules:save',async input=>{
    const task=scheduleTask(input);
    await store.update(s=>{s.schedules||=[];const i=s.schedules.findIndex(t=>t.id===input.id);const next=task.enabled?schedules.nextRun(task.rule):null;if(i<0)s.schedules.push({id:id(),createdAt:Date.now(),...task,nextRunAt:next});else s.schedules[i]={...s.schedules[i],...task,nextRunAt:next};});pushState();
    return (store.state.schedules||[]).find(t=>t.id===input.id)||store.state.schedules.at(-1);
  });
  register('schedules:toggle',async(sid,enabled)=>{await store.update(s=>{const t=(s.schedules||[]).find(t=>t.id===sid);if(!t)throw new Error('定时任务不存在');t.enabled=!!enabled;t.nextRunAt=enabled?schedules.nextRun(t.rule):null;});pushState();});
  register('schedules:remove',async sid=>{
    if(scheduleRuns().some(r=>r.scheduleId===sid&&r.status==='running'))throw new Error('任务正在运行，请等它结束后再删除');
    for(const run of scheduleRuns().filter(r=>r.scheduleId===sid&&r.worktree&&!r.worktreeRemoved))await removeRunWorktree(run).catch(()=>{});
    await store.update(s=>{s.schedules=(s.schedules||[]).filter(t=>t.id!==sid);s.scheduleRuns=(s.scheduleRuns||[]).filter(r=>r.scheduleId!==sid);});pushState();
  });
  register('schedules:run-now',sid=>runSchedule(sid,'manual'));
  register('schedules:remove-worktree',async rid=>{const run=scheduleRuns().find(r=>r.id===rid);if(!run?.worktree||run.worktreeRemoved)throw new Error('没有可删除的工作树');if(run.status==='running')throw new Error('任务正在运行');await removeRunWorktree(run);pushState();});
  register('schedules:open-worktree',async rid=>{const run=scheduleRuns().find(r=>r.id===rid);if(!run?.worktree||run.worktreeRemoved||!inside(path.join(dataRoot,'worktrees'),run.worktree))throw new Error('工作树不存在');await shell.openPath(run.worktree);});
  register('agents:list',()=>agentList());
  register('agents:scan',agentId=>scanAgent(agentId));
  register('agents:install',agentId=>installAgent(agentId));
  register('updates:set-proxy',async value=>{const proxy=updates.normalizeProxy(value);await store.update(s=>{s.settings.updateProxy=proxy;});pushState();return proxy;});
  register('updates:state',()=>updater.state());
  register('updates:check',()=>updater.check());
  register('updates:download',()=>updater.download());
  register('updates:cancel',()=>updater.cancel());
  register('updates:install',()=>{if(updater.state().phase!=='ready')throw new Error('更新尚未准备好');pendingUpdate=true;app.quit();});
  register('data:backup',async()=>{await draftWrites.flush();await store.queue;const dir=await backupBeforeUpgrade(dataRoot,'manual-'+Date.now());return dir;});
  register('data:show-backups',async()=>{const dir=path.join(dataRoot,'backups.noindex');await fs.mkdir(dir,{recursive:true,mode:0o700});const error=await shell.openPath(dir);if(error)throw new Error('无法打开备份目录，请通过系统文件管理器访问应用数据目录');});
  register('external:open', url => { const parsed=new URL(url); if(!['https:','http:'].includes(parsed.protocol))throw new Error('不支持的链接'); return shell.openExternal(parsed.href); });
}

async function pollTelemetry(sessionIds) {
  const active=new Set(['running','busy','idle','starting','external']);
  const records=store.state.sessions.filter(r=>(r.kind==='claude'||r.kind==='agent')&&(sessionIds?sessionIds.includes(r.id):active.has(r.status)));
  const pending=(await Promise.all(records.flatMap(record=>['event','usage'].map(async type=>{
    try{const data=JSON.parse(await fs.readFile(path.join(telemetryDir,record.id+'-'+type+'.json'),'utf8'));return data.time>(record[type+'Time']||0)?{id:record.id,type,data}:null;}catch{return null;}
  })))).filter(Boolean);
  if(!pending.length)return;
  await store.update(s=>{
    for(const {id,type,data} of pending){
      const r=s.sessions.find(x=>x.id===id);if(!r||data.time<=(r[type+'Time']||0))continue;
      r[type+'Time']=data.time;if(type==='event'&&data.titleHint)applyTaskTitle(r,data.titleHint);if(r.kind==='claude'&&data.sessionId)r.claudeSessionId=data.sessionId;if(r.kind==='claude'&&data.transcript)r.transcript=data.transcript;
      if(type==='usage'&&data.usage){const a=s.accounts.find(a=>a.id===r.accountId);if(a)a.usage={...data.usage,time:data.time};}
      if(type==='event'&&r.status!=='exited'){
        r.lastEvent=data.event;
        if(data.event==='SessionStart'&&['running','starting','external'].includes(r.status))r.status='idle';
        if(data.event==='UserPromptSubmit'){r.status='busy';r.hasSubmittedPrompt=true;}
        if(['Stop','StopFailure','Interrupt'].includes(data.event)){r.status='idle';r.hasSubmittedPrompt=true;}
        if(data.event==='SessionEnd')r.status='exited';
      }
    }
  });await refreshTitles([...new Set(pending.filter(p=>p.type==='event').map(p=>p.id))]);pushState();
}

async function settleQuietSessions(){
  const quiet=agentStatus.quietSessions(store.state.sessions,terminals);
  if(!quiet.length)return;
  await store.update(s=>{for(const r of s.sessions)if(quiet.includes(r.id)&&r.status==='busy'){r.status='idle';r.lastEvent='Quiet';}});pushState();
}

async function createWindow() {
  win=new BrowserWindow({width:1480,height:980,minWidth:960,minHeight:640,title:'WbSpace',icon:path.join(root,'dist/app-icon-v1.png'),backgroundColor:'#f4f4f7',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',autoHideMenuBar:process.platform==='win32',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(({url})=> { if(/^https?:/.test(url))shell.openExternal(url); return {action:'deny'}; });
  win.webContents.on('will-navigate',(event,url)=> { const expected=process.env.ACCOUNTOR_DEV_URL; if(expected?new URL(url).origin!==new URL(expected).origin:new URL(url).href.split(/[?#]/)[0]!==pathToFileURL(path.join(root,'dist/index.html')).href)event.preventDefault(); });
  win.on('close',e=> {if(!quitting){e.preventDefault();if(process.platform==='win32')app.quit();else win.hide();}});
  if(process.env.ACCOUNTOR_DEV_URL)await win.loadURL(process.env.ACCOUNTOR_DEV_URL); else await win.loadFile(path.join(root,'dist/index.html'));
  if(process.env.ACCOUNTOR_SCREENSHOT) setTimeout(()=>win.capturePage().then(im=>fs.writeFile(process.env.ACCOUNTOR_SCREENSHOT,im.toPNG())),1200);
}

if(process.platform==='win32')app.setAppUserModelId('local.claude-accountor.desktop');
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance)app.exit(0);
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});

app.whenReady().then(async()=> {
  try {
    if(process.platform==='darwin'&&app.isPackaged&&!process.env.ACCOUNTOR_DATA_DIR)for(const legacy of ['/Applications/Claude Accountor.app','/Applications/终端工作站.app']){
      if(!existsSync(legacy))continue;const old=await inspectLegacy(legacy);
      if(old.mainRunning){dialog.showErrorBox('请先退出旧应用',path.basename(legacy,'.app')+' 仍在运行。请先按 ⌘Q 退出旧应用，再打开 WbSpace，现有数据会自动保留。');quitting=true;app.quit();return;}
      await retireLegacy(legacy,path.join(dataRoot,'legacy-builds.noindex',path.basename(legacy,'.app')+'-before-'+Date.now()+'.app')).catch(()=>{});
    }
    await backupBeforeUpgrade(dataRoot,app.getVersion());
    await store.load();
    await store.update(s=>{if(!s.onboarding&&(s.accounts.length||s.workspaces.some(w=>!w.builtIn)))s.onboarding={completedAt:Date.now(),migrated:true};});
    await ensureDefaultWorkspace().catch(error=>console.error('default workspace unavailable',error.message));
    await store.update(s=>{for(const a of s.accounts)if(a.source==='existing'&&!a.configDirectory){try{a.configDirectory=profileDiscovery.existingDirectory(a);}catch{}}s.installVersion=app.getVersion();});
    await store.update(s=>{
      // A crash before the replacement transaction must leave one recoverable source.
      const abandoned=new Set(s.sessions.filter(r=>r.pendingRestore&&r.backend==='embedded'&&(s.sessions.some(old=>old.id===r.pendingRestore)||findDeleted(s,r.pendingRestore))).map(r=>r.id));
      s.sessions=s.sessions.filter(r=>!abandoned.has(r.id));
      for(const r of s.sessions)delete r.pendingRestore;
      deduplicateRecovered(s);
      const completed=new Set(s.operations.filter(o=>{
        const from=s.sessions.find(r=>r.id===o.source),to=s.sessions.find(r=>r.id===o.target);
        return ['empty','handoff','unverified'].includes(o.status)&&from?.status==='exited'&&to?.claudeSessionId&&to.status!=='failed';
      }).map(o=>o.source));
      s.sessions=s.sessions.filter(r=>!completed.has(r.id));
      for(const w of s.workspaces){
        if(completed.has(w.selectedSession))w.selectedSession=[...s.sessions].reverse().find(r=>r.workspaceId===w.id)?.id||'';
        w.hiddenGroups=(w.hiddenGroups||[]).filter(g=>s.sessions.some(r=>r.workspaceId===w.id&&r.groupId===g));
      }
    });
    await store.update(s=>{ for(const r of s.sessions)if(['running','idle','busy','starting','external'].includes(r.status)){r.status='interrupted';} });
    await refreshTitles();
    registerHandlers();
    setInterval(()=>{void expireDeleted().catch(()=>{});},60000).unref();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'WbSpace',submenu:[{role:'about'},{type:'separator'},{label:'退出 WbSpace',accelerator:'CmdOrCtrl+Q',click:()=>app.quit()}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{label:'复制',accelerator:process.platform==='win32'?'Ctrl+Shift+C':'CmdOrCtrl+C',click:()=>notify('clipboard:copy-request')},{role:'paste'},{role:'selectAll'}]},{role:'viewMenu'},{role:'windowMenu'}]));
    // Stale runs are settled before the window shows them.
    await startSchedules();
    // Pick up MCP servers and command-line tools already configured on this machine.
    // Test runs (ACCOUNTOR_DATA_DIR) must not pick up the developer's own configuration.
    if(!process.env.ACCOUNTOR_DATA_DIR||process.env.ACCOUNTOR_AUTO_SCAN==='1'){void scanMcpServers().catch(()=>{});void scanCliTools().catch(()=>{});}
    await createWindow();
    for(const a of store.state.accounts)if(['codex-cli','opencode'].includes(a.agentToolId)&&!a.connection&&a.status==='valid')void checkAccount(a.id).catch(()=>{});
    const lastUpdate=await updateInstall.consumeResult(updateDir);
    if(lastUpdate?.ok===false)void dialog.showMessageBox(win,{type:'warning',message:'上次更新没有完成',detail:'当前仍是旧版本，数据未受影响。'+(lastUpdate.reason==='permission'?'应用没有权限替换自身，请到系统设置允许，或从下载页手动安装。':'可在设置中重试，或从下载页手动安装。')});
    let polling=false;
    setInterval(async()=>{if(polling)return;polling=true;try{await pollTelemetry();await settleQuietSessions();}finally{polling=false;}},2000).unref();
  }catch(e){dialog.showErrorBox('启动失败',e.message);quitting=true;app.quit();}
});
app.on('activate',()=> { if(win)win.show(); });
let checkingQuit=false;
app.on('before-quit',async e=> {
  if(quitting)return;
  e.preventDefault();
  if(checkingQuit)return;checkingQuit=true;
  try{await new Promise(resolve=>setImmediate(resolve));await draftWrites.flush();await store.queue;}catch(error){checkingQuit=false;dialog.showErrorBox('草稿未保存',error.message);return;}
  const active=store.state.sessions.some(s=>terminals.has(s.id)&&['running','busy','idle','starting'].includes(s.status));
  const drafts=Object.values(store.state.drafts).some(d=>d.text!==d.baseText);
  if(active||drafts){ const choice=dialog.showMessageBoxSync(win,{type:'question',message:pendingUpdate?'重启并更新 WbSpace？':'退出 WbSpace？',detail:(active?'内置终端将被结束，更新后可在会话列表恢复。\n':'')+(drafts?'未保存内容将保留为本地恢复草稿，不会写入原文件。':''),buttons:['取消',pendingUpdate?'更新并重启':'退出并保留草稿'],defaultId:0,cancelId:0}); if(choice!==1){checkingQuit=false;pendingUpdate=false;return;} }
  try{await draftWrites.flush();}catch(error){checkingQuit=false;dialog.showErrorBox('草稿未保存',error.message);return;}
  if(pendingUpdate){try{await updateInstall.launchHelper({platform:process.platform,target:updateTarget().target,artifact:updater.artifact(),dir:updateDir,version:updater.state().latest});}catch(error){checkingQuit=false;pendingUpdate=false;dialog.showErrorBox('无法启动更新',error.message);return;}}
  quitting=true;
  // Wait for the terminals to exit before quitting: tearing down a live ConPTY while the app exits crashes it on
  // Windows (0xC0000409, 0xC0000005). node-pty reports the exit before its ConPTY threads finish, hence the extra pause.
  const started=Date.now(),live=[...terminals.entries()].filter(([,t])=>!t.closed),exits={};
  const allExited=Promise.all(live.map(([sid,t])=>new Promise(resolve=>{try{t.proc.onExit(()=>{exits[sid]=Date.now()-started;resolve();});t.proc.kill();}catch(error){exits[sid]='kill failed: '+error.message;resolve();}})));
  const finished=await Promise.race([allExited.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),5000))]);
  if(process.platform==='win32'&&live.length)await new Promise(resolve=>setTimeout(resolve,500));
  if(process.env.ACCOUNTOR_QUIT_DIAGNOSTICS)try{await fs.writeFile(process.env.ACCOUNTOR_QUIT_DIAGNOSTICS,JSON.stringify({terminals:live.length,finished,exits,waitedMs:Date.now()-started}));}catch{}
  app.quit();
});
