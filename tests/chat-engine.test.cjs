const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {CHAT_ARGS,ChatRuntime,killTree,permissionResponse,usageFromRateLimit,transcriptEvents,validContent}=require('../electron/chat-engine.cjs');

function fakeChild(){
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  // No pid: stopping must never reach a real process (on Windows it would run taskkill on that pid).
  child.written=[];child.stdin.on('data',d=>{for(const line of String(d).split('\n').filter(Boolean))child.written.push(JSON.parse(line));});
  child.kill=()=>{child.killed=true;setImmediate(()=>child.emit('exit',null,'SIGTERM'));};
  child.say=event=>child.stdout.write(JSON.stringify(event)+'\n');
  return child;
}
const tick=()=>new Promise(r=>setTimeout(r,40));

test('chat args keep the interactive-only tools by using the stdio permission protocol',()=>{
  assert.ok(CHAT_ARGS.includes('-p'));
  assert.deepEqual(CHAT_ARGS.slice(CHAT_ARGS.indexOf('--permission-prompt-tool'),CHAT_ARGS.indexOf('--permission-prompt-tool')+2),['--permission-prompt-tool','stdio']);
  assert.ok(!CHAT_ARGS.includes('--permission-prompts'));
});

test('events are parsed across chunk boundaries and buffered without partial deltas',async()=>{
  const child=fakeChild(),batches=[];
  const chat=new ChatRuntime(child,{onEvents:events=>batches.push(...events)});
  const line=JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'你好'}]}});
  child.stdout.write(line.slice(0,10));child.stdout.write(line.slice(10)+'\n');
  child.say({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'你'}}});
  child.say({type:'system',subtype:'hook_started'});
  await tick();
  assert.equal(chat.events.length,1);
  assert.equal(chat.events[0].message.content[0].text,'你好');
  assert.ok(Math.abs(chat.events[0].wb_time-Date.now())<1000,'each kept event records when it arrived');
  assert.ok(batches.some(e=>e.type==='stream_event'),'live deltas are still forwarded');
});

test('a permission request waits for the user and is answered on stdin',async()=>{
  const child=fakeChild(),turns=[];
  const chat=new ChatRuntime(child,{onTurn:s=>turns.push(s)});
  child.say({type:'control_request',request_id:'r1',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'ls'},permission_suggestions:[{type:'addRules',rules:[{toolName:'Bash',ruleContent:'ls'}],behavior:'allow',destination:'localSettings'}]}});
  await tick();
  assert.equal(child.written.length,0,'nothing is approved on its own');
  chat.respond('r1',{always:true});
  await tick();
  const reply=child.written.at(-1);
  assert.equal(reply.type,'control_response');
  assert.equal(reply.response.request_id,'r1');
  assert.equal(reply.response.response.behavior,'allow');
  assert.deepEqual(reply.response.response.updatedInput,{command:'ls'});
  assert.equal(reply.response.response.updatedPermissions[0].type,'addRules');
  assert.throws(()=>chat.respond('r1',{}),/已处理/);
  assert.equal(chat.events.at(-1).type,'wb_permission');
});

test('unsupported host requests are refused instead of left hanging; cancelled prompts are closed',async()=>{
  const child=fakeChild();
  const chat=new ChatRuntime(child);
  child.say({type:'control_request',request_id:'x',request:{subtype:'hook_callback'}});
  child.say({type:'control_request',request_id:'r2',request:{subtype:'can_use_tool',tool_name:'Write',input:{}}});
  child.say({type:'control_cancel_request',request_id:'r2'});
  await tick();
  assert.equal(child.written[0].response.subtype,'error');
  assert.equal(child.written[0].response.request_id,'x');
  assert.equal(chat.permissions.size,0);
  assert.equal(chat.events.at(-1).behavior,'cancelled');
});

