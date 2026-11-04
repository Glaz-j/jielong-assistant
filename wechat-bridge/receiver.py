"""Durable handoff for a single explicitly selected chat. No GUI operations."""
import hashlib,json,os,pathlib,time,math
from datetime import datetime,timezone
from cards import parse_card

def iso(ts):return datetime.fromtimestamp(ts,timezone.utc).isoformat().replace('+00:00','Z')
def atomic_json(file,value):
    file=pathlib.Path(file);file.parent.mkdir(parents=True,exist_ok=True)
    tmp=file.with_suffix(file.suffix+'.tmp')
    with open(tmp,'w',encoding='utf-8') as f:
        json.dump(value,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
    os.replace(tmp,file)

class Receiver:
    def __init__(self,db,data,account_id,chat_id,group_name,clock=time.time):
        if not account_id or not(chat_id=='filehelper' or chat_id.endswith('@chatroom')):raise ValueError('Explicit account and chat required')
        self.db=db;self.data=pathlib.Path(data);self.account_id=account_id;self.chat_id=chat_id;self.group_name=group_name;self.clock=clock
        self.file=self.data/'wechat-cursor.json';self.cursor=None
        if self.file.exists():
            saved=json.loads(self.file.read_text(encoding='utf-8'))
            if saved['accountId']==account_id and saved['chatId']==chat_id:self.cursor=saved
    def _save(self):atomic_json(self.file,self.cursor)
    def baseline(self):
        if self.cursor is not None:return
        rows=self.db.get_messages(self.chat_id,limit=1)
        seq=int(rows[0]['sort_seq']) if rows else 0
        boundary=self.db.get_new_messages(self.chat_id,since_seq=max(0,seq-1),limit=1000)
        if len(boundary)>=1000:raise RuntimeError('Baseline batch limit reached')
        seen=[]
        for row in boundary:
            current=int(row['sort_seq']);seq=max(seq,current)
            identity='|'.join(map(str,[self.account_id,self.chat_id,row.get('shard',''),row['local_id'],current]))
            seen.append(hashlib.sha256(identity.encode()).hexdigest())
        self.cursor={'accountId':self.account_id,'chatId':self.chat_id,'seq':seq,'since':math.floor(self.clock()),'seen':seen};self._save()
    def poll(self):
        if self.cursor is None:self.baseline();return 0
        rows=self.db.get_new_messages(self.chat_id,since_seq=max(0,self.cursor['seq']-1),limit=1000)
        if len(rows)>=1000:raise RuntimeError('Message batch limit reached; cursor not advanced')
        count=0;seen=set(self.cursor['seen']);seq=self.cursor['seq'];now=self.clock()
        for row in sorted(rows,key=lambda r:int(r['sort_seq'])):
            current=int(row['sort_seq']);seq=max(seq,current)
            identity='|'.join(map(str,[self.account_id,self.chat_id,row.get('shard',''),row['local_id'],current]))
            event_id=hashlib.sha256(identity.encode()).hexdigest()
            if event_id in seen:continue
            sent=float(row['create_time'])
            if sent>now:raise RuntimeError('Message timestamp is ahead of local clock; retry later')
            if sent<self.cursor['since'] or now-sent>120:
                seen.add(event_id);continue
            card=parse_card(row.get('content'))
            if card:
                event={'source':'wechat-db','eventId':event_id,'accountId':self.account_id,'chatId':self.chat_id,'group':self.group_name,'url':card['url'],'emittedAt':iso(sent),'observedAt':iso(now)}
                # Persist handoff before cursor. A crash may replay the event; consumer dedups.
                atomic_json(self.data/'inbox'/(event_id+'.json'),event);count+=1
            seen.add(event_id)
        # Keep IDs on the boundary so equal sort_seq rows across shards aren't skipped.
        boundary=set()
        for row in rows:
            if int(row['sort_seq'])>=seq-1:
                identity='|'.join(map(str,[self.account_id,self.chat_id,row.get('shard',''),row['local_id'],int(row['sort_seq'])]))
                boundary.add(hashlib.sha256(identity.encode()).hexdigest())
        self.cursor.update(seq=seq,seen=sorted(seen&boundary));self._save();return count
