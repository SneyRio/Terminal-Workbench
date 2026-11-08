import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import Papa from 'papaparse';
import { ArrowSquareOut, ArrowsOut, ArrowsIn, CaretDown, CaretRight, Check, Code, FileText, FloppyDisk, Folder, FolderOpen, GitBranch, X, ArrowsClockwise, Trash } from '@phosphor-icons/react';
import { call, nameOf } from './api';
import {FileIcon} from './FileIcon';
import {GitPanel,gitStatusKind,gitStatusLabel} from './GitPanel';
import type {GitSnapshot} from './GitPanel';
import type { AppState, Draft, FileEntry, OpenFile, Workspace } from './types';

type Decoration={kind:string;label:string};
function Tree({ workspace, path, label, root, onOpen, onDelete, refresh, decorations }: { workspace: Workspace; path: string; label: string; root?: number; onOpen: (path: string) => void; onDelete:(path:string)=>void; refresh:number; decorations:Record<string,Decoration> }) {
  const decoration=decorations[path];
  const [open, setOpen] = useState(root === 1), [entries, setEntries] = useState<FileEntry[]>([]), [error, setError] = useState('');
  useEffect(() => { let disposed=false;if (open) void call<FileEntry[]>('files:list', workspace.id, path).then(data=>{if(!disposed){setEntries(data);setError('');}}).catch(e=>{if(!disposed)setError(e.message);});return()=>{disposed=true;}; }, [open, path, workspace.id,refresh]);
  const remove=(file:string,name:string)=><button className="tree-delete icon-button tiny" aria-label={'删除 '+name} title="移入系统回收站" onClick={()=>onDelete(file)}><Trash size={13}/></button>;
  return <div className="tree-node"><div className="tree-entry"><button className={'tree-row folder-row '+(decoration?'git-'+decoration.kind+' ':'')+(root?'tree-root':'')} onClick={() => setOpen(!open)} title={path+(decoration?' · '+decoration.label:'')}>{open ? <CaretDown size={12}/> : <CaretRight size={12}/>} {root ? <span className="project-number">{root}</span> : open ? <FolderOpen size={15} className="folder-icon"/> : <Folder size={15} className="folder-icon"/>}<span className="truncate">{label}</span>{decoration&&<small className="tree-git-label">{decoration.kind==='conflict'?'!':'●'}</small>}{root === 1 && <small className="badge">主项目</small>}</button>{!root&&remove(path,label)}</div>
    {open && <div className="tree-children">{error && <p className="inline-error">{error}</p>}{entries.map(e => e.directory && !e.symlink ? <Tree key={e.path} workspace={workspace} path={e.path} label={e.name} onOpen={onOpen} onDelete={onDelete} refresh={refresh} decorations={decorations}/> : <div key={e.path} className="tree-entry"><button className={'tree-row file-row '+(decorations[e.path]?'git-'+decorations[e.path].kind:'')} onClick={() => onOpen(e.path)} title={e.path+(decorations[e.path]?' · '+decorations[e.path].label:'')}><FileIcon name={e.name}/><span className="truncate">{e.name}{e.symlink ? ' ↗' : ''}</span>{decorations[e.path]&&<small className="tree-git-label">{decorations[e.path].label}</small>}</button>{!e.symlink&&remove(e.path,e.name)}</div>)}</div>}
  </div>;
}

function CodeEditor({ text, path, dark, onChange }: { text: string; path: string; dark: boolean; onChange: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null); const editor = useRef<EditorView | null>(null); const changeRef = useRef(onChange); changeRef.current = onChange;
  const theme=useRef(new Compartment());
  const value = useRef(text); value.current = text;
  useEffect(() => {
    const extension = /\.md$/i.test(path) ? markdown() : /\.json$/i.test(path) ? json() : /\.py$/i.test(path) ? python() : javascript({ typescript: true, jsx: true });
    const view = new EditorView({ doc: value.current, parent: host.current!, extensions: [basicSetup, extension, theme.current.of(dark ? [oneDark] : []), EditorState.lineSeparator.of(value.current.includes('\r\n')?'\r\n':'\n'), EditorView.lineWrapping, EditorView.updateListener.of(update => { if (update.docChanged) changeRef.current(update.state.sliceDoc()); }), EditorView.theme({ '&': { height: '100%', fontSize: '13px' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'Menlo, monospace' }, '.cm-content': { padding: '16px 0' }, '.cm-gutters': { background: 'transparent', border: 'none' } })] });
    editor.current = view; return () => { view.destroy(); editor.current = null; };
  }, [path]);
  useEffect(()=>{editor.current?.dispatch({effects:theme.current.reconfigure(dark?[oneDark]:[])});},[dark]);
  useEffect(() => { const view = editor.current; if (view && view.state.sliceDoc() !== text) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); }, [text]);
  return <div className="code-editor" ref={host}/>;
}

