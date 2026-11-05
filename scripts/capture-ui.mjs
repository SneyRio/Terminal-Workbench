import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),data=path.join(root,'.test-data','capture-'+Date.now());await fs.mkdir(data,{recursive:true});
const app=await electron.launch({args:[root],env:{...process.env,ACCOUNTOR_DATA_DIR:data}});
try{
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1024});await expect(page.getByRole('heading',{name:'你的工作空间'})).toBeVisible();
 const a=await page.evaluate(()=>window.accountor.invoke('account:import','claude-tomton'));
 const w=await page.evaluate(p=>window.accountor.invoke('workspace:save',p),{name:'账号工具研发',projects:[{path:root},{path:path.join(root,'docs')}],backend:'embedded',accountId:a.id,rightOpen:true,rightWidth:380});
 await page.evaluate(()=>window.accountor.invoke('settings:save',{theme:'light'}));
 await page.getByRole('button',{name:'README.md',exact:true}).first().click();
 await page.getByRole('banner').getByRole('button',{name:'新建会话',exact:true}).click();
 await expect(page.locator('.terminal-frame')).toBeVisible();
 let trusted=false;
 for(let i=0;i<20;i++){
   const s=await page.evaluate(()=>window.accountor.invoke('state:get').then(s=>s.sessions.at(-1)));
   const buf=await page.evaluate(id=>window.accountor.invoke('terminal:buffer',id),s.id);
   const screen=buf.data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,' ');
   if(!trusted&&/Yes,\s*I\s*trust|Quick\s*safety\s*check/.test(screen)){await page.evaluate(id=>window.accountor.invoke('terminal:input',id,'\x1b[B\r'),s.id);trusted=true;}
   if(s.claudeSessionId){await page.waitForTimeout(1500);break;}await page.waitForTimeout(500);
 }
 await page.locator('.tree-section').evaluate(el=>{el.scrollTop=0;});await page.screenshot({animations:'disabled',path:path.join(root,'test-results','app-light.png')});
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'黑夜',exact:true}).click();await page.locator('.workspace-nav').filter({hasText:'账号工具研发'}).click();await page.locator('.tree-section').evaluate(el=>{el.scrollTop=0;});await page.screenshot({animations:'disabled',path:path.join(root,'test-results','app-dark.png')});
 await page.getByRole('button',{name:'收起右侧辅助栏',exact:true}).click();await page.locator('.tree-section').evaluate(el=>{el.scrollTop=0;});await page.screenshot({animations:'disabled',path:path.join(root,'test-results','app-right-collapsed.png')});
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
