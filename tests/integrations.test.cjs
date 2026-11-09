const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const ig=require('../electron/integrations.cjs');

test('servers are validated and secrets kept unless replaced',()=>{
 const first=ig.normalizeServers([{id:'a',name:'github',type:'stdio',command:'npx',args:['-y','gh-mcp'],env:{GITHUB_TOKEN:'t1'}},{id:'b',name:'remote',type:'http',url:'https://x.example/mcp',headers:{Authorization:'Bearer 1'},agents:ig.AGENT_IDS}],{});
 assert.deepEqual(first.servers.map(s=>[s.name,s.envKeys,s.headerKeys,s.agents]),[['github',['GITHUB_TOKEN'],[],[]],['remote',[],['Authorization'],[]]]);
 assert.equal(first.secrets.a.env.GITHUB_TOKEN,'t1');
 const second=ig.normalizeServers([{...first.servers[0],enabled:false},{...first.servers[1],headers:{'X-Key':'2'}}],first.secrets,first.servers);
 assert.equal(second.secrets.a.env.GITHUB_TOKEN,'t1');assert.deepEqual(second.secrets.b.headers,{'X-Key':'2'});assert.equal(second.servers[0].enabled,false);
 assert.throws(()=>ig.normalizeServers([{name:'a.b',command:'x'}],{}),/名称/);
 assert.throws(()=>ig.normalizeServers([{name:'a',command:'x'},{name:'A',command:'y'}],{}),/重复/);
 assert.throws(()=>ig.normalizeServers([{name:'a',type:'http',url:'ftp://x'}],{}),/HTTP/);
 assert.throws(()=>ig.normalizeServers([{name:'a',command:''}],{}),/命令/);
});

test('scanning reads Claude, Qoder, OpenCode and portable Codex servers',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'wb-mcp-'));
 try{
  await fs.writeFile(path.join(home,'.claude.json'),JSON.stringify({mcpServers:{shared:{type:'http',url:'https://a.example/mcp',headers:{Authorization:'Bearer a'}}}}));
  await fs.mkdir(path.join(home,'.claude-work'));await fs.writeFile(path.join(home,'.claude-work','.claude.json'),JSON.stringify({mcpServers:{files:{command:'npx',args:['-y','fs-mcp'],env:{ROOT:'/tmp'}}}}));
  await fs.mkdir(path.join(home,'.qoder'));await fs.writeFile(path.join(home,'.qoder','mcp.json'),JSON.stringify({mcpServers:{shared:{type:'http',url:'https://other.example'},off:{type:'http',url:'https://off.example',disabled:true}}}));
  await fs.mkdir(path.join(home,'.config','opencode'),{recursive:true});await fs.writeFile(path.join(home,'.config','opencode','opencode.json'),'// comment\n'+JSON.stringify({mcp:{oc:{type:'local',command:['uvx','oc-mcp'],environment:{K:'v'}},rm:{type:'remote',url:'https://rm.example',enabled:false}}}));
  const codexList=[{name:'cx',enabled:true,transport:{type:'stdio',command:'npx',args:['cx'],env:null,env_vars:[],cwd:null}},{name:'cx-http',enabled:true,transport:{type:'streamable_http',url:'https://cx.example',http_headers:{A:'1'}}},{name:'node_repl',enabled:true,transport:{type:'stdio',command:'/Applications/ChatGPT.app/x/node_repl',args:[],env_vars:[]}},{name:'cu',enabled:false,transport:{type:'stdio',command:'./Codex.app/x',args:[],cwd:'.'}},{name:'fw',enabled:true,transport:{type:'stdio',command:'/bin/sh',args:[],env_vars:['PATH']}}];
  const found=await ig.scanMcp({home,codexList});
  assert.deepEqual(found.map(s=>[s.name,s.source,s.type,s.enabled]),[['shared','Claude','http',true],['files','Claude','stdio',true],['shared','Qoder','http',true],['off','Qoder','http',false],['oc','OpenCode','stdio',true],['rm','OpenCode','http',false],['cx','Codex','stdio',true],['cx-http','Codex','http',true]]);
  const merged=ig.mergeScanned([],{},found,['rm']);
  assert.deepEqual(merged.added,['shared','files','off','oc','cx','cx-http']);
  const shared=merged.servers.find(s=>s.name==='shared');assert.equal(shared.url,'https://a.example/mcp');assert.deepEqual(merged.secrets[shared.id].headers,{Authorization:'Bearer a'});
  assert.equal(merged.servers.find(s=>s.name==='off').enabled,false);
  assert.deepEqual(ig.mergeScanned(merged.servers,merged.secrets,found,[]).added,['rm']);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});

