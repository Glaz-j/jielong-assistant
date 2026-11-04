"""Hold a wait-only handle: exit the receiver when its parent application exits."""
import ctypes
from ctypes import wintypes

class ParentGuard:
    def __init__(self,pid):
        if pid<=0:raise ValueError('Parent PID required')
        self.api=ctypes.WinDLL('kernel32',use_last_error=True)
        self.api.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        self.api.OpenProcess.restype=wintypes.HANDLE
        self.api.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
        self.api.WaitForSingleObject.restype=wintypes.DWORD
        self.api.CloseHandle.argtypes=[wintypes.HANDLE]
        self.handle=self.api.OpenProcess(0x100000,False,pid) # SYNCHRONIZE only
        if not self.handle:raise OSError('Cannot monitor parent process')
    def alive(self):
        state=self.api.WaitForSingleObject(self.handle,0)
        if state==0x102:return True
        if state==0:return False
        raise OSError('Parent process wait failed')
    def close(self):
        if self.handle:self.api.CloseHandle(self.handle);self.handle=None
