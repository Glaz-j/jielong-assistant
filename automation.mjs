import {BrowserAssistant} from './browser.mjs';
import {fixedPlan} from './profile.mjs';
export class AutoFillEngine {
 constructor(assistant){this.assistant=assistant;this.sessions=new Map();}
 async process(job){
  const a=this.assistant;
  if(['pending','unknown','success'].includes(a.ledger[job.id]?.status))return {status:'already_submitted',message:'已有提交或待核实记录，未重复填写'};
  await a.ensure();
  const old=this.sessions.get(job.id);if(old?.page&&!old.page.isClosed()&&a.page!==old.page)await old.page.close();
  const session=new BrowserAssistant(a.dir,a.origin);
  Object.assign(session,{context:a.context,visible:false,page:await a.context.newPage(),profile:{...a.profile},ledger:a.ledger});
  this.sessions.set(job.id,session);
  // Bound retained draft tabs; evicted drafts can be filled again explicitly.
  while(this.sessions.size>12){const [id,s]=this.sessions.entries().next().value;this.sessions.delete(id);if(s.page!==a.page)await s.page.close().catch(()=>{});}
  try {
   await session.open(job.url);
   if(session.scan.login)return {status:'login_required',message:'登录已失效，等待你主动打开登录窗口'};
   if(session.scan.notice.some(x=>/已满|结束|截止|未开始/.test(x)))return {status:'unavailable',message:session.scan.notice.join('；')};
   if(session.scan.payment)return {status:'manual_required',message:'活动涉及支付，等待人工处理'};
   await session.enter();
   if(session.scan.login)return {status:'login_required',message:'登录已失效，等待你主动打开登录窗口'};
   const plan=fixedPlan(session.scan.fields,session.profile);
   if(plan.errors.length)return {status:'fields_mismatch',message:plan.errors.join('；')};
   await session.autoFill();
   const pending=session.scan.fields.some(f=>f.manual&&f.required&&!f.value);
   a.log('活动 '+job.id+'：四项固定资料已在后台填写');
   return {status:pending?'consent_required':'filled',message:pending?'资料已填写，等待本人确认官网授权':'固定资料已填写，等待核对提交',fieldCount:Object.keys(plan.values).length};
  } catch(e){return {status:'error',message:String(e.message||'后台填写未完成').slice(0,350)};}
 }
 async review(id){
  const s=this.sessions.get(id),a=this.assistant;
  if(!s?.page||s.page.isClosed())throw Error('这个后台表单已关闭，请在任务列表重新填写。');
  Object.assign(a,{page:s.page,activity:s.activity,scan:s.scan,preview:s.preview});return a.inspect();
 }
}
