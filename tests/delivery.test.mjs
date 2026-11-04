import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {chromium} from 'playwright';import {startApp} from '../delivery/app.mjs';
test('首次使用：空白资料、保存后重启恢复、无账号不提交、请求来源检查',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-delivery-'));let app=await startApp({dir,port:0});const b=await chromium.launch({headless:true,channel:'chromium'});
 try{const p=await b.newPage();await p.goto(app.url);await p.getByLabel('姓名',{exact:true}).waitFor();assert.equal(await p.getByLabel('姓名',{exact:true}).inputValue(),'');assert.equal(await p.getByRole('checkbox').first().isChecked(),false);
 const vals={姓名:'验收同学',单位:'验收单位',职工号:'0000123',所属部门:'验收部门'};for(const[k,v]of Object.entries(vals))await p.getByLabel(k,{exact:true}).fill(v);await p.getByRole('button',{name:'保存个人信息'}).click();await p.getByRole('status').filter({hasText:'已保存'}).waitFor();
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'config.json'))).profile,vals);
 assert.equal((await fetch(app.url+'/api/state',{method:'POST',body:'{}'})).status,403);
 await p.getByText('手动验证一个活动',{exact:true}).click();await p.getByRole('button',{name:'后台填写并提交'}).click();await p.getByRole('status').filter({hasText:'请核对'}).waitFor();assert.equal(await fs.stat(path.join(dir,'auth.json')).then(()=>true,()=>false),false);
 await app.close();app=await startApp({dir,port:0});await p.goto(app.url);await p.waitForFunction(()=>document.getElementById('职工号').value==='0000123');assert.equal(await p.getByLabel('姓名',{exact:true}).inputValue(),vals.姓名);
 }finally{await b.close();await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
