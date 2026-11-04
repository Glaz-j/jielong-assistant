import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {fixedProfile,PROFILE_FIELDS} from '../profile.mjs';
import {SilentWorker} from '../silent-worker.mjs';
import {WeChatBridge} from './wechat.mjs';
import {startupSettings} from './startup.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function startApp({
 dir=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'JielongAssistant'),port=47834,
 bridgeFactory=d=>new WeChatBridge(d),workerFactory=d=>new SilentWorker(d),startup=startupSettings(),retryMs=30000
}={}){
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const token=randomBytes(32).toString('hex'),bridge=bridgeFactory(dir);
 let config=null,worker=null,login=null,discovery=null,tail=Promise.resolve(),pump=null,pumping=false,runtimeError='',closing=false,closePromise,app,retryTimer;
 try{config=JSON.parse(await fs.readFile(path.join(dir,'config.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 try{const saved=JSON.parse(await fs.readFile(path.join(dir,'wechat-discovery.json'),'utf8'));if(saved.ok===true&&Array.isArray(saved.groups))discovery=saved;}catch{}
 const save=async()=>{await fs.writeFile(path.join(dir,'config.json.tmp'),JSON.stringify(config),{mode:0o600});await fs.rename(path.join(dir,'config.json.tmp'),path.join(dir,'config.json'));};
 const hasAuth=()=>fs.stat(path.join(dir,'auth.json')).then(()=>true,()=>false);
 async function ensureWorker(){
  if(worker)return worker;
  if(!await hasAuth())throw Error('请先完成本人的接龙管家官网登录');
  const next=workerFactory(dir);
  try{await next.init();worker=next;return worker;}catch(e){await next.close();throw e;}
 }
 async function stopRuntime({disable=false}={}){
  pumping=false;
  if(disable&&config){config.wechatEnabled=false;config.autoStart=false;await save();}
  await bridge.stop();
  if(pump){await pump;pump=null;}
  if(worker){await Promise.allSettled([...worker.active.values()]);await worker.close();worker=null;}
 }
 async function startRuntime(){
  if(pumping)return;
  if(!config||PROFILE_FIELDS.some(k=>!fixedProfile(config.profile)[k]))throw Error('请先保存四项个人信息');
  if(!config.wechatAccountId||!config.wechatChatId||!config.group)throw Error('请先读取微信并选择目标群');
  if(!config.acceptSavedPersonalInfo)throw Error('请先确认保存个人信息授权');
  if(login)throw Error('请先完成官网登录并关闭登录窗口');
  if(!await hasAuth())throw Error('请先完成本人的接龙管家官网登录');
  await stopRuntime();
  config.wechatEnabled=true;config.autoStart=true;config.allowSimulation=false;await save();runtimeError='';
  try{
   await ensureWorker();await bridge.start();pumping=true;
   pump=(async()=>{
    while(pumping){
     const state=await bridge.status();
     if(state.state==='failed')throw Error(state.message);
     if(state.ready)await worker.tick();
     await sleep(100);
    }
   })().catch(e=>{pumping=false;runtimeError='后台任务暂停：'+e.message;});
  }catch(e){config.wechatEnabled=false;await save();await stopRuntime();throw e;}
 }
 async function state(){
  const watching=await bridge.status();
  let jobs=worker?.jobs;
  if(!jobs){try{jobs=JSON.parse(await fs.readFile(path.join(dir,'jobs.json'),'utf8'));}catch{jobs={};}}
  return {
   profile:config?.profile||{},group:config?.group||'',authorized:!!config?.acceptSavedPersonalInfo,loginSaved:await hasAuth(),
   accountId:discovery?.accountId||'',accountName:discovery?.accountName||'',groups:discovery?.groups||[],selectedChatId:config?.wechatChatId||'',
   wechatReady:pumping&&watching.ready,watching:{...watching,ready:pumping&&watching.ready,message:runtimeError||watching.message},
   running:pumping,autoStart:!!config?.autoStart,onboardingComplete:!!config?.onboardingComplete,
   startup:await startup.state(),version:'1.1.0',
   results:Object.values(jobs).sort((a,b)=>(b.receivedMs||0)-(a.receivedMs||0)).slice(0,10).map(j=>({id:j.id,status:j.status,completedAt:j.completedAt,endToEndMs:j.endToEndMs,durationMs:j.durationMs,error:j.error}))
  };
 }
 const server=http.createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${server.address().port}`;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   if(req.headers.host!==new URL(origin).host)throw Error('Invalid host');
   if(req.method==='GET'&&req.url==='/'){
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'nonce-"+token+"'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    return res.end((await fs.readFile(path.join(root,'index.html'),'utf8')).replaceAll('__TOKEN__',token));
   }
   if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-app-token']!==token){res.statusCode=403;return res.end('Forbidden');}
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)throw Error('请求过大');}
   const body=JSON.parse(raw||'{}');
   const action=async()=>{
    if(closing)throw Error('后台正在退出');
    switch(req.url){
     case '/api/quit':setTimeout(()=>app.close().catch(()=>{}),100);return {message:'正在停止监听并等待正在提交的任务结束，可关闭此页面'};
     case '/api/state':return state();
     case '/api/startup':return {startup:await startup.set(body.enabled),message:body.enabled?'已开启登录 Windows 后静默启动':'已关闭开机自启'};
     case '/api/onboarding-finish':{
      if(!pumping||!(await bridge.status()).ready)throw Error('请等待监听就绪后再完成设置');
      config.onboardingComplete=true;await save();return {message:'设置完成，可以关闭此页面，后台继续监听'};
     }
     case '/api/profile':{
      const profile=fixedProfile(body.profile);if(PROFILE_FIELDS.some(k=>!profile[k]))throw Error('请填写全部四项个人信息');
      await stopRuntime({disable:true});
      config={...config,profile,group:config?.group||'',acceptSavedPersonalInfo:body.authorized===true,manualEnabled:true,allowSimulation:false,wechatEnabled:false,autoStart:false};
      await save();return {message:'个人信息已保存到这台电脑；修改资料后请重新启动监听'};
     }
     case '/api/login':{
      if(!config)throw Error('请先保存个人信息');await stopRuntime({disable:true});if(login)await login.close();
      login=await chromium.launchPersistentContext(path.join(dir,'login-browser'),{headless:false,channel:process.platform==='win32'?'msedge':'chromium'});
      const page=await login.newPage();await page.goto('https://i.jielong.com/login');return {message:'请在官网完成本人登录，然后点“完成登录”'};
     }
     case '/api/login-finish':{
      if(!login)throw Error('请先打开官网登录');const page=await login.newPage();await page.goto('https://i.jielong.com/my-form');
      await page.waitForFunction(()=>location.pathname==='/my-form'&&document.body.innerText.includes('发布的')&&document.body.innerText.includes('参与的'),null,{timeout:15000}).catch(()=>{throw Error('官网尚未完成登录')});
      await login.storageState({path:path.join(dir,'auth.json')});await fs.chmod(path.join(dir,'auth.json'),0o600);await login.close();login=null;
      return {message:'本人登录已保存，填写在后台运行'};
     }
     case '/api/wechat-discover':{
      if(!config)throw Error('请先保存个人信息');await stopRuntime({disable:true});discovery=await bridge.discover();
      return {message:'已读取微信账号和群列表，请核对账号并选择目标群'};
     }
     case '/api/wechat-select':{
      if(!config||!discovery)throw Error('请先读取微信账号和群列表');
      const group=discovery.groups.find(g=>g.id===body.chatId);
      if(!group||!group.id.endsWith('@chatroom'))throw Error('请选择已读取的目标群');
      await stopRuntime({disable:true});
      config.wechatAccountId=discovery.accountId;config.wechatChatId=group.id;config.group=group.name;
      await save();return {message:'目标群已保存：'+group.name+'。启动后只处理此群的新卡片'};
     }
     case '/api/wechat-start':await startRuntime();return {message:'正在建立监听，等待状态变为“正在监听”后再发测试卡片；关闭此页面不影响后台'};
     case '/api/wechat-stop':await stopRuntime({disable:true});runtimeError='';return {message:'监听已停止，正在提交的任务已结束'};
     case '/api/submit':{
      if(!config)throw Error('请先填写个人信息');if(body.confirm!==true)throw Error('请核对活动链接并确认提交');
      if(pumping)throw Error('请先停止自动监听，再手动验证活动');
      const w=await ensureWorker(),job=await w.accept({source:'manual',group:config.group,url:body.url});
      if(job.status!=='queued')return {message:'此活动已有记录：'+job.status};
      const result=await w.process(job);return {message:result.status==='submitted'?'官网确认提交成功，用时 '+(result.durationMs/1000).toFixed(2)+' 秒':result.error};
     }
     default:throw Error('未知操作');
    }
   };
   const promise=tail.then(action);tail=promise.catch(()=>{});const result=await promise;
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 app={url:`http://127.0.0.1:${server.address().port}`,close:()=>{
  if(closePromise)return closePromise;
  closing=true;clearInterval(retryTimer);return closePromise=(async()=>{await tail;await stopRuntime();if(login)await login.close();await new Promise(r=>server.close(r));})();
 }};
 if(config?.autoStart){tail=startRuntime().catch(e=>{runtimeError=e.message;});}
 // Windows can start us before WeChat is ready. Retry only the user's saved
 // listening choice; never open a login page or synthesize desktop input.
 retryTimer=setInterval(()=>{
  tail=tail.then(async()=>{if(!closing&&config?.autoStart&&!pumping&&!login)await startRuntime();}).catch(e=>{runtimeError=e.message;});
 },retryMs);retryTimer.unref();
 return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const app=await startApp();for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>app.close().catch(()=>{process.exitCode=1;}));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
