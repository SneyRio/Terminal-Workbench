import {BracketsCurly,Code,FileText,Image,TerminalWindow} from '@phosphor-icons/react';
export function FileIcon({name,size=15}:{name:string;size?:number}){
  const ext=name.split('.').at(-1)?.toLowerCase();
  if(['ts','tsx','js','jsx','vue','svelte','html','css','scss'].includes(ext||''))return <Code size={size} className="file-icon type-code"/>;
  if(['py','sh','bash','zsh','rb','go','rs','java'].includes(ext||''))return <TerminalWindow size={size} className="file-icon type-script"/>;
  if(['json','yaml','yml','toml','ini','env','lock'].includes(ext||'')||name.startsWith('.'))return <BracketsCurly size={size} className="file-icon type-config"/>;
  if(['png','jpg','jpeg','webp','svg','gif','ico'].includes(ext||''))return <Image size={size} className="file-icon type-image"/>;
  return <FileText size={size} className={'file-icon '+(['md','txt','csv','tsv'].includes(ext||'')?'type-document':'type-default')}/>;
}
