import {useEffect,useState} from 'react';
import {ArrowsClockwise,PencilSimple,Plug,Plus,TerminalWindow,Trash,X} from '@phosphor-icons/react';
import {call,timeOf} from './api';
import type {AppState,CliTool,McpServer} from './types';

type Tool={id:string;name:string};
const agentsOf=(agents:string[],tools:Tool[])=>agents.length?agents:tools.map(t=>t.id);
const toggleAgent=(agents:string[],tools:Tool[],agent:string,on:boolean)=>{const cur=agentsOf(agents,tools),next=on?[...new Set([...cur,agent])]:cur.filter(a=>a!==agent);return next.length===tools.length?[]:next;};
const parseLines=(text:string)=>Object.fromEntries(text.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const i=l.indexOf('=');if(i<1)throw new Error('每行写成 名称=值：'+l);return [l.slice(0,i).trim(),l.slice(i+1)];}));

function AgentChecks({agents,tools,onChange}:{agents:string[];tools:Tool[];onChange:(a:string[])=>void}){
 const current=agentsOf(agents,tools);
 return <div className="schedule-days" role="group" aria-label="生效的 Agent">{tools.map(t=><label key={t.id}><input type="checkbox" checked={current.includes(t.id)} disabled={current.length===1&&current.includes(t.id)} onChange={e=>onChange(toggleAgent(agents,tools,t.id,e.target.checked))}/>{t.name}</label>)}</div>;
}

type Draft={id?:string;name:string;type:'stdio'|'http';command:string;args:string;url:string;secrets:string;keys:string[];source?:string;enabled:boolean;agents:string[]};
const toDraft=(s?:McpServer):Draft=>s?{id:s.id,name:s.name,type:s.type,command:s.command||'',args:(s.args||[]).join('\n'),url:s.url||'',secrets:'',keys:s.type==='http'?s.headerKeys:s.envKeys,source:s.source,enabled:s.enabled,agents:s.agents}:{name:'',type:'stdio',command:'',args:'',url:'',secrets:'',keys:[],enabled:true,agents:[]};

