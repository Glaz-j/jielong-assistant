import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {extractCardActivities} from '../cards.mjs';
import {extractLinks,QQWatcher} from '../qq.mjs';
import {TaskQueue} from '../tasks.mjs';
const card=url=>({app:'com.tencent.miniapp_01',meta:{detail_1:{appid:'fixture-only',title:'接龙管家',qqdocurl:url}},prompt:'[QQ小程序]接龙管家'});
test('miniapp payload: explicit official destination, escaped JSON, surrounding text and CQ envelope',()=>{
 const json=JSON.stringify(card('https://i.jielong.com/f/FORM1234'));
 for(const input of [json,json.replaceAll('/','\\/'),'发送人\n'+json+'\n普通消息','[CQ:json,data='+json.replaceAll('&','&amp;').replaceAll('[','&#91;').replaceAll(']','&#93;').replaceAll(',', '&#44;')+']',JSON.stringify({type:'json',data:{data:json}})]){
  const result=extractCardActivities(input);assert.equal(result.activities[0]?.url,'https://i.jielong.com/f/FORM1234');
 }
 assert.equal(extractLinks(json+'\nhttps://i.jielong.com/f/FORM1234').length,1);
});
test('miniapp payload: no title/ID guessing, no foreign links, malformed and oversized payloads rejected',()=>{
 for(const url of ['https://evil.test/f/FORM1234','https://i.jielong.com.evil.test/f/FORM1234','https://user@i.jielong.com/f/FORM1234','file:///etc/passwd','https://i.jielong.com/?threadId=FORM1234','https://m.q.qq.com/a/s/opaque']){
  const result=extractCardActivities(JSON.stringify(card(url)));assert.equal(result.activities.length,0);assert.equal(result.unresolved,1);
 }
 assert.deepEqual(extractCardActivities('[小程序]接龙管家 测试 FORM1234').activities,[]);
 assert.equal(extractCardActivities(JSON.stringify({app:'com.tencent.miniapp_01',meta:{detail_1:{title:'其他小程序',qqdocurl:'https://example.com/'}}})).cards,0);
 assert.equal(extractCardActivities('{broken').activities.length,0);
 assert.equal(extractCardActivities('x'.repeat(150001)).cards,0);
 assert.equal(extractCardActivities(JSON.stringify({...card('https://i.jielong.com/f/FORM1234'),app:'another.app'})).cards,0);
});
test('card ingestion fixture: existing links do not hide unresolved cards; resolved cards queue once',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jla-cards-')),handled=[];
 const queue=new TaskQueue(dir,async j=>{handled.push(j.id);return {status:'filled',message:'fixture'}});await queue.init();
 let text='https://i.jielong.com/e/OLD12345';const watcher=new QQWatcher('',{},queue,{read:async()=>JSON.stringify({status:'ready',group:'接龙助手测试群',text})});
 try{
  await watcher.poll();await queue.tail;
  text+='\n'+JSON.stringify(card('https://m.q.qq.com/a/s/opaque'));await watcher.poll();assert.equal(watcher.status,'card_needs_link');
  text+='\n'+JSON.stringify(card('https://i.jielong.com/f/FORM1234')).replaceAll('/','\\/');
  await watcher.poll();await queue.tail;await watcher.poll();await queue.tail;
  assert.deepEqual(handled,['FORM1234']);assert.equal(watcher.state().cardDiagnostics.resolved,1);assert.equal(watcher.state().cardDiagnostics.unresolved,1);
 }finally{watcher.stop();await queue.close();await fs.rm(dir,{recursive:true,force:true});}
});
