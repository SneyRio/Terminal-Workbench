import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dirs=(await fs.readdir(path.join(root,'.test-data'))).filter(x=>x.startsWith('native-cli-')).sort();
const state=JSON.parse(await fs.readFile(path.join(root,'.test-data',dirs.at(-1),'data/state.json'),'utf8'));
const testRoot=path.join(root,'.test-data','switch-ui-'+Date.now());await fs.mkdir(path.join(testRoot,'data'),{recursive:true});await fs.writeFile(path.join(testRoot,'data/state.json'),JSON.stringify(state));
const app=await electron.launch({args:[root],env:{...process.env,ACCOUNTOR_DATA_DIR:path.join(testRoot,'data')}});
try{
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1024});await expect(page.getByRole('heading',{name:'CLI 集成验证'})).toBeVisible();
 await page.locator('.session-navigation button').filter({hasText:'claude-jemusbob'}).click();
 const switchTarget=state.accounts.find(a=>a.command==='claude-dp');await page.getByLabel('切换此会话账号').click();await page.getByRole('option',{name:switchTarget.name}).click();
 await page.getByRole('button',{name:'保存并切换',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'确认账号切换'});await expect(dialog).toBeVisible();
 await expect(dialog.locator('select')).toHaveValue('handoff');await expect(page.getByLabel('上下文交接资料')).toContainText('ACCOUNTOR_NATIVE_OK');
 await page.getByLabel('上下文交接资料').fill((await page.getByLabel('上下文交接资料').inputValue())+'\n下一步：继续当前任务。');
 await page.screenshot({path:path.join(root,'test-results','switch-preview.png')});
 await page.getByRole('button',{name:'取消切换',exact:true}).click();
 expect((await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions.length).toBe(state.sessions.length);
 await fs.writeFile(path.join(root,'test-results','switch-ui.json'),JSON.stringify({passed:true,checks:['DP defaults to explicit handoff','handoff preview preserves marker','preview editable before launch','cancel creates no new process']},null,2));console.log('Switch preview UI passed.');
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