function JsonTree({ value, label, depth=0 }: { value: any; label?: string; depth?: number }) {
  if(value===null || typeof value!=='object')return <div className="json-leaf">{label!==undefined&&<strong>{label}: </strong>}<span>{JSON.stringify(value)}</span></div>;
  const entries=Object.entries(value);
  return <details open={depth<2} className="json-tree"><summary>{label!==undefined?label+': ':''}{Array.isArray(value)?`Array (${entries.length})`:`Object (${entries.length})`}</summary><div>{entries.slice(0,1000).map(([key,v])=><JsonTree key={key} value={v} label={key} depth={depth+1}/>)}</div></details>;
}

function localLinkTarget(href:string,file:string){
  const normalized=file.replaceAll('\\','/'),base=new URL('file:///');
  if(normalized.startsWith('//')){const slash=normalized.indexOf('/',2);base.hostname=normalized.slice(2,slash);base.pathname=normalized.slice(slash);}else base.pathname=normalized.startsWith('/')?normalized:'/'+normalized;
  const target=new URL(href,base);if(target.protocol!=='file:')throw new Error('仅支持工作空间内的本地文件');
  const decoded=decodeURIComponent(target.pathname);return target.hostname?'//'+target.hostname+decoded:decoded.replace(/^\/(?=[A-Za-z]:\/)/,'');
}

