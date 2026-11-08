// Scheduled tasks: time rules, validation and the unattended command line for each agent.

const PERMISSIONS=['read','write','full'];
const MIN_INTERVAL=5;

// Five-field cron: minute hour day-of-month month day-of-week, with lists, ranges and steps.
function parseField(text,min,max){
 const values=new Set();
 for(const part of String(text).split(',')){
  const match=/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
  if(!match)throw new Error('cron 表达式格式不正确');
  let [from,to]=match[1]==='*'?[min,max]:match[1].split('-').map(Number);
  if(to===undefined)to=match[2]?max:from;
  const step=match[2]?Number(match[2]):1;
  if(from<min||to>max||from>to||step<1)throw new Error('cron 表达式超出范围');
  for(let v=from;v<=to;v+=step)values.add(v===7&&max===7?0:v);
 }
 return values;
}
function parseCron(expr){
 const fields=String(expr||'').trim().split(/\s+/);
 if(fields.length!==5)throw new Error('cron 表达式需要 5 个字段：分 时 日 月 周');
 const [minute,hour,day,month,week]=fields;
 return {minute:parseField(minute,0,59),hour:parseField(hour,0,23),day:parseField(day,1,31),month:parseField(month,1,12),week:parseField(week,0,7),dayAny:day==='*',weekAny:week==='*'};
}
function cronMatches(c,d){
 if(!c.minute.has(d.getMinutes())||!c.hour.has(d.getHours())||!c.month.has(d.getMonth()+1))return false;
 const dayOk=c.day.has(d.getDate()),weekOk=c.week.has(d.getDay());
 // Standard cron: when both day fields are restricted, either one matching is enough.
 return c.dayAny&&c.weekAny?true:c.dayAny?weekOk:c.weekAny?dayOk:dayOk||weekOk;
}

const clock=time=>{const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(time||'');if(!m)throw new Error('时间格式应为 HH:MM');return [Number(m[1]),Number(m[2])];};

function normalizeRule(rule){
 const type=rule?.type;
 if(type==='interval'){const every=Math.round(Number(rule.every));if(!Number.isFinite(every)||every<MIN_INTERVAL||every>7*24*60)throw new Error(`间隔需在 ${MIN_INTERVAL} 分钟到 7 天之间`);return {type,every};}
 if(type==='daily'){clock(rule.time);return {type,time:rule.time};}
 if(type==='weekly'){clock(rule.time);const days=[...new Set((rule.days||[]).map(Number))].filter(d=>d>=0&&d<=6).sort();if(!days.length)throw new Error('请至少选择一天');return {type,time:rule.time,days};}
 if(type==='cron'){parseCron(rule.expr);return {type,expr:String(rule.expr).trim()};}
 throw new Error('不支持的时间规则');
}

// The first run strictly after `from`, in local time.
function nextRun(rule,from=Date.now()){
 if(rule.type==='interval')return from+rule.every*60000;
 const start=new Date(from);start.setSeconds(0,0);
 if(rule.type==='daily'||rule.type==='weekly'){
  const [h,m]=clock(rule.time);
  for(let i=0;i<=8;i++){
   const d=new Date(start);d.setDate(d.getDate()+i);d.setHours(h,m,0,0);
   if(d.getTime()>from&&(rule.type==='daily'||rule.days.includes(d.getDay())))return d.getTime();
  }
  throw new Error('无法计算下次运行时间');
 }
 const c=parseCron(rule.expr),d=new Date(start.getTime()+60000);
 for(let i=0;i<366*24*60;i++){
  if(!c.month.has(d.getMonth()+1)){d.setMonth(d.getMonth()+1,1);d.setHours(0,0,0,0);continue;}
  if(!c.hour.has(d.getHours())){d.setHours(d.getHours()+1,0,0,0);continue;}
  if(cronMatches(c,d))return d.getTime();
  d.setMinutes(d.getMinutes()+1);
 }
 throw new Error('cron 表达式在一年内不会触发');
}

