"""Dated public district context. Never geocodes or reads patient data."""
import calendar
import hashlib
import json
import re
from datetime import date,datetime
from decimal import Decimal,InvalidOperation
from pathlib import Path
from .loader import KST

MARKET_FILE=Path(__file__).resolve().parents[1]/'static'/'data'/'market-context.json'
SPECS={
    'workers':{'dataset':'OA-22185','label':'추정 직장인구','unit':'명',
        'note':'자치구에 직장이 있는 인구의 추정치입니다. 연 1회 4분기 갱신 후 다음 1~3분기에 같은 값이 제공됩니다. 분기별 증감으로 해석하지 않습니다.'},
    'stores':{'dataset':'OA-22173','label':'제공 업종 점포 합계','unit':'곳',
        'note':'파일에 제공된 업종의 전체 점포(일반+프랜차이즈) 합계입니다. 모든 사업체 수나 치과 경쟁기관 수를 뜻하지 않습니다.'},
    'consumption':{'dataset':'OA-22167','label':'추정 의료비 지출 총액','unit':'원',
        'note':'자치구 공개 추정치입니다. 1인당·월평균·치과만의 지출이 아닙니다. 연 1회 4분기 갱신 후 다음 1~3분기에는 같은 값이 제공됩니다.'},
    'income':{'dataset':'3046077','label':'국민연금 지역가입자 평균소득월액','unit':'원',
        'note':'사업장가입자를 제외한 지역가입자의 신고소득 기준 지표입니다. 전체 주민·가구의 평균소득이나 구매력을 뜻하지 않습니다.'}
}
for _kind,_spec in SPECS.items():
    _spec['source_url']=('https://www.data.go.kr/data/3046077/fileData.do' if _kind=='income' else f"https://data.seoul.go.kr/dataList/{_spec['dataset']}/S/1/datasetView.do")
    _spec['provider']='국민연금공단' if _kind=='income' else '서울시·서울신용보증재단 상권분석서비스'

POLICY='환자 조회 종료일 이전에 끝난 제공 기간 중 가장 최근 값을 선택합니다. 조회기간 전체 합계가 아니며, 현재 내려받은 수정 자료이므로 당시 공개된 값과 다를 수 있습니다.'
BOUNDARY_NOTE='코드와 전체 지역 명칭을 대조했습니다. 통계 시점과 지도 경계 시점의 동일성은 보장하지 않습니다. 법정동에는 상위 시군구 참고값으로만 표시합니다.'

def number(raw):
    try:value=Decimal(str(raw).strip().replace(',',''))
    except InvalidOperation as exc:raise ValueError('Invalid public numeric value') from exc
    if not value.is_finite() or value<0 or value!=value.to_integral_value() or value>10**16:raise ValueError('Invalid public integer')
    return int(value)

def period(raw,kind):
    if kind=='income':
        if not re.fullmatch(r'20\d{2}-(?:0[1-9]|1[0-2])',raw):raise ValueError('Invalid income month')
        year,month=map(int,raw.split('-'));label=f'{year}년 {month}월'
    else:
        if not re.fullmatch(r'20\d{2}[1-4]',raw):raise ValueError('Invalid public quarter')
        year=int(raw[:4]);quarter=int(raw[4]);month=quarter*3;label=f'{year}년 {quarter}분기'
    return {'period':label,'period_end':date(year,month,calendar.monthrange(year,month)[1]).isoformat()}