test('control requests resolve with the CLI reply and turns report busy and idle',async()=>{
  const child=fakeChild(),turns=[];
  const chat=new ChatRuntime(child,{onTurn:s=>turns.push(s)});
  const pending=chat.control({subtype:'set_model',model:'opus'});
  await tick();
  const sent=child.written.at(-1);
  child.say({type:'control_response',response:{subtype:'success',request_id:sent.request_id,response:{ok:1}}});
  assert.deepEqual(await pending,{ok:1});
  chat.send('hi');
  child.say({type:'result',subtype:'success',result:'done'});
  await tick();
  assert.deepEqual(turns,['busy','idle']);
  assert.equal(child.written.at(-1).type,'user');
});

test('send now queues the message, then interrupts the running turn; otherwise it only sends',async()=>{
  const child=fakeChild();const chat=new ChatRuntime(child);
  chat.send('first',{now:true});
  assert.deepEqual(child.written.map(m=>m.type),['user'],'nothing to interrupt while idle');
  chat.send('second');
  assert.deepEqual(child.written.map(m=>m.type),['user','user'],'a plain send while working is left to the CLI queue');
  chat.send('third',{now:true});
  assert.deepEqual(child.written.slice(-2).map(m=>m.type==='user'?m.message.content:m.request.subtype),['third','interrupt']);
});

test('a turn the CLI starts on its own from a queued message reports busy',async()=>{
  const child=fakeChild(),turns=[];const chat=new ChatRuntime(child,{onTurn:s=>turns.push(s)});
  chat.send('long task');chat.send('queued');
  child.say({type:'system',subtype:'init',session_id:'s'});
  child.say({type:'result',subtype:'error_during_execution',is_error:true});
  child.say({type:'system',subtype:'init',session_id:'s'});
  await tick();
  assert.deepEqual(turns,['busy','busy','idle','busy'],'the init of a running turn changes nothing; the next one marks it busy again');
  assert.equal(chat.busy,true);
});

test('the process exit rejects waiting requests and is reported once',async()=>{
  const child=fakeChild();let exited=null;
  const chat=new ChatRuntime(child,{onExit:code=>{exited=code;}});
  const pending=chat.control({subtype:'interrupt'});
  chat.kill();
  await assert.rejects(pending,/已结束/);
  assert.equal(exited,1);
  assert.equal(chat.closed,true);
  assert.throws(()=>chat.send('x'),/已结束/);
});

test('ask-user answers and plan approval become the expected permission responses',()=>{
  const ask={tool_name:'AskUserQuestion',input:{questions:[{question:'颜色？',options:[{label:'红'}]}]}};
  assert.deepEqual(permissionResponse(ask,{answers:{'颜色？':'红','注入？':'x'}}).updatedInput.answers,{'颜色？':'红'});
  const plan=permissionResponse({tool_name:'ExitPlanMode',input:{plan:'p'}},{mode:'auto'});
  assert.deepEqual(plan.updatedPermissions,[{type:'setMode',mode:'auto',destination:'session'}]);
  assert.equal(permissionResponse({tool_name:'ExitPlanMode',input:{}},{mode:'acceptEdits'}).updatedPermissions,undefined,'only the offered modes');
  assert.deepEqual(permissionResponse({tool_name:'Bash',input:{}},{behavior:'deny',message:'不行'}),{behavior:'deny',message:'不行'});
  assert.equal(permissionResponse({tool_name:'Bash',input:{},permission_suggestions:[]},{always:true}).updatedPermissions,undefined);
});

test('rate limit events become the account usage shape',()=>{
  const usage=usageFromRateLimit({type:'rate_limit_event',rate_limit_info:{unifiedWindows:{five_hour:{utilization:0.034,resetsAt:100},seven_day:{utilization:0.5,resetsAt:200}}}});
  assert.deepEqual(usage,{five_hour:{used_percentage:3.4,resets_at:100},seven_day:{used_percentage:50,resets_at:200}});
  assert.equal(usageFromRateLimit({}),null);
});

