const {test}=require('node:test'),assert=require('node:assert/strict');
const s=require('../electron/schedules.cjs');
const at=(y,mo,d,h,mi)=>new Date(y,mo-1,d,h,mi).getTime();

test('time rules compute the next run strictly after now in local time',()=>{
 assert.equal(s.nextRun({type:'interval',every:30},1000),1000+30*60000);
 assert.equal(s.nextRun({type:'daily',time:'09:00'},at(2026,11,7,8,59)),at(2026,11,7,9,0));
 assert.equal(s.nextRun({type:'daily',time:'09:00'},at(2026,11,7,9,0)),at(2026,11,8,9,0));
 // 2026-11-07 is a Saturday; the next Monday is the 9th.
 assert.equal(s.nextRun({type:'weekly',time:'10:30',days:[1,3]},at(2026,11,7,12,0)),at(2026,11,9,10,30));
 assert.equal(s.nextRun({type:'cron',expr:'0 9 * * 1-5'},at(2026,11,7,12,0)),at(2026,11,9,9,0));
 assert.equal(s.nextRun({type:'cron',expr:'*/15 * * * *'},at(2026,11,7,12,7)),at(2026,11,7,12,15));
 assert.equal(s.nextRun({type:'cron',expr:'0 0 1 1 *'},at(2026,11,7,12,0)),at(2027,1,1,0,0));
 assert.equal(s.nextRun({type:'cron',expr:'0 8 * * 7'},at(2026,11,7,12,0)),at(2026,11,8,8,0));
});
test('invalid rules and tasks are refused with a reason',()=>{
 for(const rule of [{type:'interval',every:2},{type:'daily',time:'25:00'},{type:'weekly',time:'09:00',days:[]},{type:'cron',expr:'* * *'},{type:'cron',expr:'61 * * * *'},{type:'cron',expr:'0 0 31 2 *'},{type:'hourly'}])
  assert.throws(()=>{s.normalizeRule(rule);if(rule.type==='cron')s.nextRun(rule);},undefined,JSON.stringify(rule));
 const ok={workspaceExists:()=>true,accountExists:()=>true},base={name:'检查',prompt:'看看',workspaceId:'w',accountId:'a',rule:{type:'daily',time:'09:00'}};
 const read=s.normalizeTask(base,ok);assert.equal(read.permission,'read');assert.equal(read.worktree,false);assert.equal(read.timeoutMinutes,30);assert.equal(read.enabled,true);
 assert.equal(s.normalizeTask({...base,permission:'write'},ok).worktree,true);assert.equal(s.normalizeTask({...base,permission:'write',worktree:false},ok).worktree,false);
 assert.equal(s.normalizeTask({...base,permission:'root'},ok).permission,'read');
 for(const bad of [{name:''},{prompt:' '},{timeoutMinutes:0}])assert.throws(()=>s.normalizeTask({...base,...bad},ok));
 assert.throws(()=>s.normalizeTask(base,{workspaceExists:()=>false,accountExists:()=>true}),/工作空间/);
 assert.equal(s.describeRule({type:'weekly',time:'09:00',days:[1,5]}),'每周一、五 09:00');assert.equal(s.describeRule({type:'interval',every:120}),'每 2 小时');
});
test('each agent gets an unattended command with the chosen permission',()=>{
 const claude=s.headlessArgs('claude-code','P','read').args;assert.deepEqual(claude.slice(0,2),['--permission-mode','dontAsk']);assert.ok(claude.includes('Bash')&&claude.includes('Edit'));assert.deepEqual(claude.slice(-2),['-p','P']);
 assert.deepEqual(s.headlessArgs('claude-code','P','full').args,['--permission-mode','bypassPermissions','-p','P']);
 assert.deepEqual(s.headlessArgs('codex-cli','P','read').args,['exec','--skip-git-repo-check','-s','read-only','P']);
 assert.deepEqual(s.headlessArgs('codex-cli','P','write').args,['exec','--skip-git-repo-check','-s','workspace-write','P']);
 assert.ok(s.headlessArgs('codex-cli','P','full').args.includes('--dangerously-bypass-approvals-and-sandbox'));
 assert.deepEqual(s.headlessArgs('qoder-cli','P','read').args,['--permission-mode','dont_ask','-p','P']);
 const oc=s.headlessArgs('opencode','P','read');assert.deepEqual(oc.args,['run','P']);assert.deepEqual(oc.opencodePermission,{edit:'deny',bash:'deny'});
 const merged=JSON.parse(s.mergeOpencodeConfig(JSON.stringify({provider:{x:1},model:'x/m'}),oc.opencodePermission));assert.deepEqual(merged.provider,{x:1});assert.equal(merged.permission.bash,'deny');
 assert.equal(JSON.parse(s.mergeOpencodeConfig('not json',{edit:'allow'})).permission.edit,'allow');
 assert.throws(()=>s.headlessArgs('codex-cli','P','root'));assert.throws(()=>s.headlessArgs('gemini-cli','P','read'));
});
test('a nearly exhausted account is skipped and branch names are safe',()=>{
 assert.equal(s.quotaBlocked({five_hour:{used_percentage:89}}),'');assert.match(s.quotaBlocked({five_hour:{used_percentage:90}}),/五小时/);
 assert.match(s.quotaBlocked({seven_day:{used_percentage:96}}),/本周/);assert.match(s.quotaBlocked({credits:{exceeded:true}}),/Credits/);assert.equal(s.quotaBlocked(undefined),'');
 assert.equal(s.worktreeBranch('每日 Lint 检查!',at(2026,11,7,9,5)),'wbspace/lint-20261107-090500');assert.equal(s.worktreeBranch('中文',at(2026,1,2,3,4)),'wbspace/task-20260102-030400');
});
