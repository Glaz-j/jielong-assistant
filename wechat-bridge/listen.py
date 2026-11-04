"""Opt-in background receiver; no sender or desktop APIs are imported."""
import argparse,json,os,pathlib,time
import probe  # Establish isolated DB/dependency paths, with no probe side effects.
from receiver import Receiver,atomic_json
from singleton import singleton

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);parser.add_argument('--run-id',required=True);parser.add_argument('--parent-pid',type=int,required=True);args=parser.parse_args()
    data=pathlib.Path(args.data).resolve();data.mkdir(parents=True,exist_ok=True)
    from guardian import ParentGuard
    guard=ParentGuard(args.parent_pid)
    try:
        with singleton(data/'wechat-listener.lock'):run(data,args.run_id,guard)
    finally:guard.close()

def run(data,run_id,guard):
    status=data/'wechat-status.json'
    def publish(value):atomic_json(status,dict(value,runId=run_id))
    try:
        cfg=json.loads((data/'config.json').read_text(encoding='utf-8'))
        if cfg.get('wechatEnabled') is not True:raise RuntimeError('WeChat listener is not enabled')
        account=cfg['wechatAccountId'];chat=cfg['wechatChatId'];group=cfg['group']
        os.environ['WECHATAUTO_KEYS_DIR']=str(data/'wechat-private'/'protected-keys')
        publish({'state':'initializing','ready':False})
        from jla_readonly.db import WeChatDB
        db=WeChatDB(workdir=str(data/'wechat-private'/'database-cache'),keys_file=str(data/'wechat-private'/'protected-keys'/'keys.json'))
        if db.get_self_info().get('username')!=account:raise RuntimeError('Logged-in WeChat account differs from selected account')
        receiver=Receiver(db,data,account,chat,group);receiver.baseline()
        last_status=0;errors=0
        while guard.alive() and not (data/'wechat-stop.flag').exists():
            start=time.monotonic()
            try:
                count=receiver.poll();errors=0
                if time.monotonic()-last_status>2 or count:
                    publish({'state':'listening','ready':True,'pid':os.getpid(),'lastPollAt':time.time(),'pollMs':round((time.monotonic()-start)*1000),'cardsHandedOff':count});last_status=time.monotonic()
            except Exception as e:
                errors+=1;publish({'state':'read-error','ready':False,'errorType':type(e).__name__,'consecutiveErrors':errors,'lastPollAt':time.time()})
                # Cursor is unchanged when reads fail; never silently fall back to old data.
                if errors>=10:raise RuntimeError('Repeated database read failures') from e
            time.sleep(max(0.05,0.5-(time.monotonic()-start)))
        publish({'state':'stopped','ready':False})
    except Exception as e:
        publish({'state':'failed','ready':False,'errorType':type(e).__name__});raise
if __name__=='__main__':main()
