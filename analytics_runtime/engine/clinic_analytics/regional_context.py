"""Public resident statistics, kept separate from patient aggregates."""
import csv
import hashlib
import json
import re
from collections import defaultdict,Counter
from datetime import date,datetime
from pathlib import Path
from .loader import KST

SOURCE_URL='https://www.data.go.kr/data/15099158/fileData.do'
POPULATION_FILE=Path(__file__).resolve().parents[1]/'static'/'data'/'population-seoul.json'
PROVINCES={'11':'서울특별시','28':'인천광역시','41':'경기도'}


def parse_population(stream,index):
    reader=csv.DictReader(stream)
    columns=reader.fieldnames or []
    required={'법정동코드','기준연월','시도명','시군구명','읍면동명','계','남자','여자'}
    if not required.issubset(columns):raise ValueError('Missing public population columns')
    age_columns=[]
    for column in columns:
        match=re.fullmatch(r'(\d+)세(이상)?\s*(남자|여자)',column)
        if match:age_columns.append((column,int(match.group(1)),match.group(3),bool(match.group(2))))
    if not age_columns:raise ValueError('Missing age columns')
    period=None;seen=set();mapped={};districts=defaultdict(list);groups=defaultdict(list);source_rows=0;province_rows=Counter()
    def number(value):
        value=int(str(value).replace(',',''))
        if value<0:raise ValueError('Negative population')
        return value
    for row in reader:
        code=row['법정동코드'].strip()
        if code[:2] not in PROVINCES:continue
        if not re.fullmatch(r'\d{10}',code) or code[5:8]=='000':raise ValueError('Unexpected public legal region level')
        if code in seen:raise ValueError('Duplicate public region code')
        seen.add(code);source_rows+=1;province_rows[code[:2]]+=1
        observed=date.fromisoformat(row['기준연월']).isoformat()
        if period and period!=observed:raise ValueError('Mixed public data periods')
        period=observed
        total,male,female=(number(row[key]) for key in ('계','남자','여자'))
        if total!=male+female:raise ValueError('Sex totals do not reconcile')
        age_sum={'남자':0,'여자':0};weighted={'남자':0,'여자':0};bands=defaultdict(int)
        for column,age,sex,open_ended in age_columns:
            count=number(row[column]);age_sum[sex]+=count;weighted[sex]+=age*count
            bands['100세 이상' if age>=100 else f'{age//10*10}대']+=count
        if age_sum!={'남자':male,'여자':female}:raise ValueError('Age totals do not reconcile')
        short=code[:8];name=' '.join(row[key].strip() for key in ('시도명','시군구명','읍면동명') if row[key].strip())
        groups[short].append({'code':code,'name':name,'ri':row.get('리명','').strip(),'population':total,'male':male,'female':female,'weighted_male':weighted['남자'],'weighted_female':weighted['여자'],'bands':dict(bands)})
    exclusions=[]
    for code,items in groups.items():
        direct=[item for item in items if item['code'].endswith('00')];children=[item for item in items if not item['code'].endswith('00')]
        names={item['name'] for item in items};reason=None
        if direct and children:reason='mixed_parent_and_ri'
        elif len(names)!=1:reason='conflicting_names'
        elif index.names['emd'].get(code)!=items[0]['name']:reason='code_or_name_mismatch'
        elif children and (not items[0]['name'].endswith(('읍','면')) or any(not item['ri'] for item in children)):reason='unverified_ri_level'
        elif direct and (code[5]!='1' or direct[0]['ri']):reason='unverified_direct_level'
        if reason:
            exclusions.append({'code':code,'name':items[0]['name'],'reason':reason,'rows':len(items)});continue
        item={key:sum(r[key] for r in items) for key in ('population','male','female','weighted_male','weighted_female')}
        item.update(name=items[0]['name'],bands=defaultdict(int),complete=not children,aggregation='published_ri_sum' if children else 'direct_dong',source_rows=len(items),included_ris=len(children),expected_ris=None)
        for row in items:
            for label,value in row['bands'].items():item['bands'][label]+=value
        mapped[code]=item;districts[code[:5]].append((code,item))
    def public(item):
        return {key:value for key,value in item.items() if key not in ('weighted_male','weighted_female','bands')}|{
            'average_age':round((item['weighted_male']+item['weighted_female'])/item['population'],1) if item['population'] else None,
            'male_average_age':round(item['weighted_male']/item['male'],1) if item['male'] else None,
            'female_average_age':round(item['weighted_female']/item['female'],1) if item['female'] else None,
            'age_bands':[{'label':label,'value':item['bands'].get(label,0)} for label in [f'{n}대' for n in range(0,100,10)]+['100세 이상']]}
    sig={}
    for code,items in districts.items():
        expected={key for key in index.names['emd'] if key.startswith(code)};included={key for key,_ in items}
        item={key:sum(row[key] for _,row in items) for key in ('population','male','female','weighted_male','weighted_female')}
        excluded=sum(x['code'].startswith(code) for x in exclusions)
        item.update(name=index.names['sig'].get(code,code),complete=expected==included and not excluded and all(row['complete'] for _,row in items),included_dongs=len(included),boundary_dongs=len(expected),excluded_groups=excluded,ri_aggregated_dongs=sum(row['aggregation']=='published_ri_sum' for _,row in items),aggregation='mapped_emd_sum',bands=defaultdict(int))
        for _,row in items:
            for label,value in row['bands'].items():item['bands'][label]+=value
        sig[code]=public(item)
    province_summary={prefix:{'name':name,'source_rows':province_rows[prefix],'source_groups':sum(c.startswith(prefix) for c in groups),'mapped_dongs':sum(c.startswith(prefix) for c in mapped),'boundary_dongs':sum(c.startswith(prefix) for c in index.names['emd']),'excluded_groups':sum(x['code'].startswith(prefix) for x in exclusions),'ri_aggregated_dongs':sum(c.startswith(prefix) and item['aggregation']=='published_ri_sum' for c,item in mapped.items())} for prefix,name in PROVINCES.items()}
    return {'as_of':period,'scope':'서울·인천·경기 · 코드와 명칭이 일치하는 공개 법정읍면동','source_url':SOURCE_URL,'source':'행정안전부 주민등록 인구통계',
            'age_note':'평균 연령은 단일연령별 인구의 가중평균입니다. 110세 이상은 110세로 계산한 근사값입니다.',
            'district_note':'시군구 값은 지도에 연결된 공개 법정읍면동 인구 합계입니다. 누락 지역은 0명으로 채우지 않습니다. 공개 리 합계가 포함되면 전체 인구로 확정하지 않습니다.',
            'ri_note':'읍·면의 공개 리 자료만 합산했습니다. 전체 리 포함 여부가 확인되지 않아 해당 읍·면의 총인구로 확정하지 않습니다.',
            'boundary_note':'고정 지도와 최신 통계의 코드·전체 명칭이 일치하는 곳만 연결합니다. 같은 코드라도 경계 자체의 동일성을 보장하지 않습니다.',
            'coverage_definition':'complete는 공개자료 연결 범위에 대한 표시이며 시점별 도형 경계의 동일성을 뜻하지 않습니다.',
            'source_rows':source_rows,'source_groups':len(groups),'mapped_dongs':len(mapped),'boundary_dongs':sum(k[:2] in PROVINCES for k in index.names['emd']),
            'unmatched':len(exclusions),'exclusion_counts':dict(Counter(x['reason'] for x in exclusions)),'exclusions':exclusions,'province_summary':province_summary,'regions':{'emd':{code:public(item) for code,item in mapped.items()},'sig':sig}}


def read_context(path=POPULATION_FILE):
    checked=datetime.now(KST).isoformat()
    try:
        data=Path(path).read_bytes();context=json.loads(data)
        date.fromisoformat(context['as_of'])
        if not isinstance(context['regions']['emd'],dict) or not isinstance(context['regions']['sig'],dict):raise ValueError
        return {**context,'connected':True,'checked_at':checked,'file_sha256':hashlib.sha256(data).hexdigest()}
    except (OSError,ValueError,KeyError,TypeError):
        return {'connected':False,'checked_at':checked,'regions':{'emd':{},'sig':{}},'error':'공개 인구 자료를 확인하지 못했습니다.'}
