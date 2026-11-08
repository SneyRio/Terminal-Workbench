import {useEffect,useState} from 'react';
import {ArrowDown,ArrowUp,Plus,Trash} from '@phosphor-icons/react';
import {call} from './api';
import type {SystemPrompt} from './types';

type Tool={id:string;name:string};
const MAX_TEXT=20000;
const newPrompt=(n:number):SystemPrompt=>({id:crypto.randomUUID(),name:'提示词 '+n,text:'',enabled:true,agents:[]});
const same=(a:SystemPrompt[],b:SystemPrompt[])=>JSON.stringify(a)===JSON.stringify(b);

// An empty agent list means "all agents"; the UI shows that as every box ticked.
export function SystemPrompts({value,tools,onError}:{value?:SystemPrompt[];tools:Tool[];onError:(e:unknown)=>void}){
 const saved=value||[];
 const [items,setItems]=useState<SystemPrompt[]>(saved),[saving,setSaving]=useState(false);
 useEffect(()=>setItems(value||[]),[value]);
 const dirty=!same(items,saved);
 const patch=(id:string,p:Partial<SystemPrompt>)=>setItems(list=>list.map(e=>e.id===id?{...e,...p}:e));
 const move=(i:number,d:number)=>setItems(list=>{const next=[...list];[next[i],next[i+d]]=[next[i+d],next[i]];return next;});
 const toggleAgent=(e:SystemPrompt,agent:string,on:boolean)=>{
  const current=e.agents.length?e.agents:tools.map(t=>t.id);
  const next=on?[...new Set([...current,agent])]:current.filter(a=>a!==agent);
  patch(e.id,{agents:next.length===tools.length?[]:next.length?next:['__none__']});
 };
 const agentsOf=(e:SystemPrompt)=>e.agents.length?e.agents:tools.map(t=>t.id);
 const invalid=items.find(e=>e.agents.includes('__none__'))?'每条提示词至少选择一个 Agent':items.find(e=>e.text.length>MAX_TEXT)?`单条提示词最多 ${MAX_TEXT} 字`:'';
 const save=async()=>{setSaving(true);try{await call('settings:save',{systemPrompts:items});}catch(e){onError(e);}finally{setSaving(false);}};
 const active=(agent:string)=>items.filter(e=>e.enabled&&e.text.trim()&&agentsOf(e).includes(agent)).length;
 return <div className="settings-section system-prompts">
  <div className="section-heading"><h3>系统提示词</h3><button type="button" className="text-button" disabled={items.length>=30} onClick={()=>setItems(list=>[...list,newPrompt(list.length+1)])}><Plus size={15}/>添加</button></div>
  <p className="muted">追加到各 Agent 自带的系统提示词之后，不会替换原有内容。保存后对新开、恢复和定时任务的会话生效，已运行的会话不受影响。多条按顺序拼接。</p>
  {!items.length&&<p className="muted system-prompt-empty">还没有系统提示词。点击“添加”写一条，例如“始终使用简体中文回复”。</p>}
  {items.map((e,i)=><div className={'system-prompt-card'+(e.enabled?'':' paused')} key={e.id}>
   <div className="system-prompt-head">
    <label className="check-field"><input type="checkbox" aria-label={'启用 '+e.name} checked={e.enabled} onChange={ev=>patch(e.id,{enabled:ev.target.checked})}/>启用</label>
    <input className="system-prompt-name" aria-label="提示词名称" value={e.name} maxLength={60} onChange={ev=>patch(e.id,{name:ev.target.value})}/>
    <button type="button" className="icon-button" aria-label="上移" title="上移" disabled={i===0} onClick={()=>move(i,-1)}><ArrowUp size={14}/></button>
    <button type="button" className="icon-button" aria-label="下移" title="下移" disabled={i===items.length-1} onClick={()=>move(i,1)}><ArrowDown size={14}/></button>
    <button type="button" className="text-button danger" onClick={()=>setItems(list=>list.filter(x=>x.id!==e.id))}><Trash size={14}/>删除</button>
   </div>
   <textarea aria-label={e.name+' 内容'} rows={5} value={e.text} placeholder="例如：始终使用简体中文回复；修改代码前先说明计划。" onChange={ev=>patch(e.id,{text:ev.target.value})}/>
   <div className="system-prompt-foot">
    <div className="schedule-days" role="group" aria-label="生效的 Agent">{tools.map(t=><label key={t.id}><input type="checkbox" checked={agentsOf(e).includes(t.id)} onChange={ev=>toggleAgent(e,t.id,ev.target.checked)}/>{t.name}</label>)}</div>
    <small className={e.text.length>MAX_TEXT?'update-error':'muted'}>{e.text.length} / {MAX_TEXT}</small>
   </div>
  </div>)}
  {!!items.length&&<p className="muted">当前生效：{tools.map(t=>`${t.name} ${active(t.id)} 条`).join(' · ')}</p>}
  {invalid&&<p role="alert" className="update-error">{invalid}</p>}
  {(dirty||saving)&&<div className="system-prompt-actions"><button type="button" className="secondary" disabled={saving} onClick={()=>setItems(saved)}>撤销修改</button><button type="button" className="primary" disabled={saving||!!invalid} onClick={()=>void save()}>{saving?'保存中…':'保存'}</button></div>}
 </div>;
}
