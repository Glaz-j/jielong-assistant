"""List account and group identifiers from authenticated local snapshots only."""
import argparse,json,os,pathlib
import probe
from receiver import atomic_json

def discover(db):
    account=db.get_self_info()
    if not account.get('username'):raise RuntimeError('No account identifier')
    groups={}
    contacts=[rel for rel,file,_ in db._db_files if pathlib.Path(file).name=='contact.db']
    if not contacts:raise RuntimeError('Contact database unavailable')
    for rel in contacts:
        conn=db._open(rel)
        try:
            for row in conn.execute("SELECT username,nick_name,remark FROM contact WHERE username LIKE '%@chatroom'"):
                chat,name,remark=row
                if not isinstance(chat,str) or not chat.endswith('@chatroom'):continue
                groups[chat]={'id':chat,'name':str(remark or name or chat)}
        finally:conn.close()
    return {'ok':True,'accountId':account['username'],'accountName':account.get('remark') or account.get('nick_name') or account['username'],
            'groups':sorted(groups.values(),key=lambda g:(g['name'],g['id']))}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);parser.add_argument('--run-id',required=True);args=parser.parse_args()
    data=pathlib.Path(args.data).resolve();data.mkdir(parents=True,exist_ok=True)
    os.environ['WECHATAUTO_KEYS_DIR']=str(data/'wechat-private'/'protected-keys')
    try:
        from jla_readonly.db import WeChatDB
        db=WeChatDB(workdir=str(data/'wechat-private'/'database-cache'),keys_file=str(data/'wechat-private'/'protected-keys'/'keys.json'))
        result=discover(db)
    except Exception as e:result={'ok':False,'errorType':type(e).__name__}
    atomic_json(data/'wechat-discovery.json',dict(result,runId=args.run_id))
    if not result['ok']:raise SystemExit(1)
if __name__=='__main__':main()
