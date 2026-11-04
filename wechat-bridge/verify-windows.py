"""Developer-only native smoke check. Never opens a visible browser or uses desktop input."""
import hashlib,json,os,pathlib,subprocess,sys,tempfile,time,zipfile
BASE=pathlib.Path(__file__).resolve().parent
RESULT=BASE/'jielong-windows-verification-1.0.0.json'
PACKAGE='接龙助手-Windows-1.0.0.zip'
checks=[]
def record(state,**extra):
    tmp=RESULT.with_suffix('.tmp');tmp.write_text(json.dumps({'state':state,'checks':checks,'at':time.time(),**extra},ensure_ascii=False,indent=2),encoding='utf-8');os.replace(tmp,RESULT)
def run(args,cwd,timeout=90):
    proc=subprocess.Popen(args,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
    try:stdout,stderr=proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        # Only this verification's own child tree; no WeChat or unrelated processes.
        subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW,timeout=10)
        proc.communicate(timeout=10);raise
    if proc.returncode:raise RuntimeError('Native check exit code '+str(proc.returncode))
    return json.loads(stdout.decode('utf-8').strip())
def main():
    record('starting')
    if sys.platform!='win32':raise RuntimeError('Windows only')
    expected=(BASE/'SHA256SUMS-1.0.0.txt').read_text(encoding='utf-8').split()[0]
    archive=BASE/PACKAGE
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise RuntimeError('Package checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='jla-native-',dir=os.environ['LOCALAPPDATA']) as temp:
        root=pathlib.Path(temp)
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                if root.resolve() not in (root/name).resolve().parents:raise RuntimeError('Unsafe archive path')
            z.extractall(root)
        app=root/'JielongAssistant-1.0.0'
        manifest=json.loads((app/'MANIFEST.json').read_text(encoding='utf-8'))
        for name,digest in manifest.items():
            if app.resolve() not in (app/name).resolve().parents:raise RuntimeError('Unsafe manifest path')
            if hashlib.sha256((app/name).read_bytes()).hexdigest()!=digest:raise RuntimeError('File checksum mismatch')
        checks.append({'name':'manifest','ok':True,'files':len(manifest)});record('native-python')
        py=r'''
import sys,json,os
import probe,cryptography,zstandard,win32crypt
from jla_readonly import db
from guardian import ParentGuard
plain=b'jielong-runtime-smoke-only'
blob=win32crypt.CryptProtectData(plain,'Jielong runtime test',None,None,None,0)
assert win32crypt.CryptUnprotectData(blob,None,None,None,0)[1]==plain
parent=ParentGuard(os.getpid())
assert parent.alive()
parent.close()
print(json.dumps({'name':'python-native','ok':True,'version':sys.version.split()[0],'dpapiRoundTrip':True,'parentWaitHandle':True}))
'''
        checks.append(run([str(app/'runtime/python/python.exe'),'-I','-B','-c',py],app));record('headless-edge')
        js=r'''
import {chromium} from 'playwright';
import {startApp} from './delivery/app.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const data=await fs.mkdtemp(path.join(os.tmpdir(),'jla-smoke-'));
let app,browser;
try {
 app=await startApp({dir:data,port:0});
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage();await page.goto(app.url);
 await page.getByLabel('姓名',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('姓名',{exact:true}).inputValue(),'');
 const profile={姓名:'离线测试',单位:'虚构单位',职工号:'0000123',所属部门:'虚构部门'};
 for(const[k,v]of Object.entries(profile))await page.getByLabel(k,{exact:true}).fill(v);
 await page.getByRole('button',{name:'保存个人信息'}).click();
 await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(data,'config.json'))).profile,profile);
 await page.getByRole('button',{name:'启动后台监听'}).click();
 await page.getByRole('status').filter({hasText:'选择目标群'}).waitFor();
 assert.equal(await fs.stat(path.join(data,'auth.json')).then(()=>true,()=>false),false);
 console.log(JSON.stringify({name:'node-headless-edge',ok:true,node:process.version,edge:browser.version(),initialProfileBlank:true,profileSaved:true,unconfiguredStartRejected:true,liveWeChat:'not tested',officialSubmission:'not tested'}));
} finally {await browser?.close();await app?.close();await fs.rm(data,{recursive:true,force:true});}
'''
        checks.append(run([str(app/'runtime/node.exe'),'--input-type=module','-e',js],app));record('complete',liveWeChat='not tested',actual10Seconds='not tested')
if __name__=='__main__':
    try:main()
    except Exception as e:record('failed',errorType=type(e).__name__)
