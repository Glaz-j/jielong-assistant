"""One-shot developer probe bootstrap. No desktop input, no network listeners."""
import hashlib,json,os,pathlib,subprocess,sys,time,zipfile
BASE=pathlib.Path(__file__).resolve().parent
TARGET=pathlib.Path(os.environ['LOCALAPPDATA'])/'JielongReadOnlyProbe'
RESULT=BASE/'wechat-readonly-probe-result.json'
def record(value):
    RESULT.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
def main():
    record({'state':'starting','at':time.time()})
    archive=BASE/'wechat-readonly-probe.zip'
    manifest=json.loads((BASE/'wechat-readonly-probe.sha256.json').read_text())
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=manifest['sha256']:raise RuntimeError('archive checksum mismatch')
    TARGET.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            target=(TARGET/name).resolve()
            if TARGET.resolve() not in target.parents:raise RuntimeError('invalid archive path')
        z.extractall(TARGET)
    # No pip execution or package installation hooks: expand verified wheels locally.
    deps=TARGET/'deps';deps.mkdir(exist_ok=True)
    for wheel in (TARGET/'wheels').glob('*.whl'):
        with zipfile.ZipFile(wheel) as z:
            for name in z.namelist():
                target=(deps/name).resolve()
                if deps.resolve() not in target.parents:raise RuntimeError('invalid wheel path')
            z.extractall(deps)
    record({'state':'reading','at':time.time()})
    args=[sys.executable.replace('pythonw.exe','python.exe'),str(TARGET/'probe.py'),'--data',str(TARGET/'private')]
    done=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=240,creationflags=subprocess.CREATE_NO_WINDOW)
    result=TARGET/'private/probe-result.json'
    if done.returncode or not result.exists():record({'state':'failed','exitCode':done.returncode})
    else:record({'state':'complete','result':json.loads(result.read_text(encoding='utf-8'))})
    # Optional native package smoke check is entirely headless and uses dummy data.
    # Keep its result separate from actual WeChat compatibility evidence.
    smoke=BASE/'verify-windows.py'
    if smoke.exists() and (BASE/'SHA256SUMS-0.4.1.txt').exists() and (BASE/'接龙助手-Windows-待验收版-0.4.1.zip').exists():
        try:subprocess.run([sys.executable.replace('pythonw.exe','python.exe'),str(smoke)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW,timeout=240)
        except Exception as e:
            (BASE/'jielong-windows-verification.json').write_text(json.dumps({'state':'failed','stage':'smoke-launch','errorType':type(e).__name__}),encoding='utf-8')
try:main()
except Exception as e:record({'state':'failed','errorType':type(e).__name__})
