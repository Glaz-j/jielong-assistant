import {BrowserAssistant} from './browser.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
const a=new BrowserAssistant(path.resolve('data'),'http://127.0.0.1:47832');
const fixtures=new Map();
try{
 await a.init();const p=await a.ensure();
 p.on('response',async response=>{
  try{
   if(!response.headers()['content-type']?.includes('json'))return;
   const visit=v=>{
    if(!v||typeof v!=='object')return;
    if(/^接龙助手测试2-0[1-9]$/.test(v.Subject||'')&&/^[A-Za-z0-9]+$/.test(v.ThreadStrId||'')&&v.ThreadType===1)
     fixtures.set(v.ThreadStrId,{title:v.Subject,url:'https://i.jielong.com/f/'+v.ThreadStrId,id:v.ThreadStrId,count:v.AttendCount});
    for(const c of Object.values(v))if(c&&typeof c==='object')visit(c);
   };visit(await response.json());
  }catch{}
 });
 await p.goto('https://i.jielong.com/my-form');
 await p.getByText('接龙助手测试2-02',{exact:true}).waitFor();
 await p.waitForTimeout(200);
 const results=[...fixtures.values()].sort((x,y)=>x.title.localeCompare(y.title));
 await fs.writeFile('data/test2-links.json',JSON.stringify(results,null,2),{mode:0o600});
 await a.context.storageState({path:'data/silent-auth.json'});await fs.chmod('data/silent-auth.json',0o600);
 console.log(JSON.stringify(results));
}finally{await a.close();}
