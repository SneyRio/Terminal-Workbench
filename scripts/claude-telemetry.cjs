const fs = require('node:fs');
const path = require('node:path');
const {taskText}=require('../electron/session-titles.cjs');
const {renderStatusLine}=require('../electron/statusline.cjs');
const cancellation=new AbortController();
for(const signal of ['SIGTERM','SIGHUP','SIGINT'])process.once(signal,()=>{cancellation.abort();process.exit(0);});
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { if (input.length < 1024 * 1024) input += d; });
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(input);
    const dir = process.env.ACCOUNTOR_TELEMETRY_DIR;
    const key = process.env.ACCOUNTOR_RUN_ID;
    const output = { time: Date.now() };
    if (process.argv[2] === 'usage') {
      output.usage = data.rate_limits || null;
      output.sessionId = data.session_id;
    } else {
      output.event = data.hook_event_name;
      if(data.hook_event_name==='UserPromptSubmit'&&!data.is_autonomous){const title=taskText(data.prompt);if(title)output.titleHint=title;}
      output.sessionId = data.session_id;
      output.transcript = data.transcript_path;
      output.cwd = data.cwd;
    }
    if(dir&&key&&/^[a-zA-Z0-9-]+$/.test(key))try{
      const target = path.join(dir, key + '-' + (process.argv[2] === 'usage' ? 'usage' : 'event') + '.json');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = target + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(output), { mode: 0o600 }); fs.renameSync(tmp, target);
    }catch{/* Keep the user's HUD visible even when local telemetry cannot be saved. */}
    if(process.argv[2]==='usage'){
      const index=process.argv.indexOf('--delegate'),command=index>=0?process.argv[index+1]:null;
      const hud=command?await renderStatusLine(command,input,{signal:cancellation.signal}):'';
      if(hud)process.stdout.write(hud);
      else if(process.env.ACCOUNTOR_ACCOUNT_PROVIDER!=='custom') {
        const five=data.rate_limits?.five_hour?.used_percentage,week=data.rate_limits?.seven_day?.used_percentage;
        const remaining=typeof week==='number'&&Number.isFinite(week)?Math.round(Math.min(100,Math.max(0,100-week)))+'%':'未知';
        process.stdout.write('Accountor · 5h 已用 '+(typeof five==='number'?five+'%':'未知')+' · 本周剩余 '+remaining+(command?' · HUD 暂不可用':''));
      }
    }
  } catch { /* telemetry must never interrupt the CLI */ }
});
