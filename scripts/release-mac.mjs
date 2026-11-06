import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),root=process.cwd(),{version}=JSON.parse(await fs.readFile('package.json','utf8')),app=path.join(root,'release/builds.noindex/WbSpace-darwin-arm64/WbSpace.app'),out=path.join(root,'release'),identity=process.env.TW_SIGN_IDENTITY,profile=process.env.TW_NOTARY_PROFILE;
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('本流程只验收 macOS Apple Silicon');
const packaged=JSON.parse(await fs.readFile(path.join(app,'Contents/Resources/app/package.json'),'utf8'));if(packaged.version!==version)throw new Error('应用包版本与源码不一致，请重新打包');
if(process.env.TW_REQUIRE_SIGNING==='1'&&!identity)throw new Error('缺少正式签名身份');if(profile&&!identity)throw new Error('公证必须有签名身份');
const check=await exec('/usr/bin/codesign',['--verify','--deep','--strict',app]);
if(identity){const sig=await exec('/usr/bin/codesign',['-dv','--verbose=2',app]);if(!sig.stderr.includes('Authority=Developer ID Application:'))throw new Error('应用未使用 Developer ID 签名');}
const label=identity?(profile?'notarized':'signed'):'unsigned-beta',stem=`WbSpace-${version}-mac-arm64-${label}`,zip=path.join(out,stem+'.zip'),dmg=path.join(out,stem+'.dmg');
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'terminal-workbench-dmg-'));
try{
 await exec('/usr/bin/ditto',[app,path.join(stage,'WbSpace.app')]);await fs.symlink('/Applications',path.join(stage,'Applications'));
 const guide=`WbSpace ${version} · ${label}\n\n1. 将“WbSpace.app”拖入 Applications（应用程序）。\n2. 弹出磁盘映像，再从应用程序打开。\n3. 若因开发者未验证而被拦截，请先尝试打开一次，然后前往系统设置 → 隐私与安全性 → 仍要打开。公司管理策略可能禁止自行放行。不要关闭整机安全检查。\n4. 首次启动指南会检测 Claude CLI；缺失时可查看官方安装说明或选择已安装文件。\n5. 使用自己的账号登录或填写自己的供应商配置。包内不含开发者账号、密钥和会话。\n\n支持范围：macOS Apple Silicon（M 系列）。Intel/Windows/Linux 未验收。\n更新：设置 → 检查更新。下载后先退出旧版再替换；不后台自动安装。\n未公证包不承诺通过 Gatekeeper 默认检查。依赖许可见应用 Resources/app/dist/licenses 与 Electron 自带许可。\nhttps://github.com/SneyRio/Terminal-Workbench\n`;
 await fs.writeFile(path.join(stage,'安装说明.txt'),guide);await fs.writeFile(path.join(out,stem+'-README.txt'),guide);
 await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip]);await exec('/usr/bin/hdiutil',['create','-volname','WbSpace','-srcfolder',stage,'-format','UDZO','-fs','HFS+','-ov',dmg],{maxBuffer:1024*1024});
 if(identity)await exec('/usr/bin/codesign',['--sign',identity,'--timestamp',dmg]);
 if(profile){const r=await exec('/usr/bin/xcrun',['notarytool','submit',dmg,'--keychain-profile',profile,'--wait','--output-format','json'],{maxBuffer:1024*1024});if(JSON.parse(r.stdout).status!=='Accepted')throw new Error('Apple 未接受公证，不作为正式包交付');await exec('/usr/bin/xcrun',['stapler','staple',dmg]);await exec('/usr/bin/xcrun',['stapler','validate',dmg]);}
 await exec('/usr/bin/hdiutil',['verify',dmg]);const files=[];for(const file of [zip,dmg]){const b=await fs.readFile(file);files.push({name:path.basename(file),size:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});}
 await fs.writeFile(path.join(out,stem+'.sha256'),files.map(f=>f.sha256+'  '+f.name).join('\n')+'\n');await fs.writeFile(path.join(out,stem+'.json'),JSON.stringify({version,arch:'arm64',channel:label,signed:!!identity,notarized:!!profile,bundleId:'local.claude-accountor.desktop',files},null,2));console.log(JSON.stringify({version,channel:label,files:files.map(f=>f.name)},null,2));
}finally{await fs.rm(stage,{recursive:true,force:true});}
