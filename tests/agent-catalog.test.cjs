const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const usage=require('../electron/agent-usage.cjs'),catalog=require('../electron/agent-catalog.cjs'),install=require('../electron/agent-install.cjs'),{connection,Connections}=require('../electron/account-connections.cjs');
async function fixture(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'wbspace-agent-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
const base={providerName:'网关',baseUrl:'https://example.invalid/v1',models:['m1','org/m2'],defaultModel:'org/m2',authType:'bearer'};
const connect=over=>connection({...base,...over});

test('the catalog offers exactly the four agents and maps each protocol to its supporting agents',()=>{
 assert.deepEqual(catalog.agents.map(a=>a.id),['claude-code','codex-cli','qoder-cli','opencode']);
 const usable=p=>catalog.agents.filter(a=>catalog.supports(a.id,p)).map(a=>a.id);
 assert.deepEqual(usable('messages'),['claude-code','opencode']);
 assert.deepEqual(usable('chat'),['opencode']);
 assert.deepEqual(usable('responses'),['codex-cli','opencode']);
 assert.throws(()=>catalog.protocol('gemini'));
 assert.throws(()=>catalog.agent('gemini-cli'));
 assert.deepEqual(catalog.agent('qoder-cli').protocols,[]);assert.equal(catalog.agent('qoder-cli').login,true);
 assert.deepEqual(catalog.agents.filter(a=>a.login).map(a=>a.id),catalog.agents.map(a=>a.id));
 for(const a of catalog.agents)for(const command of Object.values(a.install))assert.ok(command.length>5);
});
test('a connection cannot be saved for an agent that does not speak its protocol',()=>{
 for(const [agentToolId,protocol] of [['claude-code','chat'],['claude-code','responses'],['codex-cli','chat'],['codex-cli','messages'],['qoder-cli','messages']])assert.throws(()=>connect({agentToolId,protocol}),/不支持/,agentToolId+protocol);
 assert.equal(connect({agentToolId:'opencode',protocol:'chat'}).protocol,'chat');
 assert.equal(connect({}).protocol,'messages');
 assert.throws(()=>connect({agentToolId:'codex-cli',protocol:'responses',authType:'api-key'}),/认证/);
 assert.throws(()=>connect({agentToolId:'opencode',protocol:'gemini'}),/协议/);
 assert.throws(()=>connect({protocol:'smtp'}),/协议/);
});
test('pasted full endpoints are reduced to a base address and mismatched endpoints are explained',()=>{
 assert.equal(connect({agentToolId:'opencode',protocol:'chat',baseUrl:'https://x.invalid/v1/chat/completions'}).baseUrl,'https://x.invalid/v1');
 assert.equal(connect({agentToolId:'codex-cli',protocol:'responses',baseUrl:'https://x.invalid/v1/responses/'}).baseUrl,'https://x.invalid/v1');
 assert.equal(connect({protocol:'messages',baseUrl:'https://x.invalid/v1/messages'}).baseUrl,'https://x.invalid');
 assert.throws(()=>connect({protocol:'messages',baseUrl:'https://x.invalid/v1/chat/completions'}),/\/chat\/completions 接口/);
 assert.equal(catalog.protocolOf({baseUrl:'https://x.invalid/v1/chat/completions'}),'chat');
 assert.equal(catalog.protocolOf({baseUrl:'https://x.invalid/anthropic'}),'messages');
});
test('launch settings route each agent to the provider and never write the key to disk',async t=>{
 const root=await fixture(t),secret='fixture-provider-secret';
 const all=async dir=>{let out='';for(const e of await fs.readdir(dir,{withFileTypes:true,recursive:true}))if(e.isFile())out+=await fs.readFile(path.join(e.parentPath,e.name),'utf8');return out;};
 const codexHome=path.join(root,'codex');let env=await catalog.prepareLaunch('codex-cli',connect({agentToolId:'codex-cli',protocol:'responses'}),secret,codexHome);
 assert.equal(env.CODEX_HOME,codexHome);assert.equal(env[catalog.keyVariable],secret);const toml=await all(codexHome);assert.match(toml,/wire_api = "responses"/);assert.match(toml,/model = "org\/m2"/);assert.ok(!toml.includes(secret));
 for(const [protocol,npm,url] of [['chat','@ai-sdk/openai-compatible','https://example.invalid/v1'],['responses','@ai-sdk/openai','https://example.invalid/v1'],['messages','@ai-sdk/anthropic','https://example.invalid/v1/v1']]){
  env=await catalog.prepareLaunch('opencode',connect({agentToolId:'opencode',protocol,authType:'bearer'}),secret,path.join(root,'oc-'+protocol));
  const config=JSON.parse(env.OPENCODE_CONFIG_CONTENT),provider=config.provider.wbspace;assert.equal(provider.npm,npm);assert.equal(provider.options.baseURL,url);assert.equal(config.model,'wbspace/org/m2');assert.ok(!env.OPENCODE_CONFIG_CONTENT.includes(secret));assert.deepEqual(Object.keys(provider.models),['m1','org/m2']);
 }
 await assert.rejects(()=>catalog.prepareLaunch('codex-cli',connect({agentToolId:'opencode',protocol:'chat'}),secret,path.join(root,'x')),/不支持/);
});
test('an existing Claude connection pointing at an OpenAI endpoint fails with a clear instruction',async t=>{
 const root=await fixture(t),manager=new Connections(root,{});
 await assert.rejects(()=>manager.env({id:'a',connection:{baseUrl:'https://x.invalid/v1/chat/completions',models:['m'],defaultModel:'m',authType:'bearer'}}),/Claude Code 不支持 \/chat\/completions/);
});
test('scan reports the first candidate that actually runs and never counts a broken file as installed',async t=>{
 const options={platform:'darwin',home:'/h',shell:'/bin/sh',searchPath:'/a:/b'};
 const seen=[];
 const run=(ok)=>async(file,args)=>{seen.push(file);if(file==='/bin/sh')return {stdout:'/login/codex\n'};if(ok.includes(file))return {stdout:'codex-cli 1.2.3\n'};throw new Error('broken');};
 const agent=catalog.agent('codex-cli');
 const good=await install.scan(agent,{...options,run:run(['/b/codex']),access:async f=>{if(f!=='/b/codex')throw new Error('no');}});
 assert.deepEqual([good.installed,good.path,good.version],[true,'/b/codex','1.2.3']);
 const broken=await install.scan(agent,{...options,run:run([]),access:async()=>{throw new Error('no');}});
 assert.equal(broken.installed,false);assert.match(broken.issue,/无法运行/);
 const none=await install.scan(agent,{...options,run:async()=>{throw new Error('none');},access:async()=>{throw new Error('no');}});
 assert.deepEqual([none.installed,none.issue],[false,'']);
});
test('Windows scan prefers a native executable over a command shim',async()=>{
 const run=async(file,args)=>{if(file==='where.exe')return {stdout:'C:\\n\\codex.cmd\r\nC:\\n\\codex.exe\r\n'};return {stdout:'1.0.0'};};
 const result=await install.scan(catalog.agent('codex-cli'),{platform:'win32',home:'C:\\h',searchPath:'C:\\n',run});
 assert.equal(result.path,'C:\\n\\codex.exe');
});
test('install runs only the fixed command for the platform and reports failures in plain language',async()=>{
 assert.equal(install.installCommand(catalog.agent('opencode'),{platform:'darwin',shell:'/bin/zsh'}).file,'/bin/zsh');
 assert.deepEqual(install.installCommand(catalog.agent('codex-cli'),{platform:'darwin',shell:'/bin/zsh'}).args,['-lc','npm install -g @openai/codex']);
 assert.equal(install.installCommand(catalog.agent('qoder-cli'),{platform:'win32'}).file,'powershell.exe');
 const fake=(code,text)=>()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};setImmediate(()=>{c.stdout.emit('data',Buffer.from(text));c.emit('close',code);});return c;};
 const logs=[];assert.equal(await install.runInstall({file:'x',args:[]},{spawner:fake(0,'done'),onLog:l=>logs.push(l)}),'done');assert.deepEqual(logs,['done']);
 await assert.rejects(()=>install.runInstall({file:'x',args:[]},{spawner:fake(127,'zsh: npm: command not found')}),/Node\.js/);
 await assert.rejects(()=>install.runInstall({file:'x',args:[]},{spawner:fake(1,'boom')}),/退出码 1/);
 const hanging=()=>{const c=new EventEmitter();c.kill=()=>{};return c;};await assert.rejects(()=>install.runInstall({file:'x',args:[]},{spawner:hanging,timeoutMs:5}),/超时/);
});
test('Qoder sign-in state comes from its JSON status and anything else counts as signed out',()=>{
 assert.deepEqual(catalog.parseQoderStatus(JSON.stringify({logged_in:true,email:'a@b.invalid',username:'a',login_method:'browser',org_id:'o'})),{loggedIn:true,email:'a@b.invalid',username:'a',method:'browser',org:'o'});
 for(const text of [JSON.stringify({logged_in:false,version:'1'}),'Not logged in','','{"logged_in":"true"}','null'])assert.equal(catalog.parseQoderStatus(text).loggedIn,false,text);
});
test('Qoder accounts get an isolated home and no launcher, and custom providers stay rejected',async t=>{
 const root=await fixture(t),manager=new Connections(root,{});const account={id:'q1',name:'Qoder',provider:'subscription',agentToolId:'qoder-cli'};
 await manager.provision(account,'');assert.equal(account.launchPath,undefined);assert.equal(manager.officialHome('q1','qoder-cli'),path.join(root,'accounts','q1','qoder-cli'));
 for(const protocol of ['messages','chat','responses'])assert.throws(()=>connect({agentToolId:'qoder-cli',protocol}),/不支持/);
});
test('official sign-in state is read per CLI and unknown output counts as signed out',async t=>{
 const root=await fixture(t);
 assert.equal(catalog.parseCodexStatus(0,'Logged in using ChatGPT').method,'ChatGPT');
 for(const [code,text] of [[1,'Not logged in'],[0,'Not logged in'],[0,''],[2,'Logged in using ChatGPT']])assert.equal(catalog.parseCodexStatus(code,text).loggedIn,false);
 const codex=catalog.officialProfile('codex-cli');assert.equal((await codex.status(async args=>{assert.deepEqual(args,['login','status']);return {code:0,stdout:'',stderr:'Logged in using ChatGPT'};})).loggedIn,true);
 const opencode=catalog.officialProfile('opencode'),oc=path.join(root,'o');assert.equal((await opencode.status(null,oc)).loggedIn,false);
 await fs.mkdir(path.join(oc,'data/opencode'),{recursive:true});await fs.writeFile(path.join(oc,'data/opencode/auth.json'),'{}');assert.equal((await opencode.status(null,oc)).loggedIn,false);
 await fs.writeFile(path.join(oc,'data/opencode/auth.json'),'{"openai":{"type":"oauth","access":"secret"}}');const signed=await opencode.status(null,oc);assert.deepEqual([signed.loggedIn,signed.method],[true,'openai']);assert.ok(!JSON.stringify(signed).includes('secret'));
 assert.throws(()=>catalog.officialProfile('claude-code'));
});
test('official profiles isolate each account and clear credentials that would override it',async t=>{
 const root=await fixture(t);
 const codex=await catalog.prepareOfficial('codex-cli',path.join(root,'c'));assert.deepEqual(codex.env,{CODEX_HOME:path.join(root,'c')});assert.deepEqual(codex.loginArgs,['login']);assert.ok(codex.clearEnv.includes('OPENAI_API_KEY'));
 const opencode=await catalog.prepareOfficial('opencode',path.join(root,'o'));assert.deepEqual(opencode.env,{XDG_DATA_HOME:path.join(root,'o','data')});assert.deepEqual(opencode.loginArgs,['auth','login']);
 assert.throws(()=>catalog.officialProfile('gemini-cli'));
});
test('Codex usage maps both windows by length and survives a failing app server',async()=>{
 const limits={rateLimits:{primary:{usedPercent:12,windowDurationMins:10080,resetsAt:200},secondary:{usedPercent:3,windowDurationMins:300,resetsAt:100}}};
 assert.deepEqual(usage.parseCodexLimits(limits),{seven_day:{used_percentage:12,resets_at:200},five_hour:{used_percentage:3,resets_at:100}});
 assert.equal(usage.parseCodexLimits({}),null);assert.equal(usage.parseCodexLimits({rateLimits:{primary:{windowDurationMins:300}}}),null);
 const fake=(reply)=>()=>{const c=new EventEmitter(),sent=[];c.stdout=new EventEmitter();c.stdin=new EventEmitter();c.kill=()=>{};c.stdin.write=l=>{const m=JSON.parse(l);sent.push(m);setImmediate(()=>reply(m,c));};return c;};
 const ok=fake((m,c)=>{if(m.id===1)c.stdout.emit('data','{"id":1,"result":{}}\n');if(m.id===2)c.stdout.emit('data',JSON.stringify({id:2,result:limits})+'\n');});
 assert.equal((await usage.readCodexUsage('x',{}, {spawner:ok})).five_hour.used_percentage,3);
 assert.equal(await usage.readCodexUsage('x',{}, {spawner:fake(()=>{}),timeoutMs:5}),null);
 assert.equal(await usage.readCodexUsage('x',{}, {spawner:()=>{throw new Error('no');}}),null);
 assert.equal(await usage.readCodexUsage('x',{}, {spawner:fake((m,c)=>c.emit('close',1))}),null);
});
test('Qoder credits report an exhausted account as used up even when the percentage reads zero',()=>{
 assert.deepEqual(usage.parseQoderCredits({total_usage_percentage:0,is_quota_exceeded:true,total_remaining:0,expires_at:2000,unit:'credits'}),{credits:{used_percentage:100,exceeded:true,remaining:0,unit:'credits',resets_at:2}});
 assert.equal(usage.parseQoderCredits({total_usage_percentage:40,is_quota_exceeded:false,total_remaining:60}).credits.used_percentage,40);
 for(const value of [undefined,null,'x',{}])assert.equal(usage.parseQoderCredits(value),null);
});
test('OpenCode stats are read from its table and an unexpected format yields nothing',()=>{
 const table='│Sessions                                              3 │\n│Total Cost                                        $1.25 │\n│Input                                              1.2K │\n│Output                                               300 │\n';
 assert.deepEqual(usage.parseOpencodeStats(table),{local:{cost:'$1.25',input:'1.2K',output:'300',sessions:'3'}});
 assert.equal(usage.parseOpencodeStats('nothing useful'),null);
});
