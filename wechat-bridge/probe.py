"""Read-only compatibility probe. Writes no message bodies or raw keys to stdout."""
import argparse,json,os,pathlib,sys,time
ROOT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'vendor'))
sys.path.insert(0,str(ROOT/'deps'))
for part in ['win32','win32/lib','pywin32_system32']:
    sys.path.insert(0,str(ROOT/'deps'/part))
_dll_handles=[]
if hasattr(os,'add_dll_directory'):
    for part in ['pywin32_system32','win32']:
        folder=ROOT/'deps'/part
        if folder.is_dir():_dll_handles.append(os.add_dll_directory(str(folder)))

def main():
    p=argparse.ArgumentParser();p.add_argument('--data',required=True);args=p.parse_args()
    data=pathlib.Path(args.data).resolve();data.mkdir(parents=True,exist_ok=True)
    os.environ['WECHATAUTO_KEYS_DIR']=str(data/'protected-keys')
    started=time.monotonic()
    stage='import'
    try:
        from jla_readonly.db import WeChatDB
        stage='database-open'
        db=WeChatDB(workdir=str(data/'database-cache'),keys_file=str(data/'protected-keys'/'keys.json'))
        stage='account-read'
        info=db.get_self_info()
        from cards import parse_card
        stage='message-read'
        messages=db.get_messages('filehelper',limit=20)
        cards=[parse_card(m.get('content')) for m in messages]
        result={'ok':True,'elapsedSeconds':round(time.monotonic()-started,3),'accountDetected':bool(info.get('username')),'selfTestChatReadable':True,'recentMessages':len(messages),'recognizedCards':sum(c is not None for c in cards),'readOnly':True,'snapshotMode':'authenticated-committed'}
    except Exception as exc:
        result={'ok':False,'errorType':type(exc).__name__,'stage':stage,'readOnly':True}
    (data/'probe-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
