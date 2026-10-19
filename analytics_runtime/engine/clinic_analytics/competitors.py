"""Verified public dental-license context, independent of patient data."""
import hashlib
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from .loader import KST

COMPETITOR_FILE=Path(__file__).resolve().parents[1]/'static'/'data'/'competitors-seoul.json'


def build_competitor_context(inputs,index):
    facilities={};groups={level:defaultdict(list) for level in ('sig','emd')};seen={};sources=[]
    counts={'source_rows':0,'active_dental':0,'excluded_status_or_type':0,'duplicate_rows':0,'conflicting_addresses':0}
    required={'관리번호','사업장명','업태구분명','영업상태코드','상세영업상태코드','지번주소','도로명주소','데이터갱신일자'}
    for rows,source in inputs:
        sources.append(source)
        for row in rows:
            if not required.issubset(row):raise ValueError('Public license columns are missing')
            counts['source_rows']+=1
            kinds={str(row.get(k) or '').strip() for k in ('업태구분명','의료기관종별명')}-{''}
            if not kinds&{'치과의원','치과병원'}:continue
            key=source['dataset']+':'+row['관리번호'].strip()
            if not row['관리번호'].strip():raise ValueError('Missing public facility identifier')
            if key in seen:
                if seen[key]!=row:raise ValueError('Conflicting public facility identifier')
                counts['duplicate_rows']+=1;continue
            seen[key]=row
            active=row['영업상태코드'].strip()=='01' and row['상세영업상태코드'].strip()=='13'
            if len(kinds)!=1 or not active or any(str(row.get(k) or '').strip() for k in ('폐업일자','인허가취소일자','휴업시작일자')):
                counts['excluded_status_or_type']+=1;continue
            kind=next(iter(kinds));name=row['사업장명'].strip()
            if not name:raise ValueError('Missing public facility name')
            counts['active_dental']+=1
            addresses=[index.match(row[k]) for k in ('지번주소','도로명주소') if row[k].strip()]
            codes={level:{a[level] for a in addresses if a[level]} for level in groups}
            conflict=any(len(values)>1 for values in codes.values()) or any(a.get('reason')=='conflicting_evidence' for a in addresses)
            if conflict:counts['conflicting_addresses']+=1
            region={level:next(iter(values)) if len(values)==1 and not conflict else None for level,values in codes.items()}
            if region['sig'] and not region['sig'].startswith('11'):region={'sig':None,'emd':None}
            facilities[key]={'name':name,'kind':kind,'address':row['도로명주소'].strip() or row['지번주소'].strip(),
                'licensed_at':row.get('인허가일자','').strip(),'updated_at':row['데이터갱신일자'].strip(),
                'status':'자료상 영업중','source':source['dataset'],'region':region}
            for level,code in region.items():
                if code:groups[level][code].append(key)
    for level in groups:
        counts['matched_'+level]=sum(len(keys) for keys in groups[level].values())
        counts['unmatched_'+level]=counts['active_dental']-counts['matched_'+level]
    return {**counts,'scope':'서울','sources':sources,'built_at':datetime.now(KST).isoformat(),
        'boundary_version':index.provenance['boundary_date'],'facilities':facilities,'regions':{level:dict(value) for level,value in groups.items()},
        'note':'공개 인허가 자료상 영업중인 치과의원·치과병원입니다. 분석 중인 병원도 포함될 수 있고 종합병원 치과 진료과는 포함하지 않습니다. 현장 영업 여부·진료 역량·시장 점유율을 뜻하지 않습니다.'}


def read_competitors(path=COMPETITOR_FILE):
    checked=datetime.now(KST).isoformat()
    try:
        raw=Path(path).read_bytes();data=json.loads(raw)
        if data['scope']!='서울' or not isinstance(data['facilities'],dict) or not data['sources']:raise ValueError
        for level in ('sig','emd'):
            if not isinstance(data['regions'][level],dict):raise ValueError
            if any(key not in data['facilities'] for keys in data['regions'][level].values() for key in keys):raise ValueError
        return {**data,'connected':True,'checked_at':checked,'file_sha256':hashlib.sha256(raw).hexdigest()}
    except (OSError,ValueError,TypeError,KeyError):
        return {'connected':False,'checked_at':checked,'facilities':{},'regions':{'sig':{},'emd':{}}}
