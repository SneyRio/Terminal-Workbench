const {app,nativeImage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'.test-data/qa-render'));
app.whenReady().then(()=>{
 const source=nativeImage.createFromPath(path.join(root,'docs/prd/assets/cli-workspace-v05.png')).resize({width:1440,height:1024,quality:'best'});
 const actual=nativeImage.createFromPath(path.join(root,'test-results/app-light.png')).resize({width:1440,height:1024,quality:'best'});
 function combine(a,b,width,height,file){const first=a.toBitmap(),second=b.toBitmap(),out=Buffer.alloc(width*2*height*4);for(let y=0;y<height;y++){first.copy(out,y*width*8,y*width*4,(y+1)*width*4);second.copy(out,y*width*8+width*4,y*width*4,(y+1)*width*4);}fs.writeFileSync(path.join(root,'test-results',file),nativeImage.createFromBitmap(out,{width:width*2,height}).toPNG());}
 combine(source,actual,1440,1024,'design-comparison.png');
 combine(source.crop({x:0,y:0,width:760,height:650}),actual.crop({x:0,y:0,width:760,height:650}),760,650,'design-focus.png');
 console.log('Source and actual UI paired at equal dimensions.');app.exit(0);
});
