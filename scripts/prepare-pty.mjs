import fs from 'node:fs/promises';import path from 'node:path';
if(process.platform==='win32'){
 const root=path.resolve('node_modules/node-pty');
 await fs.access(path.join(root,'build/Release/conpty.node'));
 await fs.cp(path.join(root,'prebuilds','win32-'+process.arch,'conpty'),path.join(root,'build/Release/conpty'),{recursive:true});
 console.log('Prepared bundled Windows ConPTY runtime.');
}
