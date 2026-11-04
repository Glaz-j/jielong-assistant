import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { BrowserAssistant } from './browser.mjs';
import { QQWatcher } from './qq.mjs';
import {TaskQueue} from './tasks.mjs';
import {AutoFillEngine} from './automation.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
export async function startServer({port=47831,headless=true,dataDir=process.env.JIELONG_DATA_DIR||path.join(root,'data')}={}) {
  const token=randomBytes(32).toString('hex');
  let assistant,qq,queue,engine;let settings={listen:false,group:'接龙助手测试群'};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    const origin=`http://127.0.0.1:${server.address().port}`;
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    if(req.headers.host!==`127.0.0.1:${server.address().port}`)return json(403,{error:'请使用 127.0.0.1 本地地址访问。'});
    try {
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&url.pathname==='/api/health')return json(200,{app:'jielong-assistant',version:'0.2.0'});
      if(req.method==='GET'&&url.pathname==='/api/state')return json(200,assistant.state());
      if(req.method==='GET'&&url.pathname==='/api/qq')return json(200,qq.state());
      if(req.method==='POST'&&url.pathname.startsWith('/api/')) {
        if(req.headers.origin!==origin||req.headers['x-local-token']!==token||req.headers['content-type']!=='application/json')return json(403,{error:'请求来源无效。'});
        let body='';for await(const part of req){body+=part;if(body.length>100000)throw new Error('内容过长。');}
        const data=JSON.parse(body||'{}');
        const methods={open:()=>assistant.open(data.link),demo:()=>assistant.open('',true),login:()=>assistant.login(),enter:()=>assistant.enter(),inspect:()=>assistant.inspect(),profile:()=>assistant.setProfile(data.profile),fill:()=>assistant.autoFill(),submit:()=>assistant.submit(data.previewId),'reset-demo':()=>assistant.resetDemo()};
        Object.assign(methods,{'qq-start':async()=>{const result=await qq.start(data.group||settings.group);settings={listen:true,group:qq.group};await assistant.save('settings.json',settings);return result;},'qq-stop':async()=>{const result=qq.stop();settings.listen=false;await assistant.save('settings.json',settings);return result;},'qq-permission':()=>qq.poll(true)});
        methods['confirm-test-consent']=async()=>{const result=await assistant.confirmTestConsent();const job=queue.jobs.find(j=>j.id===assistant.activity?.id);if(job&&job.status==='consent_required'){job.status='filled';job.message='资料已填写，官网授权已确认，等待核对提交';await queue.persist();}return result;};
        methods['reset-test']=()=>assistant.resetTest();
        methods['task-review']=()=>engine.review(data.id);
        methods['task-retry']=async()=>{await queue.retry(data.id);return qq.state();};
        const fn=methods[url.pathname.slice(5)];if(!fn)return json(404,{error:'接口不存在'});
        return json(200,await assistant.run(fn));
      }
      const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/demo':'demo.html','/demo.js':'demo.js'};
      if(req.method==='GET'&&files[url.pathname]) {
        let content=await fs.readFile(path.join(root,'public',files[url.pathname]));
        if(url.pathname==='/')content=Buffer.from(content.toString().replace('__LOCAL_TOKEN__',token));
        const ext=path.extname(files[url.pathname]);res.setHeader('Content-Type',ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(content);return;
      }
      json(404,{error:'未找到页面'});
    } catch(e) {json(400,{error:e.message?.replace(/Bearer\s+\S+/gi,'[已隐藏]')||'操作失败'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  assistant=new BrowserAssistant(dataDir,origin,{headless});await assistant.init();
  engine=new AutoFillEngine(assistant);
  queue=new TaskQueue(dataDir,job=>assistant.run(()=>engine.process(job)));await queue.init();
  qq=new QQWatcher(process.env.JIELONG_READER||path.join(root,'QQ群读取器.app/Contents/MacOS/QQGroupReader'),assistant,queue);
  try{settings=JSON.parse(await fs.readFile(path.join(dataDir,'settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('监听设置损坏');}
  if(settings.listen)await qq.start(settings.group);
  return {server,assistant,qq,queue,engine,origin,token,close:async()=>{qq.stop();await queue.close();await assistant.close();await new Promise(r=>server.close(r));}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const app=await startServer({port:Number(process.env.PORT||47831)});
  console.log(`接龙报名测试版已启动：${app.origin}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
