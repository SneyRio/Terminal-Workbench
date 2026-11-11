// Chat view: drives the same Claude CLI as the terminal over stream-json instead of a PTY.
// The harness (system prompt, tools, CLAUDE.md, skills, hooks, plugins, MCP) is untouched;
// only the transport changes. Permission prompts go through the stdio control protocol so the
// interactive-only tools (AskUserQuestion, EnterPlanMode, ExitPlanMode) stay available.
const {randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');

const CHAT_ARGS=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--replay-user-messages','--permission-prompt-tool','stdio'];
// The permission modes the chat view offers: auto, plan and YOLO.
const CHAT_MODES=['auto','plan','bypassPermissions'];
const BUFFER_LIMIT=4000;
const HISTORY_LIMIT=600;

// The stream events the renderer needs to rebuild the conversation after a remount.
// Partial deltas are only forwarded live; the finished block arrives as an `assistant` event.
const keep=event=>event.type!=='stream_event'&&!(event.type==='system'&&['hook_started','hook_response','status'].includes(event.subtype));

class ChatRuntime{
  constructor(child,{onEvents,onExit,onTurn,onUsage,onMode}={}){
    this.child=child;this.onEvents=onEvents;this.onTurn=onTurn;this.onUsage=onUsage;this.onMode=onMode;this.mode='';
    this.events=[];this.seq=0;this.outbox=[];this.flushTimer=null;
    this.permissions=new Map();this.waiters=new Map();this.commands=[];this.echoes=[];this.busy=false;this.closed=false;this.lastOutput=Date.now();
    let buffer='';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;let index;
      while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line.trim())this.line(line);}
    });
    child.stderr.setEncoding('utf8');
    let stderr='';
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
    child.stdin.on('error',()=>{});
    child.on('exit',(code,signal)=>{
      this.closed=true;
      for(const [,waiter] of this.waiters)waiter.reject(new Error('对话进程已结束'));this.waiters.clear();
      if(code&&stderr.trim())this.emit({type:'wb_error',text:stderr.trim().slice(-1500)});
      this.emit({type:'wb_exit',code,signal});this.flush();
      onExit?.(code??(signal?1:0));
    });
    child.on('error',error=>{this.emit({type:'wb_error',text:error.message});this.flush();});
  }
  get pid(){return this.child.pid;}
  line(line){
    let event;try{event=JSON.parse(line);}catch{return;}
    this.lastOutput=Date.now();
    if(event.type==='control_response'){
      const waiter=this.waiters.get(event.response?.request_id);
      if(waiter){this.waiters.delete(event.response.request_id);if(event.response.subtype==='error')waiter.reject(new Error(event.response.error||'操作失败'));else waiter.resolve(event.response.response||{});}
      return;
    }
    if(event.type==='control_request'){
      if(event.request?.subtype==='can_use_tool'){this.permissions.set(event.request_id,event.request);this.emit(event);return;}
      // Anything else the CLI asks the host for is not supported here; answer so it never waits forever.
      this.write({type:'control_response',response:{subtype:'error',request_id:event.request_id,error:'WbSpace 不支持此请求：'+(event.request?.subtype||'未知')}});
      return;
    }
    if(event.type==='control_cancel_request'){
      if(this.permissions.delete(event.request_id))this.emit({type:'wb_permission',request_id:event.request_id,behavior:'cancelled'});
      return;
    }
    // The message was already shown when it was sent; drop the CLI's copy of it.
    if(event.type==='user'&&!event.parent_tool_use_id&&!event.isSynthetic&&!event.isMeta){
      const index=this.echoes.indexOf(echoKey(event.message?.content));
      if(index>=0){this.echoes.splice(index,1);return;}
    }
    if(event.type==='rate_limit_event'){const usage=usageFromRateLimit(event);if(usage)this.onUsage?.(usage);return;}
    if(event.type==='result'){this.busy=false;this.onTurn?.('idle',event);}
    this.emit(event);
  }
  emit(event){
    // wb_time: when the event reached the host, so the view can show message times and tool durations.
    if(keep(event)){this.seq++;const row={...event,wb_seq:this.seq,wb_time:event.wb_time||Date.now()};this.events.push(row);if(this.events.length>BUFFER_LIMIT)this.events.splice(0,this.events.length-BUFFER_LIMIT);this.outbox.push(row);}
    else this.outbox.push(event);
    if(!this.flushTimer)this.flushTimer=setTimeout(()=>this.flush(),30);
  }
  flush(){
    if(this.flushTimer){clearTimeout(this.flushTimer);this.flushTimer=null;}
    if(!this.outbox.length)return;
    const events=this.outbox;this.outbox=[];this.onEvents?.(events,this.seq);
  }
  write(message){if(this.closed)throw new Error('对话进程已结束');this.child.stdin.write(JSON.stringify(message)+'\n');}
  control(request,timeout=15000){
    const request_id=randomUUID();
    const promise=new Promise((resolve,reject)=>{
      this.waiters.set(request_id,{resolve,reject});
      setTimeout(()=>{if(this.waiters.delete(request_id))reject(new Error('CLI 未响应'));},timeout).unref?.();
    });
    this.write({type:'control_request',request_id,request});
    return promise;
  }
  async initialize(){const reply=await this.control({subtype:'initialize'},30000).catch(()=>({}));this.commands=Array.isArray(reply.commands)?reply.commands.map(c=>({name:String(c.name),description:String(c.description||''),argumentHint:String(c.argumentHint||'')})):[];return reply;}
  send(content){
    const message=validContent(content);
    this.write({type:'user',message:{role:'user',content:message},parent_tool_use_id:null,session_id:''});
    // Show the message at once instead of waiting for the CLI to echo it back (hooks run first).
    // Slash commands are left to the CLI, which echoes them in its own form.
    const key=echoKey(message);
    if(!(typeof message==='string'&&message.trimStart().startsWith('/'))&&key){
      this.echoes.push(key);if(this.echoes.length>50)this.echoes.shift();
      this.emit({type:'user',message:{role:'user',content:message},parent_tool_use_id:null,wb_local:true});
    }
    this.busy=true;this.onTurn?.('busy');
  }
  respond(requestId,decision){
    const request=this.permissions.get(requestId);
    if(!request)throw new Error('该请求已处理或已取消');
    const response=permissionResponse(request,decision);
    this.write({type:'control_response',response:{subtype:'success',request_id:requestId,response}});
    this.permissions.delete(requestId);
    this.emit({type:'wb_permission',request_id:requestId,behavior:response.behavior,always:!!decision?.always});
    const mode=response.updatedPermissions?.find(p=>p.type==='setMode')?.mode;
    if(mode)this.setMode(mode);
  }
  // The model picked for this conversation ('default' = the account's default), shown by the model picker.
  setModel(model){this.emit({type:'wb_model',model});}
  // Recorded in the event log so the mode picker shows it, and reported so the session remembers it.
  setMode(mode){if(!CHAT_MODES.includes(mode)||mode===this.mode)return;this.mode=mode;this.emit({type:'wb_mode',mode});this.onMode?.(mode);}
  interrupt(){return this.control({subtype:'interrupt'});}
  kill(signal){if(!this.closed)try{this.child.stdin.end();killTree(this.child,signal);}catch{}}
}

