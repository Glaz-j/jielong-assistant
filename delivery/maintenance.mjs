// Graceful installer shutdown. Never terminate unrelated Node/WeChat processes.
import {setTimeout as sleep} from 'node:timers/promises';
const url='http://127.0.0.1:47834';
try{
 let response;
 try{response=await fetch(url,{signal:AbortSignal.timeout(3000)});}catch(e){
  if(e.cause?.code==='ECONNREFUSED')process.exit(0);
  throw Error('无法确认应用是否正在运行，请退出接龙助手后重试');
 }
 const html=await response.text();
 if(!response.ok||!html.includes('content="JielongAssistant"'))throw Error('端口被其他程序占用，未关闭任何进程');
 const token=html.match(/X-App-Token':'([a-f0-9]{64})'/)?.[1];
 if(!token)throw Error('无法验证正在运行的接龙助手');
 const stop=await fetch(url+'/api/quit',{method:'POST',headers:{Origin:url,'X-App-Token':token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(65000)});
 if(!stop.ok)throw Error('应用拒绝退出，请在设置页退出后台后重试');
 let stopped=false;
 for(let i=0;i<120;i++){
  await sleep(500);
  try{await fetch(url,{signal:AbortSignal.timeout(2000)});}catch(e){if(e.cause?.code==='ECONNREFUSED'){stopped=true;break;}}
 }
 if(!stopped)throw Error('仍有任务运行，安装已暂停；请等待提交完成后重试');
}catch(e){console.error(e.message);process.exitCode=1;}
