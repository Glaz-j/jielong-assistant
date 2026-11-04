"""Snapshots stay fresh despite coarse timestamps and concurrent later writes."""
import pathlib,sys,tempfile,types,os,unittest,struct,hashlib,hmac
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parent/'vendor'))
from jla_readonly import snapshot,wal_snapshot
from test_snapshot import KEY,SALT,PAGE,wal
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes

def sqlite_page(version):
    plain=bytearray(PAGE);plain[:16]=b'SQLite format 3\x00';plain[16:24]=bytes([16,0,1,1,80,64,32,32]);plain[24:28]=struct.pack('>I',1);plain[28:32]=struct.pack('>I',1);plain[44:48]=struct.pack('>I',4);plain[56:60]=struct.pack('>I',1);plain[60:64]=struct.pack('>I',version);plain[92:96]=struct.pack('>I',1);plain[96:100]=struct.pack('>I',3040001);plain[100:108]=bytes([13,0,0,0,0,15,176,0])
    iv=b'x'*16;enc=Cipher(algorithms.AES(KEY),modes.CBC(iv)).encryptor();page=SALT+enc.update(bytes(plain[16:4016]))+enc.finalize()+iv
    mac=hashlib.pbkdf2_hmac('sha512',KEY,bytes(x^0x3a for x in SALT),2,32)
    return page+hmac.new(mac,page[16:]+struct.pack('<I',1),hashlib.sha512).digest()
def replace_preserving_metadata(file,data):
    before=file.stat();file.write_bytes(data);os.utime(file,ns=(before.st_atime_ns,before.st_mtime_ns))
class LiveSnapshots(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.source=pathlib.Path(self.temp.name)/'source.db';self.source.write_bytes(sqlite_page(1));self.db=types.SimpleNamespace(_keys={'source':KEY},_db_path=lambda rel:str(self.source),workdir=str(pathlib.Path(self.temp.name)/'cache'))
    def tearDown(self):self.temp.cleanup()
    def read_version(self):
        c=snapshot.open_verified(self.db,'source')
        try:return c.execute('PRAGMA user_version').fetchone()[0]
        finally:c.close()
    def test_same_size_and_timestamp_main_update_is_seen(self):
        self.assertEqual(self.read_version(),1);replace_preserving_metadata(self.source,sqlite_page(2));self.assertEqual(self.read_version(),2)
    def test_same_size_and_timestamp_wal_reset_is_seen(self):
        target=pathlib.Path(str(self.source)+'-wal');target.write_bytes(wal([(1,1,sqlite_page(2))]));self.assertEqual(self.read_version(),2)
        replace_preserving_metadata(target,wal([(1,1,sqlite_page(3))],salt=b'new-salt'));self.assertEqual(self.read_version(),3)
    def test_change_during_copy_retries_without_trusting_metadata(self):
        original=wal_snapshot._read_pair;calls=[]
        def changing(source):
            pair=original(source);calls.append(1)
            if len(calls)==1:replace_preserving_metadata(self.source,sqlite_page(2))
            return pair
        with patch.object(wal_snapshot,'_read_pair',changing):self.assertEqual(self.read_version(),2)
        self.assertEqual(len(calls),2)
    def test_later_write_does_not_discard_valid_captured_snapshot(self):
        original=snapshot.decrypt_snapshot
        def subsequent(data,key):
            replace_preserving_metadata(self.source,sqlite_page(2));return original(data,key)
        with patch.object(snapshot,'decrypt_snapshot',subsequent):self.assertEqual(self.read_version(),1)
        self.assertEqual(self.read_version(),2)
    def test_unchanged_content_reuses_verified_cache_without_decrypt(self):
        self.assertEqual(self.read_version(),1)
        with patch.object(snapshot,'decrypt_snapshot',side_effect=AssertionError('Unexpected rebuild')):self.assertEqual(self.read_version(),1)
    def test_repeated_copy_changes_fail_without_old_cache_fallback(self):
        self.assertEqual(self.read_version(),1);original=wal_snapshot._read_pair;count=[1]
        def changing(source):
            pair=original(source);count[0]+=1;replace_preserving_metadata(self.source,sqlite_page(count[0]));return pair
        with patch.object(wal_snapshot,'_read_pair',changing):
            with self.assertRaisesRegex(ValueError,'changed during copy'):self.read_version()
        self.assertEqual(count[0],4)
if __name__=='__main__':unittest.main()
