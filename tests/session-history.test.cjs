const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../electron/core.cjs');
const {RETENTION_MS,archiveSession,pruneDeleted,findDeleted,forgetDeleted,replaceSession,deduplicateRecovered}=require('../electron/session-history.cjs');
const state=()=>({workspaces:[{id:'a',name:'空间 A',projects:[{path:'/fixture/a'}]},{id:'b',name:'空间 B',projects:[{path:'/fixture/b'}]}],sessions:[],deletedWorkspaces:[]});
test('manual archives persist workspace/session hierarchy and immutable original metadata',()=>{
  const s=state(),record={id:'s1',workspaceId:'a',title:'原名',claudeSessionId:'native',cwd:'/fixture/a',projects:[{path:'/fixture/a'}]};
  archiveSession(s,record,1000);archiveSession(s,{id:'s2',workspaceId:'a'},2000);archiveSession(s,{id:'s3',workspaceId:'b'},3000);
  record.title='changed';assert.equal(s.deletedWorkspaces.length,2);assert.equal(s.deletedWorkspaces[0].sessions.length,2);
  assert.equal(findDeleted(s,'s1').row.session.title,'原名');assert.equal(findDeleted(s,'s1').row.expiresAt,1000+RETENTION_MS);
  forgetDeleted(s,'s3');assert.equal(s.deletedWorkspaces.length,1);
});
test('seven-day expiration is exact and leaves retained workspaces, sessions and project references intact',()=>{
  const s=state(),now=10*RETENTION_MS;
  archiveSession(s,{id:'edge',workspaceId:'a'},now-RETENTION_MS);archiveSession(s,{id:'recent',workspaceId:'b'},now-RETENTION_MS+1);
  pruneDeleted(s,now);assert.equal(findDeleted(s,'edge'),undefined);assert.equal(findDeleted(s,'recent').row.session.id,'recent');
  pruneDeleted(s,now+1);assert.equal(s.deletedWorkspaces.length,0);assert.equal(s.workspaces.length,2);
});
test('automatic replacement never archives source and keeps split siblings and selections',()=>{
  const s=state(),old={id:'old',workspaceId:'a',groupId:'split'},next={id:'new',workspaceId:'a',groupId:'split'},sibling={id:'sibling',workspaceId:'a',groupId:'split'};
  s.sessions=[old,next,sibling];Object.assign(s.workspaces[0],{selectedSession:'old',hiddenGroups:['split','gone']});
  replaceSession(s,'old',next);assert.deepEqual(s.sessions,[next,sibling]);assert.equal(s.workspaces[0].selectedSession,'new');assert.deepEqual(s.workspaces[0].hiddenGroups,['split']);assert.equal(s.deletedWorkspaces.length,0);
});
test('trash survives restart and expired entries are pruned while original files remain',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'accountor-trash-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'history.jsonl');await fs.writeFile(file,'ORIGINAL');
  const store=new Store(path.join(root,'data'));await store.load();
  await store.update(s=>{s.workspaces=state().workspaces;archiveSession(s,{id:'keep',workspaceId:'a',transcript:file});archiveSession(s,{id:'expire',workspaceId:'b',transcript:file});findDeleted(s,'expire').row.deletedAt=Date.now()-RETENTION_MS;});
  const reopened=new Store(store.root);await reopened.load();assert.ok(findDeleted(reopened.state,'keep'));assert.equal(findDeleted(reopened.state,'expire'),undefined);assert.equal(await fs.readFile(file,'utf8'),'ORIGINAL');
});

test('legacy recovery duplicates collapse only for the same embedded native conversation without entering trash',()=>{
  const s=state(),base={kind:'claude',backend:'embedded',workspaceId:'a',accountId:'account',cwd:'/fixture/a',claudeSessionId:'native',groupId:'g'};
  s.sessions=[{...base,id:'old',createdAt:1},{...base,id:'restored',createdAt:2,recovery:'requested'},{...base,id:'other-account',accountId:'different'},{...base,id:'external',backend:'iterm2'}];
  deduplicateRecovered(s);assert.deepEqual(s.sessions.map(r=>r.id),['restored','other-account','external']);assert.equal(s.deletedWorkspaces.length,0);
});
