import unittest,tempfile,pathlib,json
from receiver import Receiver
from test_cards import card
class DB:
    def __init__(self):self.rows=[]
    def get_messages(self,chat,limit):return sorted(self.rows,key=lambda r:r['sort_seq'],reverse=True)[:limit]
    def get_new_messages(self,chat,since_seq,limit):return [r for r in self.rows if r['sort_seq']>since_seq][:limit]
class Receiving(unittest.TestCase):
    def test_baseline_new_dedup_restart_equal_seq(self):
        with tempfile.TemporaryDirectory() as d:
            db=DB();db.rows=[dict(local_id=1,sort_seq=10,create_time=99,shard='a',content=card())]
            r=Receiver(db,d,'self','group@chatroom','测试群',clock=lambda:100);r.poll();self.assertFalse((pathlib.Path(d)/'inbox').exists())
            db.rows.append(dict(local_id=2,sort_seq=11,create_time=101,shard='a',content=card()));r.clock=lambda:102
            self.assertEqual(r.poll(),1);self.assertEqual(r.poll(),0)
            r=Receiver(db,d,'self','group@chatroom','测试群',clock=lambda:103);self.assertEqual(r.poll(),0)
            db.rows.append(dict(local_id=2,sort_seq=11,create_time=103,shard='b',content=card('form/pages/detail/index?threadId=XYZ12345')))
            self.assertEqual(r.poll(),1);events=[json.loads(p.read_text()) for p in (pathlib.Path(d)/'inbox').glob('*.json')];self.assertEqual(len(events),2);self.assertTrue(all(e['source']=='wechat-db' for e in events))
    def test_old_and_foreign_service_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            db=DB();r=Receiver(db,d,'self','filehelper','测试',clock=lambda:100);r.baseline();db.rows=[dict(local_id=1,sort_seq=1,create_time=101,content=card(appid='other')),dict(local_id=2,sort_seq=2,create_time=100,content=card())];r.clock=lambda:300;self.assertEqual(r.poll(),0)
    def test_corrupt_cursor_is_not_reset(self):
        with tempfile.TemporaryDirectory() as d:
            (pathlib.Path(d)/'wechat-cursor.json').write_text('bad')
            with self.assertRaises(json.JSONDecodeError):Receiver(DB(),d,'self','filehelper','测试')
if __name__=='__main__':unittest.main()
