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
// Claude Code prints `/usage` as text, e.g. "Current session: 93% used · resets Nov 12 at 1:29am (Asia/Shanghai)".
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function zoneOffset(time,timeZone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));
 return Date.UTC(+parts.year,parts.month-1,+parts.day,+parts.hour%24,+parts.minute,+parts.second)-time;
}
// A wall-clock time in the named zone (local time when the zone is unknown), as epoch milliseconds.
function zonedTime(year,month,day,hour,minute,timeZone){
 const wall=Date.UTC(year,month,day,hour,minute);
 try{if(timeZone){let time=wall-zoneOffset(wall,timeZone);time=wall-zoneOffset(time,timeZone);return time;}}catch{/* Unknown zone: fall back to local time. */}
 return new Date(year,month,day,hour,minute).getTime();
}
// "Nov 12 at 1:29am (Asia/Shanghai)" or "1pm (Asia/Shanghai)" → epoch seconds of the next such time, or null.
function parseClaudeReset(text,now=Date.now()){
 const m=/^(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i.exec(String(text).trim());
 if(!m)return null;
 const month=m[1]?MONTHS.indexOf(m[1].toLowerCase()):-1;if(m[1]&&month<0)return null;
 let hour=+m[4];const minute=m[5]?+m[5]:0;if(hour>23||minute>59)return null;
 if(m[6]){if(hour<1||hour>12)return null;hour=hour%12+(m[6].toLowerCase()==='pm'?12:0);}
 const zone=m[7]?.trim(),today=new Date(now);
 let time;
 if(month>=0){
  const year=m[3]?+m[3]:today.getFullYear();
  time=zonedTime(year,month,+m[2],hour,minute,zone);
  // Only the next reset is printed, so a date already well past belongs to next year.
  if(!m[3]&&time<now-24*3600*1000)time=zonedTime(year+1,month,+m[2],hour,minute,zone);
 }else{
  time=zonedTime(today.getFullYear(),today.getMonth(),today.getDate(),hour,minute,zone);
  for(let i=0;i<2&&time<now-60*1000;i++)time+=24*3600*1000;
 }
 return Number.isFinite(time)?Math.floor(time/1000):null;
}
function parseClaudeUsage(text,now=Date.now()){
 const usage={},clean=String(text||'').replace(/\x1b\[[0-9;]*m/g,'');
 for(const [key,label] of [['five_hour','Current session'],['seven_day','Current week \\(all models\\)']]){
  const m=new RegExp('^\\s*'+label+':\\s*(\\d+(?:\\.\\d+)?)%\\s*used(?:\\s*·\\s*resets\\s+(.+))?$','im').exec(clean);
  if(!m)continue;
  const reset=m[2]?parseClaudeReset(m[2],now):null;
  usage[key]={used_percentage:Number(m[1]),...(reset?{resets_at:reset}:{})};
 }
 return Object.keys(usage).length?usage:null;
}
module.exports={parseCodexLimits,readCodexUsage,parseQoderCredits,parseOpencodeStats,parseClaudeUsage,parseClaudeReset};
