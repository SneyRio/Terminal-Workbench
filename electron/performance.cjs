class DraftBatch {
  constructor(store,onFlush,{delay=200}={}){this.store=store;this.onFlush=onFlush;this.delay=delay;this.pending=new Map();this.waiters=[];this.timer=null;this.inFlight=null;}
  enqueue(file,draft){
    this.pending.set(file,draft);
    const promise=new Promise((resolve,reject)=>this.waiters.push({resolve,reject}));
    if(!this.timer)this.timer=setTimeout(()=>{void this.flush().catch(()=>{});},this.delay);
    return promise;
  }
  flush(){
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    if(this.inFlight)return this.inFlight.then(()=>this.flush());
    if(!this.pending.size)return this.inFlight||Promise.resolve();
    const updates=[...this.pending],waiters=this.waiters;this.pending.clear();this.waiters=[];
    const write=this.store.update(s=>{for(const [file,draft] of updates){if(draft)s.drafts[file]=draft;else delete s.drafts[file];}});
    const result=write.then(()=>{this.onFlush?.();for(const w of waiters)w.resolve();},error=>{for(const [file,draft] of updates)if(!this.pending.has(file))this.pending.set(file,draft);for(const w of waiters)w.reject(error);throw error;});
    this.inFlight=result;
    void result.finally(()=>{if(this.inFlight===result)this.inFlight=null;}).catch(()=>{});
    return result;
  }
}

class TerminalHistory {
  constructor(limit=2*1024*1024){this.limit=limit;this.chunks=[];this.head=0;this.length=0;}
  append(data){
    if(!data)return;
    if(data.length>=this.limit){this.chunks=[data.slice(-this.limit)];this.head=0;this.length=this.limit;return;}
    this.chunks.push(data);this.length+=data.length;
    while(this.length>this.limit){const excess=this.length-this.limit,first=this.chunks[this.head];if(first.length<=excess){this.length-=first.length;this.head++;}else{this.chunks[this.head]=first.slice(excess);this.length-=excess;}}
    if(this.head>=32){this.chunks=this.chunks.slice(this.head);this.head=0;}
  }
  snapshot(){return this.chunks.slice(this.head).join('');}
  shrink(limit){const tail=this.snapshot().slice(-limit);this.limit=limit;this.chunks=[];this.head=0;this.length=0;this.append(tail);}
}
function flushTerminal(runtime,id,notify){
  if(runtime.outputTimer){clearTimeout(runtime.outputTimer);runtime.outputTimer=null;}
  if(!runtime.pending.length)return;
  const data=runtime.pending.join('');runtime.pending=[];runtime.pendingSize=0;runtime.history.append(data);runtime.seq++;
  notify('terminal:data',{id,data,seq:runtime.seq});
}
function appendTerminal(runtime,id,data,notify){
  runtime.pending.push(data);runtime.pendingSize+=data.length;
  if(runtime.pendingSize>=512*1024)flushTerminal(runtime,id,notify);
  else if(!runtime.outputTimer)runtime.outputTimer=setTimeout(()=>flushTerminal(runtime,id,notify),16);
}
module.exports={DraftBatch,TerminalHistory,appendTerminal,flushTerminal};
