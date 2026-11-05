import {ArrowCounterClockwise,CaretRight,FolderOpen,TerminalWindow,Trash} from '@phosphor-icons/react';
import type {DeletedWorkspace,Session} from './types';
export function DeletedSessions({groups,now,busy,onRestore,onDelete}:{groups:DeletedWorkspace[];now:number;busy:string;onRestore:(session:Session)=>void;onDelete:(session:Session)=>void}){
  const visible=groups.map(group=>({...group,sessions:group.sessions.filter(row=>row.expiresAt>now)})).filter(group=>group.sessions.length);
  return <main className="content-page deleted-page">
    <div className="page-intro"><h2>最近删除</h2><p>手动删除的会话按原工作空间保留 7 天。恢复替换、账号切换和进程结束的自动清理不进入此处。</p></div>
    {!visible.length&&<div className="deleted-empty"><Trash size={28}/><h3>暂无最近删除的会话</h3><p>删除会话后，可在这里恢复。超过 7 天的管理记录自动清理，项目文件和原始 CLI 历史保留。</p></div>}
    {visible.map(group=><details open className="deleted-workspace" key={group.workspace.id||'login'}>
      <summary><CaretRight className="deleted-chevron" size={13}/><FolderOpen size={19}/><strong>{group.workspace.name}</strong><span className="badge">{group.sessions.length} 个会话</span></summary>
      <div className="deleted-session-list">{group.sessions.map(row=><div className="history-row deleted-session-row" key={row.session.id} data-deleted-session-id={row.session.id}>
        <TerminalWindow size={19}/><div className="deleted-session-info"><strong>{row.session.title}</strong><small title={row.session.cwd}>{row.session.cwd}</small><small>删除于 {new Date(row.deletedAt).toLocaleString('zh-CN')} · {Math.min(7,Math.max(1,Math.ceil((row.expiresAt-now)/86400000)))} 天内可恢复</small>{row.session.kind==='shell'&&<small>恢复工作目录并新建 Shell，不恢复已结束的命令进程</small>}</div>
        <div className="deleted-row-actions"><button className="secondary" disabled={!!busy} aria-label={'恢复已删除会话 '+row.session.title} onClick={()=>onRestore(row.session)}><ArrowCounterClockwise size={15}/>{busy===row.session.id?'正在处理…':'恢复会话'}</button><button className="text-button danger" disabled={!!busy} aria-label={'永久删除会话 '+row.session.title} onClick={()=>onDelete(row.session)}><Trash size={15}/>永久删除</button></div>
      </div>)}</div>
    </details>)}
  </main>;
}
