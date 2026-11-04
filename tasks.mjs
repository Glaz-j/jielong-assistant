import fs from 'node:fs/promises';
import path from 'node:path';
import {parseActivity} from './core.mjs';
export class TaskQueue {
 constructor(dir,processTask,{now=()=>new Date().toISOString()}={}){this.dir=dir;this.processTask=processTask;this.now=now;this.jobs=[];this.seen=new Set();this.baseline=false;this.active=false;this.stopped=false;this.tail=Promise.resolve();this.saveTail=Promise.resolve();}
 async init(){
  try{const saved=JSON.parse(await fs.readFile(path.join(this.dir,'tasks.json'),'utf8'));if(saved.version!==1||!Array.isArray(saved.jobs)||!Array.isArray(saved.seen))throw Error('invalid');this.jobs=saved.jobs;this.seen=new Set(saved.seen);
   for(const j of this.jobs)if(['queued','filling','filled','consent_required'].includes(j.status)){j.status='interrupted';j.message='应用已重启，后台表单未保留；可手动重试填写';}
  }catch(e){if(e.code!=='ENOENT')throw Error('任务记录损坏，已停止监听，请保留 tasks.json 检查。');}
 }
 list(){return this.jobs.slice(0,100).map(j=>({...j}));}
 async persist(){const snapshot=JSON.stringify({version:1,seen:[...this.seen],jobs:this.jobs});const task=this.saveTail.then(async()=>{await fs.mkdir(this.dir,{recursive:true,mode:0o700});const f=path.join(this.dir,'tasks.json');await fs.writeFile(f+'.tmp',snapshot,{mode:0o600});await fs.rename(f+'.tmp',f);});this.saveTail=task.catch(()=>{});return task;}

 async observe(activities,{baseline=false}={}){
  const out=[];
  for(const input of activities){const a=parseActivity(input.url);if(this.seen.has(a.id))continue;this.seen.add(a.id);
   const job={...a,status:baseline?'existing':'queued',message:baseline?'启动时已存在的活动，不自动填写':'等待后台填写',receivedAt:this.now()};this.jobs.unshift(job);out.push(job);
  }
  await this.persist();this.kick();return out;
 }
 kick(){if(this.active||this.stopped)return;this.active=true;this.tail=this.drain().finally(()=>{this.active=false;if(!this.stopped&&this.jobs.some(j=>j.status==='queued'))this.kick();});}
 async drain(){while(!this.stopped){const job=this.jobs.find(j=>j.status==='queued');if(!job)return;job.status='filling';job.message='正在后台读取并填写';await this.persist();
  try{Object.assign(job,await this.processTask({...job}));}catch{Object.assign(job,{status:'error',message:'后台处理未完成，可检查登录和网络后重试'});}
  job.updatedAt=this.now();await this.persist();
 }}
 async retry(id){const j=this.jobs.find(j=>j.id===id);if(!j)throw Error('任务不存在');if(['queued','filling'].includes(j.status))return;if(j.status==='submitted')throw Error('已提交活动不能重复处理');j.status='queued';j.message='等待重新填写';await this.persist();this.kick();}
 async close(){this.stopped=true;await this.tail;}
}
