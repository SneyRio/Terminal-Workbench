import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),seeds=(await fs.readdir(path.join(root,'.test-data'))).filter(n=>n.startsWith('native-cli-')).sort(),seed=JSON.parse(await fs.readFile(path.join(root,'.test-data',seeds.at(-1),'data/state.json'),'utf8'));
const source=seed.sessions.find(s=>s.title.includes('claude-tomton')&&s.claudeSessionId&&s.transcript);
if(!source||!source.cwd.startsWith(path.join(root,'.test-data')+path.sep))throw Error('No isolated native CLI fixture available');
await fs.access(source.transcript);
const dir=path.join(root,'.test-data','native-resume-trash-'+Date.now()),data=path.join(dir,'data');await fs.mkdir(data,{recursive:true});
seed.sessions=[{...source,status:'interrupted'}];seed.operations=[];seed.deletedWorkspaces=[];seed.selectedWorkspace=source.workspaceId;
await fs.writeFile(path.join(data,'state.json'),JSON.stringify(seed));
const app=await electron.launch({...(process.env.ACCOUNTOR_EXECUTABLE?{executablePath:process.env.ACCOUNTOR_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,ACCOUNTOR_DATA_DIR:data}}),checks=[];
try{
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.accountor);await page.evaluate(()=>{globalThis.__nativeOutput='';window.accountor.on('terminal:data',e=>{globalThis.__nativeOutput=(globalThis.__nativeOutput+e.data).slice(-30000);});});await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
 const invoke=(channel,...args)=>page.evaluate(({channel,args})=>window.accountor.invoke(channel,...args),{channel,args});
 const resumed=await invoke('terminal:resume',source.id);let state=await invoke('state:get');expect(resumed.claudeSessionId).toBe(source.claudeSessionId);expect(resumed.cwd).toBe(source.cwd);expect(state.sessions.some(s=>s.id===source.id)).toBe(false);expect(state.deletedWorkspaces).toHaveLength(0);checks.push('real subscription CLI resumes the precise prior native session and removes only the old app entry');
 await invoke('terminal:delete',resumed.id);state=await invoke('state:get');const archived=state.deletedWorkspaces.flatMap(g=>g.sessions).find(r=>r.session.id===resumed.id);expect(archived.session.claudeSessionId).toBe(source.claudeSessionId);expect((await fs.readFile(archived.session.checkpoint,'utf8')).length).toBeGreaterThan(0);checks.push('manual deletion of real CLI retains a local transcript checkpoint in seven-day trash');
 const restored=await invoke('trash:restore',resumed.id);state=await invoke('state:get');expect(restored.claudeSessionId).toBe(source.claudeSessionId);expect(restored.cwd).toBe(source.cwd);expect(state.sessions).toHaveLength(1);expect(state.deletedWorkspaces).toHaveLength(0);checks.push('real subscription CLI restores deleted native session without duplicate app entries');
 // Only lifecycle actions: no chat input, model prompt, or browser sign-in.
 await invoke('terminal:stop',restored.id);await expect.poll(async()=>(await invoke('state:get')).sessions[0].status,{timeout:15000}).toBe('exited');
 await fs.writeFile(path.join(root,'test-results','native-resume-trash.json'),JSON.stringify({passed:true,packaged:!!process.env.ACCOUNTOR_EXECUTABLE,checks,modelPrompts:0,testData:data},null,2));console.log(JSON.stringify({passed:true,checks,modelPrompts:0},null,2));
}catch(error){const pages=app.windows();if(pages[0])await fs.writeFile(path.join(root,'test-results','native-resume-failure.log'),await pages[0].evaluate(()=>globalThis.__nativeOutput||''));throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
