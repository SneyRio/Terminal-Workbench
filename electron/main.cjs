const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, safeStorage } = require('electron');
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
const {tools:agentTools,plannedTools,requireTool}=require('./agent-tools.cjs');
const {inspectLegacy,retireLegacy}=require('./app-migration.cjs');
const {taskText,defaultTitle,migrateTitle,applyTaskTitle,copyTitle,transcriptTitle}=require('./session-titles.cjs');
const {pruneDeleted,findDeleted,forgetDeleted,archiveSession,replaceSession,deduplicateRecovered}=require('./session-history.cjs');
const restoringJobs=new Map(),deletingSessions=new Set();
const {configuredStatusLine}=require('./statusline.cjs');
const {DraftBatch,TerminalHistory,appendTerminal,flushTerminal}=require('./performance.cjs');
const { Store, atomicJson, id, inside, cleanEnv, buildHandoff } = require('./core.cjs');
const exec = promisify(execFile);
const profileDiscovery=require('./profile-discovery.cjs');
const {backupBeforeUpgrade}=require('./release-support.cjs');
const updates=require('./updates.cjs');
const platformTools=require('./platform.cjs');
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
const terminals = new Map();
let win, quitting = false;
const notify = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const pushState = () => notify('state:changed', store.state);
const draftWrites=new DraftBatch(store,pushState);
const accountDir = accountId => { const a=store.state.accounts.find(a=>a.id===accountId);return a?.source==='existing' ? profileDiscovery.existingDirectory(a) : path.join(dataRoot,'accounts',accountId); };
const accountExecutable = async account => account.source==='existing'&&account.command ? (path.isAbsolute(account.command)?account.command:path.join(os.homedir(),'.local/bin',account.command)) : executable();
const telemetryDir = path.join(dataRoot, 'telemetry');
const argvString = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
function cliEnv(configDirectory) {
  const env=cleanEnv(process.env,configDirectory);
  // Finder launches do not inherit the interactive shell's CLI search path.
  const expanded=platformTools.searchPath(process.env);for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env[process.platform==='win32'?'Path':'PATH']=expanded;
  return env;
}

