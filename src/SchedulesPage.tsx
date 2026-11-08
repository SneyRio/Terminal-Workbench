import {useState} from 'react';
import {Alarm,FolderOpen,Pause,Play,PencilSimple,Plus,TerminalWindow,Trash,X} from '@phosphor-icons/react';
import {call} from './api';
import type {AppState} from './types';

export interface ScheduleRule{type:'interval'|'daily'|'weekly'|'cron';every?:number;time?:string;days?:number[];expr?:string}
export interface ScheduleTask{id:string;name:string;prompt:string;workspaceId:string;accountId:string;rule:ScheduleRule;permission:'read'|'write'|'full';worktree:boolean;timeoutMinutes:number;catchUp:boolean;notify:boolean;enabled:boolean;nextRunAt?:number|null}
export interface ScheduleRun{id:string;scheduleId:string;trigger:string;startedAt:number;finishedAt?:number;status:'running'|'success'|'failed'|'skipped'|'timeout'|'interrupted';reason?:string;sessionId?:string;worktree?:string;branch?:string;worktreeRemoved?:boolean;changedFiles?:number;commits?:number;exitCode?:number}

const weekNames=['日','一','二','三','四','五','六'];
export function describeRule(rule:ScheduleRule){
 if(rule.type==='interval')return (rule.every||0)%60===0?`每 ${(rule.every||0)/60} 小时`:`每 ${rule.every} 分钟`;
 if(rule.type==='daily')return `每天 ${rule.time}`;
 if(rule.type==='weekly')return `每周${(rule.days||[]).map(d=>weekNames[d]).join('、')} ${rule.time}`;
 return `cron ${rule.expr}`;
}
const permissionNames={read:'只读',write:'可修改项目文件',full:'完全权限'};
const statusNames:Record<ScheduleRun['status'],string>={running:'运行中',success:'完成',failed:'失败',skipped:'已跳过',timeout:'超时',interrupted:'被中断'};
const when=(t?:number|null)=>t?new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const blank=(state:AppState):Omit<ScheduleTask,'id'>=>{const w=state.workspaces.find(w=>w.id===state.selectedWorkspace)||state.workspaces[0];return {name:'',prompt:'',workspaceId:w?.id||'',accountId:w?.accountId||state.accounts[0]?.id||'',rule:{type:'daily',time:'09:00'},permission:'read',worktree:true,timeoutMinutes:30,catchUp:true,notify:true,enabled:true};};

