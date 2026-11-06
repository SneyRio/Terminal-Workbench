import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { call } from './api';
import type { Session } from './types';
import '@xterm/xterm/css/xterm.css';

export function TerminalPane({ session, active, dark, fontSize, fontFamily='JetBrains Mono',lineHeight=1.3,onFocus }: { session: Session; active: boolean; dark: boolean; fontSize: number; fontFamily?:string;lineHeight?:number; onFocus: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const resizeRef=useRef<(()=>void)|null>(null);
  const windows=navigator.platform.startsWith('Win');
  const family=(name:string)=>name==='JetBrains Mono'?'"Accountor JetBrains Mono", "PingFang SC", "Microsoft YaHei", monospace':name==='system'?(windows?'Consolas, "Cascadia Code", monospace':'"SFMono-Regular", Menlo, Monaco, Consolas, monospace'):name+', monospace';
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const darkTheme = { background: '#00000000', foreground: '#e4e4ee', cursor: '#b1a5ff', selectionBackground: '#b6a2ee', selectionForeground:'#15131f', selectionInactiveBackground:'#9383c2', black:'#30303c', red:'#ef8d91',green:'#a0d5ae',yellow:'#dfcf97',blue:'#a3b6ee',magenta:'#c9adea',cyan:'#91d3d7',white:'#eeedf5' };
  const lightTheme = { background: '#00000000', foreground: '#30313d', cursor: '#6255ac', selectionBackground: '#36549a', selectionForeground:'#ffffff', selectionInactiveBackground:'#52658e', black:'#373843',red:'#ae424b',green:'#3c7958',yellow:'#8f6d21',blue:'#506dab',magenta:'#8753a7',cyan:'#2c7e86',white:'#ededf2' };
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ allowTransparency: true, cursorBlink: true, fontFamily: family(fontFamily), fontSize, lineHeight, scrollback: 10000, theme: dark ? darkTheme : lightTheme });
    terminal.current = term;
    const fit = new FitAddon(); const find = new SearchAddon(); search.current = find;
    term.loadAddon(fit); term.loadAddon(find);
    term.loadAddon(new WebLinksAddon((_e, url) => { void call('external:open', url); }));
    term.open(host.current);
    const syncViewport=()=>{if(host.current){host.current.dataset.viewport=String(term.buffer.active.viewportY);host.current.dataset.scrollback=String(term.buffer.active.baseY);host.current.dataset.bufferMode=term.buffer.active.type;}};
    const scrollState=term.onScroll(syncViewport),renderState=term.onRender(syncViewport),selectionState=term.onSelectionChange(()=>{if(host.current)host.current.dataset.hasSelection=String(term.hasSelection());});
    syncViewport();
    const copy=()=>{
      if(term.hasSelection())void call('clipboard:write',term.getSelection());
      else if(session.kind==='claude'&&term.buffer.active.type==='alternate')void call('terminal:input',session.id,'\x1b[99;6u');
    };
    const pane=host.current.closest('.terminal-pane')!;
    pane.addEventListener('accountor:terminal-copy',copy);
    const bottom=()=>{if(session.kind==='claude'&&term.buffer.active.type==='alternate')void call('terminal:input',session.id,'\x1b[1;5F');else term.scrollToBottom();};
    pane.addEventListener('accountor:terminal-bottom',bottom);
    const clipboardOsc=term.parser.registerOscHandler(52,data=>{
      const split=data.indexOf(';'),target=data.slice(0,split),encoded=data.slice(split+1);
      if(split<0||!['','c'].includes(target)||encoded==='?'||encoded.length>3*1024*1024)return true;
      try{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);void call('clipboard:write',text).catch(()=>{});}catch{}
      return true;
    });
    let disposed = false, ready = false; const pending: { data: string; seq: number }[] = [];
    const off = window.accountor?.on('terminal:data', event => { if (event.id !== session.id) return; if (!ready) pending.push(event); else term.write(event.data); });
    void call('terminal:buffer', session.id).then((snapshot: { data: string; seq: number } | string) => {
      if (disposed) return;
      const seq = typeof snapshot === 'string' ? 0 : snapshot.seq;
      term.write(typeof snapshot === 'string' ? snapshot : snapshot.data);
      for (const event of pending) if (event.seq > seq) term.write(event.data);
      ready = true;
    });
    const input = term.onData(data => { void call('terminal:input', session.id, data).catch(() => {}); });
    const resize = () => { if (!host.current?.clientWidth || !host.current?.clientHeight) return; try { fit.fit(); void call('terminal:resize', session.id, term.cols, term.rows); } catch {} };
    resizeRef.current=resize;
    const observer = new ResizeObserver(resize); observer.observe(host.current);
    term.attachCustomKeyEventHandler(event => {
      if((event.metaKey||event.ctrlKey&&(event.shiftKey||windows&&term.hasSelection()))&&event.key.toLowerCase()==='c'){if(event.type==='keydown')copy();return false;}
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { if (event.type === 'keydown') setSearching(true); return false; } return true;
    });
    requestAnimationFrame(resize);
    return () => { disposed = true; off?.(); input.dispose(); observer.disconnect(); clipboardOsc.dispose();scrollState.dispose();renderState.dispose();selectionState.dispose();pane.removeEventListener('accountor:terminal-copy',copy);pane.removeEventListener('accountor:terminal-bottom',bottom);term.dispose(); terminal.current = null;resizeRef.current=null; };
  }, [session.id]);
  useEffect(() => { if (terminal.current) { terminal.current.options.theme = dark ? darkTheme : lightTheme; terminal.current.options.fontSize = fontSize;terminal.current.options.fontFamily=family(fontFamily);terminal.current.options.lineHeight=lineHeight;requestAnimationFrame(()=>resizeRef.current?.()); } }, [dark, fontSize,fontFamily,lineHeight]);
  useEffect(() => { if (active) requestAnimationFrame(() => terminal.current?.focus()); }, [active]);
  return <div className="terminal-pane" onMouseDown={onFocus}>
    {searching && <div className="terminal-search"><MagnifyingGlass size={16}/><input autoFocus aria-label="终端搜索" placeholder="搜索终端输出" value={query} onChange={e => { setQuery(e.target.value); search.current?.findNext(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') search.current?.findNext(query); if (e.key === 'Escape') setSearching(false); }}/><button className="icon-button" title="关闭搜索" onClick={() => setSearching(false)}><X size={16}/></button></div>}
    <div className="terminal-host" ref={host}/>
  </div>;
}
