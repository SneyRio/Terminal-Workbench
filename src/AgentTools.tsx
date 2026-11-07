import {useEffect,useState} from 'react';
import {Check,TerminalWindow} from '@phosphor-icons/react';
import {call} from './api';
export interface AgentInfo {id:string;name:string;protocols:string[];authTypes:string[];login?:boolean;unavailable?:string;command:string;docs:string;scan:{installed:boolean;path:string;version:string;issue?:string}|null;install:{running:boolean;log:string;error:string}|null}
export interface ProtocolInfo {id:string;label:string;placeholder:string;hint:string}
export interface Catalog {agents:AgentInfo[];protocols:ProtocolInfo[]}
export function useAgentCatalog(onError:(e:unknown)=>void){
 const [catalog,setCatalog]=useState<Catalog>({agents:[],protocols:[]});
 useEffect(()=>{void call<Catalog>('agents:list').then(setCatalog).catch(onError);return window.accountor?.on('agents:state',setCatalog);},[]);
 return catalog;
}
// Prefers keeping the current choice, then an installed agent, so the protocol maps to something runnable.
export function pickAgent(agents:AgentInfo[],protocol:string,current:string){
 const usable=agents.filter(a=>a.protocols.includes(protocol));
 if(!agents.length||usable.some(a=>a.id===current))return current;
 return (usable.find(a=>a.scan?.installed)||usable[0])?.id||current;
}
export function AgentStatus({agent,onError,compact}:{agent:AgentInfo;onError:(e:unknown)=>void;compact?:boolean}){
 const [scanning,setScanning]=useState(false);
 const scan=async()=>{setScanning(true);try{await call('agents:scan',agent.id);}catch(e){onError(e);}finally{setScanning(false);}};
 const installing=!!agent.install?.running,installed=!!agent.scan?.installed;
 return <div className={'agent-status'+(compact?' compact':'')} aria-label={agent.name+' 安装状态'}>
  {installed?<span className="agent-available"><Check size={13}/>可用{agent.scan?.version?' · '+agent.scan.version:''}</span>:<span className="muted">{agent.scan?'未安装':'尚未扫描'}</span>}
  {installed&&!compact&&<small className="connection-url">{agent.scan?.path}</small>}
  {!installed&&agent.scan?.issue&&<small className="muted">{agent.scan.issue}</small>}
  <span className="spacer"/>
  <button type="button" className={installed?'text-button':'secondary compact'} disabled={scanning||installing} onClick={()=>void scan()}>{scanning?'扫描中…':installed?'重新扫描':'扫描'}</button>
  {!installed&&<button type="button" className="primary compact" disabled={scanning||installing} onClick={()=>void call('agents:install',agent.id).catch(onError)}>{installing?'下载中…':'下载'}</button>}
  {agent.install?.error&&<p role="alert" className="update-error">{agent.install.error}</p>}
  {agent.install?.log&&<details open={installing}><summary>安装日志</summary><pre className="agent-log">{agent.install.log}</pre></details>}
 </div>;
}
export function AgentPicker({catalog,value,protocol,customOnly,onChange,onError}:{catalog:Catalog;value:string;protocol?:string;customOnly?:boolean;onChange:(id:string)=>void;onError:(e:unknown)=>void}){
 const selected=catalog.agents.find(a=>a.id===value);
 const reason=(a:AgentInfo)=>{if(customOnly)return a.unavailable?'仅支持官方登录':a.protocols.includes(protocol||'')?'':'不支持此协议';return a.login?'':'仅支持自定义供应商';};
 return <div className="agent-picker"><label className="field">Agent 工具<select aria-label="选择 Agent 工具" value={value} onChange={e=>onChange(e.target.value)}>{catalog.agents.length?catalog.agents.map(a=><option key={a.id} value={a.id} disabled={!!reason(a)}>{a.name}{reason(a)?`（${reason(a)}）`:''}</option>):<option value={value}>Claude Code</option>}</select></label>{selected&&<AgentStatus agent={selected} onError={onError} compact/>}</div>;
}
export function AgentToolRows({catalog,onSettings,onError}:{catalog:Catalog;onSettings:()=>void;onError:(e:unknown)=>void}){
 const label=(a:AgentInfo)=>a.unavailable||'支持协议：'+a.protocols.map(id=>catalog.protocols.find(p=>p.id===id)?.hint||id).join(' · ');
 return <>{catalog.agents.map(a=><div className="tool-config-row agent-row" key={a.id}><TerminalWindow size={25}/><div><strong>{a.name}</strong><small>{label(a)}</small><AgentStatus agent={a} onError={onError}/></div>{a.id==='claude-code'&&<button className="secondary" onClick={onSettings}>配置 CLI 路径</button>}</div>)}</>;
}
