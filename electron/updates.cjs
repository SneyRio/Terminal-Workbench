const endpoint='https://api.github.com/repos/SneyRio/Terminal-Workbench/releases/latest';
const releasePage='https://github.com/SneyRio/Terminal-Workbench/releases';
function parseVersion(value){const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value||'');return m?m.slice(1).map(Number):null;}
function newer(a,b){a=parseVersion(a);b=parseVersion(b);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
async function check(current,fetcher=fetch){
 let response;try{response=await fetcher(endpoint,{headers:{Accept:'application/vnd.github+json','User-Agent':'Terminal-Workbench'},signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw new Error('网络不可用或请求超时，请检查网络后重试');}
 if(response.status===404)return {status:'unpublished',current,url:releasePage,message:'尚未发布可下载版本，源码提交不等于安装包发布。'};
 if(!response.ok)throw new Error(response.status===403||response.status===429?'更新服务请求受限，请稍后重试':'暂时无法检查更新');
 const body=await response.text();if(body.length>512*1024)throw new Error('更新信息过大');const data=JSON.parse(body);
 if(!parseVersion(data.tag_name)||data.draft||data.prerelease)throw new Error('更新服务未返回有效正式版本');
 return {status:newer(data.tag_name,current)?'available':'current',current,latest:data.tag_name.replace(/^v/,''),url:releasePage,message:newer(data.tag_name,current)?'发现新版本，下载后退出应用并替换安装。':'当前版本无需更新。'};
}
module.exports={check,newer,parseVersion,releasePage};