const weekNames=['日','一','二','三','四','五','六'];
function describeRule(rule){
 if(rule.type==='interval')return rule.every%60===0?`每 ${rule.every/60} 小时`:`每 ${rule.every} 分钟`;
 if(rule.type==='daily')return `每天 ${rule.time}`;
 if(rule.type==='weekly')return `每周${rule.days.map(d=>weekNames[d]).join('、')} ${rule.time}`;
 return `cron ${rule.expr}`;
}

function normalizeTask(input,{workspaceExists,accountExists}){
 const name=String(input?.name||'').trim().slice(0,80);if(!name)throw new Error('请填写任务名称');
 const prompt=String(input?.prompt||'').trim();if(!prompt)throw new Error('请填写要执行的提示词');if(prompt.length>20000)throw new Error('提示词过长');
 if(!workspaceExists(input.workspaceId))throw new Error('请选择工作空间');
 if(!accountExists(input.accountId))throw new Error('请选择账号');
 const permission=PERMISSIONS.includes(input.permission)?input.permission:'read';
 const timeout=Math.round(Number(input.timeoutMinutes??30));if(!Number.isFinite(timeout)||timeout<1||timeout>24*60)throw new Error('超时需在 1 分钟到 24 小时之间');
 return {name,prompt,workspaceId:input.workspaceId,accountId:input.accountId,rule:normalizeRule(input.rule),permission,
  // Read-only runs cannot change files, so only writing runs get their own worktree.
  worktree:permission!=='read'&&input.worktree!==false,timeoutMinutes:timeout,catchUp:input.catchUp!==false,notify:input.notify!==false,enabled:input.enabled!==false};
}

const claudeModes={read:'dontAsk',write:'acceptEdits',full:'bypassPermissions'};
const qoderModes={read:'dont_ask',write:'accept_edits',full:'bypass_permissions'};
const opencodePermissions={read:{edit:'deny',bash:'deny'},write:{edit:'allow',bash:'deny'},full:{edit:'allow',bash:'allow',webfetch:'allow'}};

// Arguments that run one prompt without anyone present, plus the OpenCode permission override when needed.
function headlessArgs(agentId,prompt,permission){
 if(!PERMISSIONS.includes(permission))throw new Error('无效的权限级别');
 if(agentId==='claude-code')return {args:['--permission-mode',claudeModes[permission],...(permission==='read'?['--disallowedTools','Edit','Write','MultiEdit','NotebookEdit','Bash']:[]),'-p',prompt]};
 if(agentId==='codex-cli')return {args:['exec','--skip-git-repo-check',...(permission==='full'?['--dangerously-bypass-approvals-and-sandbox']:['-s',permission==='read'?'read-only':'workspace-write']),prompt]};
 if(agentId==='qoder-cli')return {args:['--permission-mode',qoderModes[permission],'-p',prompt]};
 if(agentId==='opencode')return {args:['run',prompt],opencodePermission:opencodePermissions[permission]};
 throw new Error('该 Agent 不支持定时任务');
}
function mergeOpencodeConfig(current,permission){
 let config={};try{config=current?JSON.parse(current):{};}catch{config={};}
 return JSON.stringify({$schema:'https://opencode.ai/config.json',...config,permission});
}

// Usage windows reported by Claude and Codex; a nearly exhausted account is skipped so the user keeps some quota.
function quotaBlocked(usage){
 const five=usage?.five_hour?.used_percentage,week=usage?.seven_day?.used_percentage;
 if(typeof five==='number'&&five>=90)return '五小时额度已用 '+Math.round(five)+'%';
 if(typeof week==='number'&&week>=95)return '本周额度已用 '+Math.round(week)+'%';
 if(usage?.credits?.exceeded)return 'Credits 已用尽';
 return '';
}

const slug=text=>String(text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)||'task';
function worktreeBranch(name,time=Date.now()){
 const d=new Date(time),pad=n=>String(n).padStart(2,'0');
 return `wbspace/${slug(name)}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

module.exports={parseCron,normalizeRule,nextRun,describeRule,normalizeTask,headlessArgs,mergeOpencodeConfig,quotaBlocked,worktreeBranch,PERMISSIONS};
