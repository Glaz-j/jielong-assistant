import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {startServer} from '../server.mjs';import {QQWatcher} from '../qq.mjs';import {TaskQueue} from '../tasks.mjs';import {fixedProfile,fixedPlan,TEST_PROFILE} from '../profile.mjs';
const fields=Object.keys(TEST_PROFILE).map((label,i)=>({id:'f'+i,label:'* '+(i+1)+'. '+label,type:'text',required:true,supported:true,value:''}));
test('fixed schema: rejects extra keys, missing values, unknown required fields and duplicated aliases',()=>{
 assert.throws(()=>fixedProfile({...TEST_PROFILE,学号:'123'}),/固定字段/);
 assert.equal(fixedPlan(fields,TEST_PROFILE).errors.length,0);
 assert.ok(fixedPlan(fields,{...TEST_PROFILE,单位:''}).errors.length);
 assert.ok(fixedPlan([...fields,{id:'x',label:'手机',required:true}],TEST_PROFILE).errors.length);
 assert.ok(fixedPlan([...fields,{...fields[2],id:'x',label:'工号'}],TEST_PROFILE).errors.length);
 assert.ok(fixedPlan([{...fields[2],disabled:true,value:'other'}],TEST_PROFILE).errors.length);
 assert.ok(fixedPlan([{...fields[1],type:'select',options:[{value:'1',label:'不匹配'}]}],TEST_PROFILE).errors.length);
 assert.deepEqual(fixedPlan([...fields,{id:'x',label:'备注',required:false}],TEST_PROFILE).values,{f0:'测试同学',f1:'测试单位',f2:'TEST0001',f3:'测试部门'});
});
test('QQ ingestion: baseline, new links, deduplication, wrong group, card without URL and restart recovery',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-queue-')),handled=[];
 const queue=new TaskQueue(dir,async j=>{handled.push(j.id);return {status:'filled',message:'ok'}});await queue.init();
 let data={status:'ready',group:'接龙助手测试群',text:'https://i.jielong.com/e/OLD12345'};
 const watcher=new QQWatcher('unused',{},queue,{read:async()=>JSON.stringify(data)});
 try{
  await watcher.poll();await queue.tail;assert.equal(queue.jobs[0].status,'existing');assert.equal(handled.length,0);
  data.text+='\nhttps://i.jielong.com/e/NEW12345';await watcher.poll();await queue.tail;assert.deepEqual(handled,['NEW12345']);
  await watcher.poll();await queue.tail;assert.equal(handled.length,1);
  data={...data,group:'其他群',text:'https://i.jielong.com/e/NOPE1234'};await watcher.poll();assert.equal(queue.jobs.length,2);
  data={status:'ready',group:'接龙助手测试群',text:'[小程序] 接龙管家 测试'};await watcher.poll();assert.equal(watcher.status,'card_needs_link');assert.equal(queue.jobs.length,2);
  const next=new TaskQueue(dir,async()=>{throw Error('must not auto retry')});await next.init();assert.equal(next.jobs.find(j=>j.id==='NEW12345').status,'interrupted');
  await next.observe([{url:'https://i.jielong.com/e/NEW12345'}]);await next.tail;assert.equal(next.jobs.length,2);
  await next.close();
 }finally{watcher.stop();await queue.close();await fs.rm(dir,{recursive:true,force:true});}
});
function form(mode='normal') {
 const nodes=Object.entries(TEST_PROFILE).map(([k],i)=>`<div data-form-field><label for="f${i}">* ${i+1}. ${k}</label><input id="f${i}" required></div>`).join('');
 return `<html><meta charset="utf-8"><h1>测试</h1><form>${nodes}${mode==='extra'?'<div data-form-field><label for="unknown">手机号</label><input id="unknown" required></div>':''}${mode==='consent'?'<label><input type="checkbox">我已阅读《保存个人信息授权》</label>':''}<button type="button">提交表单</button></form></html>`;
}
test('background auto-fill pipeline: isolated pages, consent, extra fields, expired login and full activity',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-auto-'));const app=await startServer({port:0,dataDir:dir});
 let submissions=0;
 try{
  const a=app.assistant;await a.setProfile(TEST_PROFILE);await a.open('',true);const originalPage=a.page;
  await a.context.route('https://i.jielong.com/**',async route=>{
   const url=new URL(route.request().url());if(route.request().method()!=='GET'){submissions++;return route.abort();}
   const id=/^\/[ef]\//.test(url.pathname)?url.pathname.split('/').pop():url.searchParams.get('threadId');
   if(id==='FULL1234')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>名额已满</h1>'});
   if(id==='LOGIN123'&&url.pathname.startsWith('/e/'))return route.fulfill({status:302,headers:{location:'https://i.jielong.com/login'}});
   if(url.pathname==='/login')return route.fulfill({contentType:'text/html; charset=utf-8',body:'扫码登录'});
   const body=url.pathname.startsWith('/e/')?`<h1>测试活动</h1><button onclick="location.href='/attend-event?threadId=${id}'">我要报名</button>`:form(id==='EXTRA123'?'extra':['TERMS123','1WV33CVWWV'].includes(id)?'consent':'normal');
   return route.fulfill({contentType:'text/html; charset=utf-8',body});
  });
  for(const [id,status] of [['GOOD1234','filled'],['NEXT1234','filled'],['TERMS123','consent_required'],['EXTRA123','fields_mismatch'],['LOGIN123','login_required'],['FULL1234','unavailable']]){
   const result=await app.engine.process({id,url:'https://i.jielong.com/e/'+id});assert.equal(result.status,status,JSON.stringify(result));
  }
  const questionnaire=await app.engine.process({id:'FORM1234',url:'https://i.jielong.com/f/FORM1234'});assert.equal(questionnaire.status,'filled',JSON.stringify(questionnaire));
  assert.equal(app.engine.sessions.get('FORM1234').scan.isForm,true);
  assert.equal(a.page,originalPage,'automatic tasks must not replace the manual preview');
  for(const id of ['GOOD1234','NEXT1234','TERMS123','FORM1234'])assert.deepEqual(Object.values(app.engine.sessions.get(id).scan.values).filter(v=>typeof v==='string'),Object.values(TEST_PROFILE));
  assert.equal(app.engine.sessions.get('TERMS123').scan.fields.find(f=>f.manual).value,false);
  assert.equal(app.engine.sessions.get('TERMS123').preview,null);
  const consentSession=app.engine.sessions.get('TERMS123');
  await assert.rejects(()=>consentSession.confirmTestConsent(),/当前已授权/);
  const approved=await app.engine.process({id:'1WV33CVWWV',url:'https://i.jielong.com/f/1WV33CVWWV'});
  assert.equal(approved.status,'consent_required');
  const accepted=await app.engine.sessions.get('1WV33CVWWV').confirmTestConsent();
  assert.equal(accepted.scan.fields.find(f=>f.manual).value,true);
  assert.ok(accepted.preview,'explicit acceptance creates a reviewable preview');
  assert.equal(submissions,0,'auto-fill and consent acceptance must not submit');
  const s=await app.engine.review('GOOD1234');assert.equal(s.activity.id,'GOOD1234');assert.ok(s.preview);
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
