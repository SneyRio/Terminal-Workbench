import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),testRoot=path.join(root,'.test-data','account-login-'+Date.now());
await fs.mkdir(testRoot,{recursive:true});
const mode=path.join(testRoot,'mode'),fixture=path.join(testRoot,'claude-fixture');
await fs.writeFile(mode,'valid');
// Local protocol fixture only: no web login, external service or credential access.
await fs.writeFile(fixture,`#!${process.execPath}
const fs=require('node:fs');const mode=${JSON.stringify(mode)};
if(process.argv.includes('login')){setTimeout(()=>fs.writeFileSync(mode,'valid'),500);setInterval(()=>{},1000);}
else {const value=fs.readFileSync(mode,'utf8');setTimeout(()=>{if(value==='error'){console.error('fixture failure');process.exit(2);}console.log(JSON.stringify({loggedIn:value==='valid',email:value==='valid'?'fixture@example.invalid':'',authMethod:'fixture'}));process.exit(value==='valid'?0:1);},350);}
`,{mode:0o700});
const launch=()=>electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',ACCOUNTOR_DATA_DIR:path.join(testRoot,'data')}});
const checks=[];let app=await launch();
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);await page.evaluate(()=>window.accountor.invoke('setup:finish'));
 await page.evaluate(file=>window.accountor.invoke('settings:save',{claudePath:file}),fixture);
 const account=await page.evaluate(()=>window.accountor.invoke('account:add','登录回归'));
 await page.getByRole('button',{name:/账号与连接/}).click();
 await page.getByRole('button',{name:'刷新状态与用量 登录回归',exact:true}).click();
 await expect(page.getByRole('button',{name:'刷新状态与用量 登录回归',exact:true})).toBeDisabled();
 await expect(page.getByRole('alert')).toContainText('登录有效，暂未取到最新用量');
 await expect(page.locator('.account-card')).toContainText('登录有效');await page.screenshot({path:path.join(root,'test-results','account-status-fixed.png')});checks.push('pending state, duplicate-click protection and success feedback');
 await fs.writeFile(mode,'error');await page.getByRole('button',{name:'刷新状态与用量 登录回归',exact:true}).click();
 await expect(page.locator('.account-card .inline-error')).toContainText('无法读取 CLI 登录状态');
 await expect(page.getByRole('alert')).toContainText('无法读取 CLI 登录状态');checks.push('CLI failure is visible rather than silently swallowed');
 await fs.writeFile(mode,'login');await page.getByRole('button',{name:'刷新状态与用量 登录回归',exact:true}).click();
 await expect(page.locator('.account-card')).toContainText('需要登录');
 await expect(page.getByRole('alert')).toContainText('尚未登录或认证已失效');checks.push('nonzero unauthenticated JSON produces actionable result');
 await page.getByRole('button',{name:'重新登录',exact:true}).click();
 await expect(page.getByRole('button',{name:/^关闭 账号登录 ·/ })).toBeVisible();
 await expect.poll(()=>page.evaluate(id=>window.accountor.invoke('state:get').then(s=>s.accounts.find(a=>a.id===id).status),account.id),{timeout:12000}).toBe('valid');
 const state=await page.evaluate(()=>window.accountor.invoke('state:get'));const login=state.sessions.at(-1);await page.screenshot({path:path.join(root,'test-results','login-close-fixed.png')});
 expect(state.accounts.find(a=>a.id===account.id).error).toBe('');checks.push('login in progress refreshes status automatically and clears stale errors');
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
 await page.getByRole('button',{name:/^关闭 账号登录 ·/ }).click();
 await expect(page.locator('.terminal-tabs')).toContainText('账号登录 ·');
 expect((await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions.at(-1).closedAt).toBeUndefined();
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 await page.getByRole('button',{name:/^关闭 账号登录 ·/ }).click();
 await expect(page.locator('.terminal-tabs')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(id=>window.accountor.invoke('state:get').then(s=>s.sessions.find(s=>s.id===id).status),login.id)).toBe('exited');
 checks.push('login tab close cancels safely or terminates and removes the window');
 await page.getByRole('button',{name:'切换记录',exact:true}).click();
 await expect(page.getByRole('button',{name:'查看',exact:true})).toHaveCount(0);
 expect((await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions).toHaveLength(1);
 checks.push('ended login automatically leaves history without removing authentication data');
 // Real imported profile with Finder's minimal PATH: metadata only, no model/browser.
 const imported=await page.evaluate(()=>window.accountor.invoke('account:import','claude-jemusbob'));
 const actual=await page.evaluate(id=>window.accountor.invoke('account:status',id),imported.id);
 expect(actual.status).toBe('valid');checks.push('real wrapper authentication status works with Finder minimal PATH');
 await app.evaluate(({app})=>app.exit(0));app=await launch();
 const restored=await app.firstWindow();await restored.waitForFunction(()=>!!window.accountor);
 const persisted=await restored.evaluate(()=>window.accountor.invoke('state:get'));
 expect(persisted.sessions.find(s=>s.id===login.id).closedAt).toBeTruthy();
 await expect(restored.locator('.terminal-tabs')).toHaveCount(0);checks.push('closed login window stays closed across application restart');
 await fs.writeFile(path.join(root,'test-results','account-login-regression.json'),JSON.stringify({passed:true,packaged:!!process.env.ACCOUNTOR_EXECUTABLE,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
