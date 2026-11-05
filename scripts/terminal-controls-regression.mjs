import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),testRoot=path.join(root,'.test-data','terminal-controls-'+Date.now()),project=path.join(testRoot,'project'),dataRoot=path.join(testRoot,'data'),fixture=path.join(testRoot,'terminal-fixture'),recordFile=path.join(testRoot,'terminal.json');
await fs.mkdir(project,{recursive:true});await fs.writeFile(path.join(project,'open.json'),'{}');
await fs.writeFile(fixture,`#!${process.execPath}
const fs=require('node:fs');if(process.argv.includes('status')){console.log(JSON.stringify({loggedIn:true}));process.exit(0);}const record={pid:process.pid,controlC:0,copyRequests:0};let input='';
const save=()=>{record.cols=process.stdout.columns;record.rows=process.stdout.rows;fs.writeFileSync(${JSON.stringify(recordFile)}+'.tmp',JSON.stringify(record));fs.renameSync(${JSON.stringify(recordFile)}+'.tmp',${JSON.stringify(recordFile)});};
process.stdout.write('COPY_FIXTURE\\r\\n');process.stdin.setRawMode(true);process.stdin.resume();save();process.on('SIGWINCH',()=>setTimeout(save,30));
const osc=()=>process.stdout.write('\\x1b]52;c;'+Buffer.from('CLI_COPY_中文').toString('base64')+'\\x07');
process.stdin.on('data',data=>{const text=data.toString();input+=text;if(text.includes('\\x03'))record.controlC++;
if(text.includes('\\x1b[99;6u')){record.copyRequests++;osc();}
if(text.includes('MANY'))process.stdout.write(Array.from({length:1600},(_,i)=>'LINE_'+String(i).padStart(4,'0')).join('\\r\\n')+'\\r\\n');
if(text.includes('OSC'))osc();
if(text.includes('ALT'))process.stdout.write('\\x1b[?1049h\\x1b[?1000h\\x1b[?1006h\\x1b[HALTERNATE_FIXTURE');
save();});setInterval(()=>{},1000);
`,{mode:0o700});
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,ACCOUNTOR_DATA_DIR:dataRoot}});
const checks=[],errors=[];
try{
 await app.evaluate(async({clipboard,ClipboardItem})=>{globalThis.__clipboardFixtureBackup=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1024});await page.waitForFunction(()=>!!window.accountor);
 const invoke=(channel,...args)=>page.evaluate(({channel,args})=>window.accountor.invoke(channel,...args),{channel,args});
 await invoke('settings:save',{shell:fixture,fontSize:14,fontFamily:'Menlo',lineHeight:1.3});await invoke('workspace:save',{name:'终端控件回归',projects:[{path:project}],backend:'embedded',rightOpen:true});
 await page.locator('.workspace-nav').click();await page.getByRole('button',{name:'打开 Shell',exact:true}).click();await expect.poll(()=>fs.readFile(recordFile,'utf8').then(JSON.parse).then(x=>x.cols||0).catch(()=>0)).toBeGreaterThan(0);
 const session=(await invoke('state:get')).sessions.at(-1),host=page.locator('.terminal-host'),screen=page.locator('.xterm-screen');
 const metrics=await screen.evaluate(el=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='14px Menlo';return {cell:ctx.measureText('M').width,row:14*1.3,rect:el.getBoundingClientRect().toJSON()};});
 await page.mouse.move(metrics.rect.x+.2,metrics.rect.y+metrics.row/2);await page.mouse.down();await page.mouse.move(metrics.rect.x+metrics.cell*12,metrics.rect.y+metrics.row/2,{steps:10});await page.mouse.up();await expect(host).toHaveAttribute('data-has-selection','true');
 await page.keyboard.press('Meta+c');await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('COPY_FIXTURE');checks.push('mouse-selected terminal text copies via actual Command-C and native clipboard');
 await page.mouse.click(metrics.rect.x+metrics.cell*15,metrics.rect.y+metrics.row*2);await page.keyboard.press('Control+c');await expect.poll(()=>fs.readFile(recordFile,'utf8').then(JSON.parse).then(x=>x.controlC)).toBe(1);checks.push('Ctrl-C without selection still reaches the running CLI');
 const search=page.getByLabel('搜索工作空间');await search.fill('EDITOR_COPY_FIXTURE');await search.focus();await page.keyboard.press('Meta+a');await page.keyboard.press('Meta+c');await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('EDITOR_COPY_FIXTURE');await search.fill('');checks.push('Command-C in normal input still uses native DOM copy');
 const original=JSON.parse(await fs.readFile(recordFile,'utf8'));
 await page.getByRole('button',{name:'放大终端字号',exact:true}).click();await expect(page.locator('.terminal-font-value')).toHaveText('15');
 await page.getByRole('button',{name:'终端字体设置',exact:true}).click();await page.getByLabel('终端字体大小',{exact:true}).fill('20');await page.getByLabel('终端字体',{exact:true}).selectOption('Monaco');await page.getByLabel('终端行高',{exact:true}).fill('1.6');await page.getByLabel('终端滚动方式').selectOption('classic');
 await page.locator('.workspace-nav').click();await expect.poll(()=>fs.readFile(recordFile,'utf8').then(JSON.parse).then(x=>x.cols)).toBeLessThan(original.cols);expect(JSON.parse(await fs.readFile(recordFile,'utf8')).pid).toBe(original.pid);checks.push('header font control and font/family/line-height settings resize existing PTY without restart');
 await invoke('terminal:input',session.id,'MANY');await expect.poll(()=>host.getAttribute('data-scrollback').then(Number)).toBeGreaterThan(1000);
 await page.getByRole('button',{name:'回到终端底部',exact:true}).click();await expect.poll(()=>host.getAttribute('data-viewport').then(Number)).toBeGreaterThan(1000);const bottom=Number(await host.getAttribute('data-viewport'));await page.mouse.move(metrics.rect.x+100,metrics.rect.y+100);await page.mouse.wheel(0,-900);await expect.poll(()=>host.getAttribute('data-viewport').then(Number)).toBeLessThan(bottom);
 const slider=page.locator('.xterm .scrollbar.vertical .slider');await page.locator('.xterm .scrollbar.vertical').hover();const bar=await page.locator('.xterm .scrollbar.vertical').boundingBox();await slider.dragTo(page.locator('.xterm .scrollbar.vertical'),{targetPosition:{x:bar.width/2,y:5}});await expect.poll(()=>host.getAttribute('data-viewport').then(Number)).toBeLessThan(100);
 checks.push('native scrollback wheel and draggable scrollbar both navigate long terminal output');
 await invoke('terminal:input',session.id,'OSC');await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('CLI_COPY_中文');checks.push('CLI OSC52 clipboard output supports UTF-8 without exposing clipboard reads');
 await invoke('settings:save',{claudePath:fixture});const account=await invoke('account:add','全屏复制测试');const cli=await invoke('terminal:start',{workspaceId:session.workspaceId,kind:'claude',accountId:account.id});
 await page.locator('[data-session-id="'+cli.id+'"]').getByRole('button',{name:cli.title,exact:true}).click();await invoke('terminal:input',cli.id,'ALT');await expect(page.locator('.terminal-slot.visible .terminal-host')).toHaveAttribute('data-buffer-mode','alternate');
 await app.evaluate(async({clipboard})=>clipboard.writeText('BEFORE_ALT_COPY'));await page.locator('.terminal-slot.visible .xterm-helper-textarea').focus();await page.keyboard.press('Meta+c');await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('CLI_COPY_中文');checks.push('Cmd-C in alternate screen routes CLI copy action through OSC52');
 // Verify the persisted settings are not overwritten by later control changes.
 const file=path.join(dataRoot,'state.json');const stored=JSON.parse(await fs.readFile(file,'utf8'));expect(stored.settings.fontFamily).toBe('Monaco');expect(stored.settings.lineHeight).toBe(1.6);
 if(await page.getByRole('button',{name:'展开右侧辅助栏',exact:true}).count())await page.getByRole('button',{name:'展开右侧辅助栏',exact:true}).click();await page.getByRole('button',{name:'open.json',exact:true}).click();
 await app.evaluate(({shell})=>{globalThis.__openedFixture=[];shell.openPath=async value=>{globalThis.__openedFixture.push(value);return '';};});
 await page.getByRole('button',{name:'在系统应用打开',exact:true}).click();expect(await app.evaluate(()=>globalThis.__openedFixture.at(-1))).toBe(path.join(project,'open.json'));checks.push('file quick-open delegates original typed path to native system association');
 expect(errors).toEqual([]);await page.screenshot({path:path.join(root,'test-results','terminal-controls.png')});await fs.writeFile(path.join(root,'test-results','terminal-controls-regression.json'),JSON.stringify({passed:true,packaged:!!process.env.ACCOUNTOR_EXECUTABLE,checks,errors},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await app.evaluate(async({clipboard,app})=>{const b=globalThis.__clipboardFixtureBackup;if(b&&['COPY_FIXTURE','CLI_COPY_中文','EDITOR_COPY_FIXTURE'].includes(await clipboard.readText()))await Promise.race([clipboard.write(b),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Clipboard restore timeout')),4000))]);app.exit(0);}).catch(async()=>{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});});}
