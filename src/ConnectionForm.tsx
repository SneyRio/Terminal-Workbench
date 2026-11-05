import {useState} from 'react';
import type {Account} from './types';
export function ConnectionForm({account,saving,onSave,onCancel}:{account?:Account;saving:boolean;onSave:(input:any)=>void;onCancel?:()=>void}){
 const c=account?.connection;
 const [name,setName]=useState(account?.name||''),[providerName,setProvider]=useState(c?.providerName||''),[baseUrl,setUrl]=useState(c?.baseUrl||''),[apiKey,setKey]=useState(''),[authType,setAuth]=useState(c?.authType||'bearer'),[modelText,setModels]=useState(c?.models.join('\n')||''),[model,setModel]=useState(c?.defaultModel||'');
 const models=[...new Set(modelText.split(/[\n,，]/).map(m=>m.trim()).filter(Boolean))],selected=models.includes(model)?model:models[0]||'';
 return <form onSubmit={e=>{e.preventDefault();onSave({name,providerName,baseUrl,apiKey,authType,models,defaultModel:selected,provider:'custom'});}} className="custom-connection-form">
 {!account&&<label className="field">连接别名<input aria-label="自定义连接别名" required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：团队开发"/></label>}
 <div className="connection-form-grid"><label className="field">供应商名称<input aria-label="供应商名称" required maxLength={80} value={providerName} onChange={e=>setProvider(e.target.value)} placeholder="自定义供应商或网关名称"/></label><label className="field">认证方式<select aria-label="供应商认证方式" value={authType} onChange={e=>setAuth(e.target.value)}><option value="bearer">Bearer Token</option><option value="api-key">API Key（x-api-key）</option></select></label></div>
 <label className="field">Anthropic 兼容服务地址<input aria-label="供应商服务地址" type="url" required value={baseUrl} onChange={e=>setUrl(e.target.value)} placeholder="https://gateway.example.com/anthropic"/></label>
 <label className="field">API Key / Token{account&&'（留空保留现有密钥）'}<input aria-label="供应商密钥" type="password" autoComplete="new-password" required={!account} value={apiKey} onChange={e=>setKey(e.target.value)} placeholder={account?'已加密保存，留空不修改':'仅加密保存在此设备'}/></label>
 <label className="field">模型 ID 列表<textarea aria-label="供应商模型列表" required rows={3} value={modelText} onChange={e=>setModels(e.target.value)} placeholder={'每行一个模型 ID，也可用逗号分隔'}/></label>
 <label className="field">默认模型<select aria-label="供应商默认模型" required value={selected} onChange={e=>setModel(e.target.value)}>{!models.length&&<option value="">请先填写模型 ID</option>}{models.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
 <p className="muted">使用 Anthropic Messages 兼容接口。模型名称以服务方实际 ID 为准；保存不发送模型请求，检查配置不代表推理成功。更改在新启动或恢复的会话中生效。</p>
 <footer className="modal-footer">{onCancel&&<button type="button" className="secondary" disabled={saving} onClick={onCancel}>取消</button>}<button className="primary" disabled={saving||(!account&&!name.trim())||!selected}>{saving?'正在保存…':account?'保存供应商配置':'添加自定义连接'}</button></footer>
 </form>;
}
