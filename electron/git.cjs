const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {inside}=require('./core.cjs');
const exec=promisify(execFile);
async function git(directory,args){
  const {stdout}=await exec('git',['--no-optional-locks','--literal-pathspecs','-c','core.fsmonitor=false','-c','core.quotepath=false','-C',directory,...args],{windowsHide:true,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},timeout:10000,maxBuffer:4*1024*1024});return stdout;
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
module.exports={parseStatus,parseNumstat,snapshot,diff};
