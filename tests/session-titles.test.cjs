const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {taskText,defaultTitle,migrateTitle,applyTaskTitle,copyTitle,transcriptTitle,migrateEmbedded}=require('../electron/session-titles.cjs');
const {legacyActivity}=require('../electron/app-migration.cjs');
test('task titles ignore greetings, tool/system wrappers, and redact common credentials',()=>{
  assert.equal(taskText('你好！'),'');assert.equal(taskText('继续'),'');assert.equal(taskText('/clear'),'');
  assert.equal(taskText('<system-reminder>internal</system-reminder>\n请帮我修复会话恢复重复窗口'), '修复会话恢复重复窗口');
  assert(!taskText('检查 token=SECRET_ACCOUNT_KEY 的配置').includes('SECRET_ACCOUNT_KEY'));
  assert([...taskText('长'.repeat(100))].length<=33);
});
test('distinct fallback titles upgrade once to a task and preserve manual names through replacement',()=>{
  const a={id:'abc-123456',kind:'claude',cwd:'/p/project',title:'Claude · A'},b={...a,id:'abc-654321'};
  migrateTitle(a,{name:'A'});migrateTitle(b,{name:'A'});assert.notEqual(a.title,b.title);
  assert(applyTaskTitle(a,'修复复制快捷键'));assert.equal(a.title,'修复复制快捷键 · 123456');assert(!applyTaskTitle(a,'其他任务'));
  a.title='我的发布任务';a.titleSource='manual';const target={id:'new'};copyTitle(a,target);assert.equal(target.titleSource,'manual');assert(!applyTaskTitle(target,'覆盖失败'));
  const oldCustom={id:'custom',title:'原来的自定义名称',kind:'claude'};migrateTitle(oldCustom,{name:'A'});assert.equal(oldCustom.titleSource,'manual');assert.equal(oldCustom.title,'原来的自定义名称');
});
test('bounded transcript extraction finds user task, skips tool results and handles truncated lines',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-titles-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'t.jsonl');
  const rows=[{type:'user',isMeta:true,message:{role:'user',content:'system wrapper'}},{type:'user',message:{role:'user',content:[{type:'tool_result',content:'tool noise'}]}},{type:'user',message:{role:'user',content:'hi'}},{type:'user',message:{role:'user',content:[{type:'image',source:{}},{type:'text',text:'请修复客户端草稿格式'}]}}];
  await fs.writeFile(file,rows.map(JSON.stringify).join('\n')+'\n{partial');assert.equal(await transcriptTitle(file),'修复客户端草稿格式');
});
test('embedded migration covers archived workspaces without deleting conversation or account metadata',()=>{
  const source={id:'s',backend:'iterm2',status:'external',claudeSessionId:'native',accountId:'a',iterm:{sessionId:'external'},pid:123};const s={workspaces:[{backend:'iterm2'}],sessions:[source],deletedWorkspaces:[{workspace:{backend:'iterm2'},sessions:[{session:{...source}}]}]};
  migrateEmbedded(s);assert.equal(s.workspaces[0].backend,'embedded');assert.equal(source.status,'interrupted');assert.equal(source.claudeSessionId,'native');assert.equal(source.accountId,'a');assert.equal(source.iterm,undefined);assert.equal(source.pid,undefined);assert.equal(s.deletedWorkspaces[0].sessions[0].session.backend,'embedded');
});
test('legacy app retirement detects main app and external CLI dependencies without terminating them',()=>{
  const root='/Applications/Claude Accountor.app';assert.deepEqual(legacyActivity('123 '+root+'/Contents/MacOS/Claude Accountor',root),{inUse:true,mainRunning:true});assert.deepEqual(legacyActivity('124 /usr/local/bin/claude --settings '+root+'/Contents/Resources/app/scripts/claude-telemetry.cjs',root),{inUse:true,mainRunning:false});assert.deepEqual(legacyActivity('125 /Applications/终端工作站.app/Contents/MacOS/终端工作站',root),{inUse:false,mainRunning:false});
});
