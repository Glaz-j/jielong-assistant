import { chromium } from 'playwright';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseActivity, suggest, validate } from './core.mjs';
import {fixedProfile, fixedPlan, PROFILE_FIELDS} from './profile.mjs';

const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export class BrowserAssistant {
  constructor(dataDir, origin, {headless = true} = {}) {
    this.dir=dataDir; this.origin=origin; this.headless=headless;
    this.context=null; this.page=null; this.activity=null; this.preview=null; this.scan=null;
    this.events=[]; this.profile={}; this.ledger={}; this.tail=Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.dir,{recursive:true,mode:0o700});
    await fs.chmod(this.dir,0o700);
    for(const [key,file] of [['profile','profile.json'],['ledger','ledger.json']]) {
      try { this[key]=JSON.parse(await fs.readFile(path.join(this.dir,file),'utf8')); }
      catch(e) { if(e.code!=='ENOENT') throw new Error(`${file} 损坏，请保留文件并检查，未启动提交功能。`); }
    }
    this.profile=fixedProfile(Object.fromEntries(PROFILE_FIELDS.map(k=>[k,typeof this.profile[k]==='string'?this.profile[k]:''])));
  }
  async save(file,data) {
    const target=path.join(this.dir,file), temp=target+'.tmp';
    await fs.writeFile(temp,JSON.stringify(data,null,2),{mode:0o600}); await fs.rename(temp,target);
  }
  log(message) { this.events.unshift({at:new Date().toISOString(),message}); this.events=this.events.slice(0,30); }
  run(fn) { const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p; }
  async ensure(visible=false) {
    if(this.context && this.visible!==visible){await this.context.close();this.context=null;this.page=null;}
    if(!this.context) {
      this.visible=visible;
      this.context=await chromium.launchPersistentContext(path.join(this.dir,'browser'),{headless:!visible,channel:'chromium',viewport:{width:1100,height:820},locale:'zh-CN'});
      this.context.on('close',()=>{this.context=null;this.page=null;this.preview=null;});
    }
    if(!this.page || this.page.isClosed()) this.page=await this.context.newPage();
    return this.page;
  }
  allowed() {
    if(!this.page || this.page.isClosed()) throw new Error('浏览器已关闭，请重新打开活动。');
    const u=new URL(this.page.url());
    if(u.origin!==this.origin && u.origin!=='https://i.jielong.com') throw new Error('页面不在接龙管家官网，请重新打开活动。');
    return u;
  }
  async open(input, demo=false) {
    const p=await this.ensure();this.preview=null;this.scan=null;
    this.activity=demo?{id:'demo',url:this.origin+'/demo',demo:true}:{...parseActivity(input),demo:false};
    await p.goto(this.activity.url,{waitUntil:'domcontentloaded',timeout:45000});
    await p.waitForFunction(()=>/我要报名|立即填写|填写表单|名额已满|报名已结束|扫码登录|立即报名|提交表单|提交测试报名/.test(document.body.innerText),null,{timeout:12000}).catch(()=>{});
    this.log(demo?'已打开本地模拟活动':'已打开官网活动');
    return this.inspect();
  }
  async login() {
    const p=await this.ensure(true); this.preview=null;this.scan=null;
    const redirect=this.activity&&!this.activity.demo?this.activity.url:'https://i.jielong.com/';
    await p.goto('https://i.jielong.com/login?redirectTo='+encodeURIComponent(redirect),{waitUntil:'domcontentloaded'});
    await p.getByRole('button',{name:'立即登录',exact:true}).waitFor({state:'visible',timeout:10000}).catch(()=>{});
    const qq=p.getByRole('img',{name:'qq',exact:true});
    if(await qq.count()===1)await qq.click();
    this.log('请在官网窗口完成扫码登录，再点击打开活动；之后自动恢复后台运行');
    return this.inspect();
  }
  async enter() {
    if(!this.activity)throw new Error('请先打开活动。');
    if(this.activity.demo)return this.inspect();
    if(new URL(this.activity.url).pathname.startsWith('/f/')){
      await this.ensure();
      if(this.page.url()!==this.activity.url)await this.open(this.activity.url);
      return this.inspect();
    }
    const p=await this.ensure();this.preview=null;
    // Let the official detail page resolve its public ID to the internal form ID.
    if(p.url()!==this.activity.url)await p.goto(this.activity.url,{waitUntil:'domcontentloaded'});
    const button=p.getByRole('button',{name:'我要报名',exact:true});
    try{await button.waitFor({state:'visible',timeout:10000});}catch{await this.inspect();throw new Error('官网没有可用的「我要报名」入口，请检查活动是否已满或结束。');}
    await button.click();
    await p.waitForURL(u=>u.pathname==='/attend-event'||u.pathname==='/login',{timeout:15000});
    const u=new URL(p.url());if(u.pathname==='/attend-event')this.activity.formId=u.searchParams.get('threadId');
    await p.waitForFunction(()=>document.querySelectorAll('textarea,input:not([type=hidden])').length>0||/扫码登录/.test(document.body.innerText),null,{timeout:12000}).catch(()=>{});
    return this.inspect();
  }
  async inspect() {
    const u=this.allowed(), p=this.page;
    const info=await p.evaluate(()=>{
      const visible=e=>!!(e.getClientRects().length) && getComputedStyle(e).visibility!=='hidden';
      const text=e=>(e?.innerText||e?.textContent||'').trim();
      const labelFor=e=>{
        const outer=e.closest('.event-item-wrap,.ant-form-item,[data-form-field],fieldset');
        return text(outer?.querySelector('.form-item-title,.ant-form-item-label,label,legend')) || text(e.labels?.[0]) || e.getAttribute('aria-label') || e.placeholder || e.name || '未命名字段';
      };
      const nodes=[...document.querySelectorAll('input,textarea,select')].filter(e=>visible(e)&&!['hidden','submit','button','reset'].includes(e.type));
      const fields=[], groups=new Map();
      nodes.forEach((e,i)=>{
        const outer=e.closest('.event-item-wrap,.ant-form-item,[data-form-field],fieldset');
        const id='f'+i;e.dataset.jlaControl=id;
        const type=e.tagName==='TEXTAREA'?'textarea':e.tagName==='SELECT'?'select':e.type;
        if(type==='checkbox') {
          let a=e.parentElement, consent='';
          for(let j=0;j<5&&a;j++,a=a.parentElement){const t=text(a);if(t.length<300&&/我已阅读|隐私协议|保存个人信息授权/.test(t)){consent=t;break;}}
          if(consent){fields.push({id,label:consent,type:'consent',manual:true,required:true,supported:true,disabled:true,value:e.checked});return;}
        }
        const required=e.required||e.getAttribute('aria-required')==='true'||!!outer?.querySelector('.ant-form-item-required,.validate,[data-required]');
        const label=labelFor(e).replace(/\s+/g,' ').slice(0,180);
        const base={id,label,type,required,disabled:e.disabled||e.readOnly,maxLength:e.maxLength||0,supported:['text','tel','email','number','textarea','select','radio','checkbox','url'].includes(type)};
        if(e.getAttribute('role')==='combobox') {base.supported=false;base.type='custom';}
        if(type==='radio'||type==='checkbox') {
          // Group by actual shared field container and input name, never by label alone.
          const key=e.name?`${type}:${e.name}`:outer||e;
          let group=groups.get(key);
          if(!group){group={...base,value:type==='checkbox'?[]:'',options:[]};fields.push(group);groups.set(key,group);}
          let optionLabel=text(e.labels?.[0])||text(e.closest('label'))||e.getAttribute('aria-label')||e.value;
          group.options.push({value:id,label:optionLabel,control:id,disabled:e.disabled});
          if(e.checked){if(type==='checkbox')group.value.push(id);else group.value=id;}
        } else {
          base.value=e.value;
          if(type==='select')base.options=[...e.options].filter(o=>o.value).map(o=>({value:o.value,label:o.text,disabled:o.disabled}));
          fields.push(base);
        }
      });
      // Report visible required fields implemented without a native form control.
      [...document.querySelectorAll('.event-item-wrap,.ant-form-item,[data-form-field]')].filter(visible).forEach((outer,i)=>{
        if(nodes.some(n=>outer.contains(n)))return;
        const label=text(outer.querySelector('.form-item-title,.ant-form-item-label,label'));
        if(label)fields.push({id:'u'+i,label,type:'custom',required:!!outer.querySelector('.ant-form-item-required,.validate,[data-required]'),supported:false,value:''});
      });
      const body=document.body.innerText;
      const title=text(document.querySelector('h1,.thread-subject,.event-subject,.thread-title,.subject'))||document.title;
      const notice=[...new Set(body.split('\n').map(t=>t.trim()).filter(t=>/^(名额已满|报名已结束|报名未开始|报名已截止|活动已结束|提交成功|报名成功)$/.test(t)))];
      const errors=[...document.querySelectorAll('.ant-form-item-explain-error,.ant-message-error,[role="alert"]')].filter(visible).map(text);
      return {title,fields,notice,errors,login:location.pathname==='/login',payment:/我要支付|请使用微信扫码付款/.test(body)};
    });
    const isDemo=u.origin===this.origin&&u.pathname==='/demo';
    const isForm=(isDemo || (u.origin==='https://i.jielong.com' && (u.pathname==='/attend-event'||/^\/f\/[A-Za-z0-9]+\/?$/.test(u.pathname)))) && !info.login;
    const actualId=isDemo?'demo':u.searchParams.get('threadId')||u.pathname.match(/^\/[ef]\/([^/]+)/)?.[1];
    const aligned=actualId===this.activity?.id || (!!this.activity?.formId && actualId===this.activity.formId);
    const fields=info.fields;
    const shape=digest(fields.map(({id,label,type,options,required,disabled,supported})=>({id,label,type,options,required,disabled,supported})));
    const values=Object.fromEntries(fields.map(f=>[f.id,f.value]));
    this.scan={...info,fields:suggest(fields,this.profile),url:u.href,isForm,aligned,demo:isDemo,shape,values,activityId:this.activity?.id};
    // Any user edit/navigation makes a prior preview stale.
    if(this.preview&&(this.preview.url!==u.href||this.preview.shape!==shape||this.preview.valuesHash!==digest(values)))this.preview=null;
    return this.state();
  }
  state() { return {activity:this.activity,scan:this.scan,profile:this.profile,preview:this.preview?{id:this.preview.id,createdAt:this.preview.createdAt}:null,events:this.events,ledger:this.activity?this.ledger[this.activity.id]||null:null,browserOpen:!!this.page&&!this.page.isClosed()}; }
  async setProfile(profile) {
    profile=fixedProfile(profile);
    this.profile=profile;await this.save('profile.json',profile);this.log('报名资料已保存到本机');return this.state();
  }
  async fill(values,shape,{allowPendingConsent=false}={}) {
    await this.inspect();const s=this.scan;this.preview=null;
    if(!s.isForm||!s.aligned)throw new Error('当前不是该活动的报名表，请先进入报名表。');
    if(s.shape!==shape)throw new Error('表单已变化，请重新读取并核对。');
    const plan=fixedPlan(s.fields,this.profile);
    const errors=[...plan.errors,...validate(allowPendingConsent?s.fields.filter(f=>!f.manual):s.fields,values)];
    for(const [id,v] of Object.entries(values))if(JSON.stringify(plan.values[id])!==JSON.stringify(v))errors.push('填写内容必须来自四项固定资料');
    for(const [id,v] of Object.entries(plan.values))if(values[id]!==v)errors.push('固定资料缺少回填值');
    if(errors.length)throw new Error(errors.join('；'));
    for(const f of s.fields) {
      if(!f.supported||f.disabled)continue;
      const v=values[f.id]; if(v==null)continue;
      const loc=this.page.locator(`[data-jla-control="${f.id}"]`);
      if(f.type==='radio'||f.type==='checkbox') {
        const selected=new Set(Array.isArray(v)?v:[v]);
        for(const o of f.options) {
          if(o.disabled)continue;
          const l=this.page.locator(`[data-jla-control="${o.control}"]`);
          if(f.type==='checkbox')await l.setChecked(selected.has(o.value));
          else if(selected.has(o.value))await l.check();
        }
      } else if(f.type==='select')await loc.selectOption(v);
      else await loc.fill(String(v));
    }
    await this.page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    await this.inspect();const now=this.scan;
    if(now.shape!==shape)throw new Error('填写触发了新的表单项，请再次读取并填写。');
    for(const f of now.fields.filter(f=>f.supported&&!f.disabled)) {
      if(values[f.id]!=null&&digest(now.values[f.id])!==digest(values[f.id]))throw new Error(`「${f.label}」未成功回填，请在官网核对。`);
    }
    if(now.errors.length)throw new Error(now.errors.join('；'));
    if(allowPendingConsent&&now.fields.some(f=>f.manual&&f.required&&!f.value)){this.preview=null;this.log('四项资料已填写，等待本人确认官网授权');return this.state();}
    this.preview={id:randomUUID(),createdAt:Date.now(),url:now.url,shape:now.shape,valuesHash:digest(now.values)};
    this.log('已回填官网表单，请核对后再提交');return this.state();
  }
  async autoFill() {
    await this.inspect();const plan=fixedPlan(this.scan.fields,this.profile);
    if(plan.errors.length)throw Error(plan.errors.join('；'));
    return this.fill(plan.values,this.scan.shape,{allowPendingConsent:true});
  }
  async submit(previewId) {
    await this.inspect();const s=this.scan, pv=this.preview;
    if(!pv||pv.id!==previewId||Date.now()-pv.createdAt>10*60e3)throw new Error('预览已失效，请重新回填并核对。');
    if(!s.isForm||!s.aligned||s.login||s.payment||s.notice.some(x=>/已满|结束|截止|未开始/.test(x)))throw new Error('当前页面不满足提交条件，请在官网查看状态。');
    if(s.fields.some(f=>!f.supported))throw new Error('存在需要手动操作的表单项，请在官网完成并提交。');
    const prior=this.ledger[this.activity.id];
    if(prior && ['pending','unknown','success'].includes(prior.status))throw new Error('此活动已有成功或待核实的提交记录，已阻止重复提交，请先在官网核实。');
    const errors=validate(s.fields,s.values);if(errors.length)throw new Error(errors.join('；'));
    if(!s.fields.length)throw new Error('未读取到报名字段，停止提交。');
    const button=this.page.getByRole('button',{name:s.demo?'提交测试报名':new URL(s.url).pathname.startsWith('/f/')?'提交表单':'立即报名',exact:true});
    if(await button.count()!==1||!await button.isEnabled())throw new Error('未找到唯一可用的报名按钮，请在官网检查。');
    const key=this.activity.id;
    this.ledger[key]={status:'pending',at:new Date().toISOString(),demo:s.demo};
    await this.save('ledger.json',this.ledger);this.preview=null;
    let status='unknown',message='提交结果尚未确认。请到官网查看“我参与的”，不要重复报名。';
    try {
      await button.click({timeout:10000});
      const outcome=await this.page.waitForFunction(()=>{
        const visible=e=>!!e.getClientRects().length;
        if(location.pathname==='/submit-success'||document.querySelector('[data-demo-success]'))return {status:'success'};
        const errs=[...document.querySelectorAll('.ant-form-item-explain-error,.ant-message-error')].filter(visible).map(e=>e.innerText).filter(Boolean);
        return errs.length?{status:'rejected',message:errs.join('；')}:null;
      },null,{timeout:18000});
      const v=await outcome.jsonValue(); status=v.status;message=status==='success'?(s.demo?'模拟报名成功，未向接龙管家提交数据。':'官网已显示提交成功。'):v.message;
    } catch { /* Never retry a possibly completed submission. */ }
    this.ledger[key]={status,at:new Date().toISOString(),demo:s.demo,message};
    await this.save('ledger.json',this.ledger);this.log(message);
    await this.inspect();return this.state();
  }
  async resetDemo() { delete this.ledger.demo;await this.save('ledger.json',this.ledger);return this.open('',true); }
  async resetTest() {
    if(this.activity?.id!=='2XSYYRM7JR')throw new Error('仅联调测试活动支持重复测试。');
    if(this.ledger[this.activity.id]){
      this.ledger[this.activity.id+'@'+Date.now()]=this.ledger[this.activity.id];
      delete this.ledger[this.activity.id];await this.save('ledger.json',this.ledger);
    }
    this.log('已开启新一轮测试；官网已有的报名记录仍然保留');
    await this.open('https://i.jielong.com/e/2XSYYRM7JR');return this.enter();
  }
  async confirmTestConsent() {
    await this.inspect();
    if(this.activity?.id!=='1WV33CVWWV'||!this.scan.isForm||!this.scan.aligned)throw new Error('此按钮仅用于当前已授权的联调测试活动。');
    const f=this.scan.fields.find(x=>x.manual&&/保存个人信息授权/.test(x.label));
    if(!f)throw new Error('未找到对应授权控件。');
    await this.page.locator(`[data-jla-control="${f.id}"]`).check();this.preview=null;
    await this.inspect();
    if(!this.scan.fields.find(x=>x.manual&&/保存个人信息授权/.test(x.label))?.value)throw Error('官网授权未成功勾选');
    this.log('已按本次确认勾选四字段测试活动的保存个人信息授权');
    return this.autoFill();
  }
  async close() { if(this.context)await this.context.close(); }
}
