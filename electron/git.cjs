const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {inside}=require('./core.cjs');
const exec=promisify(execFile);
async function git(directory,args,timeout=10000){
  const {stdout}=await exec('git',['--no-optional-locks','--literal-pathspecs','-c','core.fsmonitor=false','-c','core.quotepath=false','-C',directory,...args],{windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},timeout,maxBuffer:4*1024*1024});return stdout;
}
function parseStatus(raw){
  const parts=raw.split('\0'),entries=[];
  for(let i=0;i<parts.length;i++){
    const row=parts[i];if(row.length<4)continue;
    const index=row[0],worktree=row[1],name=row.slice(3);
    const original=/[RC]/.test(index+worktree)?parts[++i]:undefined;
    const conflict=index==='U'||worktree==='U'||['AA','DD'].includes(index+worktree);
    entries.push({path:name,originalPath:original,index,worktree,status:conflict?'conflict':index+worktree==='??'?'untracked':/[ADRC]/.test(index)?index:worktree.trim()||index});
  }
  return entries;
}
function parseNumstat(raw){
  const parts=raw.split('\0'),result=Object.create(null);
  for(let i=0;i<parts.length;i++){
    const row=parts[i];if(!row)continue;const first=row.indexOf('\t'),second=row.indexOf('\t',first+1);if(first<0||second<0)continue;
    const added=row.slice(0,first),deleted=row.slice(first+1,second);let name=row.slice(second+1);
    if(!name){i++;name=parts[++i];}
    if(name)result[name]={added:added==='-'?null:Number(added),deleted:deleted==='-'?null:Number(deleted)};
  }
  return result;
}
async function context(store,wid,directory){
  const real=await store.resolveFile(wid,directory);if(!(await fs.stat(real)).isDirectory())throw new Error('Git 项目必须为文件夹');
  let root;try{root=(await git(real,['rev-parse','--show-toplevel'])).trim();}catch{throw new Error('此项目不是 Git 仓库，或 Git 不可用');}
  root=await fs.realpath(root);if(!inside(root,real))throw new Error('无法确认 Git 项目范围');
  return {real,root,scope:path.relative(root,real)||'.'};
}
async function snapshot(store,wid,directory,withStats=true){
  const ctx=await context(store,wid,directory),{real,root,scope}=ctx;
  const jobs=[git(root,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>git(root,['rev-parse','--short','HEAD']).catch(()=>'(未提交)')),git(root,['status','--porcelain=v1','-z','--untracked-files=all','--',scope])];
  if(withStats)jobs.push(git(root,['diff','--no-ext-diff','--no-textconv','--numstat','-z','--',scope]),git(root,['diff','--cached','--no-ext-diff','--no-textconv','--numstat','-z','--',scope]));
  const [branch,raw,working='',staging='']=await Promise.all(jobs);
  const all=parseStatus(raw).filter(e=>inside(real,path.resolve(root,e.path)));
  const unstaged=parseNumstat(working),staged=parseNumstat(staging);
  return {branch:branch.trim(),directory:real,total:all.length,truncated:all.length>2000,entries:all.slice(0,2000).map(e=>({...e,absolutePath:path.resolve(root,e.path),worktreeStats:unstaged[e.path],stagedStats:staged[e.path]}))};
}
async function diff(store,wid,directory,file,group){
  if(!['staged','worktree','untracked','conflict'].includes(group))throw new Error('无效的变更区域');
  const ctx=await context(store,wid,directory),data=await snapshot(store,wid,directory,false);
  const entry=data.entries.find(e=>e.path===file);if(!entry)throw new Error('文件状态已变化，请刷新变更列表');
  const valid=group==='untracked'?entry.status==='untracked':group==='conflict'?entry.status==='conflict':group==='staged'?entry.index!==' '&&entry.index!=='?':entry.worktree!==' '&&entry.worktree!=='?';
  if(!valid)throw new Error('文件状态已变化，请刷新变更列表');
  let raw;
  if(group==='untracked'||group==='conflict'){
    const content=await store.read(wid,entry.absolutePath);
    if(content.binary||content.image)return {binary:true,path:file,group};
    if(content.tooLarge)return {tooLarge:true,path:file,group};
    const rows=content.text.split('\n');if(rows.at(-1)==='')rows.pop();
    if(group==='conflict')return {path:file,group,conflict:true,lines:rows.slice(0,4000).map((text,i)=>({type:/^(<<<<<<<|=======|>>>>>>>)/.test(text)?'hunk':'context',old:null,next:i+1,text})),truncated:rows.length>4000};
    raw='@@ -0,0 +1,'+rows.length+' @@\n'+rows.map(line=>'+'+line).join('\n');
  }else raw=await git(ctx.root,['diff',...(group==='staged'?['--cached']:[]),'--no-ext-diff','--no-textconv','--no-color','--unified=3','--',entry.path,...(entry.originalPath&&inside(ctx.real,path.resolve(ctx.root,entry.originalPath))?[entry.originalPath]:[])]);
  if(/^(Binary files |GIT binary patch)/m.test(raw))return {binary:true,path:file,group};
  let old=0,next=0,inHunk=false;const lines=[];
  for(const text of raw.split('\n')){
    const match=text.match(/^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/);
    if(match){old=Number(match[1]);next=Number(match[2]);inHunk=true;lines.push({type:'hunk',text});continue;}
    if(!inHunk)continue;
    if(text.startsWith('+'))lines.push({type:'added',old:null,next:next++,text:text.slice(1)});
    else if(text.startsWith('-'))lines.push({type:'deleted',old:old++,next:null,text:text.slice(1)});
    else if(text.startsWith(' '))lines.push({type:'context',old:old++,next:next++,text:text.slice(1)});
    else if(text.startsWith('\\'))lines.push({type:'note',text});
  }
  return {path:file,group,lines:lines.slice(0,4000),truncated:lines.length>4000};
}
const lines=text=>String(text).split('\n').map(line=>line.trim()).filter(Boolean);
// Git's own explanation is kept, minus its hints, so authentication and conflict failures read plainly.
function gitError(prefix,error){
  if(error.killed)return new Error(prefix+'：操作超时，请检查网络或在终端中执行');
  const reason=String(error.stderr||error.stdout||error.message||'').split('\n').map(l=>l.trim()).filter(l=>l&&!/^hint:/i.test(l)).slice(0,4).join(' ');
  return new Error(prefix+'：'+(reason||'未知原因'));
}
// Remote branches are offered only when no local branch of that name exists; switching to one creates the tracking branch.
async function branches(store,wid,directory){
  const {root}=await context(store,wid,directory);
  const [current,local,remote]=await Promise.all([git(root,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>''),git(root,['for-each-ref','--format=%(refname:short)','refs/heads']),git(root,['for-each-ref','--format=%(refname:short)','refs/remotes']).catch(()=>'')]);
  const locals=lines(local),seen=new Set(locals),remotes=[];
  for(const ref of lines(remote)){const slash=ref.indexOf('/');if(slash<0||ref.endsWith('/HEAD'))continue;const name=ref.slice(slash+1);if(!seen.has(name)){seen.add(name);remotes.push({name,ref});}}
  const tracking=current.trim()?await upstreamOf(root):{upstream:'',ahead:0,behind:0};
  return {current:current.trim(),detached:!current.trim(),local:locals,remote:remotes,...tracking};
}
async function upstreamOf(root){
  let upstream='';try{upstream=(await git(root,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'])).trim();}catch{return {upstream:'',ahead:0,behind:0};}
  const [behind,ahead]=(await git(root,['rev-list','--left-right','--count','@{upstream}...HEAD']).catch(()=>'0 0')).trim().split(/\s+/).map(Number);
  return {upstream,ahead:ahead||0,behind:behind||0};
}
async function switchBranch(store,wid,directory,name){
  const {root}=await context(store,wid,directory),list=await branches(store,wid,directory);
  if(typeof name!=='string'||!name)throw new Error('请选择分支');
  if(name===list.current)return list;
  const remote=list.remote.find(r=>r.name===name);
  if(!list.local.includes(name)&&!remote)throw new Error('分支不存在，请刷新后重试');
  // Uncommitted changes that do not conflict travel with the switch; otherwise git refuses and nothing changes.
  try{await git(root,['switch',...(remote?['--track',remote.ref]:[name])],60000);}
  catch(error){throw gitError('切换分支失败',error);}
  return branches(store,wid,directory);
}
async function head(store,wid,directory){
  try{const {root}=await context(store,wid,directory);return (await git(root,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>git(root,['rev-parse','--short','HEAD']))).trim();}catch{return '';}
}
// Only paths currently reported for this project can be staged, so nothing outside it is touched.
async function knownPaths(store,wid,directory,paths){
  if(!Array.isArray(paths)||!paths.length)throw new Error('请选择文件');
  const data=await snapshot(store,wid,directory,false),known=new Map(data.entries.map(e=>[e.path,e]));
  const chosen=paths.map(p=>known.get(p));if(chosen.some(e=>!e))throw new Error('文件状态已变化，请刷新变更列表');
  return chosen;
}
async function stage(store,wid,directory,paths){
  const {root}=await context(store,wid,directory),entries=await knownPaths(store,wid,directory,paths);
  const files=entries.flatMap(e=>e.originalPath?[e.path,e.originalPath]:[e.path]);
  try{await git(root,['add','-A','--',...files],60000);}catch(error){throw gitError('暂存失败',error);}
}
async function unstage(store,wid,directory,paths){
  const {root}=await context(store,wid,directory),entries=await knownPaths(store,wid,directory,paths);
  const files=entries.flatMap(e=>e.originalPath?[e.path,e.originalPath]:[e.path]);
  const born=await git(root,['rev-parse','--verify','HEAD']).then(()=>true,()=>false);
  try{await git(root,born?['restore','--staged','--',...files]:['rm','--cached','-r','--quiet','--',...files],60000);}catch(error){throw gitError('取消暂存失败',error);}
}
async function commit(store,wid,directory,message){
  const {root}=await context(store,wid,directory);
  const text=typeof message==='string'?message.trim():'';if(!text)throw new Error('请填写提交说明');if(text.length>10000)throw new Error('提交说明过长');
  const staged=(await git(root,['diff','--cached','--name-only','-z'])).split('\0').filter(Boolean);
  if(!staged.length)throw new Error('暂存区为空，请先暂存要提交的文件');
  try{await git(root,['commit','-m',text],120000);}catch(error){throw gitError('提交失败',error);}
  return (await git(root,['rev-parse','--short','HEAD'])).trim();
}
async function push(store,wid,directory){
  const {root}=await context(store,wid,directory),list=await branches(store,wid,directory);
  if(list.detached)throw new Error('当前不在分支上，无法推送');
  let args=['push'];
  if(!list.upstream){
    const remotes=lines(await git(root,['remote']));
    const remote=remotes.length===1?remotes[0]:remotes.includes('origin')?'origin':'';
    if(!remote)throw new Error(remotes.length?'有多个远程仓库，请先在终端设置上游分支':'没有配置远程仓库');
    args=['push','--set-upstream',remote,list.current];
  }
  try{await git(root,args,180000);}catch(error){throw gitError('推送失败',error);}
  return branches(store,wid,directory);
}
// Fast-forward only: a diverged branch is left for the user rather than merged or rebased silently.
async function pull(store,wid,directory){
  const {root}=await context(store,wid,directory),list=await branches(store,wid,directory);
  if(list.detached)throw new Error('当前不在分支上，无法拉取');
  if(!list.upstream)throw new Error('当前分支没有上游分支，请先推送或在终端设置');
  try{await git(root,['pull','--ff-only','--no-rebase'],180000);}catch(error){throw gitError('拉取失败',error);}
  return branches(store,wid,directory);
}
module.exports={parseStatus,parseNumstat,snapshot,diff,branches,switchBranch,head,stage,unstage,commit,push,pull};
