import fs from 'node:fs/promises';import path from 'node:path';
const root=process.cwd(),manifest=JSON.parse(await fs.readFile('package.json','utf8')),seen=new Set(),entries=[];
async function locate(name,from){for(let p=from;;p=path.dirname(p)){const dir=path.join(p,'node_modules',name);try{await fs.access(path.join(dir,'package.json'));return dir;}catch{}if(path.dirname(p)===p)throw new Error('Missing dependency license source: '+name);}}
async function visit(name,from){const dir=await locate(name,from);if(seen.has(dir))return;seen.add(dir);const p=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8')),texts=[];
 for(const file of await fs.readdir(dir)){if(/^(licen[sc]e|copying|notice)(\.|$)/i.test(file)&&(await fs.stat(path.join(dir,file))).isFile())texts.push(file+'\n'+await fs.readFile(path.join(dir,file),'utf8'));}
 entries.push({name:p.name,version:p.version,license:p.license||'SEE PACKAGE LICENSE',notice:texts.join('\n\n')||'See upstream package license documentation.'});for(const dep of Object.keys(p.dependencies||{}))await visit(dep,dir);
}
for(const dep of Object.keys(manifest.dependencies))await visit(dep,root);
// Bundled outside node_modules: claude-hud is shipped as the default Claude Code status line.
for(const name of ['claude-hud']){const dir=path.join(root,'vendor',name),p=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));entries.push({name:p.name,version:p.version,license:p.license,notice:'LICENSE\n'+await fs.readFile(path.join(dir,'LICENSE'),'utf8')});}
await fs.mkdir('dist/licenses',{recursive:true});await fs.writeFile('dist/licenses/third-party.json',JSON.stringify(entries,null,2));await fs.writeFile('dist/licenses/THIRD-PARTY-NOTICES.txt',entries.map(e=>e.name+' '+e.version+' · '+e.license+'\n'+e.notice).join('\n\n========================================\n\n'));console.log('Bundled notices for '+entries.length+' runtime/build-bundled dependencies. Electron/Chromium notices remain in the app bundle.');
