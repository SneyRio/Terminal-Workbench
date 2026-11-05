const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {configuredStatusLine,renderStatusLine}=require('../electron/statusline.cjs');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'accountor-hud-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('original account HUD command and options are read without changing the profile',async t=>{
 const root=await fixture(t),file=path.join(root,'settings.json');
 const statusLine={type:'command',command:'node hud.js',padding:2,refreshInterval:5};await fs.writeFile(file,JSON.stringify({statusLine}));const before=await fs.readFile(file,'utf8');
 assert.deepEqual(await configuredStatusLine(root),statusLine);assert.equal(await fs.readFile(file,'utf8'),before);
 await fs.writeFile(file,JSON.stringify({statusLine:{type:'command',command:'node claude-telemetry.cjs usage'}}));assert.equal(await configuredStatusLine(root),null);
});
test('HUD receives original stdin and account environment and keeps ANSI, multiline and UTF-8 output',async t=>{
 const root=await fixture(t),file=path.join(root,'hud fixture.js');
 await fs.writeFile(file,"let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const data=JSON.parse(input);process.stdout.write('\\x1b[32m'+data.model.display_name+'\\x1b[0m\\n'+process.env.CLAUDE_CONFIG_DIR+'\\n');const value=Buffer.from('中文');process.stdout.write(value.subarray(0,1));setTimeout(()=>process.stdout.write(value.subarray(1)),20);});");
 const output=await renderStatusLine(quote(process.execPath)+' '+quote(file),JSON.stringify({model:{display_name:'Model fixture'}}),{env:{...process.env,CLAUDE_CONFIG_DIR:'ACCOUNT_B'}});
 assert.equal(output,'\x1b[32mModel fixture\x1b[0m\nACCOUNT_B\n中文');
});
test('broken or hanging HUD cannot block the status line indefinitely',async()=>{
 assert.equal(await renderStatusLine('exit 3','{}'), '');
 const start=Date.now();assert.equal(await renderStatusLine(quote(process.execPath)+" -e 'setInterval(()=>{},1000)'",'{}',{timeout:100}), '');assert(Date.now()-start<2000);
});
function telemetry(input,env,delegate){return new Promise((resolve,reject)=>{const proc=spawn(process.execPath,[path.resolve('scripts/claude-telemetry.cjs'),'usage',...(delegate?['--delegate',delegate]:[])],{env,stdio:['pipe','pipe','pipe']});let out='',err='';proc.stdout.setEncoding('utf8');proc.stdout.on('data',d=>out+=d);proc.stderr.on('data',d=>err+=d);proc.once('error',reject);proc.once('close',code=>code===0?resolve(out):reject(new Error(err)));proc.stdin.end(JSON.stringify(input));});}
test('telemetry collects only usage metadata while displaying original HUD or descriptive fallback',async t=>{
 const root=await fixture(t),key='hud-fixture',input={session_id:'session-fixture',model:{display_name:'Fixture'},token:'SENSITIVE_FIXTURE',rate_limits:{five_hour:{used_percentage:1},seven_day:{used_percentage:42}}};
 const env={...process.env,ACCOUNTOR_TELEMETRY_DIR:root,ACCOUNTOR_RUN_ID:key};
 assert.equal(await telemetry(input,env,"printf '\033[32mHUD preserved\033[0m\\n'"),'\x1b[32mHUD preserved\x1b[0m\n');
 const raw=await fs.readFile(path.join(root,key+'-usage.json'),'utf8');assert(!raw.includes('SENSITIVE_FIXTURE'));assert(!raw.includes('display_name'));assert.equal(JSON.parse(raw).usage.five_hour.used_percentage,1);
 assert.equal(await telemetry(input,env,null),'Accountor · 5h 已用 1% · 本周剩余 58%');
 const bad=path.join(root,'not-directory');await fs.writeFile(bad,'fixture');assert.equal(await telemetry(input,{...env,ACCOUNTOR_TELEMETRY_DIR:bad},"printf 'HUD still visible'"),'HUD still visible');
});
test('prompt hook writes a short title hint without storing the complete prompt',async t=>{
 const root=await fixture(t),key='title-fixture',prompt='修复客户端草稿格式。'+ '不要保存的正文'.repeat(100);
 await new Promise((resolve,reject)=>{const proc=spawn(process.execPath,[path.resolve('scripts/claude-telemetry.cjs'),'event'],{env:{...process.env,ACCOUNTOR_TELEMETRY_DIR:root,ACCOUNTOR_RUN_ID:key},stdio:['pipe','ignore','pipe']});proc.once('error',reject);proc.once('close',code=>code===0?resolve():reject(new Error('hook failed')));proc.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:'native',prompt}));});
 const output=JSON.parse(await fs.readFile(path.join(root,key+'-event.json'),'utf8'));assert(output.titleHint.startsWith('修复客户端'));assert([...output.titleHint].length<=33);assert.equal(output.prompt,undefined);assert(!JSON.stringify(output).includes(prompt));
});
