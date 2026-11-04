"""OS-held lock releases on process exit; never kill a process based on stale PID."""
from contextlib import contextmanager
import os,pathlib
@contextmanager
def singleton(path):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with open(path,'a+b') as f:
        if f.tell()==0:f.write(b'0');f.flush()
        f.seek(0)
        try:
            if os.name=='nt':
                import msvcrt;msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl;fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as exc:raise RuntimeError('A WeChat receiver already holds this data directory') from exc
        try:yield
        finally:
            f.seek(0)
            if os.name=='nt':msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1)
            else:fcntl.flock(f.fileno(),fcntl.LOCK_UN)
