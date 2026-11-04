// Run with the build host's Node. This does NOT validate Windows native binaries.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright';
const dir=path.resolve(process.argv[2]),meta=JSON.parse(await fs.readFile(path.join(dir,'MANIFEST.json')));
for(const [name,hash] of Object.entries(meta))assert.equal(createHash('sha256').update(await fs.readFile(path.join(dir,name))).digest('hex'),hash,name);
assert.equal(await fs.readFile(path.join(dir,'runtime/python/python313._pth'),'utf8'),'python313.zip\n.\n../../wechat-bridge\n');
const {startApp}=await import(pathToFileURL(path.join(dir,'delivery/app.mjs')));
const data=await fs.mkdtemp(path.join(os.tmpdir(),'jla-package-'));const app=await startApp({dir:data,port:0});const browser=await chromium.launch({headless:true,channel:'chromium'});
try{
 const page=await browser.newPage({viewport:{width:1000,height:1100}});await page.goto(app.url);await page.getByLabel('姓名',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('姓名',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('checkbox').first().isChecked(),false);
 assert.equal(await page.locator('#groups option').count(),1);assert.equal(await page.getByText('读取微信账号和群列表',{exact:true}).count(),1);
 await page.screenshot({path:path.resolve('release/onboarding-1.0.0.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'启动后台监听'}).click();await page.getByRole('status').filter({hasText:'四项个人信息'}).waitFor();
 await page.getByRole('button',{name:'退出后台'}).click();await page.getByRole('status').filter({hasText:'正在停止监听'}).waitFor();
 console.log(JSON.stringify({manifestFiles:Object.keys(meta).length,credentials:'empty-first-launch',desktopUI:'passed',narrowUI:'passed',platform:process.platform,windowsRuntime:'NOT TESTED'}));
}finally{await browser.close();await app.close();await fs.rm(data,{recursive:true,force:true});}
