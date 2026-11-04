"""Compile a per-user NSIS Windows setup from the verified portable payload."""
from pathlib import Path
import hashlib,json,shutil,subprocess
root=Path(__file__).resolve().parent.parent
version='1.1.0'
out=root/'release';payload=out/f'JielongAssistant-{version}'
manifest=json.loads((payload/'MANIFEST.json').read_text())
for name,digest in manifest.items():
    assert hashlib.sha256((payload/name).read_bytes()).hexdigest()==digest,name
compiler=shutil.which('makensis')
if not compiler:raise SystemExit('Install NSIS (makensis) before building Setup.exe')
def escape(s):return s.replace('$','$$').replace('"','$\\"')
files=[p.relative_to(payload) for p in payload.rglob('*') if p.is_file()]
directories=sorted({parent for f in files for parent in f.parents if str(parent)!='.'},key=lambda p:len(p.parts),reverse=True)
remove=out/'installer-remove.nsh'
remove.write_text('\n'.join('Delete "$INSTDIR\\'+escape(str(f).replace('/','\\'))+'"' for f in files)+'\n'+'\n'.join('RMDir "$INSTDIR\\'+escape(str(p).replace('/','\\'))+'"' for p in directories)+'\n')
setup=out/f'JielongAssistant-Setup-{version}.exe'
subprocess.run([compiler,'-V2',f'-DPAYLOAD={payload}',f'-DOUTPUT={setup}',f'-DREMOVE_LIST={remove}',str(root/'delivery/installer.nsi')],check=True)
digest=hashlib.sha256(setup.read_bytes()).hexdigest()
(out/f'SHA256SUMS-Setup-{version}.txt').write_text(digest+'  '+setup.name+'\n')
print(json.dumps({'installer':str(setup),'sha256':digest,'bytes':setup.stat().st_size,'signing':'unsigned'},ensure_ascii=False))