async function executable() {
  const configured = store.state.settings.claudePath;
  if(configured){if(process.platform==='win32'&&!/\.exe$/i.test(configured))throw new Error('Windows 请选择原生 claude.exe；不直接执行 .cmd/.bat 启动脚本');try{await fs.access(configured,1);return configured;}catch{throw new Error('配置的 Claude CLI 路径不可执行，请在设置中修正');}}
  const options = platformTools.executableCandidates(configured);
  for (const option of options) { try { await fs.access(option, 1); return option; } catch {} }
  throw new Error('未找到 Claude CLI，请在设置中指定已安装的可执行文件');
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
    if(account.connection){await connections.env(account);await accountExecutable(account);await store.update(s=>Object.assign(s.accounts.find(a=>a.id===accountId),{status:'valid',authMethod:'custom-config',checkedAt:Date.now(),error:''}));pushState();return store.account(accountId);}
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

async function sourceHandoff(source,file){
  const context={accountName:store.account(source.accountId).name,cwd:source.cwd,projects:source.projects||store.workspace(source.workspaceId).projects};
  const bundle=buildHandoff(await fs.readFile(file,'utf8'),context);
  if(source.handoffFile&&inside(path.join(dataRoot,'handoffs'),source.handoffFile)){
    const inherited=await fs.readFile(source.handoffFile,'utf8');
    return {text:inherited+(file===source.checkpoint?'':'\n\n# 交接后的新增会话\n\n'+bundle.text),truncated:bundle.truncated};
  }
  return bundle;
}

async function sourceIsEmpty(source){
  if(source.lastEvent!=='SessionStart'||source.hasSubmittedPrompt||source.checkpoint||source.handoffFile)return false;
  let file;
  try{file=await sourceTranscript(source);}catch(e){if(e.message.startsWith('尚无可恢复的会话记录'))return true;throw e;}
  const lines=(await fs.readFile(file,'utf8')).split('\n').filter(Boolean);
  return lines.every(line=>{try{const row=JSON.parse(line);return !['user','assistant','summary'].includes(row.type)&&!row.isCompactSummary;}catch{return false;}});
}

async function startSession(input) {
  const kind = ['claude', 'shell', 'login'].includes(input.kind) ? input.kind : 'claude';
  const workspace = kind === 'login' ? null : store.workspace(input.workspaceId);
  const backend = 'embedded';
  const projects=kind==='login'?[]:(input.resumeProjects || workspace.projects);
  const acct = kind === 'shell' ? null : store.account(input.accountId || workspace?.accountId);
  if(acct)requireTool(acct.agentToolId);
  if(kind==='claude'){await statusAccount(acct.id);if(store.account(acct.id).status==='login')throw new Error('该账号需要重新登录，请在账号中心通过系统默认浏览器授权');}
  if(workspace&&!projects.length)throw new Error('请先在工作空间设置中添加本地项目');
  const cwd = workspace ? await fs.realpath(input.resumeCwd || projects[0]?.path || '') : accountDir(acct.id);
  if (!cwd || !(await fs.stat(cwd)).isDirectory()) throw new Error('主项目根目录不可用');
  const sessionId = id();
  const metadataPath = path.join(telemetryDir, sessionId + '-event.json');
  const env = {...cliEnv(acct ? accountDir(acct.id) : null),...(acct?await connections.env(acct):{})};
  // Login must use the user's macOS default browser, never an embedded webview or a named browser.
  Object.assign(env,platformTools.browserSettings());
  let file = store.state.settings.shell || platformTools.defaultShell(), args = platformTools.shellArgs(file);
  if (acct) {
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
      const originalStatusLine=await configuredStatusLine(accountDir(acct.id));
      const telemetry=platformTools.hookSettings(process.execPath,telemetryScript,originalStatusLine);
      for(const event of ['SessionStart','UserPromptSubmit','Stop','SessionEnd'])settings.hooks[event]=[{hooks:[telemetry.event]}];
      settings.statusLine=telemetry.statusLine;
      args = ['--no-chrome','--settings', JSON.stringify(settings)];
      if(acct.connection)args.push('--model',acct.connection.defaultModel);
      const extra = [];
      for (const project of projects.slice(1)) {
        try { extra.push(await fs.realpath(project.path)); } catch { throw new Error('附加项目不可访问：' + project.path); }
      }
      if(input.handoffFile)args.push('--append-system-prompt-file',input.handoffFile);
      else if (input.resumeFile) args.push('--resume', input.resumeFile, '--fork-session');
      else if (input.resumeId) args.push('--resume', input.resumeId);
      if (extra.length) args.push('--add-dir', ...extra);
    }
  }
  if(process.platform==='win32'&&acct&&!/\.exe$/i.test(file))throw new Error('Windows 请选择原生 Claude CLI 可执行文件 claude.exe');
  if(!path.isAbsolute(file))throw new Error('请设置终端可执行文件的绝对路径');
  try{await fs.access(file,1);}catch{throw new Error('终端可执行文件不存在或无执行权限：'+file);}
  const record = { id: sessionId, workspaceId: workspace?.id || '', accountId: acct?.id || '', kind, backend, cwd, projects, pendingRestore:input.restoreSourceId,checkpoint:input.resumeFile||input.checkpointFile, handoffFile:input.handoffFile||input.inheritedHandoffFile, title: kind === 'login' ? '登录 · ' + acct.name : kind === 'shell' ? 'Shell' : 'Claude · ' + acct.name, createdAt: Date.now(), status: 'starting', groupId: input.groupId || sessionId, orientation: input.orientation || 'horizontal', authVerified:acct?store.account(acct.id).status==='valid':false, recovery:input.handoffFile?'handoff':input.resumeId || input.resumeFile ? 'requested' : undefined };
  record.titleSource='default';record.titleToken=sessionId.replaceAll('-','').slice(-6).toUpperCase();record.title=defaultTitle(record);
  await store.update(s => { s.sessions.push(record); }); pushState();
  {
    try {
      const proc = pty.spawn(file, args, { name: 'xterm-256color', cols: 100, rows: 32, cwd, env });
      const runtime = { proc,history:new TerminalHistory(),pending:[],pendingSize:0,outputTimer:null,seq:0,timer:null };
      terminals.set(sessionId, runtime);
      if(kind==='login')runtime.timer=setInterval(()=>{void statusAccount(acct.id).catch(()=>{});},3000);
      proc.onData(data=>appendTerminal(runtime,sessionId,data,notify));
      proc.onExit(async ({ exitCode }) => {
        flushTerminal(runtime,sessionId,notify);runtime.closed=true;runtime.closedAt=Date.now();runtime.history.shrink(128*1024);
        const closed=[...terminals.entries()].filter(([,t])=>t.closed).sort((a,b)=>a[1].closedAt-b[1].closedAt);for(const [oldId] of closed.slice(0,-8))terminals.delete(oldId);
        if(acct)await pollTelemetry([sessionId]).catch(()=>{});
        clearInterval(runtime.timer);
        await store.update(s => { const r = s.sessions.find(s => s.id === sessionId); if (r) { r.status = 'exited'; r.exitCode = exitCode; } });
        notify('terminal:exit', { id: sessionId, exitCode }); pushState();
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
      copyTitle(source,target);target.groupId=source.groupId||target.groupId;target.orientation=source.orientation;target.createdAt=source.createdAt;target.restoredAt=Date.now();delete target.pendingRestore;
      replaceSession(s,sid,target);if(fromTrash)forgetDeleted(s,sid);
      const w=s.workspaces.find(w=>w.id===source.workspaceId);if(w){s.selectedWorkspace=w.id;w.selectedSession=target.id;w.collapsed=false;w.hiddenGroups=(w.hiddenGroups||[]).filter(g=>g!==target.groupId);}
    });
    terminals.delete(sid);
    for(const type of ['event','usage'])await fs.rm(path.join(telemetryDir,sid+'-'+type+'.json'),{force:true}).catch(()=>{});
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
    const w = { id: input.id || id(), name: input.name.trim().slice(0,100), group:String(input.group||'').trim().slice(0,80),pinned:!!input.pinned,lastUsedAt:input.lastUsedAt||Date.now(),projects, backend: 'embedded', accountId: input.accountId || '', rightOpen: input.rightOpen ?? false, rightWidth: Math.max(280, Math.min(800, input.rightWidth || 360)) };
    await store.update(s => { const i = s.workspaces.findIndex(x => x.id === w.id); if (i < 0) {w.createdAt=Date.now();w.createdOrder=nextWorkspaceOrder(s);s.workspaces.push(w);} else s.workspaces[i] = { ...s.workspaces[i], ...w, createdAt:s.workspaces[i].createdAt,createdOrder:s.workspaces[i].createdOrder }; s.selectedWorkspace = w.id; }); pushState(); return store.workspace(w.id);
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
    if (store.state.sessions.some(s => s.workspaceId === wid && terminals.get(s.id) && ['running','busy','idle','starting'].includes(s.status))) throw new Error('请先结束该工作空间的运行中终端');
    await store.update(s => { s.workspaces = s.workspaces.filter(w => w.id !== wid); if (s.selectedWorkspace === wid) s.selectedWorkspace = s.workspaces[0]?.id || ''; }); pushState();
  });
  register('account:add', async input => {
    const spec=typeof input==='string'?{name:input}:input;
    if (!spec||typeof spec.name!=='string'||!spec.name.trim()) throw new Error('请输入账号别名');
    const custom=spec.provider==='custom';
    if(spec.provider&&!['subscription','custom'].includes(spec.provider))throw new Error('不支持的账号类型');
    const account = {agentToolId:'claude-code',id:id(),name:spec.name.trim().slice(0,80),source:'managed',provider:custom?'custom':'subscription',status:custom?'unknown':'login',email:'',createdAt:Date.now(),usage:null};
    if(custom){account.connection=connection(spec);account.keyVersion=id();}
    try{await connections.provision(account,await executable());if(custom)await connections.writeKey(account.id,spec.apiKey,account.keyVersion);await store.update(s=>s.accounts.push(account));}
    catch(e){await connections.cleanup(account).catch(()=>{});throw e;}
    pushState();return account;
  });
  register('account:configure',async(accountId,input)=>{
    const account=store.account(accountId);if(!account.connection)throw new Error('现有脚本引用由原配置管理，请新建自定义连接');
    const config=connection(input);
    if(configuringAccounts.has(accountId))throw new Error('连接配置正在保存，请稍后重试');
    configuringAccounts.add(accountId);
    try{
    // Versioned encrypted files let in-flight launches keep their original config/key pair.
    const keyVersion=input.apiKey?id():account.keyVersion;
    try{if(input.apiKey)await connections.writeKey(accountId,input.apiKey,keyVersion);await store.update(s=>{const a=s.accounts.find(a=>a.id===accountId);if(!a)throw new Error('连接已被移除');Object.assign(a,{connection:config,keyVersion,status:'unknown',checkedAt:undefined,error:'',usage:null});});}
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
    for(const type of ['event','usage'])await fs.rm(path.join(telemetryDir,sid+'-'+type+'.json'),{force:true}).catch(()=>{});
    pushState();return true;
    }finally{deletingSessions.delete(sid);}
  });
  register('account:remove', async accountId => {
    store.account(accountId);
    if (store.state.sessions.some(s => s.accountId === accountId && ['running','starting','busy','idle','external'].includes(s.status))) throw new Error('请先结束或解绑该账号的活动会话');
    await store.update(s => { s.accounts = s.accounts.filter(a => a.id !== accountId); for (const w of s.workspaces) if (w.accountId === accountId) w.accountId = ''; }); pushState();
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
    if(!source||source.kind!=='claude'||!['idle','exited'].includes(source.status))throw new Error('请等待当前 Claude 回合结束后再切换');
    if(await sourceIsEmpty(source))return {mode:'empty',nativeSupported:false,eventTime:source.eventTime,sourceName:store.account(source.accountId).name,targetName:target.name};
    const file=await sourceTranscript(source),bundle=await sourceHandoff(source,file);
    const handoff=(target.command==='claude-dp'||!!target.connection)||!!source.handoffFile;
    return {...bundle,eventTime:source.eventTime,mode:handoff?'handoff':'resume',nativeSupported:!handoff,sourceName:store.account(source.accountId).name,targetName:target.name};
  });
  register('terminal:handoff',async sid=>{const r=store.state.sessions.find(s=>s.id===sid);if(!r?.handoffFile||!inside(path.join(dataRoot,'handoffs'),r.handoffFile))throw new Error('没有可查看的交接资料');return fs.readFile(r.handoffFile,'utf8');});
  register('terminal:switch', async (sid, targetAccountId, options={}) => {
    if(restoringJobs.has(sid)||deletingSessions.has(sid)||store.state.sessions.find(s=>s.id===sid)?.pendingRestore)throw new Error('会话正在恢复或删除，请稍后重试');
    await pollTelemetry();
    const source = store.state.sessions.find(s => s.id === sid);
    if(options.expectedEventTime!==undefined&&options.expectedEventTime!==source?.eventTime)throw new Error('原会话已变化，请重新预览后切换');
    store.account(targetAccountId);
    if (!source || source.kind !== 'claude') throw new Error('请选择 Claude 会话');
    if (source.accountId === targetAccountId) throw new Error('目标账号与当前相同');
    if (!['idle','exited'].includes(source.status)) throw new Error('请等待本轮结束；状态未知或运行中时不执行账号切换');
    const empty=await sourceIsEmpty(source);
    const transcript = empty?null:await sourceTranscript(source);
    const target=store.account(targetAccountId);
    const mode=options.mode || (empty?'empty':target.command==='claude-dp'||target.connection||source.handoffFile?'handoff':'resume');
    if(!['empty','resume','handoff'].includes(mode)||((mode==='empty')!==empty))throw new Error('会话内容已变化，请重新预览后切换');
    if(mode==='resume'&&(target.command==='claude-dp'||target.connection))throw new Error('此自定义供应商请使用上下文交接，不能直接导入当前原生工具历史');
    const confirmed = options.reviewed ? {response:1} : await dialog.showMessageBox(win, { message:'切换此会话的账号？', detail:empty?'当前尚无对话记录，将保留工作目录与项目设置，以目标账号新建空白会话。':mode==='handoff'?'将保留原始会话并创建携带交接资料的新会话，不迁移原生工具运行状态。':'将保存原始会话快照并结束源 CLI，再用目标账号恢复一个分支。原始记录始终保留。', buttons:['取消',empty?'切换账号':'保存检查点并切换'], defaultId:0, cancelId:0 });
    if (confirmed.response !== 1) return null;
    const checkpoint = empty?undefined:path.join(dataRoot, 'checkpoints', id() + '.jsonl');
    if(checkpoint){await fs.mkdir(path.dirname(checkpoint), { recursive: true, mode:0o700 });
    await fs.copyFile(transcript, checkpoint); await fs.chmod(checkpoint,0o600);}
    let handoffFile;
    if(mode==='handoff'){
      const bundle=await sourceHandoff(source,transcript);
      const text=typeof options.handoffText==='string'?options.handoffText:bundle.text;
      if(Buffer.byteLength(text)>600*1024)throw new Error('交接资料超过 600 KiB，请精简后继续');
      handoffFile=path.join(dataRoot,'handoffs',id()+'.md');await fs.mkdir(path.dirname(handoffFile),{recursive:true,mode:0o700});await fs.writeFile(handoffFile,text,{mode:0o600});
    }
    await pollTelemetry();
    const current=store.state.sessions.find(s=>s.id===sid);
    if(!['idle','exited'].includes(current.status)||current.eventTime!==source.eventTime)throw new Error('原会话已开始新的活动，请等待结束后重新预览');
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
      const readyDeadline=Date.now()+30000;
      let ready=false;
      while(Date.now()<readyDeadline){
        await pollTelemetry();
        const currentTarget=store.state.sessions.find(r=>r.id===result.id);
        if(!currentTarget||['failed','exited'].includes(currentTarget.status))throw new Error('目标 CLI 未能保持运行，原会话条目与检查点已保留');
        if(currentTarget.claudeSessionId&&['idle','busy'].includes(currentTarget.status)){ready=true;break;}
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
      for(const type of ['event','usage'])await fs.rm(path.join(telemetryDir,sid+'-'+type+'.json'),{force:true}).catch(()=>{});
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
  register('settings:save', async input => {
    await store.update(s=> { s.settings = { ...s.settings, theme:['light','dark','system'].includes(input.theme)?input.theme:s.settings.theme,navigationCollapsed:typeof input.navigationCollapsed==='boolean'?input.navigationCollapsed:s.settings.navigationCollapsed, opacity:Math.min(100,Math.max(0,Number(input.opacity??s.settings.opacity))), fontSize:Number.isFinite(Number(input.fontSize))?Math.min(32,Math.max(10,Number(input.fontSize))):s.settings.fontSize,fontFamily:['JetBrains Mono','system','Menlo','Monaco','Consolas'].includes(input.fontFamily)?input.fontFamily:s.settings.fontFamily,lineHeight:Number.isFinite(Number(input.lineHeight))?Math.min(2,Math.max(1,Number(input.lineHeight))):s.settings.lineHeight,terminalRenderer:['classic','fullscreen'].includes(input.terminalRenderer)?input.terminalRenderer:s.settings.terminalRenderer, ...(typeof input.claudePath==='string'?{claudePath:input.claudePath}:{}), ...(typeof input.shell==='string'?{shell:input.shell}:{}) }; }); pushState();
  });
  register('settings:background', async remove => {
    let file='';
    if(!remove) { const selected=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'背景图片',extensions:['png','jpg','jpeg','webp']}]}); if(selected.canceled)return; const src=selected.filePaths[0]; if((await fs.stat(src)).size>20*1024*1024)throw new Error('背景图最大支持 20 MiB'); file=path.join(dataRoot,'background'+path.extname(src).toLowerCase()); await fs.copyFile(src,file); }
    await store.update(s=>s.settings.background=file); pushState();
  });
  register('settings:background-data', async () => { const file=store.state.settings.background; if(!file)return ''; try { const ext=path.extname(file); return `data:image/${['.jpg','.jpeg'].includes(ext)?'jpeg':ext.slice(1)};base64,${(await fs.readFile(file)).toString('base64')}`; } catch { return ''; } });
  register('system:info', async () => ({version:app.getVersion(),tools:agentTools,plannedTools,platform:process.platform,arch:process.arch,claude:await executable().catch(()=>''),dataRoot,profiles:await profileDiscovery.discover(),releaseChannel:require('../package.json').releaseChannel||'unsigned-beta'}));
  register('setup:cli',async()=>{const pick=await dialog.showOpenDialog(win,{title:'选择 Claude CLI 可执行文件',properties:['openFile','showHiddenFiles']});if(pick.canceled)return null;const file=await fs.realpath(pick.filePaths[0]);if(process.platform==='win32'&&!/\.exe$/i.test(file))throw new Error('请选择原生 claude.exe，不支持直接选择 .cmd/.bat');await fs.access(file,1);if(!(await fs.stat(file)).isFile())throw new Error('请选择可执行文件');await store.update(s=>{s.settings.claudePath=file;});pushState();return file;});
  register('setup:finish',async()=>{await store.update(s=>{s.onboarding={completedAt:Date.now()};});pushState();});
  register('updates:check',()=>updates.check(app.getVersion()));
  register('data:backup',async()=>{await draftWrites.flush();await store.queue;const dir=await backupBeforeUpgrade(dataRoot,'manual-'+Date.now());return dir;});
  register('data:show-backups',async()=>{const dir=path.join(dataRoot,'backups.noindex');await fs.mkdir(dir,{recursive:true,mode:0o700});const error=await shell.openPath(dir);if(error)throw new Error('无法打开备份目录，请通过系统文件管理器访问应用数据目录');});
  register('external:open', url => { const parsed=new URL(url); if(!['https:','http:'].includes(parsed.protocol))throw new Error('不支持的链接'); return shell.openExternal(parsed.href); });
}

