const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const st=require('../electron/agent-status.cjs');

test('the hook command runs the telemetry script as Node on each platform',()=>{
 assert.equal(st.eventCommand("/Apps/Wb Space.app/WbSpace","/x/it's.cjs",'darwin'),"/usr/bin/env ELECTRON_RUN_AS_NODE=1 '/Apps/Wb Space.app/WbSpace' '/x/it'\\''s.cjs' event");
 assert.equal(st.eventCommand('C:\\Program Files\\WbSpace\\WbSpace.exe','C:\\Program Files\\WbSpace\\resources\\t.cjs','win32'),'set "ELECTRON_RUN_AS_NODE=1"&& "C:\\Program Files\\WbSpace\\WbSpace.exe" "C:\\Program Files\\WbSpace\\resources\\t.cjs" event');
 const hooks=st.qoderHooks('/a/WbSpace','/a/t.cjs','darwin');
 assert.deepEqual(Object.keys(hooks),st.QODER_EVENTS);
 assert.deepEqual(hooks.StopFailure,[{hooks:[{type:'command',command:st.eventCommand('/a/WbSpace','/a/t.cjs','darwin')}]}]);
 assert.match(st.qoderHooks('C:\\a\\WbSpace.exe','C:\\a\\t.cjs','win32').Stop[0].hooks[0].command,/^powershell\.exe .*-EncodedCommand /);
});

test('Codex hooks are session flags with one handler per event',()=>{
 const args=st.codexHookArgs('/usr/bin/env X=1 \'/a b\' "q" event');
 assert.equal(args.length,st.CODEX_EVENTS.length*2);
 assert.equal(args[0],'-c');
 assert.equal(args[1],'hooks.SessionStart=[{hooks=[{type="command",command="/usr/bin/env X=1 \'/a b\' \\"q\\" event",timeout=10}]}]');
});

test('only WbSpace session-flag hooks with a valid hash are trusted',()=>{
 const hash='sha256:'+'a'.repeat(64),command='cmd event';
 const listed=[{key:'/<session-flags>/config.toml:stop:0:0',source:'sessionFlags',command,currentHash:hash},{key:'/u/hooks.json:stop:0:0',source:'user',command,currentHash:hash},{key:'/<session-flags>/config.toml:interrupt:0:0',source:'sessionFlags',command:'other',currentHash:hash},{key:'/<session-flags>/config.toml:session_start:0:0',source:'sessionFlags',command,currentHash:'md5:x'}];
 assert.deepEqual(st.ownCodexHooks(listed,command),[{key:'/<session-flags>/config.toml:stop:0:0',hash}]);
 assert.deepEqual(st.ownCodexHooks(null,command),[]);
});

test('trust tables replace earlier WbSpace entries and leave the rest of config.toml alone',()=>{
 const before='model = "m"\n\n[projects."/p"]\ntrust_level = "trusted"\n\n[hooks.state."/<session-flags>/config.toml:stop:0:0"]\ntrusted_hash = "sha256:old"\n\n[hooks.state."/u/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:user"\n';
 const entries=[{key:'/<session-flags>/config.toml:stop:0:0',hash:'sha256:new'},{key:'C:\\<session-flags>\\config.toml:interrupt:0:0',hash:'sha256:win'}];
 const after=st.applyCodexTrust(before,entries);
 assert.equal(after,'model = "m"\n\n[projects."/p"]\ntrust_level = "trusted"\n\n[hooks.state."/u/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:user"\n\n[hooks.state."/<session-flags>/config.toml:stop:0:0"]\ntrusted_hash = "sha256:new"\n\n[hooks.state."C:\\\\<session-flags>\\\\config.toml:interrupt:0:0"]\ntrusted_hash = "sha256:win"\n');
 assert.equal(st.applyCodexTrust(after,entries),after);
 assert.equal(st.applyCodexTrust('',entries.slice(0,1)),'[hooks.state."/<session-flags>/config.toml:stop:0:0"]\ntrusted_hash = "sha256:new"\n');
});

