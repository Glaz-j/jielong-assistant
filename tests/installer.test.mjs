import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {startApp} from '../delivery/app.mjs';
import {startupSettings} from '../delivery/startup.mjs';

test('自启仅在安装版可用，按当前安装路径读写；拒绝覆盖其他安装与无效值',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'jla-startup-'));let entry='',calls=[];
 const execute=async(exe,args,options)=>{
  calls.push({exe,args,options});
  if(exe.endsWith('powershell.exe'))return {stdout:entry};
  if(args[0]==='add')entry=args[args.indexOf('/d')+1];else if(args[0]==='delete')entry='';
  return {stdout:''};
 };
 const startup=startupSettings({root,platform:'win32',execute});
 try{
  assert.equal((await startup.state()).supported,false);await assert.rejects(startup.set(true),/安装版/);assert.equal(calls.length,0);
  await fs.writeFile(path.join(root,'installation.json'),JSON.stringify({application:'JielongAssistant'}));
  assert.equal((await startup.state()).enabled,false);assert.equal((await startup.set(true)).enabled,true);assert.match(entry,/\/\/B \/\/Nologo/);assert.match(entry,/start-background.vbs/);
  assert.equal((await startup.set(false)).enabled,false);
  entry='"C:\\another app\\start.vbs"';await assert.rejects(startup.set(true),/另一份/);assert.equal((await startup.state()).otherInstallation,true);await assert.rejects(startup.set(false),/另一份/);assert.match(entry,/another app/);
  await assert.rejects(startup.set('yes'),/无效/);assert.ok(calls.every(c=>c.options.windowsHide&&c.options.shell===false));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('四步首次向导：恢复进度、同名群按编号、就绪前禁止完成、完成后不重复引导',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-wizard-'));let enabled=false,ready=false;
 const profile={姓名:'安装测试',单位:'测试单位',职工号:'000003',所属部门:'测试部门'};
 const bridge={running:false,async discover(){const d={ok:true,accountId:'wx_test',accountName:'测试账号',groups:[{id:'1@chatroom',name:'同名测试群'},{id:'2@chatroom',name:'同名测试群'}]};await fs.writeFile(path.join(dir,'wechat-discovery.json'),JSON.stringify(d));return d;},async start(){this.running=true;},async stop(){this.running=false;},async status(){return {ready:this.running&&ready,state:this.running?'initializing':'stopped',message:this.running?(ready?'正在监听':'正在初始化'):'监听已停止'};}};
 const options={dir,port:0,bridgeFactory:()=>bridge,workerFactory:()=>({active:new Map(),jobs:{},async init(){},async tick(){},async close(){}}),startup:{async state(){return {supported:true,enabled};},async set(value){enabled=value;return this.state();}}};
 let app=await startApp(options);const browser=await chromium.launch({headless:true,channel:'chromium'});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:1050}});await page.goto(app.url);
  await page.getByRole('heading',{name:'填写你的报名资料'}).waitFor();assert.equal(await page.locator('#startup').isChecked(),false);
  await page.screenshot({path:'release/wizard-1.1.0.png',fullPage:true});
  for(const [k,v]of Object.entries(profile))await page.getByLabel(k,{exact:true}).fill(v);
  await page.locator('#authorize').check();await page.getByRole('button',{name:'保存个人信息'}).click();await page.getByRole('heading',{name:'登录本人的接龙管家'}).waitFor();assert.equal(await page.locator('#login-next').isEnabled(),false);
  await page.reload();await page.getByRole('heading',{name:'登录本人的接龙管家'}).waitFor();
  // A saved synthetic auth file stands in for the user's completed official login.
  await fs.writeFile(path.join(dir,'auth.json'),'{}');await page.locator('#login-next').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('login-next').disabled);await page.locator('#login-next').click();
  await page.locator('#discover').click();await page.getByRole('status').filter({hasText:'已读取'}).waitFor();await page.locator('#groups').selectOption('2@chatroom');await page.locator('#select').click();await page.getByRole('heading',{name:'准备开始'}).waitFor();assert.equal(await page.locator('#complete').isEnabled(),false);
  await page.locator('#start').click();await page.getByRole('status').filter({hasText:'正在建立监听'}).waitFor();assert.equal(await page.locator('#complete').isEnabled(),false);
  ready=true;await page.waitForFunction(()=>!document.getElementById('complete').disabled);await page.locator('#startup').check();await page.locator('#complete').click();await page.getByRole('heading',{name:'后台自动填写'}).waitFor();assert.equal(enabled,true);
  const config=JSON.parse(await fs.readFile(path.join(dir,'config.json')));assert.equal(config.onboardingComplete,true);assert.equal(config.wechatChatId,'2@chatroom');assert.equal(config.profile.职工号,'000003');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'release/dashboard-narrow-1.1.0.png',fullPage:true});
  await app.close();app=await startApp(options);await page.goto(app.url);await page.getByRole('heading',{name:'后台自动填写'}).waitFor();assert.equal(await page.locator('#steps').isVisible(),false);
  await page.locator('#startup').uncheck();await page.locator('#save-startup').click();await page.getByRole('status').filter({hasText:'已关闭'}).waitFor();assert.equal(enabled,false);
 }finally{await browser.close();await app.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('已授权的监听在微信稍后就绪时后台重试，手动停止后不再重试',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-retry-'));let attempts=0,available=false;
 await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({profile:{姓名:'测试',单位:'单位',职工号:'0001',所属部门:'部门'},acceptSavedPersonalInfo:true,wechatAccountId:'wx_test',wechatChatId:'1@chatroom',group:'测试群',autoStart:true}));await fs.writeFile(path.join(dir,'auth.json'),'{}');
 const bridge={running:false,async start(){attempts++;if(!available)throw Error('WeChat unavailable');this.running=true;},async stop(){this.running=false;},async status(){return {ready:this.running,state:this.running?'listening':'stopped',message:'test'};}};
 const app=await startApp({dir,port:0,retryMs:30,bridgeFactory:()=>bridge,workerFactory:()=>({active:new Map(),jobs:{},async init(){},async tick(){},async close(){}})});
 try{
  const token=(await(await fetch(app.url)).text()).match(/X-App-Token':'([a-f0-9]+)'/)[1];const api=route=>fetch(app.url+'/api/'+route,{method:'POST',headers:{Origin:app.url,'X-App-Token':token},body:'{}'}).then(r=>r.json());
  const until=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Timed out');};
  await until(()=>attempts>=2);available=true;await until(()=>bridge.running);await api('wechat-stop');const stopped=attempts;await new Promise(r=>setTimeout(r,150));assert.equal(attempts,stopped);assert.equal(bridge.running,false);
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
