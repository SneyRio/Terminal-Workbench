import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'.test-data','bundled-font-'+Date.now()),project=path.join(dir,'project'),data=path.join(dir,'data');
await fs.mkdir(project,{recursive:true});await fs.mkdir(data);
await fs.writeFile(path.join(data,'state.json'),JSON.stringify({settings:{fontFamily:'system',fontSize:16}}));
const launch=()=>electron.launch({executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[],env:{...process.env,ACCOUNTOR_DATA_DIR:data}});
let app=await launch();const checks=[],errors=[];
try{
 let page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:980});await expect(page.getByRole('heading',{name:'你的工作空间',exact:true})).toBeVisible();
 let invoke=(channel,...args)=>page.evaluate(({channel,args})=>window.accountor.invoke(channel,...args),{channel,args});
 expect((await invoke('state:get')).settings.fontFamily).toBe('JetBrains Mono');checks.push('existing installation migrates to bundled font');
 const loaded=await page.evaluate(()=>{const faces=[...document.fonts].filter(f=>f.family.includes('Accountor JetBrains Mono'));return {faces:faces.map(f=>({status:f.status,weight:f.weight,style:f.style})),resources:[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules].filter(rule=>rule instanceof CSSFontFaceRule&&rule.style.fontFamily.includes('Accountor JetBrains Mono')).map(rule=>new URL(rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)/)[1],sheet.href).href))};});
 expect(loaded.faces).toHaveLength(4);expect(loaded.faces.every(f=>f.status==='loaded')).toBe(true);expect(loaded.resources).toHaveLength(4);expect(loaded.resources.every(r=>r.startsWith('file:'))).toBe(true);checks.push('regular, bold, italic and bold-italic load from packaged local files');
 await page.evaluate(()=>{window.__measuredFonts=[];const p=OffscreenCanvasRenderingContext2D.prototype,original=p.measureText;p.measureText=function(...args){window.__measuredFonts.push(this.font);return original.apply(this,args);};});
 await invoke('settings:save',{shell:'/bin/sh'});await invoke('workspace:save',{name:'内置字体验证',projects:[{path:project}],backend:'embedded',rightOpen:false});await page.locator('.workspace-nav').click();await page.getByRole('button',{name:'打开 Shell',exact:true}).click();
 await expect.poll(async()=>(await invoke('state:get')).sessions[0]?.pid).toBeGreaterThan(0);const session=(await invoke('state:get')).sessions[0];
 await expect.poll(()=>page.evaluate(()=>window.__measuredFonts.some(f=>f.includes('Accountor JetBrains Mono')))).toBe(true);checks.push('xterm measures terminal cells using bundled face');
 await invoke('terminal:input',session.id,"printf '\\033[2J\\033[H编码字体 · JetBrains Mono\\n0O 1lI {} [] () => != === / \\\\ |\\n中文混排 ABC 0123\\n\\033[1mBold 粗体\\033[0m  \\033[3mItalic 斜体\\033[0m\\n'\r");
 await expect.poll(()=>invoke('terminal:buffer',session.id).then(b=>b.data.includes('中文混排 ABC 0123'))).toBe(true);
 const widths=await page.evaluate(()=>{const c=document.createElement('canvas').getContext('2d');c.font='16px "Accountor JetBrains Mono"';return ['i','M','0','W'].map(x=>c.measureText(x).width);});expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(.01);
 await page.screenshot({path:path.join(root,'test-results','bundled-font-terminal.png')});checks.push('monospaced Latin metrics and mixed Chinese terminal output');
 await page.getByRole('button',{name:'终端字体设置',exact:true}).click();await expect(page.getByLabel('终端字体',{exact:true})).toHaveValue('JetBrains Mono');await page.getByLabel('终端字体',{exact:true}).selectOption('Menlo');await page.locator('.workspace-nav').click();
 await expect.poll(()=>page.evaluate(()=>window.__measuredFonts.at(-1))).toContain('Menlo');expect((await invoke('state:get')).sessions[0].pid).toBe(session.pid);
 await page.getByRole('button',{name:'终端字体设置',exact:true}).click();await page.getByLabel('终端字体',{exact:true}).selectOption('JetBrains Mono');await page.getByLabel('终端字体大小',{exact:true}).fill('20');await page.locator('.workspace-nav').click();await expect.poll(()=>page.evaluate(()=>window.__measuredFonts.at(-1))).toContain('20px');expect((await invoke('state:get')).sessions[0].pid).toBe(session.pid);checks.push('font switching and size apply without recreating terminal process');
 await app.evaluate(({app})=>app.exit(0));app=await launch();page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);await expect.poll(()=>page.evaluate(()=>window.accountor.invoke('state:get').then(s=>s.settings.fontFamily))).toBe('JetBrains Mono');checks.push('bundled font preference persists after restart');
 expect(errors).toEqual([]);await fs.writeFile(path.join(root,'test-results','bundled-font-regression.json'),JSON.stringify({passed:true,checks,errors,loaded},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
