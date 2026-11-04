import hashlib,hmac,struct,sys,pathlib,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent/'vendor'))
from jla_readonly.snapshot import decrypt_snapshot
from jla_readonly.wal_snapshot import merge_committed_pages,_checksum
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
PAGE=4096;KEY=bytes(range(32));SALT=bytes(range(16))
def encrypted(n,marker):
    start=16 if n==1 else 0;payload=bytearray(4016-start);payload[100:100+len(marker)]=marker;iv=bytes([n])*16
    enc=Cipher(algorithms.AES(KEY),modes.CBC(iv)).encryptor();page=(SALT if n==1 else b'')+enc.update(bytes(payload))+enc.finalize()+iv
    mac=hashlib.pbkdf2_hmac('sha512',KEY,bytes(x^0x3a for x in SALT),2,32)
    return page+hmac.new(mac,page[start:]+struct.pack('<I',n),hashlib.sha512).digest()
def wal(frames,salt=b'abcdefgh'):
    header=struct.pack('>IIII',0x377f0682,3007000,PAGE,0)+salt;state=_checksum(header,'<');out=header+struct.pack('>II',*state)
    for n,size,page in frames:
        prefix=struct.pack('>II',n,size);state=_checksum(prefix+page,'<',state);out+=prefix+salt+struct.pack('>II',*state)+page
    return out
class Snapshots(unittest.TestCase):
    def test_committed_only(self):
        main=encrypted(1,b'header')+encrypted(2,b'old');w=wal([(2,2,encrypted(2,b'committed')),(2,0,encrypted(2,b'uncommitted'))]);plain=decrypt_snapshot(merge_committed_pages(main,w),KEY);self.assertEqual(plain[PAGE+100:PAGE+109],b'committed');self.assertNotIn(b'uncommitted',plain)
    def test_authentication(self):
        main=encrypted(1,b'header')+encrypted(2,b'old');bad=bytearray(encrypted(2,b'bad'));bad[120]^=1
        with self.assertRaisesRegex(ValueError,'authentication'):decrypt_snapshot(merge_committed_pages(main,wal([(2,2,bytes(bad))])),KEY)
    def test_wal_checksum(self):
        w=bytearray(wal([(1,1,encrypted(1,b'new'))]));w[48]^=1
        with self.assertRaises(ValueError):merge_committed_pages(encrypted(1,b'old'),w)
    def test_old_generation(self):
        main=encrypted(1,b'old');current=wal([(1,1,encrypted(1,b'new'))]);stale=wal([(1,1,encrypted(1,b'wrong'))],b'old-salt')[32:]
        self.assertEqual(merge_committed_pages(main,current+stale),encrypted(1,b'new'))
    def test_incomplete_commit(self):
        main=encrypted(1,b'old');self.assertEqual(merge_committed_pages(main,wal([(1,0,encrypted(1,b'pending'))])+b'torn'),main)
if __name__=='__main__':unittest.main()

class SnapshotPublication(unittest.TestCase):
    def test_atomic_cache_and_failed_update_preserves_last_verified_file(self):
        import tempfile,types
        from jla_readonly.snapshot import open_verified
        # Valid empty SQLite page with SQLCipher's 80-byte reserve.
        plain=bytearray(PAGE);plain[:16]=b'SQLite format 3\x00';plain[16:24]=bytes([16,0,1,1,80,64,32,32]);plain[24:28]=struct.pack('>I',1);plain[28:32]=struct.pack('>I',1);plain[44:48]=struct.pack('>I',4);plain[56:60]=struct.pack('>I',1);plain[92:96]=struct.pack('>I',1);plain[96:100]=struct.pack('>I',3040001);plain[100:108]=bytes([13,0,0,0,0,15,176,0])
        iv=b'x'*16;enc=Cipher(algorithms.AES(KEY),modes.CBC(iv)).encryptor();page=SALT+enc.update(bytes(plain[16:4016]))+enc.finalize()+iv
        mac=hashlib.pbkdf2_hmac('sha512',KEY,bytes(x^0x3a for x in SALT),2,32);page+=hmac.new(mac,page[16:]+struct.pack('<I',1),hashlib.sha512).digest()
        with tempfile.TemporaryDirectory(prefix='snapshot # ') as d:
            source=pathlib.Path(d)/'source.db';source.write_bytes(page);work=pathlib.Path(d)/'cache';db=types.SimpleNamespace(_keys={'source':KEY},_db_path=lambda rel:str(source),workdir=str(work))
            conn=open_verified(db,'source');self.assertEqual(conn.execute('PRAGMA quick_check').fetchall()[0][0],'ok');conn.close()
            target=next(work.glob('verified-*.db'));before=target.read_bytes()
            # A malformed committed WAL must fail, never serve an old snapshot as fresh.
            pathlib.Path(str(source)+'-wal').write_bytes(b'invalid')
            with self.assertRaises(ValueError):open_verified(db,'source')
            self.assertEqual(target.read_bytes(),before)
