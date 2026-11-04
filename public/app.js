const $=id=>document.getElementById(id),token=document.querySelector('meta[name="local-token"]').content;
const fixed=['姓名','单位','职工号','所属部门'],sample={'姓名':'测试同学','单位':'测试单位','职工号':'TEST0001','所属部门':'测试部门'};
let state={},busy=false,toastTimer;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
function toast(msg){$('toast').textContent=msg;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,8000);}
async function request(name,data={}){const r=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
async function call(name,data={}){if(busy)return;busy=true;buttons();try{state=await request(name,data);render();return state;}catch(e){toast(e.message);state=await(await fetch('/api/state')).json();render();}finally{busy=false;buttons();}}
function buttons(){document.querySelectorAll('[data-action]').forEach(b=>b.disabled=busy);$('fill').disabled=busy||!state.scan?.isForm||!state.scan?.aligned;$('submit').disabled=busy||!state.preview||['success','pending','unknown'].includes(state.ledger?.status);$('reset-demo').hidden=!state.activity?.demo;}
function render(){
 const s=state.scan;$('activity').replaceChildren();
 if(!s)$('activity').textContent='等待群内新活动';else{$('activity').append(el('strong',s.title),el('div',s.login?'需要你主动打开官网登录':s.notice.join(' · ')||(s.isForm?'报名表已读取':'活动详情已读取')));if(s.payment)$('activity').append(el('div','此活动涉及付款，需人工处理。','error'));}
 $('mode').textContent=state.activity?.demo?'本地模拟':state.activity?'真实活动':'等待活动';
 $('fields').replaceChildren();$('fields').className=s?.fields.length?'field-grid':'empty';
 if(!s?.fields.length)$('fields').textContent='任务填写完成后，点击任务中的“查看填写结果”。';
 for(const f of s?.fields||[]){const box=el('div',null,'field');box.append(el('label',`${f.label}${f.required?' *':''}`));
  if(f.manual){box.append(el('p',f.value?'官网授权已确认':'等待本人确认官网授权','hint'));if(state.activity?.id==='1WV33CVWWV'&&!f.value){const b=el('button','确认本次测试的个人信息保存授权','secondary');b.onclick=()=>call('confirm-test-consent');box.append(b);}}
  else{let v=f.value;if(f.options?.length)v=f.options.filter(o=>(Array.isArray(v)?v:[v]).includes(o.value)).map(o=>o.label).join('、');box.append(el('div',String(v||'尚未填写'),'field-value'));if(!f.supported)box.append(el('small','此控件需要人工处理'));}
  $('fields').append(box);
 }
 $('events').replaceChildren(...(state.events||[]).map(e=>{const d=el('div',null,'event');d.append(el('time',new Date(e.at).toLocaleTimeString()),el('span',e.message));return d;}));
 $('result').replaceChildren();if(state.ledger)$('result').append(el('div',state.ledger.message||'已有提交记录，等待核实。',state.ledger.status==='success'?'success':'error'));
 $('preview-note').textContent=state.preview?'四项资料已回填，请核对后提交。':'只使用固定资料；官网授权不会自动同意，真实报名不会自动提交。';buttons();
}
for(const [id,name] of [['open','open'],['demo','demo'],['login','login'],['enter','enter'],['inspect','inspect'],['reset-demo','reset-demo'],['fill','fill']])$(id).onclick=()=>call(name,id==='open'?{link:$('link').value}:{});
$('submit').onclick=()=>call('submit',{previewId:state.preview?.id});
function showProfile(profile){fixed.forEach((key,i)=>$('profile-'+i).value=profile[key]||'');}
$('save-profile').onclick=()=>call('profile',{profile:Object.fromEntries(fixed.map((key,i)=>[key,$('profile-'+i).value]))});
$('sample').onclick=()=>{showProfile(sample);toast('已填入四项虚构资料，点击保存后用于测试。');};
const qqMessages={stopped:'监听已停止',ready:'正在后台监听，每 3 秒检查一次',permission_needed:'读取器权限未就绪，需要在系统设置重新登记',target_window_closed:'指定群独立窗口未打开，监听等待中',qq_not_running:'QQ 尚未运行或登录',message_list_unavailable:'指定群消息列表暂不可读',reader_unavailable:'读取器未响应，稍后自动检查',card_needs_link:'接龙卡片未暴露可解析的活动地址，尚未自动填写'};
const taskNames={existing:'启动前已有',queued:'排队中',filling:'正在填写',filled:'已填写',consent_required:'等待授权',fields_mismatch:'字段不匹配',login_required:'等待登录',unavailable:'活动不可报名',manual_required:'需人工处理',already_submitted:'已提交过',interrupted:'需重新填写',error:'处理失败'};
function renderQQ(q){$('qq-status').textContent=(qqMessages[q.status]||q.status)+(q.lastCheckedAt?' · '+new Date(q.lastCheckedAt).toLocaleTimeString():'');$('read-count').textContent='成功读取 '+(q.successfulReads||0)+' 次'+(q.cardDiagnostics?.cards?' · 卡片 '+q.cardDiagnostics.resolved+' 已解析 / '+q.cardDiagnostics.unresolved+' 待解析':'');
 $('qq-items').replaceChildren(...q.items.map(original=>{const ledger=state.activity?.id===original.id?state.ledger:null;const j=ledger&&['success','pending','unknown'].includes(ledger.status)?{...original,status:'already_submitted',message:ledger.message||'已有提交记录，等待核实'}:original;const row=el('div',null,'task-row'),content=el('div');content.append(el('strong',j.id),el('span',taskNames[j.status]||j.status,'badge'),el('p',j.message,'hint'));row.append(content);
  const actions=el('div',null,'actions');if(['filled','consent_required'].includes(j.status)){const b=el('button','查看填写结果','secondary');b.onclick=()=>call('task-review',{id:j.id});actions.append(b);}
  if(!['queued','filling','already_submitted','submitted'].includes(j.status)){const b=el('button',j.status==='existing'?'手动试填':'重新填写','secondary');b.onclick=()=>qqCall('task-retry',{id:j.id});actions.append(b);}row.append(actions);return row;}));
 if(!q.items.length)$('qq-items').append(el('p','等待指定群的新活动链接或可解析的卡片。','hint'));
}
async function qqCall(name,data={}){try{renderQQ(await request(name,{group:$('group').value,...data}));}catch(e){toast(e.message);}}
$('qq-start').onclick=()=>qqCall('qq-start');$('qq-stop').onclick=()=>qqCall('qq-stop');
state=await(await fetch('/api/state')).json();showProfile(state.profile||{});render();const first=await(await fetch('/api/qq')).json();$('group').value=first.group;renderQQ(first);
setInterval(async()=>{try{renderQQ(await(await fetch('/api/qq')).json());}catch{$('qq-status').textContent='本地服务暂不可用';}},3000);
