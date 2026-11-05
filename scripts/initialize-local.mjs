// Prepare the delivered local app without copying credentials or starting model requests.
import { _electron as electron } from 'playwright';
import path from 'node:path';
const root=process.cwd();
if(!process.env.ACCOUNTOR_EXECUTABLE)throw new Error('Set ACCOUNTOR_EXECUTABLE to the delivered application');
const env={...process.env};delete env.ACCOUNTOR_DATA_DIR;
const client=await electron.launch({executablePath:env.ACCOUNTOR_EXECUTABLE,args:[],env});
try{
 const page=await client.firstWindow();await page.waitForFunction(()=>!!window.accountor);
 const accounts=[];
 for(const command of ['claude-jemusbob','claude-tomton','claude-dp','claude-zmn']){
  const account=await page.evaluate(command=>window.accountor.invoke('account:import',command),command);
  await page.evaluate(id=>window.accountor.invoke('account:status',id),account.id);accounts.push(account);
 }
 const state=await page.evaluate(()=>window.accountor.invoke('state:get'));
 if(!state.workspaces.length)await page.evaluate(input=>window.accountor.invoke('workspace:save',input),{name:'Claude Accountor',projects:[{path:root}],backend:'embedded',accountId:accounts.find(a=>a.command==='claude-tomton').id,rightOpen:true});
 console.log(JSON.stringify({configuredProfiles:accounts.length,workspaceReady:true,modelRequests:0}));
}finally{await client.evaluate(({app})=>app.exit(0)).catch(()=>{});}
