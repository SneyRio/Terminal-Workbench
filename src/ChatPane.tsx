import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { ArrowUp, CaretDown, CaretRight, ChatTeardropDots, CheckCircle, Circle, CircleNotch, Lightning, SidebarSimple, ShieldCheck, Stop, WarningCircle, X, XCircle } from '@phosphor-icons/react';
import { call } from './api';
import type { Session } from './types';

// ---- Conversation model, rebuilt from the CLI's stream-json events -------------------------------

type Ev = any;
interface ToolItem { kind: 'tool'; key: string; id: string; name: string; input: any; result?: { text: string; isError: boolean }; children: Item[]; start?: number; end?: number; stats?: { ms?: number; tokens?: number; tools?: number }; task?: { background: boolean; done: boolean; status?: string; summary?: string; end?: number } }
interface PermissionItem { kind: 'permission'; key: string; requestId: string; request: any; resolved?: string }
type Item =
  | { kind: 'user'; key: string; text: string; images: string[]; time?: number }
  | { kind: 'text'; key: string; text: string; time?: number }
  | { kind: 'thinking'; key: string; text: string }
  | ToolItem
  | PermissionItem
  | { kind: 'result'; key: string; ok: boolean; text: string; ms?: number; cost?: number; time?: number }
  | { kind: 'note'; key: string; text: string; tone?: 'error' | 'info' };

const resultText = (content: any): string => typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => c?.type === 'text' ? c.text : c?.type === 'image' ? '[图片]' : '').join('\n') : content == null ? '' : JSON.stringify(content);
const commandEcho = (text: string) => {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1];
  const out = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)?.[1];
  if (name) return name + (text.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ? ' ' + text.match(/<command-args>([^<]*)<\/command-args>/)![1] : '');
  if (out !== undefined) return out.trim() ? out : null;
  return undefined;
};

// The CLI wraps a sub-agent's report for the main model; show just the report.
const agentReport = (text: string) => {
  const start = text.indexOf('The report follows:');
  let body = start >= 0 ? text.slice(start + 'The report follows:'.length) : text;
  const tail = body.search(/\n\s*agentId: \S+/);
  if (tail >= 0) body = body.slice(0, tail);
  return body.trim() || text;
};

