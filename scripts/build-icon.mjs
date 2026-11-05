import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=process.cwd(),source=path.join(root,'assets/claude-accountor-icon-v1.png'),folder=await fs.mkdtemp(path.join(os.tmpdir(),'accountor-icon-')),iconset=path.join(folder,'Accountor.iconset');
try{
 await fs.mkdir(iconset);
 for(const size of [16,32,128,256,512])for(const scale of [1,2])await exec('/usr/bin/sips',['-z',String(size*scale),String(size*scale),source,'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);
 await exec('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(root,'assets/claude-accountor.icns')]);
 await exec('/usr/bin/sips',['-z','128','128',source,'--out',path.join(root,'public/app-icon-v1.png')]);
 console.log('Generated native macOS .icns and small application PNG from original artwork');
}finally{await fs.rm(folder,{recursive:true,force:true});}
