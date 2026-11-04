import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseActivity } from './core.mjs';
import {extractCardActivities} from './cards.mjs';
const exec=promisify(execFile);
// LaunchServices attributes accessibility access to the signed app itself.
// A FIFO carries the response in memory; raw chat content never goes to a file.
async function readApplication(binary,args) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jielong-reader-'));
 const fifo=path.join(dir,'response');let handle,stream,timer;
 try {
  await fs.chmod(dir,0o700);
  await exec('/usr/bin/mkfifo',['-m','600',fifo]);
  handle=await fs.open(fifo,constants.O_RDWR);
  stream=handle.createReadStream({autoClose:false});stream.setEncoding('utf8');
  const response=new Promise((resolve,reject)=>{
   let result='';timer=setTimeout(()=>reject(Error('读取器响应超时')),12000);
   stream.on('error',reject);
   stream.on('data',chunk=>{result+=chunk.toString();if(Buffer.byteLength(result)>150000)reject(Error('读取器响应过大'));else if(result.includes('\n'))resolve(result.slice(0,result.indexOf('\n')));});
  });
  const app=path.resolve(binary,'../../..');
  const [,output]=await Promise.all([
   exec('/usr/bin/open',['-g','-n','-W','--stdout',fifo,'--stderr','/dev/null',app,'--args',...args],{timeout:12000}),response
  ]);
  return output;
 } finally {
  clearTimeout(timer);stream?.destroy();
  // Unblock a pending pipe read before closing the read descriptor.
  if(handle){await handle.write(Buffer.from('\n')).catch(()=>{});await handle.close().catch(()=>{});}
  await fs.rm(dir,{recursive:true,force:true});
 }
}

export function extractLinks(text) {
 const patterns=text.match(/https:\/\/(?:i\.)?jielong\.(?:com|co)\/[^\s<>"，。]+|event\/pages\/detail\/index(?:\.html)?\?[^\s<>"，。]+/g)||[];
 const found=new Map(extractCardActivities(text).activities.map(a=>[a.id,a]));
 for(const candidate of patterns){try{const a=parseActivity(candidate.replace(/[)）\]】]+$/,''));found.set(a.id,a);}catch{}}
 return [...found.values()];
}
export class QQWatcher {
 constructor(binary,assistant,queue,{read=readApplication}={}){this.binary=binary;this.assistant=assistant;this.queue=queue;this.read=read;this.group='接龙助手测试群';this.status='stopped';this.timer=null;this.polling=false;this.baseline=false;this.generation=0;this.lastCheckedAt=null;this.successfulReads=0;this.items=[];this.cardDiagnostics={cards:0,resolved:0,unresolved:0};}
 state(){return {group:this.group,status:this.status,running:!!this.timer,items:(this.queue?.list()||[]).map(j=>{const l=this.assistant.ledger?.[j.id];return l&&['success','pending','unknown'].includes(l.status)?{...j,status:'already_submitted',message:l.message||'已有提交记录，等待核实'}:j;}),lastCheckedAt:this.lastCheckedAt,successfulReads:this.successfulReads,cardDiagnostics:this.cardDiagnostics};}
 async poll(prompt=false){
  if(this.polling)return this.state();this.polling=true;const generation=this.generation;
  try {
   const stdout=await this.read(this.binary,[this.group,...(prompt?['--prompt']:[])]);
   if(generation!==this.generation)return this.state();
   const data=JSON.parse(stdout.trim());this.status=data.status;this.lastCheckedAt=new Date().toISOString();
   if(data.status==='ready'&&data.group===this.group){
    this.successfulReads++;
    const cards=extractCardActivities(data.text||'');
    this.cardDiagnostics={cards:cards.cards,resolved:cards.activities.length,unresolved:cards.unresolved};
    const links=extractLinks(data.text||'');
    await this.queue.observe(links,{baseline:!this.baseline});this.baseline=true;
    if(cards.unresolved||(!links.length&&/小程序|接龙管家|接龙助手/.test(data.text||'')))this.status='card_needs_link';
   }
  } catch {if(generation===this.generation)this.status='reader_unavailable';}
  finally{this.polling=false;}
  return this.state();
 }
 async start(group=this.group){
  if(typeof group!=='string'||!group.trim()||group.length>80||/[\r\n]/.test(group))throw Error('请输入有效的群名称');
  if(group!==this.group){this.stop();this.group=group;}
  if(!this.timer){this.baseline=false;this.generation++;this.timer=setInterval(()=>this.poll(),3000);}
  await this.poll();return this.state();
 }
 stop(){clearInterval(this.timer);this.timer=null;this.generation++;this.status='stopped';return this.state();}
}
