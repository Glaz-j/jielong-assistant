"""Read a stable main-file/WAL pair and retain only committed SQLite frames.

The page payload is opaque: this works before SQLCipher page decryption.
Format reference: https://www.sqlite.org/fileformat2.html#wal_file_format
"""
import os
import struct
import hashlib


def _checksum(data, byteorder, state=(0, 0)):
    if len(data) % 8:
        raise ValueError('WAL checksum input must contain pairs of words')
    first, second = state
    for left, right in struct.iter_unpack(byteorder + 'II', data):
        first = (first + left + second) & 0xffffffff
        second = (second + right + first) & 0xffffffff
    return first, second


def merge_committed_pages(main, wal, page_size=4096):
    """Return encrypted pages at the last commit, excluding unfinished writes."""
    if not wal:
        return main
    if len(main) < page_size or len(main) % page_size or len(wal) < 32:
        raise ValueError('Incomplete main database or WAL header')
    magic, version, size = struct.unpack('>III', wal[:12])
    if magic not in (0x377f0682, 0x377f0683) or version != 3007000 or size != page_size:
        raise ValueError('Unsupported WAL format or page size')
    byteorder = '<' if magic == 0x377f0682 else '>'
    state = _checksum(wal[:24], byteorder)
    if state != struct.unpack('>II', wal[24:32]):
        raise ValueError('Invalid WAL header checksum')
    generation = wal[16:24]
    pending, committed = {}, {}
    committed_size = None
    main_available = len(main) // page_size
    frame_size = page_size + 24
    for offset in range(32, len(wal) - frame_size + 1, frame_size):
        header = wal[offset:offset + 24]
        # A reset may leave complete frames from the previous generation.
        if header[8:16] != generation:
            break
        page_number, commit_size = struct.unpack('>II', header[:8])
        if not 1 <= page_number <= 0xfffffffe:
            raise ValueError('Invalid WAL page number')
        page = wal[offset + 24:offset + frame_size]
        state = _checksum(header[:8] + page, byteorder, state)
        if state != struct.unpack('>II', header[16:24]):
            raise ValueError('Invalid WAL frame checksum')
        pending[page_number] = page
        if commit_size:
            if commit_size > 0xfffffffe:
                raise ValueError('Invalid WAL commit size')
            committed.update(pending)
            pending.clear()
            committed = {number: payload for number, payload in committed.items() if number <= commit_size}
            committed_size = commit_size
            # A later growth must not resurrect pages removed by an earlier commit.
            main_available = min(main_available, commit_size)
    if committed_size is None:
        return main
    if committed_size > main_available + len(committed):
        raise ValueError('WAL commit grows across missing pages')
    output = bytearray()
    for number in range(1, committed_size + 1):
        page = committed.get(number)
        if page is None:
            if number > main_available:
                raise ValueError('WAL commit is missing a new page')
            page = main[(number - 1) * page_size:number * page_size]
        output.extend(page)
    return bytes(output)


def _metadata(path):
    try:
        info = os.stat(path)
        return info.st_size, info.st_mtime_ns, info.st_ino
    except FileNotFoundError:
        return None


def _read_pair(source):
    with open(source, 'rb') as handle:
        main = handle.read()
    try:
        with open(source + '-wal', 'rb') as handle:
            wal = handle.read()
    except FileNotFoundError:
        wal = b''
    return main, wal


def _digest_file(file, optional=False):
    digest=hashlib.sha256()
    try:
        with open(file,'rb') as handle:
            while True:
                chunk=handle.read(1024*1024)
                if not chunk:break
                digest.update(chunk)
    except FileNotFoundError:
        if not optional:raise
    return digest.digest()


def read_stable_pair(source, attempts=3):
    """Observe the same bytes twice; timestamps alone are unsafe on Windows.

    The second pass hashes in chunks rather than allocating a second full copy.
    Returned bytes and their content hashes form an immutable observed version.
    A later writer does not invalidate this already-captured version.
    """
    wal_path=source+'-wal'
    for _ in range(attempts):
        before = (_metadata(source), _metadata(wal_path))
        main,wal=_read_pair(source)
        version=(hashlib.sha256(main).digest(),hashlib.sha256(wal).digest())
        repeated=(_digest_file(source),_digest_file(wal_path,optional=True))
        after = (_metadata(source), _metadata(wal_path))
        if before != after or version != repeated:
            continue
        return main,wal,version
    raise ValueError('Main database/WAL changed during copy; retry next poll')


def read_snapshot(source, attempts=3):
    """Retry a changing pair; never silently publish a main-only fallback."""
    main,wal,_=read_stable_pair(source,attempts)
    return merge_committed_pages(main,wal)
