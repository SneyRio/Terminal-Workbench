const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store, hash, inside, cleanEnv, buildHandoff } = require('../electron/core.cjs');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'accountor-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=path.join(root,'project');await fs.mkdir(project);
  const store=new Store(path.join(root,'data'));await store.load();
  await store.update(s=>s.workspaces.push({id:'w',projects:[{path:project}]}));
  return {root,project,store};
}
test('bundled terminal font applies once on upgrade and later user choices survive restart',async t=>{
  const {store}=await fixture(t);
  await store.update(s=>{s.settings.fontFamily='Menlo';delete s.settings.terminalFontVersion;});
  const upgrade=new Store(store.root);await upgrade.load();
  assert.equal(upgrade.state.settings.fontFamily,'JetBrains Mono');
  await upgrade.update(s=>{s.settings.fontFamily='Monaco';});
  const reopened=new Store(store.root);await reopened.load();
  assert.equal(reopened.state.settings.fontFamily,'Monaco');
  assert.equal(reopened.state.settings.terminalFontVersion,1);
});
test('serial state updates survive concurrent callers and restart',async t=>{
  const {store}=await fixture(t);
  await Promise.all(Array.from({length:20},(_,i)=>store.update(s=>s.accounts.push({id:String(i)}))));
  const second=new Store(store.root);await second.load();assert.equal(second.state.accounts.length,20);
});
test('file editing saves UTF-8 and detects external modifications',async t=>{
  const {store,project}=await fixture(t);const file=path.join(project,'test.md');await fs.writeFile(file,'# 中文\r\n');
  const opened=await store.read('w',file);assert.equal(opened.text,'# 中文\r\n');
  const saved=await store.save('w',file,'# 编辑\r\n',opened.version);assert.equal(saved.saved,true);
  await fs.writeFile(file,'CLI writes');
  const conflict=await store.save('w',file,'editor writes',saved.version);
  assert.equal(conflict.conflict,true);assert.equal(await fs.readFile(file,'utf8'),'CLI writes');
});
test('concurrent saves of the same baseline cannot silently overwrite each other',async t=>{
  const {store,project}=await fixture(t);const file=path.join(project,'shared.txt');await fs.writeFile(file,'base');
  const version=hash('base');const results=await Promise.all([store.save('w',file,'first',version),store.save('w',file,'second',version)]);
  assert.equal(results.filter(x=>x.saved).length,1);assert.equal(results.filter(x=>x.conflict).length,1);
});
test('file scope rejects sibling-prefix, traversal and symlink escapes',async t=>{
  const {store,root,project}=await fixture(t);const secret=path.join(root,'outside.txt');await fs.writeFile(secret,'outside');
  await fs.symlink(secret,path.join(project,'link'));
  await assert.rejects(store.read('w',secret),/授权/);await assert.rejects(store.read('w',path.join(project,'link')),/授权/);
  assert.equal(inside(project,project+'-other/file'),false);assert.equal(inside(project,path.join(project,'ok')),true);
});
test('binary, invalid UTF-8 and oversized files are not truncated into editable text',async t=>{
  const {store,project}=await fixture(t);
  for(const [name,content]of [['binary',Buffer.from([0,1,2])],['encoding',Buffer.from([255,254,240])],['big',Buffer.alloc(2*1024*1024+1,65)]]){
    const file=path.join(project,name);await fs.writeFile(file,content);const result=await store.read('w',file);assert.ok(result.binary||result.tooLarge);
  }
});
test('read-only file save fails without clearing its original bytes',async t=>{
  const {store,project}=await fixture(t);const file=path.join(project,'readonly');await fs.writeFile(file,'original');await fs.chmod(file,0o444);
  await assert.rejects(store.save('w',file,'change',hash('original')));assert.equal(await fs.readFile(file,'utf8'),'original');await fs.chmod(file,0o644);
});
test('subscription process environment removes inherited gateway authentication',()=>{
  const env=cleanEnv({PATH:'/bin',BROWSER:'google-chrome',ANTHROPIC_API_KEY:'secret',ANTHROPIC_BASE_URL:'gateway',CLAUDECODE:'1',CLAUDE_CONFIG_DIR:'old',SHELL:'/bin/zsh'},'/managed/account');
  assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.ANTHROPIC_BASE_URL,undefined);assert.equal(env.CLAUDECODE,undefined);assert.equal(env.CLAUDE_CONFIG_DIR,'/managed/account');assert.equal(env.PATH,'/bin');
  if(process.platform==='darwin')assert.equal(env.BROWSER,'/usr/bin/open');
});
test('handoff preserves conversation facts without native tool schema, reasoning or credentials',()=>{
 const raw=[{type:'user',message:{content:'Remember ACCOUNTOR_CONTEXT_MARKER'}},{type:'assistant',message:{content:[{type:'thinking',thinking:'private reasoning'},{type:'tool_definition',name:'native-tool'},{type:'text',text:'The task is saved. sk-ant-abc123 and API_KEY=secret-value'}]}},{type:'user',message:{content:[{type:'tool_result',content:'Tests passed: 7'}]}}].map(x=>JSON.stringify(x)).join('\n');
 const bundle=buildHandoff(raw,{accountName:'source',cwd:'/workspace',projects:[{path:'/workspace'}]});
 assert.match(bundle.text,/ACCOUNTOR_CONTEXT_MARKER/);assert.match(bundle.text,/Tests passed: 7/);assert.doesNotMatch(bundle.text,/private reasoning|tool_definition|sk-ant-abc123|secret-value/);assert.equal(bundle.truncated,false);
});
