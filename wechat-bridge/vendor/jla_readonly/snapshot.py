"""Authenticated, committed SQLCipher snapshots; platform-independent tests."""
import hashlib,hmac,os,sqlite3,struct,tempfile,pathlib
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
from .wal_snapshot import read_stable_pair,merge_committed_pages
PAGE=4096

def decrypt_snapshot(encrypted,key):
    if len(key) not in (32,48) or not encrypted or len(encrypted)%PAGE:raise ValueError('Invalid SQLCipher input')
    raw=key[:32];salt=key[32:] if len(key)==48 else encrypted[:16]
    mac_key=hashlib.pbkdf2_hmac('sha512',raw,bytes(b^0x3a for b in salt),2,32)
    result=bytearray()
    for n,offset in enumerate(range(0,len(encrypted),PAGE),1):
        page=encrypted[offset:offset+PAGE];start=16 if n==1 else 0
        expected=hmac.new(mac_key,page[start:4032]+struct.pack('<I',n),hashlib.sha512).digest()
        if not hmac.compare_digest(expected,page[4032:]):raise ValueError('SQLCipher page authentication failed')
        d=Cipher(algorithms.AES(raw),modes.CBC(page[4016:4032])).decryptor()
        plain=d.update(page[start:4016])+d.finalize()
        if n==1:plain=(page[:16] if len(key)==48 else b'SQLite format 3\x00')+plain
        result.extend(plain+b'\x00'*80)
    return bytes(result)

def open_verified(db,rel):
    source=db._db_path(rel)
    key=db._keys.get(rel)
    if not key:raise RuntimeError('No verified database key')
    os.makedirs(db.workdir,exist_ok=True)
    target=os.path.join(db.workdir,'verified-'+hashlib.sha256(rel.encode()).hexdigest()+'.db')
    cache=getattr(db,'_verified_versions',{})
    main,wal,content_version=read_stable_pair(source)
    version=(content_version,hashlib.sha256(key).digest())
    if cache.get(rel)!=version or not os.path.isfile(target):
        encrypted=merge_committed_pages(main,wal)
        # Some upstream caches include explicit salt for a standard encrypted header.
        if len(key)==48 and encrypted[:16]!=b'SQLite format 3\x00':key=key[:32]
        plain=decrypt_snapshot(encrypted,key)
        fd,temp=tempfile.mkstemp(prefix='verified-',suffix='.tmp',dir=db.workdir)
        try:
            with os.fdopen(fd,'wb') as f:f.write(plain)
            conn=sqlite3.connect(pathlib.Path(temp).as_uri()+'?mode=ro',uri=True)
            try:
                if conn.execute('PRAGMA quick_check').fetchall()!=[('ok',)]:raise ValueError('SQLite integrity check failed')
            finally:conn.close()
            os.replace(temp,target);cache[rel]=version;db._verified_versions=cache
        finally:
            if os.path.exists(temp):os.unlink(temp)
    conn=sqlite3.connect(pathlib.Path(target).as_uri()+'?mode=ro',uri=True)
    conn.row_factory=sqlite3.Row
    conn.text_factory=lambda b:b.decode('utf-8') if _utf8(b) else b
    return conn

def _utf8(b):
    try:b.decode('utf-8');return True
    except UnicodeDecodeError:return False
