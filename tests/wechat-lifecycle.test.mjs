import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {WeChatBridge} from '../delivery/wechat.mjs';
import {startApp} from '../delivery/app.mjs';
const profile={姓名:'测试2',单位:'测试单位2',职工号:'000002',所属部门:'测试部门2'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
class Child extends EventEmitter{
 constructor(){super();this.pid=123456;this.exitCode=null;this.signalCode=null;}
 finish(code=0){this.exitCode=code;this.emit('exit',code);}
 kill(){this.signalCode='SIGTERM';this.emit('exit',null,'SIGTERM');return true;}
}

test('读取进程隐藏启动；拒绝旧心跳、错误 PID、过期心跳；退出即停止',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-bridge-'));let invocation,child;
 const bridge=new WeChatBridge(dir,{platform:'win32',launch:(...args)=>{invocation=args;return child=new Child();}});
 try{
  await bridge.start();assert.equal(invocation[2].windowsHide,true);assert.equal(invocation[2].shell,false);assert.equal(invocation[2].stdio,'ignore');assert.ok(invocation[1].includes('--parent-pid'));
  const status=value=>fs.writeFile(path.join(dir,'wechat-status.json'),JSON.stringify(value));
  await status({runId:'old',ready:true,pid:child.pid,lastPollAt:Date.now()/1000});assert.equal((await bridge.status()).ready,false);
  const current={runId:bridge.generation,state:'listening',ready:true,pid:child.pid,lastPollAt:Date.now()/1000};
  await status({...current,pid:77});assert.equal((await bridge.status()).ready,false);
  await status({...current,lastPollAt:Date.now()/1000-30});assert.equal((await bridge.status()).state,'stale');
  await status(current);assert.equal((await bridge.status()).ready,true);
  child.finish(1);assert.equal((await bridge.status()).ready,false);assert.equal((await bridge.status()).state,'failed');
  await bridge.stop();assert.equal((await bridge.status()).state,'stopped');
 }finally{child?.kill();await fs.rm(dir,{recursive:true,force:true});}
});
test('群列表发现失败和超时不复用旧文件，不遗留运行子进程',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-discover-'));let child;
 const bridge=new WeChatBridge(dir,{platform:'win32',timeoutMs:20,launch:()=>child=new Child()});
 try{
  await fs.writeFile(path.join(dir,'wechat-discovery.json'),JSON.stringify({ok:true,runId:'old',accountId:'old',groups:[]}));
  await assert.rejects(bridge.discover(),/超时/);assert.equal(child.signalCode,'SIGTERM');assert.equal(bridge.child,null);
  bridge.launch=()=>{child=new Child();setImmediate(()=>child.finish());return child;};
  await assert.rejects(bridge.discover(),/结果无效/);assert.equal(bridge.child,null);
  bridge.launch=()=>{child=new Child();setImmediate(()=>child.emit('error',Error('not found')));return child;};
  await assert.rejects(bridge.discover(),/无法启动/);assert.equal(bridge.child,null);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
async function client(app){
 const html=await (await fetch(app.url)).text(),token=html.match(/X-App-Token':'([a-f0-9]+)'/)[1];
 return async(route,body={})=>{
  const r=await fetch(app.url+'/api/'+route,{method:'POST',headers:{Origin:app.url,'X-App-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();
  if(!r.ok)throw Error(d.error);return d;
 };
}
test('首次选群按编号；无登录不启动；保存资料和退出等待在途任务；重新启动恢复监听',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-lifecycle-'));const events=[];let latestWorker;
 const bridge={running:false,ready:false,async discover(){return{ok:true,accountId:'wx_test',accountName:'测试账号',groups:[{id:'1@chatroom',name:'同名测试群'},{id:'2@chatroom',name:'同名测试群'}]};},async start(){this.running=true;events.push('start');},async stop(){this.running=false;this.ready=false;events.push('stop');},async status(){return{ready:this.running&&this.ready,state:this.running?'listening':'stopped',message:this.running?'正在监听':'已停止'};}};
 const workerFactory=()=>latestWorker={active:new Map(),jobs:{},ticks:0,async init(){events.push('worker-init');},async tick(){this.ticks++;},async close(){events.push('worker-close');}};
 let app=await startApp({dir,port:0,bridgeFactory:()=>bridge,workerFactory});
 try{
  let api=await client(app);
  await assert.rejects(api('wechat-start'),/四项/);await api('profile',{profile,authorized:true});
  await api('wechat-discover');await assert.rejects(api('wechat-select',{chatId:'other@chatroom'}),/请选择/);await api('wechat-select',{chatId:'2@chatroom'});
  await assert.rejects(api('wechat-start'),/官网登录/);await fs.writeFile(path.join(dir,'auth.json'),'{}');
  await api('wechat-start');assert.equal((await api('state')).wechatReady,false);assert.equal(latestWorker.ticks,0);
  bridge.ready=true;await pause(150);assert.ok(latestWorker.ticks>0);assert.equal((await api('state')).wechatReady,true);
  let release;latestWorker.active.set('pending',new Promise(r=>release=r));let saved=false;
  const saving=api('profile',{profile:{...profile,姓名:'测试3'},authorized:true}).then(()=>saved=true);await pause(150);assert.equal(saved,false);assert.equal(bridge.running,false);
  release();await saving;assert.equal(JSON.parse(await fs.readFile(path.join(dir,'config.json'))).profile.姓名,'测试3');assert.equal((await api('state')).running,false);
  await api('wechat-start');const cfg=JSON.parse(await fs.readFile(path.join(dir,'config.json')));assert.equal(cfg.wechatChatId,'2@chatroom');assert.equal(cfg.allowSimulation,false);
  await app.close();assert.equal(bridge.running,false);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'config.json'))).autoStart,true);
  app=await startApp({dir,port:0,bridgeFactory:()=>bridge,workerFactory});api=await client(app);assert.equal((await api('state')).running,true);
  await api('wechat-stop');assert.equal(JSON.parse(await fs.readFile(path.join(dir,'config.json'))).autoStart,false);assert.equal(events.at(-1),'worker-close');
 }finally{await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