function Preview({ file, text, workspace, onOpen }: { file: OpenFile; text: string; workspace: Workspace; onOpen: (path:string)=>void }) {
  const [markdownHtml,setMarkdownHtml]=useState('');
  useEffect(()=>{
    if(!/\.md$/i.test(file.path))return;
    let disposed=false;
    const renderer=new marked.Renderer();
    const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    renderer.code=({text,lang})=>`<pre><code class="hljs">${lang&&hljs.getLanguage(lang)?hljs.highlight(text,{language:lang}).value:escape(text)}</code></pre>`;
    renderer.image=({href,text})=>`<img data-local-image="${escape(href)}" alt="${escape(text)}"/>`;
    const safe=DOMPurify.sanitize(marked.parse(text,{async:false,renderer}) as string,{FORBID_TAGS:['style','iframe','script','object','embed'],FORBID_ATTR:['style','src','srcset']});
    setMarkdownHtml(safe);
    const doc=new DOMParser().parseFromString(safe,'text/html');
    void Promise.all([...doc.querySelectorAll('img[data-local-image]')].slice(0,30).map(async img=>{
      const href=img.getAttribute('data-local-image')||'';
      if(/^(https?:|data:|javascript:|\/\/)/i.test(href)){img.replaceWith(doc.createTextNode(`[图片未自动加载：${img.getAttribute('alt')||href}]`));return;}
      try{
        const target=localLinkTarget(href,file.path);
        const image=await call<OpenFile>('files:read',workspace.id,target);
        if(image.image)img.setAttribute('src',image.image);else img.replaceWith(doc.createTextNode('[图片无法预览]'));
      }catch{img.replaceWith(doc.createTextNode('[图片不在可访问的工作空间内]'));}
    })).then(()=>{if(!disposed)setMarkdownHtml(DOMPurify.sanitize(doc.body.innerHTML,{FORBID_TAGS:['style','iframe','script','object','embed'],FORBID_ATTR:['style','srcset']}));});
    return()=>{disposed=true;};
  },[file.path,text,workspace.id]);
  if (file.image) return <div className="image-preview"><img src={file.image} alt={nameOf(file.path)}/><small>{(file.size / 1024).toFixed(1)} KiB</small></div>;
  if (/\.md$/i.test(file.path)) {
    return <article className="markdown-preview" onClick={e => { const a = (e.target as HTMLElement).closest('a'); if (a) { e.preventDefault(); const href=a.getAttribute('href')||''; if(/^https?:/i.test(href))void call('external:open',href);else if(href&&!href.startsWith('#'))try{onOpen(localLinkTarget(href,file.path));}catch{} } }} dangerouslySetInnerHTML={{ __html: markdownHtml }}/>;
  }
  if (/\.(csv|tsv)$/i.test(file.path)) {
    const rows = Papa.parse<string[]>(text, { delimiter: /\.tsv$/i.test(file.path) ? '\t' : ',', preview: 501 }).data;
    return <div className="csv-preview"><small>已加载前 {Math.min(rows.length, 500)} 行 · 只读预览</small><table><tbody>{rows.slice(0,500).map((row,i) => <tr key={i}>{row.map((cell,j) => i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
  }
  let formatted = text, error = '';
  if (/\.json$/i.test(file.path)) try { return <div className="json-preview"><JsonTree value={JSON.parse(text)}/></div>; } catch (e) { error = String(e); }
  const highlight = hljs.highlightAuto(formatted.slice(0,200000),['javascript','typescript','python','bash','json','xml','css','sql','yaml','plaintext']).value;
  return <div className="text-preview">{error && <p className="inline-error">格式无效，显示原文：{error}</p>}<pre><code dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlight) }}/></pre></div>;
}

interface Buffer { file: OpenFile; text: string; baseText: string; mode: 'edit' | 'preview'; conflict?: { disk: string; version: string }; saving?: boolean; error?: string }
export function FilePanel({ workspace, state, dark, onError, maximized, onMaximize, active }: { workspace: Workspace; state: AppState; dark: boolean; onError: (e: unknown) => void; maximized:boolean; active:boolean; onMaximize:(value:boolean)=>void }) {
  const runningSessions=state.sessions.filter(s=>s.workspaceId===workspace.id&&['running','busy','idle','starting'].includes(s.status)).length;
  const splitRef=useRef<HTMLDivElement>(null);
  const [treeVersion,setTreeVersion]=useState(0);const deleting=useRef(false);
  const contains=(parent:string,file:string)=>{const normalize=(p:string)=>navigator.platform.startsWith('Win')?p.replaceAll('\\','/').toLowerCase():p;const a=normalize(parent),b=normalize(file);return a===b||b.startsWith(a+'/');};
  const [treeRatio,setTreeRatio]=useState(workspace.previewSplit??0.43);
  const ratioRef=useRef(treeRatio);
  const dragRef=useRef<{y:number;ratio:number;height:number}|null>(null);
  useEffect(()=>{ratioRef.current=workspace.previewSplit??0.43;setTreeRatio(ratioRef.current);},[workspace.id]);
  const clampRatio=(ratio:number)=>{
    const height=splitRef.current?.clientHeight||600;
    const min=Math.max(.15,Math.min(.5,96/height)),max=Math.min(.75,Math.max(min,(height-186)/height));
    return Math.min(max,Math.max(min,ratio));
  };
  const updateRatio=(ratio:number)=>{ratioRef.current=clampRatio(ratio);setTreeRatio(ratioRef.current);};
  const saveRatio=()=>void call('workspace:preview-layout',workspace.id,ratioRef.current).catch(onError);
  const endDrag=()=>{if(dragRef.current){dragRef.current=null;saveRatio();}};
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [selected, setSelected] = useState(''), [section, setSection] = useState<'files' | 'git'>('files');
  const projectKey=workspace.projects.map(p=>p.path).join('\0');
  const [gitSnapshots,setGitSnapshots]=useState<Record<string,GitSnapshot>>({});
  useEffect(()=>{
    if(!active||section!=='files')return;let disposed=false,busy=false;
    const refresh=async()=>{if(busy)return;busy=true;try{const entries=await Promise.all(workspace.projects.map(async project=>[project.path,await call<GitSnapshot>('git:decorations',workspace.id,project.path).catch(()=>null)] as const));if(!disposed)setGitSnapshots(Object.fromEntries(entries.filter(([,data])=>data)) as Record<string,GitSnapshot>);}finally{busy=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>{disposed=true;clearInterval(timer);};
  },[active,section,workspace.id,projectKey,treeVersion]);
  const decorations=useMemo(()=>{
    const result:Record<string,Decoration>={};
    for(const [directory,snapshot] of Object.entries(gitSnapshots))for(const entry of snapshot.entries){
      const kind=gitStatusKind(entry);result[entry.absolutePath]={kind,label:gitStatusLabel(entry)};
      const sep=directory.includes('\\')?'\\':'/';let parent=entry.absolutePath.slice(0,entry.absolutePath.lastIndexOf(sep));
      while(parent===directory||parent.startsWith(directory+sep)){const previous=result[parent]?.kind;const combined=kind==='conflict'||previous==='conflict'?'conflict':previous&&previous!==kind?'modified':kind;result[parent]={kind:combined,label:combined==='conflict'?'目录内存在冲突':'目录内有文件变更'};if(parent===directory)break;parent=parent.slice(0,parent.lastIndexOf(sep));}
    }return result;
  },[gitSnapshots]);
  const buffersRef = useRef(buffers); buffersRef.current = buffers;
  const draftTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const open = async (path: string) => {
    setSection('files'); setSelected(path);
    if (buffersRef.current[path]) return;
    try {
      const file = await call<OpenFile>('files:read', workspace.id, path);
      const draft = state.drafts[file.path];
      setSelected(file.path);
      setBuffers(bs => ({ ...bs, [file.path]: { file, text: draft?.text ?? file.text, baseText: draft?.baseText ?? file.text, mode: file.image || /\.(md|csv|tsv|json)$/i.test(path) ? 'preview' : 'edit', ...(draft && draft.version !== file.version ? { conflict: { disk: file.text, version: file.version } } : {}) } }));
    } catch (e) { onError(e); }
  };
  const setText = (path: string, text: string) => {
    const b=buffersRef.current[path];if(!b)return;
    buffersRef.current={...buffersRef.current,[path]:{...b,text}};
    setBuffers(bs => ({ ...bs, [path]: { ...bs[path], text } }));
    const draft: Draft | null = text === b.baseText ? null : { text, baseText: b.baseText, version: b.file.version, workspaceId: workspace.id, time: Date.now() };
    void call('draft:save', path, draft).catch(onError);
  };
  const save = async (path: string) => {
    const b = buffersRef.current[path]; if (!b || b.file.image || b.file.binary || b.file.tooLarge) return;
    if(b.conflict){onError(new Error('磁盘内容已变化，请先处理冲突再保存。'));return false;}
    clearTimeout(draftTimers.current[path]);
    try {
      const result = await call('files:save', workspace.id, path, b.text, b.file.version);
      if (result.conflict) { setBuffers(bs => ({ ...bs, [path]: { ...bs[path], conflict: { disk: result.disk, version: result.version } } })); return false; }
      const latest=buffersRef.current[path];
      if(latest)buffersRef.current={...buffersRef.current,[path]:{...latest,baseText:b.text,file:{...latest.file,version:result.version},conflict:undefined}};
      setBuffers(bs => ({ ...bs, [path]: { ...bs[path], baseText: b.text, file: { ...bs[path].file, version: result.version }, conflict: undefined } }));
      await call('draft:save', path, latest&&latest.text!==b.text?{text:latest.text,baseText:b.text,version:result.version,workspaceId:workspace.id,time:Date.now()}:null);
      return true;
    } catch (e) { onError(e); return false; }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && (e.target as HTMLElement)?.closest('.file-panel')) { e.preventDefault(); if(e.shiftKey)for(const [path,b]of Object.entries(buffersRef.current)){if(b.text!==b.baseText)void save(path);}else if(selected)void save(selected); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [selected, workspace.id]);
  useEffect(()=>{
    if(!active||section!=='files'||!selected)return;
    let disposed=false,busy=false;
    const refresh=async()=>{
      if(disposed||busy||document.hidden)return;
      const original=buffersRef.current[selected];if(!original||original.file.image||original.file.binary||original.file.tooLarge)return;
      busy=true;
      try{
        const fresh=await call<OpenFile&{unchanged?:boolean}>('files:read-if-changed',workspace.id,selected,original.file.fingerprint);
        if(disposed)return;
        if(fresh.unchanged){if(original.error)setBuffers(bs=>({...bs,[selected]:{...bs[selected],error:undefined}}));return;}
        setBuffers(bs=>{
          const b=bs[selected];if(!b)return bs;
          if(fresh.version===b.file.version)return {...bs,[selected]:{...b,error:undefined,file:{...b.file,fingerprint:fresh.fingerprint,writable:fresh.writable}}};
          return {...bs,[selected]:b.text!==b.baseText?{...b,error:undefined,file:{...b.file,fingerprint:fresh.fingerprint},conflict:{disk:fresh.text,version:fresh.version}}:{...b,file:fresh,text:fresh.text,baseText:fresh.text,error:undefined}};
        });
      }catch(error){if(!disposed)setBuffers(bs=>bs[selected]?({...bs,[selected]:{...bs[selected],error:'文件不可读取，显示保留内容：'+(error instanceof Error?error.message:String(error))}}):bs);}
      finally{busy=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),3000);
    const visible=()=>{if(!document.hidden)void refresh();};window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[selected,workspace.id,active,section]);

  const close = async (path: string) => {
    const b = buffers[path];
    if (b.text !== b.baseText) { const choice=await call<number>('files:close-choice',nameOf(path));if(choice===0)return;if(choice===1){if(!(await save(path)))return;const latest=buffersRef.current[path];if(latest&&latest.text!==latest.baseText){onError(new Error('保存过程中有新的修改，标签保持打开。'));return;}} }
    clearTimeout(draftTimers.current[path]); await call('draft:save', path, null);
    setBuffers(bs => { const next = { ...bs }; delete next[path]; return next; });
    if (selected === path) setSelected(Object.keys(buffers).find(p => p !== path) || '');
    if(Object.keys(buffersRef.current).length===1&&maximized)onMaximize(false);
  };
  const removeFile=async(path:string)=>{
    if(deleting.current)return;deleting.current=true;
    try{
      if(Object.entries(buffersRef.current).some(([file,b])=>contains(path,file)&&b.text!==b.baseText))throw new Error('其中有未保存的编辑内容，请先保存或关闭并处理草稿，再删除');
      const result=await call<{path:string}|null>('files:trash',workspace.id,path);if(!result)return;
      const remaining=Object.fromEntries(Object.entries(buffersRef.current).filter(([file])=>!contains(path,file)&&!contains(result.path,file)));
      buffersRef.current=remaining;setBuffers(remaining);if(!remaining[selected])setSelected(Object.keys(remaining)[0]||'');
      if(!Object.keys(remaining).length&&maximized)onMaximize(false);setTreeVersion(v=>v+1);
    }catch(error){onError(error);}finally{deleting.current=false;}
  };
  const b = buffers[selected];
  return <aside className={'file-panel '+(maximized?'content-maximized':'')} aria-label="文件与编辑器">
    <div className="panel-tabs"><button className={section === 'files' ? 'active' : ''} onClick={() => setSection('files')}><FolderOpen size={16}/>文件</button><button className={section === 'git' ? 'active' : ''} onClick={() => setSection('git')}><GitBranch size={16}/>Git 变更</button></div>
    {section === 'git' ? <GitPanel workspace={workspace} active={active} runningSessions={runningSessions} onOpen={path=>void open(path)} onSnapshot={(directory,data)=>setGitSnapshots(previous=>({...previous,[directory]:data}))} onError={onError}/> : <div className="file-content" ref={splitRef}>
      <div className="tree-section" style={{flex:Object.keys(buffers).length?'0 0 '+(treeRatio*100)+'%':'1 1 auto'}}><div className="section-label">工作空间项目 <small>{workspace.projects.length}</small><button className="icon-button tiny" aria-label="刷新文件树" onClick={()=>setTreeVersion(v=>v+1)}><ArrowsClockwise size={14}/></button></div><p className="panel-hint">第一个项目作为 CLI 启动目录</p>{workspace.projects.map((p,i) => <Tree key={p.path} workspace={workspace} path={p.path} label={p.name} root={i+1} onOpen={path => void open(path)} onDelete={path=>void removeFile(path)} refresh={treeVersion} decorations={decorations}/>)}</div>
      {Object.keys(buffers).length>0&&<div className="preview-resize-handle" role="separator" tabIndex={0} aria-label="调整文件内容高度" aria-orientation="horizontal" aria-valuemin={15} aria-valuemax={75} aria-valuenow={Math.round(treeRatio*100)} title="上下拖动调整内容高度；双击恢复默认" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);dragRef.current={y:e.clientY,ratio:ratioRef.current,height:splitRef.current?.clientHeight||600};}} onPointerMove={e=>{const drag=dragRef.current;if(drag)updateRatio(drag.ratio+(e.clientY-drag.y)/drag.height);}} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onDoubleClick={()=>{updateRatio(.43);saveRatio();}} onKeyDown={e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();updateRatio(e.key==='Home'?.15:e.key==='End'?.75:ratioRef.current+(e.key==='ArrowUp'?-.03:.03));saveRatio();}}}><span/></div>}
      {Object.keys(buffers).length > 0 && <div className="editor-area"><div className="file-tabs">{Object.entries(buffers).map(([path, item]) => <button className={selected === path ? 'active' : ''} key={path} onClick={() => setSelected(path)} title={path}><FileText size={13}/>{nameOf(path)}{item.text !== item.baseText && <span className="dirty-dot"/>}<span role="button" aria-label={'关闭 ' + nameOf(path)} onClick={e => { e.stopPropagation(); void close(path); }}><X size={12}/></span></button>)}</div>
      {b && <><div className="editor-toolbar"><div className="segmented small"><button className={b.mode === 'edit' ? 'active' : ''} disabled={!!(b.file.image || b.file.binary || b.file.tooLarge)} onClick={() => setBuffers(bs => ({ ...bs, [selected]: { ...b, mode:'edit' } }))}><Code size={13}/>编辑</button><button className={b.mode === 'preview' ? 'active' : ''} onClick={() => setBuffers(bs => ({ ...bs, [selected]: { ...b, mode:'preview' } }))}>预览</button></div><span className="spacer"/>{b.text !== b.baseText && <small className="unsaved">未保存</small>}<button className="icon-button" title={navigator.platform.startsWith('Win')?'保存文件 Ctrl+S':'保存文件 ⌘S'} aria-label="保存文件" disabled={b.text === b.baseText || !!b.conflict} onClick={() => void save(selected)}><FloppyDisk size={16}/></button><button className="icon-button" aria-label={maximized?'还原文件内容':'放大文件内容'} title={maximized?'还原文件内容':'放大至中间和右侧区域'} aria-pressed={maximized} onClick={()=>onMaximize(!maximized)}>{maximized?<ArrowsIn size={16}/>:<ArrowsOut size={16}/>}</button><button className="icon-button" aria-label="在系统应用打开" title="按文件类型在系统默认应用中打开" onClick={() => void call('files:external', workspace.id, selected).catch(onError)}><ArrowSquareOut size={15}/></button></div>
      <div className="file-path" title={selected}>{selected.replace(workspace.projects.find(p => selected.startsWith(p.path))?.path || '', '…')}</div>
      {b.error&&<p className="inline-error">{b.error}</p>}{b.conflict && <div className="conflict-box"><strong>磁盘文件已变化</strong><p>CLI 或其他编辑器修改了此文件。你的草稿已保留。</p><details><summary>比较磁盘内容</summary><pre>{b.conflict.disk}</pre></details><button onClick={() => { if (!confirm('放弃当前草稿并加载磁盘版本？')) return; setBuffers(bs => ({ ...bs, [selected]: { ...b, text:b.conflict!.disk, baseText:b.conflict!.disk, file:{...b.file,version:b.conflict!.version},conflict:undefined } })); void call('draft:save', selected, null); }}>加载磁盘版本</button><button onClick={() => { setBuffers(bs => ({ ...bs, [selected]: { ...b, baseText:b.conflict!.disk, file:{...b.file,version:b.conflict!.version},conflict:undefined } })); }}>保留草稿，手动合并后保存</button></div>}
      {b.file.tooLarge || b.file.binary ? <div className="empty-note">{b.file.tooLarge ? '文件超出完整预览限额' : '此文件不是可编辑的 UTF-8 文本'}<button className="secondary" onClick={() => void call('files:external', workspace.id, selected).catch(onError)}>在系统应用打开</button></div> : b.mode === 'edit' ? <CodeEditor text={b.text} path={selected} dark={dark} onChange={text => setText(selected,text)}/> : <><div className="preview-label">{b.text !== b.baseText ? '未保存预览' : '文件预览'}</div><Preview file={b.file} text={b.text} workspace={workspace} onOpen={path=>void open(path)}/></>}
      </> }</div>}
    </div>}
  </aside>;
}