// Identifies a sent message in the CLI's echo, which may turn a string into text blocks.
function echoKey(content){
  const blocks=typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content:[];
  if(blocks.some(b=>b?.type==='tool_result'))return '';
  const text=blocks.filter(b=>b?.type==='text').map(b=>String(b.text).trim()).join('\n');
  const images=blocks.filter(b=>b?.type==='image').length;
  return text||images?text+'\u0000'+images:'';
}

// Windows has no signals: kill() ends only claude.exe and would leave its MCP servers and
// commands running, so the whole process tree is ended there.
function killTree(child,signal,platform=process.platform){
  if(!child?.pid)return;
  if(platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{try{child.kill();}catch{}});
  else child.kill(signal);
}

const MAX_TEXT=1024*1024,MAX_IMAGE=8*1024*1024,IMAGE_TYPES=['image/png','image/jpeg','image/gif','image/webp'];
function validContent(content){
  if(typeof content==='string'){if(!content.trim()||content.length>MAX_TEXT)throw new Error('消息为空或过长');return content;}
  if(!Array.isArray(content)||!content.length||content.length>20)throw new Error('无效消息');
  return content.map(block=>{
    if(block?.type==='text'&&typeof block.text==='string'&&block.text.length<=MAX_TEXT)return {type:'text',text:block.text};
    if(block?.type==='image'&&IMAGE_TYPES.includes(block.source?.media_type)&&typeof block.source?.data==='string'&&block.source.data.length<=MAX_IMAGE)return {type:'image',source:{type:'base64',media_type:block.source.media_type,data:block.source.data}};
    throw new Error('无效消息内容');
  });
}

// Turns the user's choice on a permission card into the control-protocol answer.
function permissionResponse(request,decision={}){
  if(decision.behavior==='deny')return {behavior:'deny',message:String(decision.message||'用户拒绝了此操作').slice(0,4000),...(decision.interrupt?{interrupt:true}:{})};
  let input=request.input||{};
  if(request.tool_name==='AskUserQuestion'){
    const answers={};
    for(const question of input.questions||[]){const value=decision.answers?.[question.question];if(typeof value==='string')answers[question.question]=value.slice(0,4000);}
    input={...input,answers};
  }
  const response={behavior:'allow',updatedInput:input};
  if(decision.always&&Array.isArray(request.permission_suggestions)&&request.permission_suggestions.length)response.updatedPermissions=request.permission_suggestions;
  if(decision.mode&&['auto','plan','bypassPermissions'].includes(decision.mode))response.updatedPermissions=[...(response.updatedPermissions||[]),{type:'setMode',mode:decision.mode,destination:'session'}];
  return response;
}

// rate_limit_event → the shape the status-line telemetry already stores on the account.
function usageFromRateLimit(event){
  const windows=event?.rate_limit_info?.unifiedWindows;if(!windows)return null;
  const usage={};
  for(const key of ['five_hour','seven_day']){
    const w=windows[key];if(!w||typeof w.utilization!=='number')continue;
    usage[key]={used_percentage:Math.round(w.utilization*1000)/10,...(Number.isFinite(w.resetsAt)?{resets_at:w.resetsAt}:{})};
  }
  return Object.keys(usage).length?usage:null;
}

// The earlier part of a resumed conversation, read from the CLI's own transcript.
function transcriptEvents(raw,limit=HISTORY_LIMIT){
  const rows=[];
  for(const line of String(raw).split('\n')){
    if(!line.trim())continue;
    let row;try{row=JSON.parse(line);}catch{continue;}
    if(!['user','assistant'].includes(row.type)||row.isSidechain||row.isMeta||!row.message)continue;
    const wb_time=Date.parse(row.timestamp)||undefined;
    if(row.isCompactSummary){rows.push({type:'wb_note',text:'上下文已压缩',wb_time});continue;}
    rows.push({type:row.type,message:row.message,parent_tool_use_id:null,history:true,wb_time,...(row.toolUseResult?{tool_use_result:row.toolUseResult}:{})});
  }
  return rows.slice(-limit);
}

module.exports={CHAT_ARGS,CHAT_MODES,ChatRuntime,killTree,permissionResponse,usageFromRateLimit,transcriptEvents,validContent};