function buildItems(events: Ev[]) {
  const items: Item[] = [], tools = new Map<string, ToolItem>(), permissions = new Map<string, PermissionItem>();
  let model = '', picked = 'default', mode = 'auto', resumeMode = 'auto';
  const setMode = (m: string) => { mode = m; if (m !== 'plan') resumeMode = m; };
  const target = (parent?: string | null) => (parent && tools.get(parent)?.children) || items;
  events.forEach((e, i) => {
    const key = String(e.wb_seq ?? 'h' + i), time: number | undefined = e.wb_time;
    if (e.type === 'system' && e.subtype === 'init') { model = e.model || model; if (e.permissionMode) setMode(e.permissionMode); return; }
    if (e.type === 'wb_mode') { setMode(e.mode); return; }
    if (e.type === 'wb_model') { picked = e.model || 'default'; return; }
    // Sub-agent tasks report their own progress, also when they run in the background
    // and the Agent tool call itself has already returned.
    if (e.type === 'system' && /^task_(started|progress|notification)$/.test(e.subtype) && e.tool_use_id) {
      const t = tools.get(e.tool_use_id); if (!t) return;
      const task = t.task || (t.task = { background: false, done: false });
      if (e.subtype === 'task_started') task.background = !!e.is_backgrounded;
      const u = e.usage;
      if (u) t.stats = { ms: u.duration_ms ?? t.stats?.ms, tokens: u.total_tokens ?? t.stats?.tokens, tools: u.tool_uses ?? t.stats?.tools };
      if (e.subtype === 'task_notification') { task.done = true; task.status = e.status; task.summary = e.summary; task.end = time; }
      return;
    }
    if (e.type === 'system' && e.subtype === 'compact_boundary') { items.push({ kind: 'note', key, text: '上下文已压缩' }); return; }
    if (e.type === 'wb_note') { items.push({ kind: 'note', key, text: e.text }); return; }
    if (e.type === 'wb_error') { items.push({ kind: 'note', key, text: e.text, tone: 'error' }); return; }
    if (e.type === 'wb_exit') { items.push({ kind: 'note', key, text: '对话进程已结束' + (e.code ? '（退出码 ' + e.code + '）' : '') }); return; }
    if (e.type === 'control_request' && e.request?.subtype === 'can_use_tool') {
      const p: PermissionItem = { kind: 'permission', key, requestId: e.request_id, request: e.request };
      permissions.set(e.request_id, p); target(null).push(p); return;
    }
    if (e.type === 'wb_permission') { const p = permissions.get(e.request_id); if (p) p.resolved = e.behavior + (e.always ? ':always' : ''); return; }
    if (e.type === 'result') {
      const ok = e.subtype === 'success' && !e.is_error;
      items.push({ kind: 'result', key, ok, text: ok ? '' : (e.result || (e.subtype === 'error_during_execution' ? '已中断' : e.subtype || '出错')), ms: e.duration_ms, cost: e.total_cost_usd, time });
      return;
    }
    if (e.type === 'assistant') {
      (e.message?.content || []).forEach((b: any, j: number) => {
        const k = key + '.' + j, list = target(e.parent_tool_use_id);
        if (b.type === 'text' && b.text?.trim()) list.push({ kind: 'text', key: k, text: b.text, time });
        else if (b.type === 'thinking' && b.thinking?.trim()) list.push({ kind: 'thinking', key: k, text: b.thinking });
        else if (b.type === 'tool_use') { const t: ToolItem = { kind: 'tool', key: k, id: b.id, name: b.name, input: b.input || {}, children: [], start: time }; tools.set(b.id, t); list.push(t); }
      });
      return;
    }
    if (e.type === 'user') {
      if (e.isSynthetic) return;
      const content = e.message?.content;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      let text = ''; const images: string[] = [];
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const t = tools.get(b.tool_use_id);
          if (t) {
            t.result = { text: t.name === 'Agent' || t.name === 'Task' ? agentReport(resultText(b.content)) : resultText(b.content), isError: !!b.is_error }; t.end = time;
            const r = e.tool_use_result;
            if (r && typeof r === 'object' && (r.totalDurationMs || r.totalTokens || r.totalToolUseCount)) t.stats = { ms: r.totalDurationMs, tokens: r.totalTokens, tools: r.totalToolUseCount };
            if (r && typeof r === 'object' && /async|background/i.test(String(r.status || '')) && t.task && !t.task.done) t.task.background = true;
          }
        }
        else if (b.type === 'image') { const src = b.source; if (src?.type === 'base64' && /^image\/(png|jpeg|gif|webp)$/.test(src.media_type) && typeof src.data === 'string') images.push('data:' + src.media_type + ';base64,' + src.data); }
        else if (b.type === 'text') text += (text ? '\n' : '') + b.text;
      }
      if (e.parent_tool_use_id) return;
      if (/^\[Request interrupted/.test(text)) { items.push({ kind: 'note', key, text: '已中断' }); return; }
      const echo = commandEcho(text);
      if (echo === null) return;
      if (echo !== undefined) { items.push({ kind: 'note', key, text: echo }); return; }
      if (text.trim() || images.length) items.push({ kind: 'user', key, text, images, time });
    }
  });
  // resumeMode: where an approved plan goes on, i.e. the mode used before planning.
  return { items, model, picked, mode, resumeMode };
}

// ---- Rendering helpers -----------------------------------------------------------------------------

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => `<pre><code class="hljs">${lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang }).value : escape(text)}</code></pre>`;
const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, renderer, breaks: true }) as string, { FORBID_TAGS: ['style', 'iframe', 'script', 'object', 'embed', 'img'], FORBID_ATTR: ['style'] }), [text]);
  return <div className="chat-markdown" dangerouslySetInnerHTML={{ __html: html }} onClick={e => { const a = (e.target as HTMLElement).closest('a'); if (a) { e.preventDefault(); const href = a.getAttribute('href'); if (href && /^https?:/i.test(href)) void call('external:open', href); } }}/>;
});

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t?: number) => {
  if (!t) return '';
  const d = new Date(t), now = new Date(), hm = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  return d.toDateString() === now.toDateString() ? hm : (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '-') + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
};
const fullTime = (t?: number) => t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '';
const duration = (ms?: number) => {
  if (ms == null || !isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return ms + ' 毫秒';
  const s = ms / 1000; if (s < 60) return s.toFixed(1) + ' 秒';
  const m = Math.floor(s / 60); return m < 60 ? m + ' 分 ' + Math.round(s % 60) + ' 秒' : Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
};
const tokens = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n);
const Stamp = ({ time }: { time?: number }) => time ? <time className="chat-time" dateTime={new Date(time).toISOString()} title={fullTime(time)}>{clock(time)}</time> : null;
// Ticks once a second while something is running, so its elapsed time stays current.
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  return now;
}