test('hooks/list over the app-server protocol returns the listed hooks',async()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
 const sent=[];
 const spawner=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{};
  child.stdin.on('data',d=>{for(const line of String(d).split('\n').filter(Boolean)){const m=JSON.parse(line);sent.push(m.method);
   if(m.id===1)child.stdout.write(JSON.stringify({id:1,result:{}})+'\n');
   if(m.id===2)child.stdout.write(JSON.stringify({id:2,result:{data:[{cwd:'/p',hooks:[{key:'k'}]},{cwd:'/q',hooks:[{key:'j'}]}]}})+'\n');}});
  return child;};
 assert.deepEqual(await st.listCodexHooks(['codex',['app-server']],{},'/p',{spawner}),[{key:'k'},{key:'j'}]);
 assert.deepEqual(sent,['initialize','initialized','hooks/list']);
 const silent=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{};return child;};
 assert.equal(await st.listCodexHooks(['codex',[]],{},'/p',{spawner:silent,timeoutMs:50}),null);
});

test('the OpenCode plugin reports busy while any session works and idle once all are done',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wb-oc-'));
 try{
  const url=await st.opencodePlugin(path.join(dir,'plugin'));
  assert.equal(await st.opencodePlugin(path.join(dir,'plugin')),url);
  assert.deepEqual(JSON.parse(st.mergeOpencodePlugin(JSON.stringify({model:'x/m',plugin:['a',url]}),url)),{$schema:'https://opencode.ai/config.json',model:'x/m',plugin:['a',url]});
  assert.deepEqual(JSON.parse(st.mergeOpencodePlugin('',url)).plugin,[url]);
  const tele=path.join(dir,'tele');process.env.ACCOUNTOR_TELEMETRY_DIR=tele;process.env.ACCOUNTOR_RUN_ID='run-1';
  const {WbSpaceStatus}=await import(url+'?t='+Date.now());
  const read=async()=>JSON.parse(await fs.readFile(path.join(tele,'run-1-event.json'),'utf8')).event;
  const hooks=await WbSpaceStatus();assert.equal(await read(),'SessionStart');
  const status=(id,type)=>hooks.event({event:{type:'session.status',properties:{sessionID:id,status:{type}}}});
  await status('main','busy');assert.equal(await read(),'UserPromptSubmit');
  await status('child','busy');await status('child','idle');assert.equal(await read(),'UserPromptSubmit');
  await status('main','retry');assert.equal(await read(),'UserPromptSubmit');
  await hooks.event({event:{type:'session.idle',properties:{sessionID:'main'}}});assert.equal(await read(),'Stop');
  await hooks.event({event:{type:'message.updated',properties:{sessionID:'main'}}});assert.equal(await read(),'Stop');
 }finally{delete process.env.ACCOUNTOR_TELEMETRY_DIR;delete process.env.ACCOUNTOR_RUN_ID;await fs.rm(dir,{recursive:true,force:true});}
});

test('a working session whose terminal stays silent is treated as waiting for input',()=>{
 const now=100000,terminals=new Map([['a',{lastOutput:now-20000}],['b',{lastOutput:now-1000}],['c',{lastOutput:now-20000}],['d',{lastOutput:now-20000,closed:true}],['e',{lastOutput:now-20000}],['f',{lastOutput:now-20000}],['g',{lastOutput:now-20000}]]);
 const sessions=[
  {id:'a',kind:'agent',status:'busy',eventTime:now-20000},
  {id:'b',kind:'claude',status:'busy',eventTime:now-20000},
  {id:'c',kind:'claude',status:'busy',eventTime:now-5000},
  {id:'d',kind:'agent',status:'busy',eventTime:0},
  {id:'e',kind:'agent',status:'busy',eventTime:0,scheduleRunId:'r'},
  {id:'f',kind:'shell',status:'busy'},
  {id:'g',kind:'claude',status:'idle',eventTime:0},
  {id:'h',kind:'claude',status:'busy',eventTime:0}];
 assert.deepEqual(st.quietSessions(sessions,terminals,now),['a']);
});