def build_market(inputs,index):
    names={code:name for code,name in index.names['sig'].items() if code[:2] in ('11','28','41')}
    compact={re.sub(r'\s+','',name):code for code,name in names.items()}
    series={};sources={}
    for kind,reader,metadata in inputs:
        if kind not in SPECS or kind in series or metadata['dataset']!=SPECS[kind]['dataset']:raise ValueError('Unexpected or duplicate public dataset')
        if kind=='income':required={'기준년월','시군구','평균소득월액'}
        else:
            geo='행정동' if kind=='consumption' else '자치구'
            required={'기준_년분기_코드',geo+'_코드',geo+'_코드_명'}
            required.update({'workers':{'총_직장_인구_수','남성_직장_인구_수','여성_직장_인구_수'},
                'stores':{'서비스_업종_코드','서비스_업종_코드_명','전체_점포_수','일반_점포_수','프랜차이즈_점포_수'},
                'consumption':{'지출_총금액','의료비_지출_총금액'}}[kind])
        if not required.issubset(reader.fieldnames or []):raise ValueError('Missing public market columns')
        seen=set();records={};source_rows=0;unmatched=0;industries={}
        for row in reader:
            source_rows+=1
            if any(row.get(k) is None or not row[k].strip() for k in required):raise ValueError('Empty public market field')
            raw_period=row['기준년월' if kind=='income' else '기준_년분기_코드'].strip();stamp=period(raw_period,kind)
            if kind=='income':
                region=re.sub(r'\s+','',row['시군구']);code=compact.get(region);value=number(row['평균소득월액']);identity=region
            else:
                code=row[geo+'_코드'].strip();identity=code
                if kind=='workers':
                    value=number(row['총_직장_인구_수'])
                    if value!=number(row['남성_직장_인구_수'])+number(row['여성_직장_인구_수']):raise ValueError('Worker totals do not reconcile')
                elif kind=='stores':
                    value=number(row['전체_점포_수'])
                    if value!=number(row['일반_점포_수'])+number(row['프랜차이즈_점포_수']):raise ValueError('Store totals do not reconcile')
                    industry=row['서비스_업종_코드'].strip();label=row['서비스_업종_코드_명'].strip()
                    if not re.fullmatch(r'CS\d{6}',industry):raise ValueError('Unexpected store industry code')
                    if industries.setdefault(industry,label)!=label:raise ValueError('Conflicting industry labels')
                    identity=(code,industry)
                else:
                    value=number(row['의료비_지출_총금액'])
                    if value>number(row['지출_총금액']):raise ValueError('Medical spending exceeds all spending')
                # The consumption CSV calls its district field 행정동. Accept only verified 5-digit district codes.
                if not re.fullmatch(r'11\d{3}',code) or names.get(code)!='서울특별시 '+row[geo+'_코드_명'].strip():code=None
            key=(raw_period,identity)
            if key in seen:raise ValueError('Duplicate public market record')
            seen.add(key)
            if code is None:unmatched+=1;continue
            bucket=records.setdefault(code,{})
            if kind=='stores':
                item=bucket.setdefault(raw_period,{**stamp,'value':0,'industry_count':0})
                item['value']+=value;item['industry_count']+=1
            else:bucket[raw_period]={**stamp,'value':value}
        if not source_rows:raise ValueError('Empty public dataset')
        series[kind]={code:sorted(items.values(),key=lambda x:x['period_end']) for code,items in records.items()}
        sources[kind]={**{k:metadata[k] for k in ('dataset','downloaded_at','sha256','license')},
            'source_page_updated_date':metadata.get('source_page_updated_date'),
            'source_rows':source_rows,'matched_rows':source_rows-unmatched,'unmatched_rows':unmatched,
            'matched_districts':len(records),'industries':industries}
    return {'version':1,'district_names':names,'series':series,'sources':sources,'policy':POLICY,'boundary_note':BOUNDARY_NOTE}

