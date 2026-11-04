import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';
import {TEST_PROFILE} from '../profile.mjs';
test('fixed four-field form: fill, stale preview, success, durable duplicate guard; CSRF and custom keys denied',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-test-'));
 const app=await startServer({port:0,dataDir:dir,headless:true});
 try {
  const denial=await fetch(app.origin+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(denial.status,403);
  const a=app.assistant;await assert.rejects(()=>a.setProfile({...TEST_PROFILE,邮箱:'x@y.test'}),/固定字段/);await a.setProfile(TEST_PROFILE);
  let s=await a.open('',true);assert.equal(s.scan.fields.length,4);
  s=await a.autoFill();assert.ok(s.preview);assert.deepEqual(Object.values(s.scan.values),Object.values(TEST_PROFILE));
  const stale=s.preview.id;await a.page.locator('#name').fill('changed');
  await assert.rejects(()=>a.submit(stale),/预览已失效/);
  s=await a.autoFill();s=await a.submit(s.preview.id);assert.equal(s.ledger.status,'success');
  s=await a.open('',true);s=await a.autoFill();await assert.rejects(()=>a.submit(s.preview.id),/阻止重复提交/);
  await a.close();await a.init();assert.equal(a.ledger.demo.status,'success');
  const html=await(await fetch(app.origin)).text();assert.ok(!html.includes('id="profile"'));assert.ok(html.includes('profile-3'));
 } finally {await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
