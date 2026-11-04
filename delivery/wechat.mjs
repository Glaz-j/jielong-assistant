import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class WeChatBridge {
 constructor(dir,{launch=spawn,platform=process.platform,python=path.join(root,'runtime','python','python.exe'),timeoutMs=120000}={}){
  Object.assign(this,{dir,launch,platform,python,timeoutMs});this.child=null;this.generation=null;this.failure=null;this.closed=false;
 }
 spawnScript(script,runId){
  if(this.platform!=='win32')throw Error('微信只读监听组件需要 Windows 电脑；本机未启动监听');
  const args=['-I','-B',path.join(root,'wechat-bridge',script),'--data',this.dir,'--run-id',runId];
  if(script==='listen.py')args.push('--parent-pid',String(process.pid));
  const child=this.launch(this.python,args,{
   windowsHide:true,shell:false,stdio:'ignore',cwd:root,
   env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'}
  });
  child.jlaDone=new Promise(resolve=>{child.once('exit',()=>{child.jlaExited=true;resolve();});child.once('error',()=>{child.jlaExited=true;resolve();});});
  child.on('error',()=>{if(this.child===child)this.failure='读取组件无法启动，请检查运行文件和权限';});
  return child;
 }
 async discover(){
  if(this.child)throw Error('请先停止监听再刷新群列表');
  const runId=randomUUID();const child=this.spawnScript('discover.py',runId);this.child=child;this.failure=null;
  const result=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(Error('读取账号和群列表超时，请检查微信登录及权限'));child.kill();},this.timeoutMs);
   child.once('error',()=>{clearTimeout(timer);reject(Error('读取组件无法启动'));});
   child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('无法读取微信数据库，请检查微信版本、登录状态和本机权限'));});
  }).then(async()=>{
   const data=JSON.parse(await fs.readFile(path.join(this.dir,'wechat-discovery.json'),'utf8'));
   if(data.runId!==runId||data.ok!==true||typeof data.accountId!=='string'||!Array.isArray(data.groups))throw Error('微信账号读取结果无效');
   return data;
  }).finally(async()=>{if(!child.jlaExited){child.kill();await Promise.race([child.jlaDone,pause(3000)]);}if(child.jlaExited&&this.child===child)this.child=null;});
  return result;
 }
 async start(){
  if(this.child)throw Error('微信读取组件已经运行');
  await fs.rm(path.join(this.dir,'wechat-stop.flag'),{force:true});
  this.failure=null;this.closed=false;this.generation=randomUUID();
  this.child=this.spawnScript('listen.py',this.generation);
  const child=this.child;
  child.once('exit',()=>{if(this.child===child){this.child=null;if(!this.closed)this.failure='微信读取进程已退出，请检查状态后重新启动';}});
 }
 async status(){
  let status;try{status=JSON.parse(await fs.readFile(path.join(this.dir,'wechat-status.json'),'utf8'));}catch{}
  if(!this.child||this.failure)return {state:this.failure?'failed':'stopped',ready:false,message:this.failure||'监听已停止'};
  if(!status||status.runId!==this.generation)return {state:'initializing',ready:false,message:'正在读取微信数据库'};
  if(status.ready&&Date.now()-status.lastPollAt*1000>8000)return {state:'stale',ready:false,message:'读取心跳超时，暂停接收新任务'};
  if(status.ready&&status.pid!==this.child.pid)return {state:'failed',ready:false,message:'微信读取进程标识不匹配，已暂停接收新任务'};
  return {...status,ready:status.ready===true,message:status.ready?'正在监听所选群的新卡片':status.state==='initializing'?'正在建立消息基线':'微信读取异常，已暂停接收新任务'};
 }
 async stop(){
  this.closed=true;const child=this.child;if(!child){this.failure=null;return;}
  await fs.writeFile(path.join(this.dir,'wechat-stop.flag'),'stop',{mode:0o600});
  const deadline=Date.now()+5000;
  while(!child.jlaExited&&Date.now()<deadline)await pause(50);
  if(!child.jlaExited){
   child.kill();await Promise.race([child.jlaDone,pause(3000)]);
   if(!child.jlaExited)throw Error('微信读取进程尚未退出，暂不能修改配置');
  }
  if(this.child===child)this.child=null;this.failure=null;
 }
}
