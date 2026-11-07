import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),testRoot=path.join(root,'.test-data','quota-footer-'+Date.now()),dataRoot=path.join(testRoot,'data'),project=path.join(testRoot,'project');
await fs.mkdir(project,{recursive:true});await fs.mkdir(path.join(dataRoot,'telemetry'),{recursive:true});
const time=Date.now(),reset=Math.floor(time/1000)+3600,weeklyReset=Math.floor(time/1000)+2*86400+5*3600+1800;
const accounts=[{id:'a',name:'订阅 A',provider:'subscription',status:'valid',usage:{five_hour:{used_percentage:0,resets_at:reset},seven_day:{used_percentage:25,resets_at:weeklyReset},time}},{id:'b',name:'订阅 B',provider:'subscription',status:'valid',usage:{five_hour:{used_percentage:40},time}}];
const fixture=path.join(testRoot,'quota-cli');
await fs.writeFile(fixture,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');if(process.argv.includes('status')){console.log(JSON.stringify({loggedIn:true}));process.exit(0);}const out=path.join(process.env.ACCOUNTOR_TELEMETRY_DIR,process.env.ACCOUNTOR_RUN_ID+'-event.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({event:'SessionStart',sessionId:crypto.randomUUID(),time:Date.now()}));process.stdin.resume();setInterval(()=>{},1000);
`,{mode:0o700});
let sessions=[];
await fs.writeFile(path.join(dataRoot,'state.json'),JSON.stringify({accounts,sessions:[],settings:{claudePath:fixture},workspaces:[{id:'w',name:'额度显示回归',projects:[{path:project,name:'project'}],backend:'embedded',accountId:'a',rightOpen:false,rightWidth:360}],selectedWorkspace:'w'}));
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,ACCOUNTOR_DATA_DIR:dataRoot}});
const checks=[];
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);for(const accountId of ['b','a'])sessions.push(await page.evaluate(accountId=>window.accountor.invoke('terminal:start',{workspaceId:'w',kind:'claude',accountId}),accountId));await page.reload();await page.setViewportSize({width:1440,height:1024});
 const weekly=page.getByLabel('本周剩余额度');await expect(weekly).toContainText('75%');await expect(page.locator('.footer-usage')).toContainText('5h 已用 0%');await expect(weekly).toHaveAttribute('title',/重置于/);await expect(page.getByLabel('五小时额度重置倒计时')).toHaveText(/距重置/);await expect(page.getByLabel('周额度重置倒计时')).toHaveText('距重置 2天5小时');await expect(page.getByLabel('周额度重置倒计时')).toHaveAttribute('title',/\d/);checks.push('five-hour usage, reset countdowns and weekly remaining coexist with tooltips');
 await page.setViewportSize({width:960,height:700});await expect(weekly).toBeVisible();
 const footer=await page.locator('.status-bar').boundingBox(),quota=await weekly.boundingBox(),select=await page.getByLabel('切换此会话账号').boundingBox();expect(quota.x).toBeGreaterThanOrEqual(footer.x);expect(quota.x+quota.width).toBeLessThanOrEqual(footer.x+footer.width);expect(select.x+select.width).toBeLessThanOrEqual(footer.x+footer.width);expect(select.x).toBeGreaterThanOrEqual(quota.x+quota.width);checks.push('weekly quota and account selector remain visible at minimum window width');await page.clock.install({time:Date.now()});await page.reload();await expect(weekly).toContainText('75%');await page.clock.fastForward(60000);await expect(page.getByLabel('五小时额度重置倒计时')).toContainText('59分');checks.push('reset countdown updates as local time passes without an API request');
 await page.locator('[data-session-id="'+sessions[0].id+'"]').getByRole('button',{name:sessions[0].title}).first().click();await expect(weekly).toContainText('未知');await expect(page.getByLabel('周额度重置倒计时')).toHaveCount(0);await expect(page.getByLabel('五小时额度重置倒计时')).toHaveText('重置时间未知');checks.push('switching active session uses its own account and missing weekly data stays unknown');
 async function telemetry(value){const output={time:Date.now(),usage:{five_hour:{used_percentage:40},seven_day:{used_percentage:value,resets_at:reset}}};const file=path.join(dataRoot,'telemetry',sessions[0].id+'-usage.json');await fs.writeFile(file+'.tmp',JSON.stringify(output));await fs.rename(file+'.tmp',file);}
 await telemetry(0);await expect(weekly).toHaveText('本周剩余 100%',{timeout:10000});await telemetry(100);await expect(weekly).toHaveText('本周剩余 0%',{timeout:10000});await telemetry(null);await expect(weekly).toContainText('未知',{timeout:10000});checks.push('live CLI telemetry updates weekly quota including zero/full/null without model requests');
 await page.locator('[data-session-id="'+sessions[1].id+'"]').getByRole('button',{name:sessions[1].title}).first().click();await expect(weekly).toContainText('75%');await page.setViewportSize({width:1440,height:1024});await page.screenshot({path:path.join(root,'test-results','weekly-quota-footer.png')});checks.push('account quotas remain isolated when returning to original session');
 await fs.writeFile(path.join(root,'test-results','quota-footer-regression.json'),JSON.stringify({passed:true,packaged:!!process.env.ACCOUNTOR_EXECUTABLE,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
