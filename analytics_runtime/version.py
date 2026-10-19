import hashlib
import json
from pathlib import Path

def engine_version():
    root=Path(__file__).resolve().parents[1]
    for entry in json.loads((root/'analytics_runtime'/'engine'/'inventory.json').read_text('utf8')):
        if hashlib.sha256((root/'analytics_runtime'/'engine'/entry['path']).read_bytes()).hexdigest()!=entry['sha256']:
            raise RuntimeError('Analytics engine inventory does not match this deployment')
    names=['api/analytics_runtime.py','analytics_runtime/engine/inventory.json']
    names += [p.relative_to(root).as_posix() for p in (root/'analytics_runtime').glob('*.py')]
    names += [p.relative_to(root).as_posix() for pattern in ('*.js','*.html') for p in (root/'analytics_runtime'/'web').glob(pattern)]
    digest=hashlib.sha256()
    for name in sorted(names):digest.update((name+'\0').encode());digest.update((root/name).read_bytes())
    return digest.hexdigest()

VERSION=engine_version()
