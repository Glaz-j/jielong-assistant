import pathlib,sqlite3,unittest
from discover import discover
class DB:
    _db_files=[('contact/contact.db','/private/contact.db',1)]
    def get_self_info(self):return {'username':'wx_test','nick_name':'测试账号'}
    def _open(self,rel):
        c=sqlite3.connect(':memory:');c.execute('CREATE TABLE contact(username TEXT,nick_name TEXT,remark TEXT)')
        c.executemany('INSERT INTO contact VALUES(?,?,?)',[('2@chatroom','同名群',''),('1@chatroom','同名群',''),('friend','不是群',''),('3@chatroom','旧名','备注群')]);return c
class Tests(unittest.TestCase):
    def test_stable_ids_and_group_only(self):
        data=discover(DB());self.assertEqual(data['accountId'],'wx_test');self.assertEqual(len(data['groups']),3)
        self.assertEqual({x['id'] for x in data['groups']},{'1@chatroom','2@chatroom','3@chatroom'})
        self.assertIn({'id':'3@chatroom','name':'备注群'},data['groups'])
    def test_missing_or_unreadable_contact_is_not_empty_success(self):
        db=DB();db._db_files=[]
        with self.assertRaises(RuntimeError):discover(db)
        db=DB();db._open=lambda rel: (_ for _ in ()).throw(OSError('snapshot failure'))
        with self.assertRaises(OSError):discover(db)
if __name__=='__main__':unittest.main()
