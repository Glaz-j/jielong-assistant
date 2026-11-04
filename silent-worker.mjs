import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import {BrowserAssistant} from './browser.mjs';
import {parseActivity} from './core.mjs';
import {fixedProfile,fixedPlan} from './profile.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
export class SilentWorker {
 constructor(dir,{channel=process.platform==='win32'?'msedge':'chromium',concurrency=3}={}){
  this.dir=dir;this.channel=channel;this.concurrency=concurrency;this.active=new Map();this.claims=new Set();this.jobs={};this.writes=Promise.resolve();this.stopping=false;
 }
 async save(name,value){
  const snapshot=JSON.stringify(value,null,2);
  const next=this.writes.then(async()=>{const f=path.join(this.dir,name);await fs.writeFile(f+'.tmp',snapshot,{mode:0o600});await fs.rename(f+'.tmp',f);});
  this.writes=next.catch(()=>{});return next;
 }
 async init(){
  for(const d of ['inbox','accepted','results'])await fs.mkdir(path.join(this.dir,d),{recursive:true,mode:0o700});
  this.lockPath=path.join(this.dir,'worker.lock');
  try{this.lock=await fs.open(this.lockPath,'wx',0o600);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   let pid;try{pid=JSON.parse(await fs.readFile(this.lockPath,'utf8')).pid;}catch{throw Error('后台锁文件无法核实，请先确认没有旧进程运行');}
   if(!Number.isInteger(pid)||pid<=0)throw Error('后台锁文件损坏');
   let alive=true;try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}
   if(alive)throw Error('已有后台实例运行，拒绝重复启动');
   await fs.unlink(this.lockPath);this.lock=await fs.open(this.lockPath,'wx',0o600);
  }
  await this.lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  this.config=JSON.parse(await fs.readFile(path.join(this.dir,'config.json'),'utf8'));
  this.profile=fixedProfile(this.config.profile);
  for(const [key,file] of [['jobs','jobs.json'],['ledger','ledger.json']]){
   try{this[key]=JSON.parse(await fs.readFile(path.join(this.dir,file),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this[key]={};}
  }
  for(const j of Object.values(this.jobs))if(['running','queued'].includes(j.status))j.status='interrupted';
  // Explicit headless launch with an isolated context. No desktop capture/input APIs.
  this.browser=await chromium.launch({headless:true,channel:this.channel});
  this.context=await this.browser.newContext({storageState:path.join(this.dir,'auth.json'),viewport:{width:1100,height:820},locale:'zh-CN'});
  await this.save('status.json',{mode:'headless',source:this.config?.wechatEnabled?'wechat-db':this.config?.manualEnabled?'manual':'simulation',ready:true,pid:process.pid,startedAt:new Date().toISOString(),desktopInput:false});
 }
 async accept(event){
  if(event.source==='simulation'&&this.config.allowSimulation===false)throw Error('正式应用不接收模拟事件');
  const live=event.source==='wechat-db'&&this.config.wechatEnabled===true;
  if(event.source!=='simulation'&&!(event.source==='manual'&&this.config.manualEnabled===true)&&!live)throw Error('真实微信消息适配器尚未接入；当前只接受明确标记的模拟事件或已启用的手动提交');
  if(live){
   if(!this.config.wechatAccountId||!this.config.wechatChatId||event.accountId!==this.config.wechatAccountId||event.chatId!==this.config.wechatChatId)throw Error('微信账号或群唯一编号不匹配');
   const sent=Date.parse(event.emittedAt);
   if(!Number.isFinite(sent)||Date.now()-sent>120000)throw Error('消息时间缺失或已过期，停止处理旧卡片');
  }
  if(event.group!==this.config.group)throw Error('活动不在指定测试会话');
  const a=parseActivity(event.url);
  if(this.config.allowedActivityIds&&!this.config.allowedActivityIds.includes(a.id))throw Error('活动不在本次测试白名单');
  if(Object.hasOwn(this.jobs,a.id))return this.jobs[a.id];
  const job={...a,source:event.source,eventId:String(event.eventId||a.id),status:'queued',receivedAt:new Date().toISOString(),receivedMs:Date.now()};
  if(live)Object.assign(job,{accountId:event.accountId,chatId:event.chatId,observedAt:event.observedAt});
  if(event.emittedAt!==undefined){
   const ms=Date.parse(event.emittedAt);
   if(!Number.isFinite(ms)||ms>job.receivedMs)throw Error('模拟消息发出时间无效');
   job.emittedAt=new Date(ms).toISOString();job.emittedMs=ms;
  }
  this.jobs[a.id]=job;await this.save('jobs.json',this.jobs);return job;
 }
 async process(job){
  const started=performance.now();job.status='running';await this.save('jobs.json',this.jobs);
  let session,claim,claimed=false;
  try{
   if(['pending','unknown','success'].includes(this.ledger[job.id]?.status))throw Error('已存在提交或待核实记录，阻止重复提交');
   session=new BrowserAssistant(this.dir,'http://127.0.0.1:47832');
   Object.assign(session,{context:this.context,visible:false,page:await this.context.newPage(),profile:{...this.profile},ledger:this.ledger});
   session.ensure=async(visible=false)=>{
    if(visible)throw Error('静默服务禁止打开前台窗口');
    if(session.page.isClosed())throw Error('后台页面已关闭');
    return session.page;
   };
   session.save=(name,value)=>this.save(name,value);
   const detail=session.page.waitForResponse(r=>{
    const u=new URL(r.url());return (u.hostname==='jielong.com'||u.hostname.endsWith('.jielong.com'))&&/^\/api\/(Form|Event)\/GetThreadDetail$/.test(u.pathname);
   },{timeout:10000}).then(r=>r.json()).then(d=>d.Data?.Thread).catch(()=>null);
   await session.open(job.url);if(session.scan.login)throw Error('登录失效，需要重新认证；不会打开前台登录窗口');
   await session.enter();
   const thread=await detail;
   if(!thread||!/^\d+$/.test(String(thread.ThreadId)))throw Error('未取得官网稳定活动编号，停止提交');
   job.officialThreadId=String(thread.ThreadId);claim='official:'+job.officialThreadId;
   if(this.config.allowedOfficialThreadIds&&!this.config.allowedOfficialThreadIds.includes(job.officialThreadId))throw Error('官网活动编号不在本次测试白名单');
   if(this.claims.has(claim))throw Error('同一官网活动正在处理，阻止重复提交');
   this.claims.add(claim);claimed=true;
   if(this.ledger[job.id]&&!this.ledger[claim])this.ledger[claim]=this.ledger[job.id];
   // Official short links can change for one ThreadId. All aliases share a ledger.
   Object.defineProperty(this.ledger,job.id,{configurable:true,enumerable:false,get:()=>this.ledger[claim],set:value=>{this.ledger[claim]=value;}});
   if(['pending','unknown','success'].includes(this.ledger[claim]?.status))throw Error('该官网活动已有提交记录，阻止短链接变更后的重复报名');
   const plan=fixedPlan(session.scan.fields,this.profile);
   if(plan.errors.length||plan.matchedCount!==4)throw Error(plan.errors.join('；')||'必须匹配全部四字段');
   await session.autoFill();
   const consents=session.scan.fields.filter(f=>f.manual&&f.required&&!f.value);
   for(const c of consents){
    if(!this.config.acceptSavedPersonalInfo||!c.label.includes('保存个人信息授权'))throw Error('有未确认的官网授权，已停止');
    await session.page.locator(`[data-jla-control="${c.id}"]`).check();
   }
   if(consents.length)await session.autoFill();
   if(!session.preview)throw Error('未形成通过核对的表单');
   await session.submit(session.preview.id);
   if(this.ledger[job.id]?.status!=='success')throw Error(this.ledger[job.id]?.message||'提交结果待核实');
   Object.assign(job,{status:'submitted',completedAt:new Date().toISOString(),durationMs:Date.now()-job.receivedMs,workMs:Math.round(performance.now()-started),profile:{...this.profile}});
   job.processingWithin10s=job.durationMs<=10000;
   // Receipt-only timing must not be reported as card-publication latency.
   job.endToEndMs=job.emittedMs===undefined?null:Date.parse(job.completedAt)-job.emittedMs;
   job.within10s=job.endToEndMs===null?null:job.endToEndMs<=10000;
  }catch(e){Object.assign(job,{status:'failed',completedAt:new Date().toISOString(),durationMs:Date.now()-job.receivedMs,error:e.message});}
  finally{
   if(claimed)this.claims.delete(claim);
   if(session?.page)await session.page.close().catch(()=>{});
   await this.save('results/'+job.id+'.json',job);await this.save('jobs.json',this.jobs);
  }
  return job;
 }
 async tick(){
  for(const name of await fs.readdir(path.join(this.dir,'inbox'))){
   if(!/^[A-Za-z0-9_-]+\.json$/.test(name))continue;
   const file=path.join(this.dir,'inbox',name);let event;
   try{event=JSON.parse(await fs.readFile(file,'utf8'));}catch{continue;}
   try{await this.accept(event);}catch(e){await this.save('results/rejected-'+name,{status:'rejected',error:e.message});}
   await fs.rename(file,path.join(this.dir,'accepted',name)).catch(()=>{});
  }
  for(const job of Object.values(this.jobs)){
   if(this.active.size>=this.concurrency)break;
   if(job.status!=='queued'||this.active.has(job.id))continue;
   const work=this.process(job).finally(()=>this.active.delete(job.id));this.active.set(job.id,work);
  }
 }
 async run(){
  while(!this.stopping){
   if(await fs.stat(path.join(this.dir,'stop.flag')).then(()=>true,()=>false))break;
   await this.tick();await new Promise(r=>setTimeout(r,100));
  }
  await Promise.allSettled(this.active.values());await this.close();
 }
 async close(){
  await this.writes;await this.browser?.close();
  if(this.lock){await this.save('status.json',{mode:'headless',source:this.config?.wechatEnabled?'wechat-db':this.config?.manualEnabled?'manual':'simulation',ready:false,pid:process.pid,stoppedAt:new Date().toISOString(),desktopInput:false});await this.lock.close();this.lock=null;await fs.unlink(this.lockPath);}
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const worker=new SilentWorker(path.resolve(process.argv[2]||path.join(ROOT,'silent-data')));
 try{await worker.init();await worker.run();}catch(e){await fs.writeFile(path.join(worker.dir,'startup-error.txt'),String(e.stack),{mode:0o600});await worker.close();process.exitCode=1;}
}