test('each agent receives MCP servers in its own format',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wb-mcpl-')),file=path.join(dir,'m.json');
 try{
  const {servers,secrets}=ig.normalizeServers([{id:'a',name:'gh',command:'npx',args:['-y','gh "x"'],env:{TOKEN:'t'}},{id:'b',name:'web',type:'http',url:'https://w.example/mcp',headers:{Authorization:'Bearer b'}},{id:'c',name:'off',command:'x',enabled:false},{id:'d',name:'only-oc',command:'y',agents:['opencode']}],{});
  const claude=await ig.mcpLaunch('claude-code',servers,secrets,{file});
  assert.deepEqual(claude.args,['--mcp-config',file]);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{mcpServers:{gh:{type:'stdio',command:'npx',args:['-y','gh "x"'],env:{TOKEN:'t'}},web:{type:'http',url:'https://w.example/mcp',headers:{Authorization:'Bearer b'}}}});
  assert.deepEqual((await ig.mcpLaunch('qoder-cli',servers,secrets,{file})).args,['--mcp-config',file]);
  assert.deepEqual((await ig.mcpLaunch('codex-cli',servers,secrets,{file})).args,['-c','mcp_servers.gh.command="npx"','-c','mcp_servers.gh.args=["-y","gh \\"x\\""]','-c','mcp_servers.gh.env={TOKEN="t"}','-c','mcp_servers.web.url="https://w.example/mcp"','-c','mcp_servers.web.http_headers={Authorization="Bearer b"}']);
  const oc=await ig.mcpLaunch('opencode',servers,secrets,{env:{OPENCODE_CONFIG_CONTENT:JSON.stringify({model:'x/m',mcp:{mine:{type:'local',command:['z']}}})}});
  assert.deepEqual(JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT).mcp,{mine:{type:'local',command:['z']},gh:{type:'local',command:['npx','-y','gh "x"'],enabled:true,environment:{TOKEN:'t'}},web:{type:'remote',url:'https://w.example/mcp',enabled:true,headers:{Authorization:'Bearer b'}},'only-oc':{type:'local',command:['y'],enabled:true}});
  assert.deepEqual(await ig.mcpLaunch('claude-code',[],{},{file}),{args:[],env:{},file:''});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('the secret store keeps MCP values encrypted on disk',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wb-mcps-'));
 const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s,'utf8').reverse(),decryptString:b=>Buffer.from(b).reverse().toString('utf8')};
 try{
  const store=new ig.McpSecrets(path.join(dir,'s.enc'),vault);
  assert.deepEqual(await store.read(),{});
  await store.write({a:{env:{TOKEN:'secret-value'},headers:{}}});
  assert.equal((await fs.readFile(path.join(dir,'s.enc'))).includes(Buffer.from('secret-value')),false);
  assert.deepEqual(await store.read(),{a:{env:{TOKEN:'secret-value'},headers:{}}});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('command-line tools are found, merged and described for the agent',async()=>{
 // Executable bits do not exist on Windows, so the file system is simulated: rg is present but not executable.
 const dir='/opt/wb-cli',executable=new Set(['/opt/wb-cli/gh','/opt/wb-cli/jq']);
 const access=async(file,mode)=>{if(mode!==1)throw new Error('mode');if(!executable.has(file))throw Object.assign(new Error('EACCES'),{code:'EACCES'});};
 const found=await ig.scanCli(['/nonexistent',dir],{platform:'darwin',access});
 assert.deepEqual(found.map(f=>f.command),['gh','jq']);
 const merged=ig.mergeScannedTools([{id:'x',command:'gh',path:'',description:'mine',enabled:true,agents:[],source:'manual'}],found);
 assert.deepEqual(merged.added,['jq']);assert.equal(merged.tools[0].path,'/opt/wb-cli/gh');assert.equal(merged.tools[0].description,'mine');assert.equal(merged.tools[1].enabled,false);
 const tools=ig.normalizeTools([...merged.tools,{command:'devops-token',path:'/Users/me/.local/bin/devops-token',description:'取 DevOps 令牌',enabled:true,agents:['codex-cli']}]);
 const forClaude=ig.cliLaunch(tools,'claude-code','darwin'),forCodex=ig.cliLaunch(tools,'codex-cli','darwin');
 assert.deepEqual(forClaude.dirs,[dir]);assert.match(forClaude.prompt,/- gh（.*gh）：mine/);assert.doesNotMatch(forClaude.prompt,/jq|devops/);
 assert.deepEqual(forCodex.dirs,[dir,'/Users/me/.local/bin']);assert.match(forCodex.prompt,/devops-token/);
 assert.deepEqual(ig.cliLaunch([],'opencode'),{dirs:[],prompt:''});
 assert.throws(()=>ig.normalizeTools([{command:'a b'}]),/命令名/);assert.throws(()=>ig.normalizeTools([{command:'a',path:'rel/a'}]),/绝对路径/);
});
test('Windows tool lookup tries .exe, .cmd and .bat without an executable bit',async()=>{
 const seen=[],access=async(file,mode)=>{seen.push([file,mode]);if(file!=='C:\\tools\\gh.cmd')throw new Error('ENOENT');};
 assert.equal(await ig.findOnPath('gh',['C:\\tools'],{platform:'win32',access}),'C:\\tools\\gh.cmd');
 assert.deepEqual(seen,[['C:\\tools\\gh.exe',undefined],['C:\\tools\\gh.cmd',undefined]]);
});

test('${VAR} references are expanded for every agent from the session environment',async()=>{
 const vars={TOKEN:'abc',EMPTY:''},lookup=n=>vars[n];
 assert.equal(ig.expandVars('Bearer ${TOKEN}',lookup),'Bearer abc');
 assert.equal(ig.expandVars('${MISSING:-dflt}/${EMPTY:-x}',lookup),'dflt/x');
 assert.equal(ig.expandVars('${MISSING} $TOKEN',lookup),'${MISSING} $TOKEN');
 const {servers,secrets}=ig.normalizeServers([{id:'b',name:'web',type:'http',url:'https://${HOST:-w.example}/mcp',headers:{Authorization:'Bearer ${TOKEN}'}}],{});
 const codex=await ig.mcpLaunch('codex-cli',servers,secrets,{lookup});
 assert.deepEqual(codex.args,['-c','mcp_servers.web.url="https://w.example/mcp"','-c','mcp_servers.web.http_headers={Authorization="Bearer abc"}']);
 assert.equal(secrets.b.headers.Authorization,'Bearer ${TOKEN}');
});