function McpEditor({draft,tools,onCancel,onSave}:{draft:Draft;tools:Tool[];onCancel:()=>void;onSave:(d:Draft)=>Promise<void>}){
 const [d,setD]=useState(draft),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const label=d.type==='http'?'请求头':'环境变量';
 const save=async()=>{setSaving(true);setError('');try{if(d.secrets.trim())parseLines(d.secrets);await onSave(d);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
 return <div className="modal-backdrop"><section className="modal mcp-editor" role="dialog" aria-label={d.id?'编辑 MCP 服务器':'添加 MCP 服务器'}>
  <div className="section-heading"><h3>{d.id?'编辑 MCP 服务器':'添加 MCP 服务器'}</h3><button className="icon-button" aria-label="关闭" onClick={onCancel}><X size={16}/></button></div>
  <div className="form-grid">
   <label className="field">名称<input aria-label="MCP 名称" value={d.name} placeholder="例如 github" onChange={e=>setD({...d,name:e.target.value})}/></label>
   <label className="field">类型<select aria-label="MCP 类型" value={d.type} onChange={e=>setD({...d,type:e.target.value as Draft['type'],secrets:'',keys:[]})}><option value="stdio">本地命令（stdio）</option><option value="http">远程地址（HTTP）</option></select></label>
  </div>
  {d.type==='stdio'?<><label className="field">启动命令<input aria-label="启动命令" value={d.command} placeholder="例如 npx" onChange={e=>setD({...d,command:e.target.value})}/></label>
   <label className="field">参数（每行一个）<textarea aria-label="启动参数" rows={3} value={d.args} placeholder={'-y\n@modelcontextprotocol/server-github'} onChange={e=>setD({...d,args:e.target.value})}/></label></>
  :<label className="field">地址<input aria-label="MCP 地址" value={d.url} placeholder="https://example.com/mcp" onChange={e=>setD({...d,url:e.target.value})}/></label>}
  <label className="field">{label}（每行 名称=值，加密保存）<textarea aria-label={label} rows={3} value={d.secrets} placeholder={d.keys.length?`已保存：${d.keys.join('、')}。留空保持不变，填写则整体替换`:d.type==='http'?'Authorization=Bearer …':'GITHUB_TOKEN=…'} onChange={e=>setD({...d,secrets:e.target.value})}/></label>
  <AgentChecks agents={d.agents} tools={tools} onChange={agents=>setD({...d,agents})}/>
  {error&&<p role="alert" className="update-error">{error}</p>}
  <div className="system-prompt-actions"><button className="secondary" onClick={onCancel}>取消</button><button className="primary" disabled={saving} onClick={()=>void save()}>{saving?'保存中…':'保存'}</button></div>
 </section></div>;
}

export function IntegrationsPage({state,tools,onError}:{state:AppState;tools:Tool[];onError:(e:unknown)=>void}){
 const servers=state.mcpServers||[],cli=state.cliTools||[];
 const [editing,setEditing]=useState<Draft|null>(null),[scanning,setScanning]=useState(''),[notice,setNotice]=useState('');
 const [toolDraft,setToolDraft]=useState<CliTool[]>(cli),[custom,setCustom]=useState({command:'',path:'',description:''});
 useEffect(()=>setToolDraft(state.cliTools||[]),[state.cliTools]);
 const toolsDirty=JSON.stringify(toolDraft)!==JSON.stringify(cli);
 const saveServers=async(list:any[])=>{await call('mcp:save',list);};
 const saveDraft=async(d:Draft)=>{
  const entry:any={id:d.id,name:d.name.trim(),type:d.type,command:d.command.trim(),args:d.args.split('\n').map(a=>a.trim()).filter(Boolean),url:d.url.trim(),enabled:d.enabled,agents:d.agents,source:d.source||'manual'};
  if(d.secrets.trim())entry[d.type==='http'?'headers':'env']=parseLines(d.secrets);
  const list=d.id?servers.map(s=>s.id===d.id?entry:s):[...servers,entry];
  await saveServers(list);setEditing(null);
 };
 const patchServer=(id:string,p:Partial<McpServer>)=>void saveServers(servers.map(s=>s.id===id?{...s,...p}:s)).catch(onError);
 const scan=async(kind:'mcp'|'cli')=>{setScanning(kind);setNotice('');try{const r=await call<{added:string[];found:number}>(kind+':scan');setNotice(r.added.length?`${kind==='mcp'?'接入了 MCP':'发现了工具'}：${r.added.join('、')}`:`未发现新的${kind==='mcp'?' MCP 服务器':'工具'}`);}catch(e){onError(e);}finally{setScanning('');}};
 const patchTool=(id:string,p:Partial<CliTool>)=>setToolDraft(list=>list.map(t=>t.id===id?{...t,...p}:t));
 const addCustom=()=>{if(!custom.command.trim())return;setToolDraft(list=>[...list,{id:crypto.randomUUID(),command:custom.command.trim(),path:custom.path.trim(),description:custom.description.trim(),enabled:true,agents:[],source:'manual'}]);setCustom({command:'',path:'',description:''});};
 const enabledTools=toolDraft.filter(t=>t.enabled),otherTools=toolDraft.filter(t=>!t.enabled);
 const toolRow=(t:CliTool)=><div className={'cli-tool-row'+(t.enabled?'':' paused')} key={t.id}>
  <label className="check-field"><input type="checkbox" aria-label={'启用 '+t.command} checked={t.enabled} onChange={e=>patchTool(t.id,{enabled:e.target.checked})}/><strong>{t.command}</strong></label>
  <small className="connection-url" title={t.path}>{t.path||'未指定路径（使用 PATH 查找）'}</small>
  <input aria-label={t.command+' 说明'} value={t.description} placeholder="用途说明，会告诉 Agent" onChange={e=>patchTool(t.id,{description:e.target.value})}/>
  {t.enabled&&<AgentChecks agents={t.agents} tools={tools} onChange={agents=>patchTool(t.id,{agents})}/>}
  <button className="icon-button" aria-label={'删除 '+t.command} onClick={()=>setToolDraft(list=>list.filter(x=>x.id!==t.id))}><Trash size={14}/></button>
 </div>;
 return <main className="content-page integrations-page"><section>
  <div className="page-intro"><h2>一次配置，所有 Agent 可用。</h2><p>新开、恢复和定时任务的会话生效，不改动各 Agent 自己的配置文件。</p></div>
  {notice&&<p className="muted" role="status">{notice}</p>}
  <div className="settings-section">
   <div className="section-heading"><h3><Plug size={16}/> MCP 服务器</h3><span className="spacer"/><button className="text-button" disabled={!!scanning} onClick={()=>void scan('mcp')}><ArrowsClockwise size={14}/>{scanning==='mcp'?'扫描中…':'重新扫描'}</button><button className="text-button" onClick={()=>setEditing(toDraft())}><Plus size={14}/>添加</button></div>
   <p className="muted">启动时自动扫描 Claude、Qoder、OpenCode、Codex 已配置的 MCP 并接入（同名只取一个，删除过的不再接入）。密钥类的环境变量和请求头加密保存在本机。Codex 自带的应用工具依赖 Codex 自身环境，不会接入。{state.mcpScannedAt?' 上次扫描 '+timeOf(state.mcpScannedAt):''}</p>
   {!servers.length&&<p className="muted system-prompt-empty">还没有 MCP 服务器。点击“重新扫描”或“添加”。</p>}
   {servers.map(s=><div className={'system-prompt-card'+(s.enabled?'':' paused')} key={s.id}>
    <div className="system-prompt-head">
     <label className="check-field"><input type="checkbox" aria-label={'启用 '+s.name} checked={s.enabled} onChange={e=>patchServer(s.id,{enabled:e.target.checked})}/>启用</label>
     <strong className="system-prompt-name">{s.name}</strong><span className="backend-pill">{s.type==='http'?'HTTP':'stdio'}</span>{s.source!=='manual'&&<span className="backend-pill">来自 {s.source}</span>}
     <button className="icon-button" aria-label={'编辑 '+s.name} onClick={()=>setEditing(toDraft(s))}><PencilSimple size={14}/></button>
     <button className="icon-button" aria-label={'删除 '+s.name} onClick={()=>void saveServers(servers.filter(x=>x.id!==s.id)).catch(onError)}><Trash size={14}/></button>
    </div>
    <small className="connection-url">{s.type==='http'?s.url:[s.command,...(s.args||[])].join(' ')}</small>
    {(s.envKeys.length>0||s.headerKeys.length>0)&&<small className="muted"> · {s.type==='http'?'请求头':'环境变量'}：{(s.type==='http'?s.headerKeys:s.envKeys).join('、')}</small>}
    <AgentChecks agents={s.agents} tools={tools} onChange={agents=>patchServer(s.id,{agents})}/>
   </div>)}
  </div>
  <div className="settings-section">
   <div className="section-heading"><h3><TerminalWindow size={16}/> 命令行工具</h3><span className="spacer"/><button className="text-button" disabled={!!scanning} onClick={()=>void scan('cli')}><ArrowsClockwise size={14}/>{scanning==='cli'?'扫描中…':'重新扫描'}</button></div>
   <p className="muted">勾选的工具会加入会话的 PATH，并以“本机已安装以下命令行工具”的形式附加到系统提示词，Agent 就知道可以直接用它们。扫描只找常见工具，其他工具可在下方手动添加。{state.cliScannedAt?' 上次扫描 '+timeOf(state.cliScannedAt):''}</p>
   {enabledTools.map(toolRow)}
   {otherTools.length>0&&<details className="cli-tool-more"><summary>已发现但未启用（{otherTools.length}）</summary>{otherTools.map(toolRow)}</details>}
   <div className="cli-tool-add">
    <input aria-label="命令名" value={custom.command} placeholder="命令名，如 devops-token" onChange={e=>setCustom({...custom,command:e.target.value})}/>
    <input aria-label="程序路径" value={custom.path} placeholder="绝对路径（可选）" onChange={e=>setCustom({...custom,path:e.target.value})}/>
    <input aria-label="用途说明" value={custom.description} placeholder="用途说明" onChange={e=>setCustom({...custom,description:e.target.value})}/>
    <button className="secondary" disabled={!custom.command.trim()} onClick={addCustom}><Plus size={14}/>添加</button>
   </div>
   {toolsDirty&&<div className="system-prompt-actions"><button className="secondary" onClick={()=>setToolDraft(cli)}>撤销修改</button><button className="primary" onClick={()=>void call('cli:save',toolDraft).catch(onError)}>保存</button></div>}
  </div>
 </section>
 {editing&&<McpEditor draft={editing} tools={tools} onCancel={()=>setEditing(null)} onSave={saveDraft}/>}
 </main>;
}
