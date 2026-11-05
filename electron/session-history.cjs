const RETENTION_MS=7*24*60*60*1000;
function pruneDeleted(state,now=Date.now()){
  state.deletedWorkspaces=(state.deletedWorkspaces||[]).map(group=>({...group,sessions:group.sessions.filter(row=>Number.isFinite(row.deletedAt)&&row.deletedAt+RETENTION_MS>now)})).filter(group=>group.sessions.length);
}
function findDeleted(state,sid){
  for(const group of state.deletedWorkspaces||[]){const row=group.sessions.find(row=>row.session.id===sid);if(row)return {group,row};}
}
function forgetDeleted(state,sid){
  state.deletedWorkspaces=(state.deletedWorkspaces||[]).map(group=>({...group,sessions:group.sessions.filter(row=>row.session.id!==sid)})).filter(group=>group.sessions.length);
}
function archiveSession(state,session,now=Date.now()){
  pruneDeleted(state,now);forgetDeleted(state,session.id);
  const workspace=state.workspaces.find(w=>w.id===session.workspaceId)||{id:session.workspaceId||'',name:session.kind==='login'?'账号登录':'已移除的工作空间',projects:session.projects||[],backend:session.backend,accountId:session.accountId};
  let group=state.deletedWorkspaces.find(g=>g.workspace.id===workspace.id);
  if(!group){group={workspace:structuredClone(workspace),sessions:[]};state.deletedWorkspaces.push(group);}
  group.sessions.unshift({session:structuredClone(session),deletedAt:now,expiresAt:now+RETENTION_MS});
}
function replaceSession(state,sid,next){
  state.sessions=state.sessions.filter(r=>r.id!==sid);
  for(const w of state.workspaces){
    if(w.selectedSession===sid)w.selectedSession=next?.id||'';
    w.hiddenGroups=(w.hiddenGroups||[]).filter(g=>state.sessions.some(r=>r.workspaceId===w.id&&r.groupId===g));
  }
}
function deduplicateRecovered(state){
  const groups=new Map();
  for(const r of state.sessions){
    if(r.kind!=='claude'||r.backend!=='embedded'||!r.claudeSessionId)continue;
    const key=JSON.stringify([r.workspaceId,r.accountId,r.cwd,r.claudeSessionId]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
  }
  for(const rows of groups.values()){
    if(rows.length<2||!rows.some(r=>r.recovery==='requested'))continue;
    rows.sort((a,b)=>(b.restoredAt||b.createdAt||0)-(a.restoredAt||a.createdAt||0));
    for(const old of rows.slice(1))replaceSession(state,old.id,rows[0]);
  }
}
module.exports={RETENTION_MS,pruneDeleted,findDeleted,forgetDeleted,archiveSession,replaceSession,deduplicateRecovered};
