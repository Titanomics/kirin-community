"""Bounded immutable archives with verified names, hashes, and exact timestamps."""
import hashlib
import io
import json
import os
import stat
import zipfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE=50*1024*1024
MAX_EXPANDED=250*1024*1024
MAX_FILES=3000
META='__snapshot__.json'


class SnapshotError(Exception):
    pass


def safe_name(name):
    parts=PurePosixPath(name)
    if not name or '\\' in name or ':' in name or parts.is_absolute() or any(x in ('','.','..') for x in name.split('/')):
        raise SnapshotError('저장 자료의 경로가 올바르지 않습니다.')
    if parts.name.casefold().startswith('internal-finance.sqlite'):
        raise SnapshotError('관리자 전용 비용 자료는 병원 공용 저장본에 포함할 수 없습니다.')
    return parts


def pack(root):
    files={}; size=0; output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for file in sorted(Path(root).rglob('*')):
            if file.is_symlink(): raise SnapshotError('링크 파일은 저장할 수 없습니다.')
            if not file.is_file(): continue
            name=file.relative_to(root).as_posix(); safe_name(name)
            if name==META: raise SnapshotError('예약된 저장 파일명입니다.')
            data=file.read_bytes(); size+=len(data)
            if size>MAX_EXPANDED or len(files)>=MAX_FILES: raise SnapshotError('병원 자료 저장 한도를 초과했습니다.')
            files[name]={'sha256':hashlib.sha256(data).hexdigest(),'mtime_ns':file.stat().st_mtime_ns,'size':len(data)}
            archive.writestr(name,data)
        archive.writestr(META,json.dumps({'version':1,'files':files},ensure_ascii=False))
    result=output.getvalue()
    if len(result)>MAX_ARCHIVE: raise SnapshotError('병원 자료 저장 한도를 초과했습니다.')
    return result


def restore(data,root):
    if not data or len(data)>MAX_ARCHIVE: raise SnapshotError('저장 자료의 크기가 올바르지 않습니다.')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries=archive.infolist(); names=[e.filename for e in entries]
            if len(entries)>MAX_FILES+1 or len(names)!=len(set(names)) or sum(e.file_size for e in entries)>MAX_EXPANDED+1024*1024: raise ValueError
            for entry in entries:
                safe_name(entry.filename)
                if entry.flag_bits&1 or entry.is_dir() or stat.S_ISLNK(entry.external_attr>>16): raise ValueError
            if META not in names or archive.getinfo(META).file_size>1024*1024: raise ValueError
            meta=json.loads(archive.read(META))
            if meta.get('version')!=1 or set(meta['files'])!=set(names)-{META}: raise ValueError
            checked=[]
            for name,info in meta['files'].items():
                content=archive.read(name)
                if len(content)!=info['size'] or hashlib.sha256(content).hexdigest()!=info['sha256'] or type(info['mtime_ns']) is not int or not 0<info['mtime_ns']<2**63: raise ValueError
                checked.append((name,content,info['mtime_ns']))
            # Verify everything before making any restored file visible.
            for name,content,stamp in checked:
                target=Path(root)/name
                if not target.resolve().is_relative_to(Path(root).resolve()): raise ValueError
                target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(content)
                os.utime(target,ns=(stamp,stamp))
    except (ValueError,KeyError,TypeError,OSError,zipfile.BadZipFile,RuntimeError) as error:
        raise SnapshotError('저장된 병원 자료를 검증하지 못했습니다. 빈 자료로 대체하지 않습니다.') from error