export function SchedulesPage({state,tools,onOpenSession,onError}:{state:AppState;tools:{id:string;name:string}[];onOpenSession:(id:string)=>void;onError:(e:unknown)=>void}){
 const [editing,setEditing]=useState<(Omit<ScheduleTask,'id'>&{id?:string})|null>(null),[busy,setBusy]=useState('');
 const tasks:ScheduleTask[]=(state as any).schedules||[],runs:ScheduleRun[]=(state as any).scheduleRuns||[];
 const accountLabel=(id:string)=>{const a=state.accounts.find(a=>a.id===id);return a?(tools.find(t=>t.id===(a.agentToolId||'claude-code'))?.name||'Claude Code')+' · '+a.name:'账号已移除';};
 const workspaceName=(id:string)=>state.workspaces.find(w=>w.id===id)?.name||'工作空间已移除';
 const act=async(key:string,run:()=>Promise<unknown>)=>{if(busy)return;setBusy(key);try{await run();}catch(e){onError(e);}finally{setBusy('');}};
 const save=async()=>{if(!editing)return;if(editing.permission==='full'&&!confirm('完全权限会让 Agent 无人值守地执行任意命令、修改任意文件。确定使用？'))return;await act('save',async()=>{await call('schedules:save',editing);setEditing(null);});};
 return <main className="content-page schedules-page"><div className="page-intro"><h2>按时自动运行 Agent。</h2><p>到点后在后台无人值守地运行一次，每次运行都会留下可恢复的会话。仅在应用运行时执行。</p></div>
  <div className="schedule-toolbar"><button className="primary" disabled={!state.workspaces.length||!state.accounts.length} onClick={()=>setEditing(blank(state))}><Plus size={16}/>新建定时任务</button>{(!state.workspaces.length||!state.accounts.length)&&<span className="muted">需要先有工作空间和账号</span>}</div>
  {!tasks.length&&<p className="muted schedule-empty">还没有定时任务。</p>}
  {tasks.map(task=>{const history=runs.filter(r=>r.scheduleId===task.id).sort((a,b)=>b.startedAt-a.startedAt),last=history[0],running=history.some(r=>r.status==='running');return <section className={'schedule-card'+(task.enabled?'':' paused')} key={task.id} aria-label={'定时任务 '+task.name}>
   <div className="schedule-heading"><Alarm size={22}/><div><strong>{task.name}</strong><small>{describeRule(task.rule)} · {workspaceName(task.workspaceId)} · {accountLabel(task.accountId)} · {permissionNames[task.permission]}{task.worktree?' · 独立工作树':''}</small></div>
    <div className="schedule-actions"><button className="secondary compact" disabled={!!busy||running} onClick={()=>void act('run'+task.id,()=>call('schedules:run-now',task.id))}><Play size={14}/>立即运行</button><button className="icon-button" aria-label={(task.enabled?'暂停 ':'启用 ')+task.name} title={task.enabled?'暂停':'启用'} disabled={!!busy} onClick={()=>void act('toggle',()=>call('schedules:toggle',task.id,!task.enabled))}>{task.enabled?<Pause size={16}/>:<Play size={16}/>}</button><button className="icon-button" aria-label={'编辑 '+task.name} title="编辑" onClick={()=>setEditing({...task})}><PencilSimple size={16}/></button><button className="icon-button" aria-label={'删除 '+task.name} title="删除" disabled={!!busy||running} onClick={()=>{if(confirm(`删除定时任务“${task.name}”？运行记录和保留的工作树会一起删除。`))void act('remove',()=>call('schedules:remove',task.id));}}><Trash size={16}/></button></div></div>
   <div className="schedule-meta"><span>下次运行：{task.enabled?when(task.nextRunAt):'已暂停'}</span><span>上次：{last?`${when(last.startedAt)} ${statusNames[last.status]}`:'尚未运行'}</span></div>
   {history.length>0&&<details className="schedule-runs"><summary>运行记录 {history.length}</summary>{history.map(run=><div className={'schedule-run '+run.status} key={run.id}><span className="schedule-run-status">{statusNames[run.status]}</span><span>{when(run.startedAt)}{run.trigger==='manual'?' · 手动':''}</span><span className="schedule-run-detail" title={run.reason||''}>{run.reason||(run.worktree?`${run.changedFiles??0} 个文件变更 · ${run.commits??0} 个提交 · ${run.branch}`:run.exitCode!==undefined?'退出码 '+run.exitCode:'')}</span>
    {run.sessionId&&state.sessions.some(s=>s.id===run.sessionId)&&<button className="text-button" onClick={()=>onOpenSession(run.sessionId!)}><TerminalWindow size={14}/>会话</button>}
    {run.worktree&&!run.worktreeRemoved&&run.status!=='running'&&<><button className="text-button" onClick={()=>void act('open',()=>call('schedules:open-worktree',run.id))}><FolderOpen size={14}/>工作树</button><button className="text-button" onClick={()=>{if(confirm(`删除这次运行的工作树？其中未提交的改动会丢失，已提交的内容保留在分支 ${run.branch}。`))void act('wt',()=>call('schedules:remove-worktree',run.id));}}><X size={14}/>删除工作树</button></>}</div>)}</details>}
  </section>;})}
  {editing&&<div className="modal-backdrop"><section className="modal schedule-dialog" role="dialog" aria-modal="true" aria-label={editing.id?'编辑定时任务':'新建定时任务'}><div className="modal-heading"><h2>{editing.id?'编辑定时任务':'新建定时任务'}</h2><button className="icon-button" aria-label="关闭" onClick={()=>setEditing(null)}><X size={20}/></button></div>
   <label className="field">任务名称<input aria-label="任务名称" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})} placeholder="例如：每日依赖检查"/></label>
   <div className="form-grid"><label className="field">工作空间<select aria-label="任务工作空间" value={editing.workspaceId} onChange={e=>{const w=state.workspaces.find(w=>w.id===e.target.value);setEditing({...editing,workspaceId:e.target.value,accountId:w?.accountId||editing.accountId});}}>{state.workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
   <label className="field">账号<select aria-label="任务账号" value={editing.accountId} onChange={e=>setEditing({...editing,accountId:e.target.value})}>{tools.map(t=>{const list=state.accounts.filter(a=>(a.agentToolId||'claude-code')===t.id);return list.length?<optgroup key={t.id} label={t.name}>{list.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>:null;})}</select></label></div>
   <label className="field">提示词<textarea aria-label="任务提示词" rows={4} value={editing.prompt} onChange={e=>setEditing({...editing,prompt:e.target.value})} placeholder="每次运行发送给 Agent 的内容"/></label>
   <div className="form-grid"><label className="field">时间规则<select aria-label="时间规则" value={editing.rule.type} onChange={e=>{const type=e.target.value as ScheduleRule['type'];setEditing({...editing,rule:type==='interval'?{type,every:60}:type==='daily'?{type,time:'09:00'}:type==='weekly'?{type,time:'09:00',days:[1]}:{type,expr:'0 9 * * 1-5'}});}}><option value="interval">固定间隔</option><option value="daily">每天</option><option value="weekly">每周</option><option value="cron">cron 表达式</option></select></label>
   {editing.rule.type==='interval'&&<label className="field">间隔（分钟，至少 5）<input aria-label="间隔分钟" type="number" min={5} value={editing.rule.every} onChange={e=>setEditing({...editing,rule:{...editing.rule,every:Number(e.target.value)}})}/></label>}
   {(editing.rule.type==='daily'||editing.rule.type==='weekly')&&<label className="field">时间<input aria-label="运行时间" type="time" value={editing.rule.time} onChange={e=>setEditing({...editing,rule:{...editing.rule,time:e.target.value}})}/></label>}
   {editing.rule.type==='cron'&&<label className="field">cron（分 时 日 月 周）<input aria-label="cron 表达式" value={editing.rule.expr} onChange={e=>setEditing({...editing,rule:{...editing.rule,expr:e.target.value}})}/></label>}</div>
   {editing.rule.type==='weekly'&&<div className="schedule-days" role="group" aria-label="每周运行日">{weekNames.map((n,d)=><label key={d}><input type="checkbox" checked={(editing.rule.days||[]).includes(d)} onChange={e=>setEditing({...editing,rule:{...editing.rule,days:e.target.checked?[...(editing.rule.days||[]),d]:(editing.rule.days||[]).filter(x=>x!==d)}})}/>周{n}</label>)}</div>}
   <div className="form-grid"><label className="field">权限<select aria-label="任务权限" value={editing.permission} onChange={e=>setEditing({...editing,permission:e.target.value as ScheduleTask['permission']})}><option value="read">只读（默认）</option><option value="write">可修改项目文件</option><option value="full">完全权限</option></select></label>
   <label className="field">超时（分钟）<input aria-label="超时分钟" type="number" min={1} value={editing.timeoutMinutes} onChange={e=>setEditing({...editing,timeoutMinutes:Number(e.target.value)})}/></label></div>
   <p className="muted">{editing.permission==='read'?'只读任务直接在项目目录运行，不能修改文件或执行命令。':editing.permission==='write'?'可以修改文件，不能执行命令。':'可以执行任意命令，请只用于信任的任务。'}</p>
   {editing.permission!=='read'&&<label className="check-field"><input type="checkbox" checked={editing.worktree} onChange={e=>setEditing({...editing,worktree:e.target.checked})}/>在独立 Git 工作树和新分支中运行（推荐，不影响当前工作区）</label>}
   <label className="check-field"><input type="checkbox" checked={editing.catchUp} onChange={e=>setEditing({...editing,catchUp:e.target.checked})}/>应用关闭期间错过的运行，启动后补跑一次</label>
   <label className="check-field"><input type="checkbox" checked={editing.notify} onChange={e=>setEditing({...editing,notify:e.target.checked})}/>完成、失败或跳过时发系统通知</label>
   <p className="muted">账号五小时额度用到 90%、本周额度用到 95% 或 Credits 用尽时会跳过，避免耗尽额度。上一次未结束时不会重复运行。</p>
   <footer className="modal-footer"><button className="secondary" onClick={()=>setEditing(null)}>取消</button><button className="primary" disabled={busy==='save'} onClick={()=>void save()}>保存</button></footer></section></div>}
 </main>;
}
