"""Build an isolated Windows candidate from explicit application/dependency lists."""
from pathlib import Path,PurePosixPath
import zipfile,hashlib,json,shutil,tempfile
root=Path(__file__).resolve().parent.parent
out=root/'release';out.mkdir(exist_ok=True)
version='1.0.0';name='JielongAssistant-'+version
stage=Path(tempfile.mkdtemp(prefix='jla-build-',dir=out))/name;stage.mkdir()
r=root/'delivery-runtime'
def copy(source,dest):
 dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest)
def verified(file,meta):
 assert hashlib.sha256(file.read_bytes()).hexdigest()==meta['sha256'],str(file)
def unpack(archive,dest,skip=None):
 with zipfile.ZipFile(archive) as z:
  for entry in z.infolist():
   p=PurePosixPath(entry.filename)
   assert not p.is_absolute() and '..' not in p.parts and '\\' not in entry.filename
   if entry.is_dir() or (skip and skip(p)):continue
   target=dest.joinpath(*p.parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(entry))
for file in ['silent-worker.mjs','browser.mjs','core.mjs','profile.mjs']:
 copy(root/file,stage/file)
(stage/'package.json').write_text(json.dumps({'name':'jielong-assistant','version':version,'type':'module','private':True},indent=2))
for file in ['app.mjs','wechat.mjs','index.html']:
 copy(root/'delivery'/file,stage/'delivery'/file)
copy(root/'delivery/start.vbs',stage/'启动接龙助手.vbs')
copy(root/'delivery/使用说明.txt',stage/'使用说明.txt')
copy(root/'delivery/验收记录.md',stage/'验收记录.md')
for dependency in ['playwright','playwright-core']:
 shutil.copytree(root/'node_modules'/dependency,stage/'node_modules'/dependency)
node_meta=json.loads((r/'runtime.json').read_text());verified(r/'node-win.zip',node_meta)
with zipfile.ZipFile(r/'node-win.zip') as z:
 prefix=next(n for n in z.namelist() if n.endswith('/node.exe')).rsplit('/',1)[0]
 for file in ['node.exe','LICENSE']:
  target=stage/'runtime'/file;target.parent.mkdir(exist_ok=True);target.write_bytes(z.read(prefix+'/'+file))
(stage/'runtime/SOURCE.json').write_text(json.dumps(node_meta,indent=2))
py_meta=json.loads((r/'python-runtime.json').read_text());verified(r/'python-win.zip',py_meta)
unpack(r/'python-win.zip',stage/'runtime/python')
# Isolated embedded Python explicitly sees our bridge; no system site or PYTHONPATH.
(stage/'runtime/python/python313._pth').write_text('python313.zip\n.\n../../wechat-bridge\n',encoding='ascii')
(stage/'runtime/python/SOURCE.json').write_text(json.dumps(py_meta,indent=2))
bridge=stage/'wechat-bridge'
for file in ['probe.py','discover.py','listen.py','guardian.py','cards.py','receiver.py','singleton.py']:
 copy(root/'wechat-bridge'/file,bridge/file)
for file in ['__init__.py','db.py','safe_log.py','snapshot.py','wal_snapshot.py','LICENSE','LICENSE-wal-snapshot','UPSTREAM.json']:
 copy(root/'wechat-bridge/vendor/jla_readonly'/file,bridge/'vendor/jla_readonly'/file)
wheels=json.loads((r/'python-dependencies.json').read_text())
for item in wheels:
 wheel=r/'python-wheels'/item['file'];verified(wheel,item)
 # pywin32's optional installation/test scripts are not run or distributed.
 unpack(wheel,bridge/'deps',skip=lambda p:any(s.endswith('.data') for s in p.parts))
(bridge/'DEPENDENCIES.json').write_text(json.dumps(wheels,indent=2))
for p in stage.rglob('*'):
 assert p.name not in ['auth.json','config.json','profile.json','ledger.json','jobs.json','keys.json','worker.lock','wechat-discovery.json'],p
 assert not any(x in p.relative_to(stage).parts for x in ['data','silent-data','browser','login-browser','wechat-private','.venv']),p
 assert p.suffix not in ['.db','.sqlite','.pyc'],p
manifest={str(p.relative_to(stage)):hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.rglob('*') if p.is_file()}
(stage/'MANIFEST.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False))
final=out/name
if final.exists():shutil.rmtree(final) # Exact generated version path only.
stage.rename(final);stage.parent.rmdir()
z=out/'接龙助手-Windows-1.0.0.zip'
with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as archive:
 for p in final.rglob('*'):
  if p.is_file():archive.write(p,str(p.relative_to(out)))
(out/'SHA256SUMS-1.0.0.txt').write_text(hashlib.sha256(z.read_bytes()).hexdigest()+'  '+z.name+'\n')
print(json.dumps({'package':str(z),'size':z.stat().st_size,'files':len(manifest),'credentials':'excluded by allowlist','verification':'Windows native and real group cards verified; see acceptance record'},ensure_ascii=False))
