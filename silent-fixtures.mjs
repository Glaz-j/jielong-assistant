// Development fixture authoring only; uses the existing, automation-owned profile.
import {BrowserAssistant} from './browser.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
const a=new BrowserAssistant(path.resolve('data'),'http://127.0.0.1:47832');
const title=process.argv[2];
if(title&&!/^接龙助手测试2-0[3-9]$/.test(title))throw Error('只允许创建自用测试活动');
try{
 await a.init();const p=await a.ensure();
 await p.goto('https://i.jielong.com/my-form');
 const source=p.getByText('接龙助手测试2-02',{exact:true});await source.waitFor();
 if(title&&await p.getByText(title,{exact:true}).count())throw Error('同名测试已存在，停止重复创建');
 const row=p.locator('tr').filter({has:source});
 await row.getByText('更多',{exact:true}).click();
 await p.getByText('复制',{exact:true}).click();
 await p.waitForURL(u=>u.pathname==='/publish-form');
 await p.locator('textarea:visible,input:visible').first().waitFor();
 await p.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(e=>e.value.trim()==='接龙助手测试2-02'));
 if(!title){console.log(JSON.stringify(await p.locator('input,textarea,[contenteditable=true]').evaluateAll(es=>es.map(e=>({tag:e.tagName,type:e.type,ph:e.placeholder,value:e.value,text:e.innerText})))));}
 else{
  const field=p.locator('input,textarea').filter({visible:true});
  const candidates=await field.evaluateAll(es=>es.map((e,i)=>({i,value:e.value})).filter(e=>e.value.trim()==='接龙助手测试2-02'));
  if(candidates.length!==1)throw Error('未找到唯一标题');
  await field.nth(candidates[0].i).fill(title);
  if(process.argv[3]){
   const variants={reorder:['所属部门','姓名','职工号','单位'],aliases:['真实姓名','工作单位','工号','部门']};
   const labels=variants[process.argv[3]];if(!labels)throw Error('未知测试变体');
   const questions=p.getByPlaceholder('请输入表单项标题',{exact:true});
   if(await questions.count()!==4)throw Error('复制表单不是四项');
   const originals=await questions.evaluateAll(es=>es.map(e=>e.value.trim()).sort());
   if(JSON.stringify(originals)!==JSON.stringify(['姓名','单位','职工号','所属部门'].sort()))throw Error('原始字段不匹配');
   for(let i=0;i<4;i++)await questions.nth(i).fill(labels[i]);
  }
  await p.getByText('立即发布',{exact:true}).click();
  await p.waitForTimeout(700);
  console.log(JSON.stringify({path:new URL(p.url()).pathname,body:(await p.locator('body').innerText()).slice(-1500)}));
 }
}finally{await a.close();}