async function pollTelemetry(sessionIds) {
  const active=new Set(['running','busy','idle','starting','external']);
  const records=store.state.sessions.filter(r=>r.kind==='claude'&&(sessionIds?sessionIds.includes(r.id):active.has(r.status)));
  const pending=(await Promise.all(records.flatMap(record=>['event','usage'].map(async type=>{
    try{const data=JSON.parse(await fs.readFile(path.join(telemetryDir,record.id+'-'+type+'.json'),'utf8'));return data.time>(record[type+'Time']||0)?{id:record.id,type,data}:null;}catch{return null;}
  })))).filter(Boolean);
  if(!pending.length)return;
  await store.update(s=>{
    for(const {id,type,data} of pending){
      const r=s.sessions.find(x=>x.id===id);if(!r||data.time<=(r[type+'Time']||0))continue;
      r[type+'Time']=data.time;if(type==='event'&&data.titleHint)applyTaskTitle(r,data.titleHint);if(data.sessionId)r.claudeSessionId=data.sessionId;if(data.transcript)r.transcript=data.transcript;
      if(type==='usage'&&data.usage){const a=s.accounts.find(a=>a.id===r.accountId);if(a)a.usage={...data.usage,time:data.time};}
      if(type==='event'&&r.status!=='exited'){
        r.lastEvent=data.event;
        if(data.event==='SessionStart'&&['running','starting','external'].includes(r.status))r.status='idle';
        if(data.event==='UserPromptSubmit'){r.status='busy';r.hasSubmittedPrompt=true;}
        if(data.event==='Stop'){r.status='idle';r.hasSubmittedPrompt=true;}
        if(data.event==='SessionEnd')r.status='exited';
      }
    }
  });await refreshTitles([...new Set(pending.filter(p=>p.type==='event').map(p=>p.id))]);pushState();
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
    await store.update(s=>{for(const a of s.accounts)if(a.source==='existing'&&!a.configDirectory){try{a.configDirectory=profileDiscovery.existingDirectory(a);}catch{}}s.installVersion=app.getVersion();if(!s.onboarding&&(s.accounts.length||s.workspaces.length))s.onboarding={completedAt:Date.now(),migrated:true};});
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
    await createWindow();
    let polling=false;
    setInterval(async()=>{if(polling)return;polling=true;try{await pollTelemetry();}finally{polling=false;}},2000).unref();
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
  if(active||drafts){ const choice=dialog.showMessageBoxSync(win,{type:'question',message:'退出 WbSpace？',detail:(active?'内置终端将被结束。\n':'')+(drafts?'未保存内容将保留为本地恢复草稿，不会写入原文件。':''),buttons:['取消','退出并保留草稿'],defaultId:0,cancelId:0}); if(choice!==1){checkingQuit=false;return;} }
  try{await draftWrites.flush();}catch(error){checkingQuit=false;dialog.showErrorBox('草稿未保存',error.message);return;}
  quitting=true;
  for(const t of terminals.values())if(!t.closed)try{t.proc.kill();}catch{}
  app.quit();
});
