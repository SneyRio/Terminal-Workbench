// Chat view against the real Claude CLI: CLAUDE.md, a permission prompt, AskUserQuestion,
// and switching the same conversation to the terminal and back.
// Usage: node scripts/chat-native-smoke.mjs   (ACCOUNTOR_PROFILE=claude-tomton to pick another account)
import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),testRoot=path.join(root,'.test-data','chat-native-'+Date.now());
const project=path.join(testRoot,'project'),shots=path.join(root,'test-results','chat-native');
await fs.mkdir(project,{recursive:true});await fs.mkdir(shots,{recursive:true});
await fs.writeFile(path.join(project,'CLAUDE.md'),'# 对话视图测试\n用户问暗号时，只回答 PINEAPPLE-42。\n');
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,ACCOUNTOR_DATA_DIR:path.join(testRoot,'data'),ACCOUNTOR_CLAUDE_VIEW:'chat'}});
const checks=[],errors=[];
const step=async(name,fn)=>{const t=Date.now();await fn();checks.push(name+' ('+((Date.now()-t)/1000).toFixed(1)+'s)');console.log('✓',name);};
let page;
try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1360,height:920});
  await page.waitForFunction(()=>!!window.accountor);await page.evaluate(()=>window.accountor.invoke('setup:finish'));
  const account=await page.evaluate(command=>window.accountor.invoke('account:import',command),process.env.ACCOUNTOR_PROFILE||'claude-jemusbob');
  const workspace=await page.evaluate(p=>window.accountor.invoke('workspace:save',p),{name:'对话视图验证',projects:[{path:project}],backend:'embedded',accountId:account.id,rightOpen:false});
  await page.evaluate(id=>window.accountor.invoke('workspace:select',id),workspace.id);
  const sessionOf=sid=>page.evaluate(sid=>window.accountor.invoke('state:get').then(s=>s.sessions.find(r=>r.id===sid)),sid);
  let session;
  await step('new Claude session opens in the chat view',async()=>{
    await page.getByRole('button',{name:/新建 .* 会话/}).click();
    await expect(page.locator('.chat-pane')).toBeVisible();
    session=(await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions.at(-1);
    expect(session.view).toBe('chat');
    await expect.poll(async()=>(await sessionOf(session.id)).claudeSessionId,{timeout:60000}).toBeTruthy();
  });
  await step('a session with no message yet switches views in place',async()=>{
    // The CLI has not written a transcript yet, so there is nothing to resume.
    const latest=async()=>(await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions.at(-1);
    await page.locator('.view-switch').first().click();
    await expect(page.locator('.terminal-pane')).toBeVisible({timeout:60000});
    await expect.poll(async()=>{const s=await latest();return s.view!=='chat'&&s.claudeSessionId&&s.status==='idle';},{timeout:60000}).toBeTruthy();
    await page.locator('.view-switch').first().click();
    await expect(page.locator('.chat-pane')).toBeVisible({timeout:60000});
    await expect.poll(async()=>{const s=await latest();return s.view==='chat'&&!!s.claudeSessionId;},{timeout:60000}).toBeTruthy();
    session=await latest();
    const picker=page.locator('.chat-toolbar [role=combobox][aria-label="模型"]');
    await expect(picker).toContainText('默认模型');
    await page.evaluate(sid=>window.accountor.invoke('chat:control',sid,{subtype:'set_model',model:'haiku'}),session.id);
    await expect(picker).toContainText('haiku');
  });
  const composer=page.locator('.chat-composer textarea');
  await step('CLAUDE.md is loaded and the reply streams in',async()=>{
    await composer.fill('暗号是什么？只回答暗号。');await composer.press('Enter');
    // The message shows at once, not after the CLI echoes it back.
    await expect(page.locator('.chat-user').filter({hasText:'暗号是什么'})).toBeVisible({timeout:1000});
    await expect(page.locator('.chat-assistant').filter({hasText:'PINEAPPLE-42'})).toBeVisible({timeout:90000});
    await expect(page.locator('.chat-user').filter({hasText:'暗号是什么'})).toHaveCount(1);
    await expect.poll(async()=>(await sessionOf(session.id)).status,{timeout:30000}).toBe('idle');
  });
  await step('a sent image shows as a thumbnail that opens a preview',async()=>{
    const png=path.join(testRoot,'window.png');
    await page.screenshot({path:png,scale:'css'});
    // Images come in by paste or drag and drop; there is no picker button.
    const data=(await fs.readFile(png)).toString('base64');
    await composer.evaluate((el,data)=>{
      const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),transfer=new DataTransfer();
      transfer.items.add(new File([bytes],'window.png',{type:'image/png'}));
      el.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
    },data);
    await expect(page.locator('.chat-attachments img')).toBeVisible();
    await composer.fill('这张截图里的应用叫什么名字？只回答名字。');await composer.press('Enter');
    const thumb=page.locator('.chat-user .chat-thumbs img').last();
    await expect(thumb).toBeVisible({timeout:1000});
    await thumb.click();
    await expect(page.locator('.chat-lightbox img')).toBeVisible();
    await page.screenshot({path:path.join(shots,'0-image-preview.png')});
    await page.keyboard.press('Escape');
    await expect(page.locator('.chat-lightbox')).toHaveCount(0);
    await thumb.click();
    // Synthetic clicks bypass the window's drag regions, so check the opt-out itself.
    expect(await page.locator('.chat-lightbox button').evaluate(el=>{const c=getComputedStyle(el);return c.appRegion||c.webkitAppRegion;})).toBe('no-drag');
    await page.getByRole('button',{name:'关闭预览'}).click();
    await expect(page.locator('.chat-lightbox')).toHaveCount(0);
    expect(await page.evaluate(()=>getComputedStyle(document.querySelector('.chat-thumbs button')).cursor)).toBe('zoom-in');
    await expect.poll(async()=>(await sessionOf(session.id)).status,{timeout:90000}).toBe('idle');
    await expect(page.locator('.chat-user .chat-thumbs')).toHaveCount(1);
  });
  await step('a Bash permission card waits for the user, then runs',async()=>{
    // The user's own settings may default to auto mode; ask for every tool here so a card must appear.
    // The picker offers auto, plan and YOLO; ask-for-everything is set directly so a card must appear.
    const modePicker=page.locator('.chat-toolbar [role=combobox][aria-label="权限模式"]');
    await expect(modePicker).toContainText('自动');
    await modePicker.click();
    expect(await page.locator('.picker-menu [role=option]').allTextContents()).toEqual(['自动','计划','YOLO']);
    await page.keyboard.press('Escape');
    await expect(page.locator('.picker-menu')).toHaveCount(0);
    await page.evaluate(sid=>window.accountor.invoke('chat:control',sid,{subtype:'set_permission_mode',mode:'default'}),session.id);
    await composer.fill('用 Bash 执行 echo chat-ok > chat.txt，不要用其他工具，完成后只回复“好了”。');await composer.press('Enter');
    const card=page.locator('.chat-permission:not(.resolved)');
    await expect(card).toBeVisible({timeout:90000});
    await page.screenshot({path:path.join(shots,'1-permission.png')});
    expect(await fs.access(path.join(project,'chat.txt')).then(()=>true,()=>false)).toBe(false);
    await card.getByRole('button',{name:'允许',exact:true}).click();
    await expect(page.locator('.chat-permission.resolved')).toBeVisible();
    await expect.poll(()=>fs.readFile(path.join(project,'chat.txt'),'utf8').catch(()=>''),{timeout:90000}).toContain('chat-ok');
    await expect.poll(async()=>(await sessionOf(session.id)).status,{timeout:60000}).toBe('idle');
  });
  await step('AskUserQuestion is answered from a card',async()=>{
    await composer.fill('必须使用 AskUserQuestion 工具问我喜欢“红色”还是“蓝色”（两个选项），然后只复述我的选择。');await composer.press('Enter');
    const card=page.locator('.chat-permission.ask');
    await expect(card).toBeVisible({timeout:90000});
    await card.locator('.chat-option').filter({hasText:'蓝色'}).click();
    await page.screenshot({path:path.join(shots,'2-ask.png')});
    await card.getByRole('button',{name:'提交回答'}).click();
    await expect(page.locator('.chat-assistant').last()).toContainText('蓝',{timeout:90000});
    await expect.poll(async()=>(await sessionOf(session.id)).status,{timeout:60000}).toBe('idle');
    await page.screenshot({path:path.join(shots,'3-conversation.png')});
  });
  await step('messages show their time and a sub-agent shows how long it ran',async()=>{
    await expect(page.locator('.chat-user .chat-time').first()).toHaveText(/^\d\d:\d\d:\d\d$/);
    await expect(page.locator('.chat-assistant .chat-time').first()).toHaveText(/^\d\d:\d\d:\d\d$/);
    await composer.fill('用 Agent 工具启动一个 general-purpose 子代理，让它不调用任何工具、直接回复“子代理完成”。之后你只回复“好了”。');await composer.press('Enter');
    const agent=page.locator('.chat-tool.agent').last();
    await expect(agent).toBeVisible({timeout:90000});
    // The model may run the sub-agent in the foreground or in the background; either way the card
    // keeps running until the sub-agent itself ends.
    await expect.poll(async()=>(await sessionOf(session.id)).status,{timeout:120000}).toBe('idle');
    await expect(agent.locator('.chat-tool-head .spin')).toHaveCount(0,{timeout:120000});
    await expect(agent.locator('.chat-duration')).toHaveText(/^\d[\d.]* (毫秒|秒)|分/);
    await expect(agent.locator('.chat-tool-head small').filter({hasText:'tokens'})).toBeVisible();
    await agent.locator('.chat-tool-head').click();
    await page.screenshot({path:path.join(shots,'6-timing.png')});
    await expect(agent).not.toContainText('Async agent launched');
    await expect(agent.locator('.chat-code.result')).toHaveText('子代理完成',{timeout:30000});
    await agent.getByRole('button',{name:'查看子代理详情'}).click();
    const detail=page.locator('.chat-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('已完成');
    await expect(detail.locator('.chat-detail-result')).toHaveText('子代理完成');
    // The panel's left edge resizes it; the width is kept when the panel opens again.
    const before=(await detail.boundingBox()).width,handle=await page.locator('.chat-detail-resize').boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+200);await page.mouse.down();
    await page.mouse.move(handle.x-50,handle.y+200,{steps:6});await page.mouse.up();
    const after=(await detail.boundingBox()).width;
    expect(after).toBeGreaterThan(before+30);
    // It never squeezes the conversation below 360px.
    expect((await page.locator('.chat-pane').boundingBox()).width-after).toBeGreaterThanOrEqual(359);
    await page.screenshot({path:path.join(shots,'8-agent-detail.png')});
    await detail.getByRole('button',{name:'关闭详情'}).click();
    await expect(detail).toHaveCount(0);
    await agent.getByRole('button',{name:'查看子代理详情'}).click();
    expect(Math.abs((await detail.boundingBox()).width-after)).toBeLessThan(2);
    await detail.getByRole('button',{name:'关闭详情'}).click();
  });
  await step('/btw answers from the conversation without adding to it',async()=>{
    const before=await page.locator('.chat-user').count();
    await composer.fill('/btw 暗号是什么？只回答暗号。');await composer.press('Enter');
    const answer=page.locator('.chat-btw');
    await expect(answer).toContainText('PINEAPPLE-42',{timeout:120000});
    await page.screenshot({path:path.join(shots,'9-btw.png')});
    expect(await page.locator('.chat-user').count()).toBe(before);
    await composer.press('Escape');
    await expect(answer).toHaveCount(0);
  });
  const claudeSessionId=(await sessionOf(session.id)).claudeSessionId;
  let terminalSession;
  await step('the same conversation opens in the terminal',async()=>{
    await page.locator('.view-switch').first().click();
    await expect(page.locator('.terminal-pane')).toBeVisible({timeout:60000});
    terminalSession=(await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions.find(r=>r.claudeSessionId===claudeSessionId&&r.view!=='chat');
    expect(terminalSession).toBeTruthy();
    await page.waitForTimeout(3000);
    await page.screenshot({path:path.join(shots,'4-terminal.png')});
  });
  await step('and back to the chat view with its history',async()=>{
    await expect.poll(async()=>(await sessionOf(terminalSession.id))?.status,{timeout:30000}).toBe('idle');
    await page.locator('.view-switch').first().click();
    await expect(page.locator('.chat-pane')).toBeVisible({timeout:60000});
    await expect(page.locator('.chat-assistant').filter({hasText:'PINEAPPLE-42'})).toBeVisible({timeout:30000});
    const back=(await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions.find(r=>r.claudeSessionId===claudeSessionId);
    expect(back.view).toBe('chat');
    // The picked model carries over to the resumed process.
    await expect(page.locator('.chat-toolbar [role=combobox][aria-label="模型"]')).toContainText('haiku',{timeout:30000});
    await composer.fill('暗号再说一次，只回答暗号。');await composer.press('Enter');
    await expect(page.locator('.chat-assistant').filter({hasText:'PINEAPPLE-42'})).toHaveCount(2,{timeout:90000});
    // The CLI reports the model it actually used with the turn.
    await expect(page.locator('.chat-toolbar [role=combobox][aria-label="模型"]')).toHaveAttribute('title',/haiku/);
    await page.screenshot({path:path.join(shots,'5-back-to-chat.png')});
    await page.emulateMedia({colorScheme:'dark'});
    await composer.fill('草稿');
    await page.locator('.chat-composer').screenshot({path:path.join(shots,'7-composer-dark.png')});
    await composer.fill('');
    await page.locator('.chat-composer').screenshot({path:path.join(shots,'7-composer-dark-empty.png')});
  });
  await step('switching account continues the conversation in the chat view',async()=>{
    // Relay to the second account, as when the first one runs out of quota.
    const other=await page.evaluate(command=>window.accountor.invoke('account:import',command),process.env.ACCOUNTOR_RELAY_PROFILE||'claude-tomton');
    const from=(await page.evaluate(()=>window.accountor.invoke('state:get'))).sessions.find(r=>r.claudeSessionId&&r.view==='chat'&&r.status==='idle');
    expect(from).toBeTruthy();
    const preview=await page.evaluate(([sid,aid])=>window.accountor.invoke('terminal:prepare-switch',sid,aid),[from.id,other.id]);
    const moved=await page.evaluate(([sid,aid,p])=>window.accountor.invoke('terminal:switch',sid,aid,{mode:p.mode,handoffText:p.text,expectedEventTime:p.eventTime,reviewed:true}),[from.id,other.id,preview]);
    expect(moved).toMatchObject({accountId:other.id,view:'chat'});
    // Called through the API here, so select the new tab the way the switch dialog would.
    await page.locator('.terminal-tabs > button').first().click();
    await expect(page.locator('.chat-pane')).toBeVisible({timeout:60000});
    await expect(page.locator('.chat-assistant').filter({hasText:'PINEAPPLE-42'}).first()).toBeVisible({timeout:30000});
    await expect.poll(async()=>(await sessionOf(moved.id))?.status,{timeout:60000}).toBe('idle');
    const before=await page.locator('.chat-assistant').filter({hasText:'PINEAPPLE-42'}).count();
    await composer.fill('暗号再说一次，只回答暗号。');await composer.press('Enter');
    await expect(page.locator('.chat-assistant').filter({hasText:'PINEAPPLE-42'})).toHaveCount(before+1,{timeout:90000});
    console.log('  relay mode:',preview.mode);
    await page.screenshot({path:path.join(shots,'10-account-relay.png')});
  });
  if(errors.length)throw new Error('页面错误：'+errors.join('\n'));
  console.log(JSON.stringify({ok:true,checks},null,1));
}catch(e){
  if(page)await page.screenshot({path:path.join(shots,'failure.png')}).catch(()=>{});
  console.log(JSON.stringify({ok:false,checks,errors,error:e.message.slice(0,1500)},null,1));process.exitCode=1;
}finally{
  // Confirm the quit prompt for live sessions; the app must still end every CLI it started.
  await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});
  await app.close().catch(()=>{});
}
