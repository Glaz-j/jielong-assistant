import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {SilentWorker} from '../silent-worker.mjs';
const profile={姓名:'测试二·甲',单位:'研发 & 测试单位',职工号:'00001234',所属部门:'研发一部'};
const field=(label,type='text',attrs='')=>`<div data-form-field><label for="${label}">* ${label}</label><input id="${label}" type="${type}" required ${attrs}></div>`;
const base=()=>Object.keys(profile).map(k=>field(k));
const cases=[
 ['标准四字段',()=>base().join(''),true],
 ['反向顺序',()=>base().reverse().join(''),true],
 ['乱序字段',()=>[2,0,3,1].map(i=>base()[i]).join(''),true],
 ['字段别名',()=>['真实姓名','工作单位','工号','部门'].map(k=>field(k)).join(''),true],
 ['多行文本',()=>Object.keys(profile).map(k=>`<div data-form-field><label for="${k}">* ${k}</label><textarea id="${k}" required></textarea></div>`).join(''),true],
 ['可选附加文字',()=>base().join('')+'<div data-form-field><label for="extra">备注</label><input id="extra"></div>',true],
 ['预填旧值',()=>Object.keys(profile).map(k=>field(k,'text','value="旧值"')).join(''),true],
 ['下拉部门',()=>base().slice(0,3).join('')+'<div data-form-field><label for="dept">所属部门</label><select id="dept" required><option value="">请选择</option><option value="r1">研发一部</option></select></div>',true],
 ['单选部门',()=>base().slice(0,3).join('')+'<fieldset><legend>所属部门</legend><label><input type="radio" name="dept" value="r1" required>研发一部</label><label><input type="radio" name="dept" value="r2">研发二部</label></fieldset>',true],
 ['只读匹配值',()=>base().slice(0,3).join('')+field('所属部门','text','readonly value="研发一部"'),true],
 ['编号和空格标签',()=>['1. 姓名：','2、单位','3． 职工号','4. 所属部门：'].map(k=>field(k)).join(''),true],
 ['全部只读且一致',()=>Object.entries(profile).map(([k,v])=>field(k,'text',`readonly value="${v}"`)).join(''),true],
 ['职工号电话控件保留零',()=>base().map((x,i)=>i===2?field('职工号','tel'):x).join(''),true],
 ['隐藏旧表单副本',()=>base().join('')+'<div style="display:none">'+base().join('')+'</div>',true],
 ['不猜测带额外说明的字段',()=>base().slice(0,3).join('')+field('所属部门及岗位'),false],
 ['禁用字段冲突',()=>base().slice(0,3).join('')+field('所属部门','text','disabled value="其他部门"'),false],
 ['单选匹配项被禁用',()=>base().slice(0,3).join('')+'<fieldset><legend>所属部门</legend><label><input type="radio" name="dept" value="r1" required disabled>研发一部</label><label><input type="radio" name="dept" value="r2" required>研发二部</label></fieldset>',false],
 ['页面改写职工号',()=>base().join('')+'<script>document.getElementById("职工号").addEventListener("input",e=>e.target.value=String(Number(e.target.value)))</script>',false],
 ['只读冲突',()=>base().slice(0,3).join('')+field('所属部门','text','readonly value="其他部门"'),false],
 ['缺失部门',()=>base().slice(0,3).join(''),false],
 ['未知必填项',()=>base().join('')+field('身份证号'),false],
 ['学号代替职工号',()=>base().filter((x,i)=>i!==2).join('')+field('学号'),false],
 ['重复姓名',()=>base().join('')+field('真实姓名'),false],
 ['无匹配选项',()=>base().slice(0,3).join('')+'<div data-form-field><label for="dept">所属部门</label><select id="dept" required><option value="x">其他部门</option></select></div>',false],
 ['多个同名选项',()=>base().slice(0,3).join('')+'<div data-form-field><label for="dept">所属部门</label><select id="dept" required><option value="x">研发一部</option><option value="y">研发一部</option></select></div>',false],
 ['超出最大长度',()=>[field('姓名','text','maxlength="2"'),...base().slice(1)].join(''),false],
 ['附件必填',()=>base().join('')+field('附件','file'),false],
 ['未知授权',()=>base().join('')+'<label><input type="checkbox">我已阅读第三方授权</label>',false],
 ['已批准保存授权',()=>base().join('')+'<label><input type="checkbox">我已阅读保存个人信息授权</label>',true],
 ['报名已结束',()=>base().join('')+'<p>报名已结束</p>',false],
 ['名额已满',()=>base().join('')+'<p>名额已满</p>',false],
 ['收费页面',()=>base().join('')+'<p>我要支付</p>',false],
 ['字段动态新增',()=>base().join('')+'<script>document.querySelector("input").addEventListener("input",()=>{if(!document.querySelector("#extra"))document.querySelector("button").insertAdjacentHTML("beforebegin",\'<div data-form-field><label for="extra">身份证号</label><input id="extra" required></div>\')})</script>',false],
 ['服务端拒绝',()=>base().join(''),false,'reject']
];
test('多种表单真实浏览器回归',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-matrix-'));await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({group:'测试群',profile,acceptSavedPersonalInfo:true}));await fs.writeFile(path.join(dir,'auth.json'),'{"cookies":[],"origins":[]}');
 const w=new SilentWorker(dir);let current,posts=[];
 try{await w.init();await w.context.route('https://i.jielong.com/**',async route=>{const u=new URL(route.request().url());
 if(u.pathname==='/api/Form/GetThreadDetail')return route.fulfill({contentType:'application/json',body:JSON.stringify({Data:{Thread:{ThreadId:1000+current.index}}})});
 if(u.pathname==='/posted'){posts.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:'{}'});}
 if(u.pathname==='/submit-success')return route.fulfill({contentType:'text/html',body:'提交成功'});
 const submit=current.mode==='reject'?`const e=document.createElement('div');e.className='ant-message-error';e.textContent='名额不足';document.body.append(e)`:`location.href='/submit-success'`;
 return route.fulfill({contentType:'text/html; charset=utf-8',body:`<meta charset="utf-8"><script>fetch('/api/Form/GetThreadDetail')</script><h1>测试表单</h1><button onclick="fetch('/posted',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([...document.querySelectorAll('input,textarea,select')].filter(e=>!['checkbox','radio'].includes(e.type)||e.checked).map(e=>e.value))}).then(()=>{${submit}})">提交表单</button>${current.html}`});
 });
 for(const [index,[name,render,ok,mode]] of cases.entries())await t.test(name,async()=>{current={index,html:render(),mode};posts=[];const job=await w.accept({source:'simulation',group:'测试群',url:`https://i.jielong.com/f/MATRIX${1000+index}`});const result=await w.process(job);assert.equal(result.status,ok?'submitted':'failed',result.error);assert.equal(posts.length,ok||mode==='reject'?1:0);if(ok){const values=posts[0];for(const v of Object.values(profile).slice(0,3))assert.ok(values.includes(v),JSON.stringify(values));assert.ok(values.includes(profile.所属部门)||values.includes('r1'));}});
 }finally{await w.close();await fs.rm(dir,{recursive:true,force:true});}
});
