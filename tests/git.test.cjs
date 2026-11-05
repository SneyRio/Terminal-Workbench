const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {Store}=require('../electron/core.cjs');
const {parseStatus,parseNumstat,snapshot,diff}=require('../electron/git.cjs');
const exec=promisify(execFile);
test('NUL git parsing preserves spaces, tabs, newlines, Chinese and rename paths',()=>{
 const rows=parseStatus('RM 新 名.txt\0old\tname.txt\0?? line\nbreak.md\0UU conflict.txt\0');
 assert.equal(rows[0].path,'新 名.txt');assert.equal(rows[0].originalPath,'old\tname.txt');assert.equal(rows[1].path,'line\nbreak.md');assert.equal(rows[2].status,'conflict');
 const stats=parseNumstat('2\t3\t\0old\0新 名.txt\0-\t-\timage.png\0');
 assert.deepEqual(stats['新 名.txt'],{added:2,deleted:3});assert.deepEqual(stats['image.png'],{added:null,deleted:null});
 const special=parseNumstat('1\t0\t__proto__'+String.fromCharCode(0));assert.equal(special.__proto__.added,1);assert.equal(special.toString,undefined);
});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'accountor-git-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const project=path.join(root,'project');await fs.mkdir(path.join(project,'src'),{recursive:true});
 const git=async(...args)=>(await exec('git',['-c','core.hooksPath=/dev/null','-C',project,...args],{env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout;
 await git('init','-b','fixture');await fs.writeFile(path.join(project,'src/change.ts'),'first\nold\n');await fs.writeFile(path.join(project,'src/original.txt'),'rename me\n');await fs.writeFile(path.join(project,'delete.txt'),'delete me\n');await fs.writeFile(path.join(project,'binary.bin'),Buffer.from([0,1,2]));
 await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
 const store=new Store(path.join(root,'data'));await store.load();await store.update(s=>s.workspaces.push({id:'w',projects:[{path:project}]}));return {root,project,git,store};
}
test('graphical git distinguishes index/worktree, renames, deleted, binary and untracked without modifying repo',async t=>{
 const {project,git,store}=await fixture(t);
 await fs.writeFile(path.join(project,'src/change.ts'),'first\nstaged\n');await git('add','src/change.ts');await fs.writeFile(path.join(project,'src/change.ts'),'first\nworking\n');
 await git('mv','src/original.txt','src/renamed name.txt');await fs.rm(path.join(project,'delete.txt'));await fs.writeFile(path.join(project,'binary.bin'),Buffer.from([0,3,4]));await fs.writeFile(path.join(project,'新\tfile.txt'),'new\n');
 const before=await git('status','--porcelain=v1','-z'),head=await git('rev-parse','HEAD');
 const data=await snapshot(store,'w',project);assert.equal(data.branch,'fixture');
 const file=data.entries.find(e=>e.path==='src/change.ts');assert.equal(file.index,'M');assert.equal(file.worktree,'M');assert.equal(file.stagedStats.added,1);assert.equal(file.worktreeStats.deleted,1);
 assert.equal(data.entries.find(e=>e.path==='src/renamed name.txt').originalPath,'src/original.txt');assert.equal(data.entries.find(e=>e.path==='binary.bin').worktreeStats.added,null);
 const staged=await diff(store,'w',project,file.path,'staged'),working=await diff(store,'w',project,file.path,'worktree');
 assert(staged.lines.some(l=>l.type==='added'&&l.text==='staged'));assert(working.lines.some(l=>l.type==='deleted'&&l.text==='staged'));assert(working.lines.some(l=>l.type==='added'&&l.text==='working'));
 assert((await diff(store,'w',project,'delete.txt','worktree')).lines.some(l=>l.type==='deleted'&&l.text==='delete me'));
 assert.equal((await diff(store,'w',project,'binary.bin','worktree')).binary,true);
 assert.equal((await diff(store,'w',project,'新\tfile.txt','untracked')).lines.filter(l=>l.type==='added').length,1);
 assert.equal(await git('status','--porcelain=v1','-z'),before);assert.equal(await git('rev-parse','HEAD'),head);
});
test('git scope excludes sibling projects and rejects arbitrary paths and symlink reads',async t=>{
 const {root,project,store}=await fixture(t);await fs.writeFile(path.join(project,'src/new.txt'),'inside');await fs.writeFile(path.join(project,'outside.txt'),'outside');
 await store.update(s=>s.workspaces.push({id:'sub',projects:[{path:path.join(project,'src')}]}));
 const data=await snapshot(store,'sub',path.join(project,'src'));assert(data.entries.some(e=>e.path==='src/new.txt'));assert(!data.entries.some(e=>e.path==='outside.txt'));
 await assert.rejects(()=>diff(store,'sub',path.join(project,'src'),'outside.txt','untracked'));
 await fs.writeFile(path.join(root,'private.txt'),'PRIVATE');await fs.symlink(path.join(root,'private.txt'),path.join(project,'escape.link'));
 await assert.rejects(()=>diff(store,'w',project,'escape.link','untracked'));
 await assert.rejects(()=>diff(store,'w',project,'../private.txt','untracked'));
});