const short = (s: any, n = 120) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const base = (p: string) => String(p || '').split(/[\\/]/).pop() || p;
function toolSummary(name: string, input: any): string {
  switch (name) {
    case 'Bash': return input.description ? input.description : short(input.command);
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return base(input.file_path || input.notebook_path);
    case 'Grep': case 'Glob': return short(input.pattern) + (input.path ? ' · ' + base(input.path) : '');
    case 'WebFetch': return short(input.url);
    case 'WebSearch': return short(input.query);
    case 'Agent': case 'Task': return (input.subagent_type ? input.subagent_type + ' · ' : '') + short(input.description);
    case 'Skill': return short(input.skill);
    case 'TodoWrite': return (input.todos?.length || 0) + ' 项任务';
    case 'ToolSearch': return short(input.query);
    default: { const v = Object.values(input || {}).find(v => typeof v === 'string'); return short(v ?? '', 80); }
  }
}
const toolLabel: Record<string, string> = { Bash: '运行命令', Read: '读取', Write: '写入', Edit: '编辑', NotebookEdit: '编辑笔记本', Grep: '搜索', Glob: '查找文件', WebFetch: '抓取网页', WebSearch: '网络搜索', Agent: '子 Agent', Task: '子 Agent', Skill: 'Skill', TodoWrite: '任务清单', ToolSearch: '加载工具', AskUserQuestion: '提问', ExitPlanMode: '提交方案', EnterPlanMode: '进入规划' };
const labelOf = (name: string) => toolLabel[name] || name.replace(/^mcp__([^_]+)__/, '$1 · ');

function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split('\n'), b = after.split('\n');
  return <pre className="chat-diff">{a.map((l, i) => <div key={'a' + i} className="del">- {l}</div>)}{b.map((l, i) => <div key={'b' + i} className="add">+ {l}</div>)}</pre>;
}
function ToolInput({ name, input }: { name: string; input: any }) {
  if (name === 'Bash') return <pre className="chat-code">$ {input.command}</pre>;
  if (name === 'Edit') return <>{(input.edits || [{ old_string: input.old_string, new_string: input.new_string }]).map((e: any, i: number) => <Diff key={i} before={e.old_string || ''} after={e.new_string || ''}/>)}</>;
  if (name === 'Write') return <pre className="chat-code">{String(input.content || '').slice(0, 6000)}</pre>;
  return <pre className="chat-code">{JSON.stringify(input, null, 2).slice(0, 6000)}</pre>;
}

function Todos({ todos }: { todos: any[] }) {
  return <ul className="chat-todos">{todos.map((t, i) => <li key={i} className={t.status}>{t.status === 'completed' ? <CheckCircle size={14} weight="fill"/> : t.status === 'in_progress' ? <CircleNotch size={14} className="spin"/> : <Circle size={14}/>}<span>{t.status === 'in_progress' ? t.activeForm || t.content : t.content}</span></li>)}</ul>;
}

