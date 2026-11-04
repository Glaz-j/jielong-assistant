import test from 'node:test';
import assert from 'node:assert/strict';
import {parseActivity,suggest,validate} from '../core.mjs';
import {extractLinks} from '../qq.mjs';
test('accepts official activity and mini-program path, rejects foreign credential destinations',()=>{
 assert.equal(parseActivity('event/pages/detail/index.html?threadId=ABC12345&inviterId=123').id,'ABC12345');
 assert.equal(parseActivity('https://i.jielong.com/e/ABC12345').url,'https://i.jielong.com/e/ABC12345');
 assert.equal(parseActivity('https://i.jielong.com/f/FORM1234').url,'https://i.jielong.com/f/FORM1234');
 assert.equal(extractLinks('https://i.jielong.com/f/FORM1234')[0].url,'https://i.jielong.com/f/FORM1234');
 for(const url of ['https://evil.test/e/ABC12345','https://i.jielong.com.evil.test/e/ABC12345','https://user@i.jielong.com/e/ABC12345','file:///etc/passwd','https://i.jielong.com:999/e/ABC12345'])assert.throws(()=>parseActivity(url));
});
test('QQ messages deduplicate activities, preserve exact domain restriction and match choice text',()=>{
 const links=extractLinks('上午测试 https://i.jielong.com/e/ABC12345\nhttps://i.jielong.com/e/ABC12345\nhttps://evil.test/e/ABC12345');
 assert.equal(links.length,1);
 const [f]=suggest([{id:'x',label:'* 4. 场次',type:'radio',options:[{label:'上午场',value:'f2'},{label:'下午场',value:'f3'}],value:''}],{场次:'上午场'});
 assert.equal(f.suggested,'f2');
});
test('ambiguous personal data is never selected; unrelated labels are not fuzzily matched',()=>{
 const result=suggest([{id:'a',label:'姓名',value:''},{id:'b',label:'紧急联系人姓名',value:''}],{'学生姓名':'甲','真实姓名':'乙'});
 assert.equal(result[0].suggested,'');assert.equal(result[0].ambiguous,true);assert.equal(result[1].matched,false);
});
test('validates mandatory fields, option membership and email',()=>{
 const fields=[{id:'a',label:'姓名',type:'text',required:true,supported:true},{id:'b',label:'邮箱',type:'email',supported:true},{id:'c',label:'场次',type:'select',supported:true,options:[{value:'one'}]}];
 assert.equal(validate(fields,{a:'',b:'broken',c:'missing'}).length,3);
 assert.deepEqual(validate(fields,{a:'测试',b:'test@example.com',c:'one'}),[]);
});
