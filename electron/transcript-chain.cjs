const fs=require('node:fs/promises');
const path=require('node:path');

// When the Claude CLI resumes a conversation it may carry on in a new session file and leave a
// {"type":"continued-in","continuedInSessionId":...} row at the end of the old one. The old id keeps showing up
// afterwards (the SessionEnd hook of the resumed process reports it), so a record must follow these rows forward.
const TAIL_BYTES=1024*1024,MAX_HOPS=32;
const SESSION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache=new Map();

// The session id the transcript says its conversation continued in, or null.
async function continuedIn(file){
  let handle;
  try{handle=await fs.open(file,'r');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  try{
    const stat=await handle.stat(),key=[stat.size,stat.mtimeMs,stat.ino].join(':');
    const cached=cache.get(file);if(cached?.key===key)return cached.next;
    const size=Math.min(stat.size,TAIL_BYTES),buffer=Buffer.alloc(size);
    await handle.read(buffer,0,size,stat.size-size);
    let next=null;
    for(const line of buffer.toString('utf8').split('\n')){
      if(!line.includes('"continued-in"'))continue;
      try{const row=JSON.parse(line);if(row.type==='continued-in'&&SESSION_ID.test(row.continuedInSessionId||''))next=row.continuedInSessionId;}catch{/* A partial first line of the tail. */}
    }
    if(cache.size>500)cache.clear();
    cache.set(file,{key,next});
    return next;
  }finally{await handle.close();}
}

const exists=file=>fs.access(file).then(()=>true,()=>false);

// Follows continued-in rows from a transcript to the one the conversation is written to now.
// `find(sessionId)` locates a transcript elsewhere (other project folders); the sibling file is tried first.
// Returns the last file, its session id when it moved (null otherwise) and every session id on the way.
async function latestTranscript(file,{find}={}){
  const chain=[path.basename(file,'.jsonl')],seen=new Set([path.resolve(file)]);
  let current=file,sessionId=null;
  for(let hop=0;hop<MAX_HOPS;hop++){
    const next=await continuedIn(current);
    if(!next)break;
    let candidate=path.join(path.dirname(current),next+'.jsonl');
    if(!(await exists(candidate)))candidate=find?await find(next):null;
    if(!candidate||seen.has(path.resolve(candidate)))break;
    seen.add(path.resolve(candidate));chain.push(next);current=candidate;sessionId=next;
  }
  return {file:current,sessionId,chain};
}

module.exports={continuedIn,latestTranscript,SESSION_ID};
