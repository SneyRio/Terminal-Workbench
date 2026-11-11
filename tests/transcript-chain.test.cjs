const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {continuedIn,latestTranscript}=require('../electron/transcript-chain.cjs');
const {Store}=require('../electron/core.cjs');

const A='88a46fda-0817-4c31-b8f1-d60a0105dd15',B='351176e2-918e-49f5-a866-ec410727e42a',C='0b13bf6b-0000-4000-8000-000000000001';
const row=value=>JSON.stringify(value)+'\n';
const turn=(sessionId,text)=>row({type:'user',sessionId,message:{role:'user',content:text}});
const moved=(sessionId,next)=>row({type:'continued-in',timestamp:'2026-11-10T14:23:09.568Z',sessionId,continuedInSessionId:next});
async function dir(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'wbspace-chain-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('a transcript without continued-in stays where it is',async t=>{
  const root=await dir(t),file=path.join(root,A+'.jsonl');await fs.writeFile(file,turn(A,'你好'));
  assert.equal(await continuedIn(file),null);
  assert.deepEqual(await latestTranscript(file),{file,sessionId:null,chain:[A]});
  assert.equal(await continuedIn(path.join(root,'missing.jsonl')),null);
});

test('continued-in rows are followed to the newest session, even with rows written after them',async t=>{
  const root=await dir(t),a=path.join(root,A+'.jsonl'),b=path.join(root,B+'.jsonl'),c=path.join(root,C+'.jsonl');
  // The CLI keeps appending bookkeeping rows to the old file when the resumed process ends.
  await fs.writeFile(a,turn(A,'旧')+moved(A,B)+row({type:'cost-state',sessionId:A})+row({type:'session-owner',sessionId:A}));
  await fs.writeFile(b,turn(B,'中')+moved(B,C));await fs.writeFile(c,turn(C,'新'));
  assert.deepEqual(await latestTranscript(a),{file:c,sessionId:C,chain:[A,B,C]});
  assert.deepEqual(await latestTranscript(b),{file:c,sessionId:C,chain:[B,C]});
});

test('a session continued in another folder is found through the lookup, and a missing one stops the chain',async t=>{
  const root=await dir(t),a=path.join(root,'p1',A+'.jsonl'),b=path.join(root,'p2',B+'.jsonl');
  await fs.mkdir(path.dirname(a));await fs.mkdir(path.dirname(b));
  await fs.writeFile(a,turn(A,'旧')+moved(A,B));await fs.writeFile(b,turn(B,'新'));
  assert.deepEqual(await latestTranscript(a,{find:async id=>id===B?b:null}),{file:b,sessionId:B,chain:[A,B]});
  assert.deepEqual(await latestTranscript(a),{file:a,sessionId:null,chain:[A]});
});

test('a checkpoint copy points forward to the live transcript',async t=>{
  const root=await dir(t),checkpoint=path.join(root,'deleted-1234.jsonl'),b=path.join(root,'projects',B+'.jsonl');
  await fs.mkdir(path.dirname(b));await fs.writeFile(checkpoint,turn(A,'旧')+moved(A,B));await fs.writeFile(b,turn(B,'新'));
  assert.deepEqual(await latestTranscript(checkpoint,{find:async()=>b}),{file:b,sessionId:B,chain:['deleted-1234',B]});
});

test('loops and malformed rows end the chain instead of hanging',async t=>{
  const root=await dir(t),a=path.join(root,A+'.jsonl'),b=path.join(root,B+'.jsonl');
  await fs.writeFile(a,moved(A,B)+'{"type":"continued-in",broken\n'+row({type:'continued-in',continuedInSessionId:'../../etc/passwd'}));
  await fs.writeFile(b,moved(B,A));
  assert.deepEqual(await latestTranscript(a),{file:b,sessionId:B,chain:[A,B]});
});

test('a transcript that moves later is read again',async t=>{
  const root=await dir(t),a=path.join(root,A+'.jsonl'),b=path.join(root,B+'.jsonl');
  await fs.writeFile(a,turn(A,'旧'));await fs.writeFile(b,turn(B,'新'));
  assert.equal((await latestTranscript(a)).sessionId,null);
  await fs.appendFile(a,moved(A,B));
  assert.equal((await latestTranscript(a)).sessionId,B);
});

test('the store drains writes queued while draining and refuses writes once closed',async t=>{
  const root=await dir(t),store=new Store(root);await store.load();
  let late;
  void store.update(async s=>{s.drafts.first=1;late=store.update(s=>{s.drafts.second=2;});});
  await store.drain();await late;
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'state.json'),'utf8')).drafts,{first:1,second:2});
  store.close();
  await assert.rejects(store.update(s=>{s.drafts.third=3;}),/应用正在退出/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'state.json'),'utf8')).drafts.third,undefined);
});
