const {spawn}=require('node:child_process');

function windowOf(limit){
 if(!limit||typeof limit.usedPercent!=='number')return null;
 return {used_percentage:limit.usedPercent,...(typeof limit.resetsAt==='number'?{resets_at:limit.resetsAt}:{})};
}
// Codex reports two rolling windows; they are matched by length because their order is not a contract.
function parseCodexLimits(result){
 const limits=result?.rateLimits;if(!limits)return null;
 const usage={};
 for(const limit of [limits.primary,limits.secondary]){
  const window=windowOf(limit);if(!window)continue;
  if(limit.windowDurationMins===300)usage.five_hour=window;
  else if(limit.windowDurationMins===10080)usage.seven_day=window;
 }
 return Object.keys(usage).length?usage:null;
}
// Asks the official app server, which needs no model request. Any failure simply leaves the last known usage.
function readCodexUsage(cli,env,{spawner=spawn,timeoutMs=20000,command=[cli,['app-server']]}={}){
 return new Promise(resolve=>{
  let buffer='',settled=false,child;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);try{child?.kill();}catch{}resolve(value);};
  const timer=setTimeout(()=>finish(null),timeoutMs);
  try{child=spawner(command[0],command[1],{env,windowsHide:true,stdio:['pipe','pipe','ignore']});}catch{finish(null);return;}
  child.on('error',()=>finish(null));child.on('close',()=>finish(null));child.stdin.on('error',()=>{});
  const send=message=>{try{child.stdin.write(JSON.stringify(message)+'\n');}catch{finish(null);}};
  child.stdout.on('data',chunk=>{
   buffer+=chunk;if(buffer.length>1024*1024){finish(null);return;}
   let end;
   while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    let message;try{message=JSON.parse(line);}catch{continue;}
    if(message.id===1){send({method:'initialized'});send({id:2,method:'account/rateLimits/read'});}
    if(message.id===2)finish(parseCodexLimits(message.result));
   }
  });
  send({id:1,method:'initialize',params:{clientInfo:{name:'wbspace',title:'WbSpace',version:'1'}}});
 });
}
// `is_quota_exceeded` wins because the percentage can read 0 on an exhausted account.
function parseQoderCredits(credits){
 if(!credits||typeof credits!=='object')return null;
 const exceeded=credits.is_quota_exceeded===true,percentage=typeof credits.total_usage_percentage==='number'?credits.total_usage_percentage:null;
 if(!exceeded&&percentage===null&&typeof credits.total_remaining!=='number')return null;
 return {credits:{used_percentage:exceeded?100:percentage,exceeded,remaining:typeof credits.total_remaining==='number'?credits.total_remaining:null,unit:typeof credits.unit==='string'?credits.unit:'',...(typeof credits.expires_at==='number'?{resets_at:Math.floor(credits.expires_at/1000)}:{})}};
}
// `opencode stats` only prints a table, so its labelled rows are read directly.
function parseOpencodeStats(text){
 const clean=String(text).replace(/\x1b\[[0-9;]*m/g,''),row=label=>new RegExp('│\\s*'+label+'\\s+(\\S+)\\s*│').exec(clean)?.[1];
 const cost=row('Total Cost');if(cost===undefined)return null;
 return {local:{cost,input:row('Input')??'0',output:row('Output')??'0',sessions:row('Sessions')??'0'}};
}
module.exports={parseCodexLimits,readCodexUsage,parseQoderCredits,parseOpencodeStats};
