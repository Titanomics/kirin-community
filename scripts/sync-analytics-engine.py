"""Copy a reviewed local engine using explicit source allowlists; never copy workspaces."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(); parser.add_argument('source',type=Path); args=parser.parse_args()
source=args.source.resolve(); destination=ROOT/'analytics_runtime'/'engine'
inventory=[]
files=list((source/'clinic_analytics').glob('*.py'))
files += [p for p in (source/'static').iterdir() if p.suffix in ('.js','.css','.html','.svg')]
files += [source/'static'/'data'/name for name in ('sig.geojson','emd.geojson','population-seoul.json','competitors-seoul.json','market-context.json','provenance.json')]
if not files or not (source/'clinic_analytics'/'server.py').is_file(): raise SystemExit('Engine source not found')
for file in files:
    relative=file.relative_to(source); content=file.read_bytes(); target=destination/relative
    if file.name=='index.html':
        content=content.decode('utf8').replace('디데이치과','병원 분석').replace('디데이 분석 홈','병원 분석 홈').replace('D-DAY','KIRIN').replace('이 PC에서 분석 중','ERP 병원 분석').replace('엑셀 기반 파일럿 · v0.1','병원별 접근 권한 적용').replace('로컬 데이터','비공개 데이터').replace('class="avatar">D','class="avatar">K').replace('id="source-count" class="count-tag">28','id="source-count" class="count-tag">—').encode('utf8')
    target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(content)
    inventory.append({'path':relative.as_posix(),'source_sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'sha256':hashlib.sha256(content).hexdigest()})
# This one explicit input is a public postal road/building reference, never clinical data.
road=source/'.local'/'public-data'/'roads-capital.sqlite'
data=road.read_bytes(); target=destination/'resources'/'roads-capital.sqlite.gz'; target.parent.mkdir(parents=True,exist_ok=True)
target.write_bytes(gzip.compress(data,compresslevel=6,mtime=0))
inventory.append({'path':'resources/roads-capital.sqlite.gz','source':'https://www.epost.go.kr/search/zipcode/areacdAddressDown.jsp','source_sha256':hashlib.sha256(data).hexdigest(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
(destination/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'files':len(inventory),'bytes':sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()),'patient_files_copied':0}))
