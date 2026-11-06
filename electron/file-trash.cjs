const fs=require('node:fs/promises'),path=require('node:path');
const {inside}=require('./core.cjs');
async function prepareTrash(store,wid,file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw new Error('请选择项目内的文件或文件夹');
 if((await fs.lstat(file)).isSymbolicLink())throw new Error('暂不支持删除符号链接，请在系统文件管理器中处理');
 const real=await store.resolveFile(wid,file),stat=await fs.lstat(real);
 const roots=await Promise.all(store.state.workspaces.flatMap(w=>w.projects.map(p=>fs.realpath(p.path).catch(()=>null))));
 if(roots.some(root=>root&&inside(real,root)))throw new Error('不能删除项目根目录或包含工作空间项目的文件夹');
 for(const [name,draft]of Object.entries(store.state.drafts)){
  if(!draft||draft.text===draft.baseText)continue;
  const canonical=await fs.realpath(name).catch(()=>path.resolve(name));
  if(inside(real,canonical))throw new Error('其中有未保存的编辑内容，请先保存或关闭并处理草稿，再删除');
 }
 return {path:real,directory:stat.isDirectory(),identity:[stat.dev,stat.ino,stat.birthtimeMs,stat.mtimeMs,stat.size].join(':')};
}
module.exports={prepareTrash};
