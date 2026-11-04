"""Download pinned build inputs and verify SHA-256; never execute downloads."""
import hashlib,json,pathlib,urllib.request
BASE=pathlib.Path(__file__).resolve().parent
TARGET=BASE.parent/'delivery-runtime'

def fetch(meta,target):
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==meta['sha256']:return
    url=meta['url']
    if not url.startswith(('https://nodejs.org/','https://www.python.org/','https://files.pythonhosted.org/')):raise ValueError('Unexpected source')
    target.parent.mkdir(parents=True,exist_ok=True)
    tmp=target.with_suffix(target.suffix+'.part')
    try:
        with urllib.request.urlopen(url,timeout=60) as source,open(tmp,'wb') as dest:
            while chunk:=source.read(1024*1024):dest.write(chunk)
        if hashlib.sha256(tmp.read_bytes()).hexdigest()!=meta['sha256']:raise ValueError('Checksum mismatch: '+target.name)
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)

def main():
    TARGET.mkdir(exist_ok=True)
    for name,output in [('runtime.json','node-win.zip'),('python-runtime.json','python-win.zip')]:
        raw=(BASE/'locks'/name).read_bytes();meta=json.loads(raw)
        fetch(meta,TARGET/output);(TARGET/name).write_bytes(raw)
    raw=(BASE/'locks/python-dependencies.json').read_bytes()
    for meta in json.loads(raw):
        if pathlib.Path(meta['file']).name!=meta['file']:raise ValueError('Invalid dependency name')
        fetch(meta,TARGET/'python-wheels'/meta['file'])
    (TARGET/'python-dependencies.json').write_bytes(raw)
    print('Pinned Windows build inputs verified.')
if __name__=='__main__':main()
