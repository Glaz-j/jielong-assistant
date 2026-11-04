import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SilentWorker} from '../silent-worker.mjs';
const profile={姓名:'测试2',单位:'测试单位2',职工号:'TEST0002',所属部门:'测试部门2'};
test('silent events: concurrent forms, actual filled values, submit, wrong group, dedup and no visible login',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'silent-jielong-'));
 const config={group:'文件传输助手',profile,allowedActivityIds:['SILENT0001','SILENT0002','SILENT0003','SILENT0004','SILENT0005','ALIAS0001'],acceptSavedPersonalInfo:true,allowedOfficialThreadIds:['1','2','3']};
 await fs.writeFile(path.join(dir,'config.json'),JSON.stringify(config));await fs.writeFile(path.join(dir,'auth.json'),JSON.stringify({cookies:[],origins:[]}));
 const w=new SilentWorker(dir,{channel:'chromium'});const submissions=[];
 try{
  await w.init();assert.equal(w.browser.browserType().name(),'chromium');
  const second=new SilentWorker(dir,{channel:'chromium'});
  await assert.rejects(()=>second.init(),/已有后台实例/);
  await w.context.route('https://i.jielong.com/**',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.pathname==='/api/Form/GetThreadDetail')return route.fulfill({contentType:'application/json',body:JSON.stringify({Data:{Thread:{ThreadId:Number(u.searchParams.get('id').slice(-1))}}})});
   if(u.pathname==='/test-submit'){
    const data=req.postDataJSON();submissions.push(data);assert.deepEqual(data.values,Object.values(profile));
    return route.fulfill({contentType:'application/json',body:'{"ok":true}'});
   }
   if(u.pathname==='/submit-success')return route.fulfill({contentType:'text/html',body:'提交成功'});
   if(u.pathname==='/f/SILENT0004')return route.fulfill({status:302,headers:{location:'/login'}});
   if(u.pathname==='/login')return route.fulfill({contentType:'text/html',body:'扫码登录'});
   const inputs=Object.keys(profile).map((name,i)=>`<div data-form-field><label for="f${i}">* ${i+1}. ${name}</label><input id="f${i}" required></div>`).join('');
   const html=`<meta charset="utf-8"><script>fetch('/api/Form/GetThreadDetail?id='+location.pathname.split('/').pop())</script><h1>静默测试</h1>${inputs}<button onclick="fetch('/test-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:location.pathname,values:[...document.querySelectorAll('input')].map(e=>e.value)})}).then(()=>location.href='/submit-success')">提交表单</button>`;
   return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  });
  await assert.rejects(()=>w.accept({source:'simulation',group:'其他群',url:'https://i.jielong.com/f/SILENT0001'}),/指定测试会话/);
  await assert.rejects(()=>w.accept({source:'wechat',group:config.group,url:'https://i.jielong.com/f/SILENT0001'}),/尚未接入/);
  const events=[1,2,3].map(n=>({source:'simulation',group:config.group,eventId:'signal-'+n,url:'https://i.jielong.com/f/SILENT000'+n,...(n===1?{emittedAt:new Date(Date.now()-11000).toISOString()}:{})}));
  const jobs=await Promise.all(events.map(e=>w.accept(e)));
  const outcomes=await Promise.all(jobs.map(j=>w.process(j)));
  assert.ok(outcomes.every(j=>j.status==='submitted'),JSON.stringify(outcomes));assert.equal(submissions.length,3);
  assert.equal(outcomes[0].within10s,false);assert.ok(outcomes[0].endToEndMs>=11000);
  assert.equal(outcomes[1].within10s,null);
  const prior=await w.accept(events[0]);assert.equal(prior.status,'submitted');assert.equal(submissions.length,3);
  const alias=await w.accept({source:'simulation',group:config.group,url:'https://i.jielong.com/f/ALIAS0001'});
  assert.match((await w.process(alias)).error,/短链接变更/);assert.equal(submissions.length,3);
  const diskLedger=JSON.parse(await fs.readFile(path.join(dir,'ledger.json'),'utf8'));
  assert.equal(diskLedger['official:1'].status,'success');
  const loggedOut=await w.accept({source:'simulation',group:config.group,url:'https://i.jielong.com/f/SILENT0004'});
  const failed=await w.process(loggedOut);assert.equal(failed.status,'failed');assert.match(failed.error,/登录/);
  const outside=await w.accept({source:'simulation',group:config.group,url:'https://i.jielong.com/f/SILENT0005'});
  assert.match((await w.process(outside)).error,/官网活动编号.*白名单/);
  assert.equal(submissions.length,3);assert.equal(w.context.pages().length,0);
 }finally{await w.close();await fs.rm(dir,{recursive:true,force:true});}
});
