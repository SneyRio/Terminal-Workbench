const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const sp=require('../electron/system-prompts.cjs');

test('entries are cleaned, capped and default to every agent',()=>{
 const [a,b]=sp.normalizePrompts([{id:'one',name:'  中文\n回复 ',text:'a\r\nb\x07c',agents:['codex-cli','nope']},{id:'one',text:'x',enabled:false,agents:sp.AGENT_IDS}]);
 assert.deepEqual(a,{id:'one',name:'中文 回复',text:'a\nbc',enabled:true,agents:['codex-cli']});
 assert.notEqual(b.id,'one');assert.equal(b.name,'提示词 2');assert.equal(b.enabled,false);assert.deepEqual(b.agents,[]);
 assert.throws(()=>sp.normalizePrompts('x'),/格式无效/);
 assert.throws(()=>sp.normalizePrompts([{text:'x'.repeat(sp.MAX_TEXT+1)}]),/超过/);
 assert.throws(()=>sp.normalizePrompts(Array(sp.MAX_ENTRIES+1).fill({})),/最多/);
});

test('only enabled, non-empty entries for the agent are joined in order',()=>{
 const list=[{text:' 全局 ',enabled:true,agents:[]},{text:'仅 Codex',enabled:true,agents:['codex-cli']},{text:'停用',enabled:false,agents:[]},{text:'   ',enabled:true,agents:[]}];
 assert.equal(sp.promptFor(list,'codex-cli'),'全局\n\n仅 Codex');
 assert.equal(sp.promptFor(list,'qoder-cli'),'全局');
 assert.equal(sp.promptFor(undefined,'opencode'),'');
});

test('each agent receives the prompt the way its CLI accepts it',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wb-prompt-')),file=path.join(dir,'s','p.md');
 try{
  assert.deepEqual(await sp.launchPlan('claude-code','',{file}),{before:[],after:[],env:{},file:''});
  const claude=await sp.launchPlan('claude-code','规则',{file});
  assert.deepEqual(claude.after,['--append-system-prompt-file',file]);assert.equal(await fs.readFile(file,'utf8'),'规则\n');
  const handoff=path.join(dir,'h.md');await fs.writeFile(handoff,'交接内容');
  await sp.launchPlan('claude-code','规则',{file,handoffFile:handoff});
  assert.equal(await fs.readFile(file,'utf8'),'规则\n\n交接内容\n');
  const codex=await sp.launchPlan('codex-cli','a "b"\nc',{file});
  assert.deepEqual(codex.before,['-c','developer_instructions="a \\"b\\"\\nc"']);assert.deepEqual(codex.after,[]);
  assert.deepEqual((await sp.launchPlan('qoder-cli','"带 引号"',{file})).after,['--append-system-prompt="带 引号"']);
  const oc=await sp.launchPlan('opencode','规则',{file,env:{OPENCODE_CONFIG_CONTENT:JSON.stringify({model:'wbspace/m',instructions:['x.md']})}});
  assert.deepEqual(JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT),{$schema:'https://opencode.ai/config.json',model:'wbspace/m',instructions:['x.md',file]});
  assert.deepEqual(JSON.parse((await sp.launchPlan('opencode','规则',{file})).env.OPENCODE_CONFIG_CONTENT).instructions,[file]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('Codex behind a Windows .cmd shim gets the prompt through a marked AGENTS.md instead of arguments',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'wb-codex-')),agents=path.join(home,'AGENTS.md'),env={CODEX_HOME:home};
 try{
  const shim=await sp.launchPlan('codex-cli','第一行\n"第二行" 100%',{env,shim:true});
  assert.deepEqual(shim,{before:[],after:[],env:{},file:agents});
  assert.equal(await fs.readFile(agents,'utf8'),sp.CODEX_MARKER+'\n\n第一行\n"第二行" 100%\n');
  // Back on a native executable the arguments take over and the generated file is removed, so nothing applies twice.
  assert.equal((await sp.launchPlan('codex-cli','规则',{env})).before[0],'-c');
  await assert.rejects(fs.access(agents));
  await sp.launchPlan('codex-cli','规则',{env,shim:true});
  await sp.launchPlan('codex-cli','',{env,shim:true});
  await assert.rejects(fs.access(agents));
  // A file the user wrote is never overwritten or deleted.
  await fs.writeFile(agents,'用户自己的说明');
  await assert.rejects(sp.launchPlan('codex-cli','规则',{env,shim:true}),/非 WbSpace 生成/);
  await sp.launchPlan('codex-cli','',{env,shim:true});await sp.launchPlan('codex-cli','规则',{env});
  assert.equal(await fs.readFile(agents,'utf8'),'用户自己的说明');
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
