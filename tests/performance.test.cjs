const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../electron/core.cjs');
const {DraftBatch,TerminalHistory,appendTerminal,flushTerminal}=require('../electron/performance.cjs');
test('draft bursts coalesce by file and a flush durably saves the latest state',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'accountor-batch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new Store(root);await store.load();let writes=0;const update=store.update.bind(store);store.update=fn=>{writes++;return update(fn);};
 const batch=new DraftBatch(store,()=>{},{delay:10000}),requests=[];
 for(let i=0;i<100;i++)requests.push(batch.enqueue('a',{text:String(i)}));requests.push(batch.enqueue('b',{text:'kept'}));
 await batch.flush();await Promise.all(requests);assert.equal(writes,1);const restarted=new Store(root);await restarted.load();assert.equal(restarted.state.drafts.a.text,'99');assert.equal(restarted.state.drafts.b.text,'kept');
 const clear=batch.enqueue('a',null);await batch.flush();await clear;assert.equal(store.state.drafts.a,undefined);
});
test('input during a draft write is retained and persistence failures can be retried',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);let blocked=true,fail=false,state={drafts:{}};
 const store={update:async fn=>{if(blocked){blocked=false;await gate;}if(fail)throw new Error('disk fixture');fn(state);}};
 const batch=new DraftBatch(store,()=>{},{delay:10000});
 const first=batch.enqueue('a',{text:'first'}),write=batch.flush(),next=batch.enqueue('a',{text:'newer'}),finish=batch.flush();release();await Promise.all([first,write,next,finish]);assert.equal(state.drafts.a.text,'newer');
 fail=true;const rejected=batch.enqueue('a',{text:'retry'});const assertion=assert.rejects(rejected,/disk/);await assert.rejects(batch.flush(),/disk/);await assertion;fail=false;await batch.flush();assert.equal(state.drafts.a.text,'retry');
});
test('terminal batching preserves complete ordered output and coherent snapshot sequence',()=>{
 const runtime={history:new TerminalHistory(10000),pending:[],pendingSize:0,outputTimer:null,seq:0},events=[];
 const notify=(channel,event)=>events.push(event);
 for(let i=0;i<1000;i++)appendTerminal(runtime,'t',String(i)+'\n',notify);
 assert.equal(events.length,0);flushTerminal(runtime,'t',notify);assert.equal(events.length,1);assert.equal(runtime.history.snapshot(),Array.from({length:1000},(_,i)=>String(i)+'\n').join(''));assert.equal(events[0].seq,runtime.seq);
 appendTerminal(runtime,'t','LAST',notify);flushTerminal(runtime,'t',notify);assert.equal(events[1].seq,2);assert(runtime.history.snapshot().endsWith('LAST'));
});
test('terminal history stays bounded through many chunks and large appends',()=>{
 const history=new TerminalHistory(1000);let expected='';for(let i=0;i<10000;i++){const value=String(i)+'中文';history.append(value);expected=(expected+value).slice(-1000);}assert.equal(history.snapshot(),expected);assert.equal(history.length,1000);assert(history.chunks.length<200);
 history.append('x'.repeat(3000));assert.equal(history.snapshot(),'x'.repeat(1000));history.shrink(64);assert.equal(history.snapshot(),'x'.repeat(64));
});
test('unchanged file checks avoid full reads but atomic replacements and same-size edits are detected',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'accountor-stat-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new Store(path.join(root,'data'));await store.load();await store.update(s=>s.workspaces.push({id:'w',projects:[{path:root}]}));
 const file=path.join(root,'file.txt');await fs.writeFile(file,'OLD');const first=await store.read('w',file);let reads=0;const read=store.read.bind(store);store.read=(...args)=>{reads++;return read(...args);};
 for(let i=0;i<10;i++)assert.equal((await store.readIfChanged('w',file,first.fingerprint)).unchanged,true);assert.equal(reads,0);
 const stat=await fs.stat(file);await fs.writeFile(file,'NEW');await fs.utimes(file,stat.atime,stat.mtime);const changed=await store.readIfChanged('w',file,first.fingerprint);assert.equal(changed.text,'NEW');
 await fs.writeFile(file+'.tmp','SAME');await fs.rename(file+'.tmp',file);assert.equal((await store.readIfChanged('w',file,changed.fingerprint)).text,'SAME');
 const saved=await store.save('w',file,'LOCAL',first.version);assert.equal(saved.conflict,true);
});