function ToolCard({ item, renderChildren, onDetail }: { item: ToolItem; renderChildren: (items: Item[]) => any; onDetail: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const background = !!item.task?.background && !item.task.done;
  const running = !item.result || background, error = item.result?.isError || (item.task?.done && item.task.status !== 'completed');
  if (item.name === 'TodoWrite' && Array.isArray(item.input.todos)) return <div className="chat-tool todo"><div className="chat-tool-head static"><span className="chat-tool-name">任务清单</span></div><Todos todos={item.input.todos}/></div>;
  const agent = item.name === 'Agent' || item.name === 'Task';
  const now = useNow(running && !!item.start);
  // Sub-agents report their own total; other tools are timed from the tool call to its result.
  const until = (item.task?.background ? item.task.end : item.end) ?? (running ? now : undefined);
  const timing = item.stats?.ms != null ? duration(Math.round(item.stats.ms)) : item.start && until ? duration(Math.max(0, until - item.start)) : '';
  return <div className={'chat-tool' + (error ? ' error' : '') + (agent ? ' agent' : '')}>
    <button className="chat-tool-head" onClick={() => setOpen(!open)}>
      {open ? <CaretDown size={12}/> : <CaretRight size={12}/>}
      <span className="chat-tool-name">{labelOf(item.name)}</span>
      <span className="chat-tool-summary">{toolSummary(item.name, item.input)}</span>
      {agent && (item.stats?.tools ?? item.children.filter(c => c.kind === 'tool').length) > 0 && <small>{item.stats?.tools ?? item.children.filter(c => c.kind === 'tool').length} 次工具调用</small>}
      {agent && item.stats?.tokens ? <small>{tokens(item.stats.tokens)} tokens</small> : null}
      {background && <small className="chat-bg">后台</small>}
      {timing && <small className="chat-duration" title={(item.start ? '开始 ' + fullTime(item.start) : '') + (item.end ? '\n结束 ' + fullTime(item.end) : '')}>{running ? '已运行 ' : ''}{timing}</small>}
      {running ? <CircleNotch size={13} className="spin"/> : error ? <XCircle size={14} className="danger"/> : <CheckCircle size={14} className="ok"/>}
    </button>
    {agent && <button className="chat-detail-open" title="在右侧查看子代理详情" aria-label="查看子代理详情" onClick={() => onDetail(item.id)}><SidebarSimple size={14}/></button>}
    {open && <div className="chat-tool-body">
      <ToolInput name={item.name} input={item.input}/>
      {agent && item.children.length > 0 && <div className="chat-subagent">{renderChildren(item.children)}</div>}
      {/* A background sub-agent's tool result is only launch metadata; its report arrives with the task. */}
      {item.task?.background ? (item.task.done && <pre className={'chat-code result' + (error ? ' error' : '')}>{agentReport(item.task.summary || '') || '（无输出）'}</pre>)
        : item.result && <pre className={'chat-code result' + (error ? ' error' : '')}>{item.result.text.slice(0, 8000) || '（无输出）'}{item.result.text.length > 8000 ? '\n…（已截断）' : ''}</pre>}
    </div>}
  </div>;
}

// Sub-agent details in a side panel: its task, numbers, every step it took and what it returned.
const findTool = (list: Item[], id: string): ToolItem | undefined => {
  for (const item of list) if (item.kind === 'tool') { if (item.id === id) return item; const inner = findTool(item.children, id); if (inner) return inner; }
  return undefined;
};
function AgentDetail({ item, renderChildren, onClose, resizer }: { item: ToolItem; renderChildren: (items: Item[]) => any; onClose: () => void; resizer: any }) {
  const background = !!item.task?.background;
  const running = !item.result || (background && !item.task!.done), now = useNow(running && !!item.start);
  const until = (background ? item.task!.end : item.end) ?? (running ? now : undefined);
  const failed = item.result?.isError || (item.task?.done && item.task.status !== 'completed');
  const ms = item.stats?.ms ?? (item.start && until ? until - item.start : undefined);
  const tools = item.stats?.tools ?? item.children.filter(c => c.kind === 'tool').length;
  return <aside className="chat-detail" aria-label="子代理详情">
    {resizer}
    <header>
      <div><b>{item.input.subagent_type || '子代理'}</b><span>{short(item.input.description, 80)}</span></div>
      <button className="icon-button" aria-label="关闭详情" onClick={onClose}><X size={16}/></button>
    </header>
    <div className="chat-detail-body">
      <dl className="chat-detail-stats">
        <div><dt>状态</dt><dd>{running ? (background ? '后台运行中' : '运行中') : failed ? (item.task?.status === 'killed' ? '已停止' : '失败') : '已完成'}{background ? '（后台）' : ''}</dd></div>
        <div><dt>耗时</dt><dd>{duration(ms) || '—'}</dd></div>
        <div><dt>工具调用</dt><dd>{tools} 次</dd></div>
        <div><dt>Tokens</dt><dd>{item.stats?.tokens ? tokens(item.stats.tokens) : '—'}</dd></div>
        {item.start ? <div><dt>开始</dt><dd>{fullTime(item.start)}</dd></div> : null}
        {!running && (background ? item.task!.end : item.end) ? <div><dt>结束</dt><dd>{fullTime(background ? item.task!.end : item.end)}</dd></div> : null}
        {item.input.model && <div><dt>模型</dt><dd>{item.input.model}</dd></div>}
      </dl>
      <h4>任务</h4>
      <div className="chat-detail-prompt"><Markdown text={String(item.input.prompt || '')}/></div>
      <h4>执行过程</h4>
      {item.children.length ? <div className="chat-detail-steps">{renderChildren(item.children)}</div> : <p className="muted">{running ? '等待子代理的第一步…' : '没有中间步骤：子代理没有调用工具，或这是恢复的历史对话（不含子代理内部步骤）。'}</p>}
      {background && item.task?.summary !== undefined ? <><h4>返回结果</h4><div className={'chat-detail-result' + (failed ? ' error' : '')}><Markdown text={agentReport(item.task.summary || '') || '（无输出）'}/></div></>
        : !background && item.result ? <><h4>返回结果</h4><div className={'chat-detail-result' + (item.result.isError ? ' error' : '')}><Markdown text={item.result.text || '（无输出）'}/></div></> : null}
    </div>
  </aside>;
}

function PermissionCard({ item, sessionId, resumeMode, onError }: { item: PermissionItem; sessionId: string; resumeMode: string; onError: (e: unknown) => void }) {
  const r = item.request, [reason, setReason] = useState(''), [answers, setAnswers] = useState<Record<string, string[]>>({}), [other, setOther] = useState<Record<string, string>>({}), [sending, setSending] = useState(false);
  const respond = async (decision: any) => { setSending(true); try { await call('chat:respond', sessionId, item.requestId, decision); } catch (e) { onError(e); } finally { setSending(false); } };
  if (item.resolved) {
    const [behavior, always] = item.resolved.split(':');
    const text = r.tool_name === 'AskUserQuestion' ? (behavior === 'allow' ? '已回答' : '已跳过') : r.tool_name === 'ExitPlanMode' ? (behavior === 'allow' ? '已批准方案' : '已退回方案') : behavior === 'allow' ? (always ? '已允许（并记住）' : '已允许') : behavior === 'cancelled' ? '已取消' : '已拒绝';
    return <div className={'chat-permission resolved ' + behavior}><ShieldCheck size={13}/>{labelOf(r.tool_name)} · {toolSummary(r.tool_name, r.input || {})} · {text}</div>;
  }
  if (r.tool_name === 'AskUserQuestion') {
    const questions = r.input?.questions || [];
    const value = (q: any) => [...(answers[q.question] || []), ...(other[q.question]?.trim() ? [other[q.question].trim()] : [])].join(', ');
    return <div className="chat-permission ask">
      {questions.map((q: any) => <fieldset key={q.question}><legend>{q.header && <span className="chip">{q.header}</span>}{q.question}</legend>
        {q.options?.map((o: any) => { const picked = (answers[q.question] || []).includes(o.label); return <label key={o.label} className={'chat-option' + (picked ? ' picked' : '')}><input type={q.multiSelect ? 'checkbox' : 'radio'} name={item.requestId + q.question} checked={picked} onChange={() => setAnswers(a => ({ ...a, [q.question]: q.multiSelect ? (picked ? a[q.question].filter(x => x !== o.label) : [...(a[q.question] || []), o.label]) : [o.label] }))}/><span><b>{o.label}</b>{o.description && <small>{o.description}</small>}</span></label>; })}
        <input className="chat-other" placeholder="其他（自行填写）" value={other[q.question] || ''} onChange={e => { const v = e.target.value; setOther(o => ({ ...o, [q.question]: v })); if (!q.multiSelect && v) setAnswers(a => ({ ...a, [q.question]: [] })); }}/>
      </fieldset>)}
      <div className="chat-actions"><button className="primary" disabled={sending || questions.some((q: any) => !value(q))} onClick={() => void respond({ answers: Object.fromEntries(questions.map((q: any) => [q.question, value(q)])) })}>提交回答</button><button className="secondary" disabled={sending} onClick={() => void respond({ behavior: 'deny', message: '用户跳过了这些问题' })}>跳过</button></div>
    </div>;
  }
  if (r.tool_name === 'ExitPlanMode') return <div className="chat-permission plan">
    <div className="chat-permission-title"><ShieldCheck size={15}/>方案待批准</div>
    <div className="chat-plan"><Markdown text={String(r.input?.plan || '')}/></div>
    <textarea placeholder="要修改方案，在这里写下意见后点“继续规划”" value={reason} onChange={e => setReason(e.target.value)} rows={2}/>
    <div className="chat-actions"><button className="primary" disabled={sending} onClick={() => void respond({ mode: resumeMode === 'bypassPermissions' ? 'bypassPermissions' : 'auto' })}>批准并执行（{resumeMode === 'bypassPermissions' ? 'YOLO' : '自动'}）</button><button className="secondary" disabled={sending} onClick={() => void respond({ behavior: 'deny', message: reason.trim() || '用户希望继续完善方案' })}>继续规划</button></div>
  </div>;
  const suggestions = Array.isArray(r.permission_suggestions) && r.permission_suggestions.length > 0;
  return <div className="chat-permission">
    <div className="chat-permission-title"><ShieldCheck size={15}/>{r.agent_id ? '子 Agent 请求' : '请求'}{labelOf(r.tool_name)}<span className="chat-tool-summary">{r.description && r.description !== toolSummary(r.tool_name, r.input || {}) ? r.description : ''}</span></div>
    <ToolInput name={r.tool_name} input={r.input || {}}/>
    {r.decision_reason && <p className="muted">{r.decision_reason}</p>}
    <input className="chat-other" placeholder="拒绝理由（可选，会告诉 Claude）" value={reason} onChange={e => setReason(e.target.value)}/>
    <div className="chat-actions">
      <button className="primary" disabled={sending} onClick={() => void respond({})}>允许</button>
      {suggestions && <button className="secondary" disabled={sending} title={r.permission_suggestions.map((s: any) => (s.rules || []).map((x: any) => x.toolName + (x.ruleContent ? '(' + x.ruleContent + ')' : '')).join(', ') || s.type).join('；')} onClick={() => void respond({ always: true })}>允许并记住</button>}
      <button className="secondary danger-text" disabled={sending} onClick={() => void respond({ behavior: 'deny', message: reason.trim() || '用户拒绝了此操作' })}>拒绝</button>
    </div>
  </div>;
}

// ---- Pane ---------------------------------------------------------------------------------------

interface Attachment { media_type: string; data: string; name: string }
interface Btw { id: number; question: string; answer?: string; error?: string; ms?: number }
const BTW = { name: 'btw', description: '旁路提问：基于当前对话快速回答，不打断任务，不写入对话历史', argumentHint: '<问题>' };
const MODES = [{ id: 'auto', label: '自动' }, { id: 'plan', label: '计划' }, { id: 'bypassPermissions', label: 'YOLO' }];
const OTHER_MODES: Record<string, string> = { default: '逐项确认', acceptEdits: '自动接受编辑', dontAsk: '不询问' };
const MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable', 'opus[1m]', 'sonnet[1m]'];

export function ChatPane({ session, active, yolo, onFocus, onResume, onError }: { session: Session; active: boolean; yolo: boolean; onFocus: () => void; onResume: () => void; onError: (e: unknown) => void }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [closed, setClosed] = useState(true);
  const [live, setLive] = useState('');
  const [commands, setCommands] = useState<{ name: string; description: string; argumentHint: string }[]>([]);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pick, setPick] = useState(0);
  const [modeOverride, setModeOverride] = useState('');
  const [modelOverride, setModelOverride] = useState('');
  const [preview, setPreview] = useState('');
  const [detail, setDetail] = useState('');
  // Detail panel width: dragged on its left edge, remembered for this viewer.
  const pane = useRef<HTMLDivElement>(null);
  const [detailWidth, setDetailWidth] = useState(() => { try { return Number(localStorage.getItem('wb.chatDetailWidth')) || 460; } catch { return 460; } });
  const [resizing, setResizing] = useState(false);
  const fitWidth = (w: number) => { const total = pane.current?.clientWidth || 1200; return Math.round(Math.max(320, Math.min(w, total - 360))); };
  const saveWidth = (w: number) => { const v = fitWidth(w); setDetailWidth(v); try { localStorage.setItem('wb.chatDetailWidth', String(v)); } catch { /* per-viewer convenience only */ } };
  const [btw, setBtw] = useState<Btw[]>([]);
  useEffect(() => {
    if (!preview) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPreview(''); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [preview]);
  const scroller = useRef<HTMLDivElement>(null), stick = useRef(true), input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let disposed = false, ready = false, seq = 0; const pending: Ev[][] = [];
    const apply = (batch: Ev[]) => {
      const kept = batch.filter(e => e.type !== 'stream_event' && (e.wb_seq === undefined || e.wb_seq > seq));
      for (const e of batch) {
        if (e.type === 'stream_event' && !e.parent_tool_use_id) {
          const ev = e.event;
          if (ev?.type === 'message_start') setLive('');
          else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') setLive(l => l + ev.delta.text);
        }
        if (e.type === 'assistant' && !e.parent_tool_use_id) setLive('');
        if (e.type === 'wb_exit') setClosed(true);
        if (e.wb_seq) seq = Math.max(seq, e.wb_seq);
      }
      if (kept.length) setEvents(prev => [...prev, ...kept]);
    };
    const off = window.accountor?.on('chat:events', ({ id, events }) => { if (id !== session.id) return; if (!ready) pending.push(events); else apply(events); });
    const offCommands = window.accountor?.on('chat:commands', ({ id, commands }) => { if (id === session.id) setCommands(commands); });
    void call<{ events: Ev[]; seq: number; commands: any[]; closed: boolean }>('chat:buffer', session.id).then(snapshot => {
      if (disposed) return;
      setEvents(snapshot.events); seq = snapshot.seq; setCommands(snapshot.commands || []); setClosed(snapshot.closed);
      ready = true; for (const batch of pending) apply(batch);
    }).catch(onError);
    return () => { disposed = true; off?.(); offCommands?.(); };
  }, [session.id]);

  const { items, model, picked, mode, resumeMode } = useMemo(() => buildItems(events), [events]);
  const busy = session.status === 'busy';
  const waiting = items.some(i => i.kind === 'permission' && !i.resolved);

  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items, live]);
  useEffect(() => { if (active) requestAnimationFrame(() => input.current?.focus()); }, [active]);
  // Esc works wherever the focus is in the active chat, not only in the message box (which handles it itself),
  // with the same order: side answers, then the detail panel, then the running turn.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role=dialog],dialog')) return;
      if (target && target !== document.body && !pane.current?.contains(target) && target.matches('input,textarea,select,[contenteditable=true],.xterm *')) return;
      if (btw.length) { e.preventDefault(); setBtw(list => list.slice(0, -1)); return; }
      if (detail) { e.preventDefault(); setDetail(''); return; }
      if (busy && !closed) { e.preventDefault(); void call('chat:interrupt', session.id).catch(onError); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, busy, closed, btw.length, detail, session.id]);

  const slash = text.startsWith('/') && !/\s/.test(text) ? [BTW, ...commands.filter(c => c.name !== 'btw')].filter(c => ('/' + c.name).startsWith(text)).slice(0, 8) : [];
  const askBtw = async (question: string) => {
    const id = Date.now();
    setBtw(list => [...list, { id, question }]); setText('');
    try { const r = await call<{ answer: string; ms?: number }>('chat:btw', session.id, question, model); setBtw(list => list.map(b => b.id === id ? { ...b, answer: r.answer, ms: r.ms } : b)); }
    catch (e) { setBtw(list => list.map(b => b.id === id ? { ...b, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) } : b)); }
  };
  const send = async () => {
    const body = text.trim();
    const side = body.match(/^\/btw(?:\s+([\s\S]*))?$/);
    if (side) { if (side[1]?.trim() && !attachments.length) void askBtw(side[1].trim()); else onError(new Error(attachments.length ? '/btw 不支持图片' : '用法：/btw <问题>')); return; }
    if ((!body && !attachments.length) || closed) return;
    const content = attachments.length ? [...attachments.map(a => ({ type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.data } })), ...(body ? [{ type: 'text', text: body }] : [])] : body;
    try { await call('chat:send', session.id, content); setText(''); setAttachments([]); stick.current = true; } catch (e) { onError(e); }
  };
  const addImages = (files: File[]) => {
    for (const file of files.filter(f => /^image\/(png|jpeg|gif|webp)$/.test(f.type)).slice(0, 6)) {
      if (file.size > 5 * 1024 * 1024) { onError(new Error('图片超过 5MB：' + file.name)); continue; }
      const reader = new FileReader();
      reader.onload = () => { const url = String(reader.result); setAttachments(a => [...a, { media_type: file.type, data: url.slice(url.indexOf(',') + 1), name: file.name || '粘贴的图片' }]); };
      reader.readAsDataURL(file);
    }
  };
  const control = async (request: any) => { try { await call('chat:control', session.id, request); } catch (e) { onError(e); } };

  const render = (list: Item[]): any => list.map(item => {
    switch (item.kind) {
      case 'user': return <div key={item.key} className="chat-user"><div className="bubble">{item.images.length > 0 && <div className="chat-thumbs">{item.images.map((src, i) => <button key={i} type="button" title="点击预览" onClick={() => setPreview(src)}><img src={src} alt={'图片 ' + (i + 1)}/></button>)}</div>}{item.text}</div><Stamp time={item.time}/></div>;
      case 'text': return <div key={item.key} className="chat-assistant"><Markdown text={item.text}/><Stamp time={item.time}/></div>;
      case 'thinking': return <details key={item.key} className="chat-thinking"><summary>思考过程</summary><Markdown text={item.text}/></details>;
      case 'tool': return <ToolCard key={item.key} item={item} renderChildren={render} onDetail={setDetail}/>;
      case 'permission': return <PermissionCard key={item.key} item={item} sessionId={session.id} resumeMode={resumeMode} onError={onError}/>;
      case 'result': return item.ok ? <div key={item.key} className="chat-turn-end">{item.ms ? (item.ms / 1000).toFixed(1) + ' 秒' : ''}{item.cost ? ' · $' + item.cost.toFixed(4) : ''}</div> : <div key={item.key} className="chat-note error"><WarningCircle size={13}/>{item.text}</div>;
      case 'note': return <div key={item.key} className={'chat-note ' + (item.tone || '')}>{item.tone === 'error' && <WarningCircle size={13}/>}{item.text}</div>;
    }
  });

  const currentMode = modeOverride || mode;
  useEffect(() => setModeOverride(''), [mode]);
  useEffect(() => setModelOverride(''), [picked]);
  const detailItem = detail ? findTool(items, detail) : undefined;
  const width = detailItem ? fitWidth(detailWidth) : 0;
  const resizer = <div className={'chat-detail-resize' + (resizing ? ' dragging' : '')} role="separator" aria-orientation="vertical" aria-label="调整详情宽度" aria-valuenow={width} tabIndex={0} title="拖动调整宽度，双击恢复默认"
    onPointerDown={e => {
      e.preventDefault(); const el = e.currentTarget; el.setPointerCapture(e.pointerId); setResizing(true);
      const right = pane.current!.getBoundingClientRect().right;
      const move = (ev: PointerEvent) => setDetailWidth(fitWidth(right - ev.clientX));
      const up = (ev: PointerEvent) => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); setResizing(false); saveWidth(right - ev.clientX); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    }}
    onDoubleClick={() => saveWidth(460)}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); saveWidth(width + (e.key === 'ArrowLeft' ? 40 : -40)); } }}/>;
  return <div ref={pane} className={'chat-pane' + (detailItem ? ' with-detail' : '') + (resizing ? ' resizing' : '')} style={detailItem ? { ['--detail-w' as any]: width + 'px' } : undefined} onMouseDown={onFocus}>
    <div className="chat-scroll" ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      <div className="chat-log">
        {!items.length && !live && <div className="chat-empty"><Lightning size={22} weight="duotone"/><p>{closed ? '会话未运行' : '和终端里是同一个 Claude Code：同样的工具、CLAUDE.md、skills、hooks 和 MCP。'}</p></div>}
        {render(items)}
        {live && <div className="chat-assistant streaming"><Markdown text={live}/></div>}
        {busy && !waiting && !live && <div className="chat-working"><CircleNotch size={14} className="spin"/>工作中…</div>}
      </div>
    </div>
    {closed ? <div className="chat-closed"><span>对话进程未运行。恢复后可继续这段对话。</span><button className="primary" onClick={onResume}>恢复会话</button></div> :
    <div className="chat-composer">
      {btw.length > 0 && <div className="chat-btw-stack">{btw.map(b => <div key={b.id} className={'chat-btw' + (b.error ? ' error' : '')}>
        <div className="chat-btw-head"><ChatTeardropDots size={14}/><b>/btw</b><span>{b.question}</span>{b.ms ? <small>{duration(b.ms)}</small> : null}<button className="icon-button tiny" aria-label="关闭旁路回答" onClick={() => setBtw(list => list.filter(x => x.id !== b.id))}><X size={12}/></button></div>
        {b.error ? <p>{b.error}</p> : b.answer !== undefined ? <Markdown text={b.answer}/> : <p className="muted"><CircleNotch size={12} className="spin"/> 正在回答…</p>}
      </div>)}</div>}
      {slash.length > 0 && <div className="chat-slash">{slash.map((c, i) => <button key={c.name} className={i === pick % slash.length ? 'active' : ''} onMouseDown={e => { e.preventDefault(); setText('/' + c.name + ' '); setPick(0); }}><b>/{c.name}</b>{c.argumentHint && <i>{c.argumentHint}</i>}<span>{c.description}</span></button>)}</div>}
      {attachments.length > 0 && <div className="chat-attachments">{attachments.map((a, i) => <span key={i} className="chip"><img src={'data:' + a.media_type + ';base64,' + a.data} alt="" title="点击预览" onClick={() => setPreview('data:' + a.media_type + ';base64,' + a.data)}/>{a.name}<button aria-label="移除图片" onClick={() => setAttachments(list => list.filter((_, j) => j !== i))}><X size={11}/></button></span>)}</div>}
      <div className="chat-box">
      <textarea ref={input} rows={Math.min(10, Math.max(2, text.split('\n').length))} value={text} placeholder={busy ? '工作中，可继续输入，消息会排队发送…' : '输入消息，Enter 发送，Shift+Enter 换行，/ 查看命令，可粘贴或拖入图片'}
        onChange={e => { setText(e.target.value); setPick(0); }}
        onPaste={e => { const files = [...e.clipboardData.files]; if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); addImages(files); } }}
        onDrop={e => { const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); addImages(files); } }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return;
          if (slash.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setPick(p => (p + (e.key === 'ArrowDown' ? 1 : slash.length - 1)) % slash.length); return; }
          if (slash.length && e.key === 'Tab') { e.preventDefault(); setText('/' + slash[pick % slash.length].name + ' '); return; }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (slash.length && text !== '/' + slash[pick % slash.length].name) { setText('/' + slash[pick % slash.length].name + ' '); return; } void send(); }
          // Esc closes side answers and the detail panel before it interrupts the turn.
          if (e.key === 'Escape' && btw.length) { e.preventDefault(); setBtw(list => list.slice(0, -1)); return; }
          if (e.key === 'Escape' && detail) { e.preventDefault(); setDetail(''); return; }
          if (e.key === 'Escape' && busy) { e.preventDefault(); void call('chat:interrupt', session.id).catch(onError); }
        }}/>
      <div className="chat-toolbar">
        <select aria-label="权限模式" value={currentMode} onChange={e => { setModeOverride(e.target.value); void control({ subtype: 'set_permission_mode', mode: e.target.value }); }}>{MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}{!MODES.some(m => m.id === currentMode) && <option value={currentMode}>{OTHER_MODES[currentMode] || currentMode}</option>}</select>
        <select aria-label="模型" title={model ? '当前使用：' + model : undefined} value={modelOverride || picked} onChange={e => { setModelOverride(e.target.value); void control({ subtype: 'set_model', model: e.target.value }); }}>{[...MODELS, ...(MODELS.includes(modelOverride || picked) ? [] : [modelOverride || picked])].map(m => <option key={m} value={m}>{m === 'default' ? '默认模型' : m}</option>)}</select>
        <span className="spacer"/>
        {busy && <button className="secondary chat-stop" title="中断（Esc）" onClick={() => void call('chat:interrupt', session.id).catch(onError)}><Stop size={13} weight="fill"/>中断</button>}
        <button className="chat-send" aria-label="发送" title="发送（Enter）" disabled={!text.trim() && !attachments.length} onClick={() => void send()}><ArrowUp size={16} weight="bold"/></button>
      </div>
      </div>
    </div>}
    {detailItem && <AgentDetail item={detailItem} renderChildren={render} onClose={() => setDetail('')} resizer={resizer}/>}
    {preview && <div className="chat-lightbox" role="dialog" aria-label="图片预览" onClick={() => setPreview('')}>
      <img src={preview} alt="图片预览" onClick={e => e.stopPropagation()}/>
      <button className="icon-button" aria-label="关闭预览" onClick={() => setPreview('')}><X size={18}/></button>
    </div>}
  </div>;
}
