const fs=require('node:fs/promises');
const path=require('node:path');
const token=r=>(r.titleToken||String(r.id).replace(/[^a-z0-9]/gi,'').slice(-6)).toUpperCase();
function taskText(input){
  if(typeof input!=='string')return '';
  const clean=input.slice(0,32768).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'').replace(/<(system-reminder|local-command-stdout|local-command-caveat|command-message|command-name|environment_context|ide_opened_file|ide_selection)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/```[\s\S]*?```/g,' ').replace(/<[^>]*>/g,' ').replace(/https?:\/\/\S+/g,'[链接]').replace(/\bsk-[a-zA-Z0-9_-]{12,}/g,'[已隐藏]').replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi,'$1=[已隐藏]').split('\n').map(s=>s.trim().replace(/^#+\s*|^[-*]\s*/g,'')).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  if(!clean||/^(你好|您好|hi|hello|hey|继续|需要|好的?|ok|yes|测试|test)[!！。,.，?？\s]*$/i.test(clean)||clean.startsWith('/'))return '';
  const text=clean.replace(/^(请帮我|帮我|麻烦你|请你|请)\s*/,'');
  return [...text].slice(0,32).join('')+([...text].length>32?'…':'');
}
function defaultTitle(r){
  const project=path.basename(r.cwd||'')||'工作空间';
  return (r.kind==='login'?'账号登录':r.kind==='shell'?'Shell · '+project:project+' · 新会话')+' · '+token(r);
}
function migrateTitle(r,account){
  if(r.titleSource)return false;
  const generic=!r.title||r.title==='Shell'||r.title===`Claude · ${account?.name}`||r.title===`登录 · ${account?.name}`;
  r.titleSource=generic?'default':'manual';r.titleToken=token(r);
  if(generic)r.title=defaultTitle(r);
  return true;
}
function applyTaskTitle(r,hint){
  if(r.titleSource!=='default')return false;
  const text=taskText(hint);if(!text)return false;
  r.title=text+' · '+token(r);r.titleSource='task';return true;
}
function copyTitle(source,target){for(const key of ['title','titleSource','titleToken'])if(source[key]!==undefined)target[key]=source[key];}
async function transcriptTitle(file){
  const handle=await fs.open(file,'r');
  try{
    const stat=await handle.stat();if(!stat.isFile())return '';
    const buffer=Buffer.alloc(Math.min(stat.size,1024*1024));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    for(const line of buffer.subarray(0,bytesRead).toString('utf8').split('\n')){
      let row;try{row=JSON.parse(line);}catch{continue;}
      if(row.type!=='user'||row.isMeta||row.isCompactSummary||row.message?.role!=='user')continue;
      const content=row.message.content;
      const text=typeof content==='string'?content:Array.isArray(content)?content.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n'):'';
      const title=taskText(text);if(title)return title;
    }
    return '';
  }finally{await handle.close();}
}
function migrateEmbedded(state){
  for(const w of [...state.workspaces,...(state.deletedWorkspaces||[]).map(g=>g.workspace)])w.backend='embedded';
  for(const r of [...state.sessions,...(state.deletedWorkspaces||[]).flatMap(g=>g.sessions.map(row=>row.session))]){
    if(r.backend==='iterm2'){if(r.status!=='exited')r.requiresExternalExit=true;delete r.pid;delete r.iterm;if(r.status!=='exited')r.status='interrupted';}
    r.backend='embedded';if(r.status==='external')r.status='interrupted';
  }
}
module.exports={taskText,defaultTitle,migrateTitle,applyTaskTitle,copyTitle,transcriptTitle,migrateEmbedded};
