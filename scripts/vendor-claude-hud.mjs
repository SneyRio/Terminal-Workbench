// Copies the compiled claude-hud (MIT, no runtime dependencies) into vendor/claude-hud so WbSpace can show it
// without the plugin being installed. Usage: node scripts/vendor-claude-hud.mjs [plugin directory]
// Without an argument the newest version in ~/.claude/plugins/cache/claude-hud/claude-hud is used.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root=process.cwd(),target=path.join(root,'vendor','claude-hud');
const version=name=>/^(\d+)\.(\d+)\.(\d+)$/.exec(name)?.slice(1).map(Number);
let source=process.argv[2];
if(!source){
 const base=path.join(os.homedir(),'.claude','plugins','cache','claude-hud','claude-hud');
 const newest=(await fs.readdir(base)).filter(version).sort((a,b)=>{const x=version(a),y=version(b);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];}).at(-1);
 if(!newest)throw new Error('未找到已安装的 claude-hud：'+base);
 source=path.join(base,newest);
}
const manifest=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
if(manifest.name!=='claude-hud'||manifest.license!=='MIT')throw new Error('不是 MIT 许可的 claude-hud：'+source);
if(Object.keys(manifest.dependencies||{}).length)throw new Error('claude-hud 出现了运行时依赖，需要先确认再内置');
await fs.rm(target,{recursive:true,force:true});await fs.mkdir(target,{recursive:true});
await fs.cp(path.join(source,'dist'),path.join(target,'dist'),{recursive:true,filter:file=>!/\.(map|d\.ts)$/.test(file)&&!file.endsWith('.d.ts.map')});
await fs.copyFile(path.join(source,'LICENSE'),path.join(target,'LICENSE'));
await fs.writeFile(path.join(target,'package.json'),JSON.stringify({name:'claude-hud',version:manifest.version,license:'MIT',author:manifest.author,type:'module',main:'dist/index.js',private:true},null,2)+'\n');
console.log('claude-hud '+manifest.version+' → '+path.relative(root,target));