def read_market(path=MARKET_FILE):
    checked=datetime.now(KST).isoformat()
    try:
        raw=Path(path).read_bytes();data=json.loads(raw)
        if data['version']!=1 or not isinstance(data['district_names'],dict) or not isinstance(data['series'],dict) or not data['series']:raise ValueError
        if not isinstance(data['sources'],dict) or set(data['series'])!=set(data['sources']):raise ValueError
        provinces={'11':'서울특별시','28':'인천광역시','41':'경기도'}
        for code,name in data['district_names'].items():
            if not re.fullmatch(r'(?:11|28|41)\d{3}',code) or not isinstance(name,str) or not name.startswith(provinces[code[:2]]+' '):raise ValueError
        for kind,regions in data['series'].items():
            if kind not in SPECS or data['sources'][kind]['dataset']!=SPECS[kind]['dataset']:raise ValueError
            source=data['sources'][kind]
            if not re.fullmatch(r'[0-9a-f]{64}',source['sha256']) or not isinstance(source['license'],str):raise ValueError
            if datetime.fromisoformat(source['downloaded_at']).tzinfo is None:raise ValueError
            if source.get('source_page_updated_date') is not None:date.fromisoformat(source['source_page_updated_date'])
            for key in ('source_rows','matched_rows','unmatched_rows','matched_districts'):
                if type(source[key])!=int or source[key]<0:raise ValueError
            if source['source_rows']!=source['matched_rows']+source['unmatched_rows'] or not source['source_rows']:raise ValueError
            if not isinstance(regions,dict) or len(regions)!=source['matched_districts']:raise ValueError
            for code,rows in regions.items():
                if code not in data['district_names'] or not isinstance(rows,list) or not rows:raise ValueError
                if kind!='income' and not code.startswith('11'):raise ValueError
                ends=[]
                for row in rows:
                    end=date.fromisoformat(row['period_end']);ends.append(row['period_end'])
                    if type(row['value'])!=int or not 0<=row['value']<=10**16:raise ValueError
                    raw_period=f'{end.year}-{end.month:02d}' if kind=='income' else f'{end.year}{(end.month+2)//3}'
                    if period(raw_period,kind)!={key:row[key] for key in ('period','period_end')}:raise ValueError
                    if kind=='stores' and (type(row['industry_count'])!=int or row['industry_count']<1):raise ValueError
                if ends!=sorted(set(ends)):raise ValueError
        return {**data,'connected':True,'checked_at':checked,'file_sha256':hashlib.sha256(raw).hexdigest()}
    except (OSError,ValueError,KeyError,TypeError,AttributeError):
        return {'connected':False,'checked_at':checked,'error':'지역 상권 참고자료를 확인하지 못했습니다.'}

def region_market(data,level,code,end):
    date.fromisoformat(end)
    if not data.get('connected'):return None
    if level not in ('sig','emd') or not re.fullmatch(r'\d{5}' if level=='sig' else r'\d{8}',code):raise ValueError('Invalid market region')
    district=code[:5];name=data['district_names'].get(district)
    if not name:return None
    indicators=[]
    for kind,spec in SPECS.items():
        rows=data['series'].get(kind,{}).get(district,[])
        eligible=[row for row in rows if row['period_end']<=end]
        selected=max(eligible,key=lambda r:r['period_end']) if eligible else None
        source=data['sources'].get(kind)
        indicators.append({'id':kind,**spec,'status':'available' if selected else 'after_query_end' if rows else 'unavailable',
            'value':None,'period':None,'period_end':None,**(selected or {}),
            'latest_period':rows[-1]['period'] if rows else None,
            'latest_period_end':rows[-1]['period_end'] if rows else None,
            'source':{k:source.get(k) for k in ('dataset','downloaded_at','source_page_updated_date','sha256','license')} if source else None})
    return {'district_code':district,'district_name':name,'relation':'parent_district' if level=='emd' else 'same_district',
        'selection_end':end,'policy':POLICY,'boundary_note':BOUNDARY_NOTE,'indicators':indicators}

def dashboard_market(data,end):
    if not data.get('connected'):return data
    return {'connected':True,'checked_at':data['checked_at'],'file_sha256':data['file_sha256'],'selection_end':end,
        'policy':POLICY,'boundary_note':BOUNDARY_NOTE,
        'districts':{code:region_market(data,'sig',code,end) for code in data['district_names']},
        'coverage':{kind:{k:source[k] for k in ('source_rows','matched_rows','unmatched_rows','matched_districts')} for kind,source in data['sources'].items()}}