test('transcript history keeps the main conversation only',()=>{
  const raw=[
    {type:'user',timestamp:'2026-11-11T03:48:27.997Z',message:{role:'user',content:'hi'}},
    {type:'assistant',message:{content:[{type:'text',text:'yo'}]}},
    {type:'assistant',isSidechain:true,message:{content:[]}},
    {type:'user',isMeta:true,message:{content:'meta'}},
    {type:'summary'},
    'not json',
  ].map(r=>typeof r==='string'?r:JSON.stringify(r)).join('\n');
  const events=transcriptEvents(raw);
  assert.equal(events.length,2);
  assert.ok(events.every(e=>e.history));
  assert.equal(events[0].wb_time,Date.parse('2026-11-11T03:48:27.997Z'),'history keeps the original message time');
  assert.equal(events[1].wb_time,undefined);
});

test('message content is validated before it reaches the CLI',()=>{
  assert.equal(validContent('hi'),'hi');
  assert.throws(()=>validContent('  '));
  assert.throws(()=>validContent([{type:'image',source:{media_type:'image/svg+xml',data:'x'}}]));
  assert.deepEqual(validContent([{type:'text',text:'a',extra:1}]),[{type:'text',text:'a'}]);
});

test('a sent message shows at once and the CLI echo of it is not shown twice',async()=>{
  const child=fakeChild(),batches=[];
  const chat=new ChatRuntime(child,{onEvents:events=>batches.push(...events)});
  chat.send('你好');
  await tick();
  assert.equal(batches.filter(e=>e.type==='user').length,1,'shown before the CLI answers');
  assert.equal(batches[0].wb_local,true);
  child.say({type:'user',message:{role:'user',content:[{type:'text',text:'你好'}]},parent_tool_use_id:null});
  child.say({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'ok'}]},parent_tool_use_id:null});
  child.say({type:'user',message:{role:'user',content:'别处来的消息'},parent_tool_use_id:null});
  await tick();
  assert.equal(chat.events.filter(e=>e.type==='user').length,3,'echo dropped, tool results and other messages kept');
  chat.send('/compact');
  await tick();
  assert.equal(chat.events.filter(e=>e.type==='user').length,3,'slash commands wait for the CLI');
});

test('an approved plan switches the mode, which is logged and reported once',async()=>{
  const child=fakeChild(),modes=[];
  const chat=new ChatRuntime(child,{onMode:m=>modes.push(m)});
  chat.setMode('plan');
  child.say({type:'control_request',request_id:'p1',request:{subtype:'can_use_tool',tool_name:'ExitPlanMode',input:{plan:'x'}}});
  await tick();
  chat.respond('p1',{mode:'bypassPermissions'});
  chat.setMode('bypassPermissions');chat.setMode('default');
  assert.deepEqual(modes,['plan','bypassPermissions']);
  assert.deepEqual(chat.events.filter(e=>e.type==='wb_mode').map(e=>e.mode),['plan','bypassPermissions']);
});

test('stopping ends the whole process tree on Windows and signals the CLI elsewhere',()=>{
  const signals=[],runs=[];
  const fakeRun=(file,args)=>{runs.push([file,...args]);return {on(){return this;}};};
  killTree({pid:4242,kill:s=>signals.push(s)},'SIGTERM','darwin',fakeRun);
  assert.deepEqual(signals,['SIGTERM']);
  assert.equal(runs.length,0);
  // On Windows taskkill /t ends claude.exe together with its MCP servers and commands.
  killTree({pid:4242,kill:()=>signals.push('direct')},'SIGTERM','win32',fakeRun);
  assert.deepEqual(runs,[['taskkill.exe','/pid','4242','/t','/f']]);
  assert.deepEqual(signals,['SIGTERM'],'not killed directly');
  // A process that never started has no pid and no tree.
  killTree({kill:s=>signals.push('no-pid '+s)},'SIGTERM','win32',fakeRun);
  assert.deepEqual(signals,['SIGTERM','no-pid SIGTERM']);
  assert.equal(runs.length,1);
});
