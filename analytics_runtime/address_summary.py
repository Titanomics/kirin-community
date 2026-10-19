"""Validated aggregate-only reports. No invented receipts, identities or revenue."""
import hashlib
import io
import json
import math
import re
import zipfile
from collections import Counter
from datetime import datetime,timezone,timedelta
from html import escape
from itertools import islice
from pathlib import Path
import openpyxl

PERIOD=re.compile(r'20\d{2}-(?:0[1-9]|1[0-2])')
WEB=Path(__file__).parent/'web'

class SummaryError(ValueError):pass

def norm(value):return re.sub(r'\s+','',str(value or ''))
def count(value):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or int(value)!=value or not 0<=value<=100_000_000:
        raise SummaryError('환자 기록 건수는 0 이상의 정수여야 합니다.')
    return int(value)

def parse_workbook(data,*,period,source_name):
    if not isinstance(period,str) or not PERIOD.fullmatch(period):raise SummaryError('자료의 연월을 지정해 주세요.')
    if not 0<len(data)<=25*1024*1024:raise SummaryError('엑셀 크기를 확인해 주세요.')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if len(archive.infolist())>2000 or sum(v.file_size for v in archive.infolist())>50*1024*1024:raise SummaryError('엑셀 내용이 너무 큽니다.')
        for item in archive.infolist():
            if item.filename.endswith(('.xml','.rels')) and any(v in archive.read(item).upper() for v in (b'<!DOCTYPE',b'<!ENTITY')):raise SummaryError('지원하지 않는 엑셀 형식입니다.')
    # Read Excel's cached values without executing formulas. Independently sum
    # every detail row and reconcile the total/ranking; missing caches fail closed.
    book=openpyxl.load_workbook(io.BytesIO(data),read_only=True,data_only=True,keep_links=False)
    rows=[];declared=None;ranked=None;title='';found=False
    try:
        for sheet in book:
            if (sheet.max_row or 0)>5000 or (sheet.max_column or 0)>50:raise SummaryError('집계표의 행·열 범위가 너무 큽니다.')
            values=list(islice(sheet.iter_rows(values_only=True,max_col=50),5001))
            if len(values)>5000:raise SummaryError('집계 행 수가 너무 많습니다.')
            for offset,row in enumerate(values[:20]):
                headers=[norm(v) for v in row]
                if {'아파트명','도로명주소','환자기록(건)'}.issubset(headers):
                    if found:raise SummaryError('주소 집계표가 중복되어 있습니다.')
                    found=True;title=str(values[0][0] or '')[:200]
                    name_i,address_i,count_i=[headers.index(v) for v in ('아파트명','도로명주소','환자기록(건)')]
                    for value in values[offset+1:]:
                        if not any(v is not None for v in value):continue
                        name,address,amount=(value[i] if i<len(value) else None for i in (name_i,address_i,count_i))
                        if not name and '합계' in str(address):
                            if declared is not None:raise SummaryError('합계가 중복되어 있습니다.')
                            declared=count(amount);continue
                        if name is None or address is None:raise SummaryError('단지명 또는 주소가 없는 집계 행입니다.')
                        rows.append({'name':str(name).strip(),'address':str(address).strip(),'records':count(amount)})
                    break
                if {'순위','아파트명','환자기록(건)'}.issubset(headers):
                    if ranked is not None:raise SummaryError('순위 집계표가 중복되어 있습니다.')
                    ni,ci=headers.index('아파트명'),headers.index('환자기록(건)')
                    ranked=[(str(r[ni]).strip(),count(r[ci])) for r in values[offset+1:] if any(v is not None for v in r)]
                    break
    finally:book.close()
    total=sum(r['records'] for r in rows)
    if not rows or len(rows)>2000 or total<=0 or declared!=total:raise SummaryError('단지별 합계와 원본 합계가 일치하지 않습니다.')
    if len({r['name'] for r in rows})!=len(rows):raise SummaryError('단지명이 중복되어 있습니다.')
    if ranked is not None and Counter(ranked)!=Counter((r['name'],r['records']) for r in rows):raise SummaryError('주소 집계와 순위 시트의 수치가 일치하지 않습니다.')
    report={'version':1,'period':period,'measure':'신규환자 기록' if '신규환자' in norm(title) else '환자 기록',
        'rows':rows,'total_records':total,'source_name':Path(source_name).name,'source_sha256':hashlib.sha256(data).hexdigest(),
        'source_title':title,'period_basis':'원본에 기간이 없어 제공자가 확인한 연월','prepared_at':datetime.now(timezone.utc).isoformat(),
        'ranking_verified':ranked is not None}
    validate_report(report);return report

def validate_report(report,clinic_id=None):
    if not isinstance(report,dict) or report.get('version')!=1 or not PERIOD.fullmatch(str(report.get('period',''))):raise SummaryError('저장된 집계 기간을 확인할 수 없습니다.')
    if clinic_id and report.get('clinic_id')!=clinic_id:raise SummaryError('집계 자료의 병원이 일치하지 않습니다.')
    rows=report.get('rows')
    if not isinstance(rows,list) or not 1<=len(rows)<=2000:raise SummaryError('집계 행 수가 올바르지 않습니다.')
    for row in rows:
        if not isinstance(row,dict):raise SummaryError('집계 행이 올바르지 않습니다.')
        for key,limit in (('name',160),('address',300)):
            if not isinstance(row.get(key),str) or not 0<len(row[key])<=limit:raise SummaryError('집계 항목을 확인할 수 없습니다.')
        count(row.get('records'))
    if len({r['name'] for r in rows})!=len(rows) or sum(r['records'] for r in rows)!=count(report.get('total_records')) or report['total_records']<=0:raise SummaryError('저장된 집계 합계가 올바르지 않습니다.')
    return report

def enrich_regions(report,index,clinic_address=''):
    validate_report(report)
    for row in report['rows']:
        match=index.match(row['address']);code=match['emd']
        row.update(region_code=code,region_name=index.names['emd'].get(code,'법정동 미확인'),match_method=match['method'])
    clinic_region=index.match(clinic_address) if clinic_address else {}
    districts={r['region_code'][:5] for r in report['rows'] if r.get('region_code')}
    if clinic_region.get('sig'):districts.add(clinic_region['sig'])
    report['geometry']=[f for f in index.features['emd'] if f['properties']['SIG_CD'] in districts]
    report['clinic_address']=clinic_address;report['clinic_region']=clinic_region.get('emd')
    report['boundary_date']=index.provenance.get('boundary_date')
    report['address_reference_date']=index.address_source.get('as_of')
    return report

def read_reports(root,clinic_id):
    result={}
    for path in sorted((Path(root)/'address-reports').glob('*.json')):
        if not PERIOD.fullmatch(path.stem) or path.stat().st_size>4*1024*1024:raise SummaryError('저장된 집계 파일을 확인할 수 없습니다.')
        report=validate_report(json.loads(path.read_text('utf8')),clinic_id)
        if report['period']!=path.stem:raise SummaryError('집계 파일의 기간이 일치하지 않습니다.')
        result[path.stem]=report
    return result

def map_svg(report):
    features=report.get('geometry',[])
    if not features:return '<p class="muted">확인된 지도 경계가 없습니다. 주소별 표를 확인해 주세요.</p>'
    totals=Counter()
    for row in report['rows']:
        if row.get('region_code'):totals[row['region_code']]+=row['records']
    def rings(feature):
        geometry=feature['geometry'];coords=geometry['coordinates']
        return coords if geometry['type']=='Polygon' else [ring for polygon in coords for ring in polygon] if geometry['type']=='MultiPolygon' else []
    coordinates=[xy for feature in features for ring in rings(feature) for xy in ring]
    if not coordinates:return ''
    # Equirectangular local projection; the map represents legal-dong totals, not building pins.
    cosine=math.cos(math.radians(sum(p[1] for p in coordinates)/len(coordinates)))
    xs=[p[0]*cosine for p in coordinates];ys=[p[1] for p in coordinates]
    x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys);scale=min(700/max(x1-x0,.001),430/max(y1-y0,.001))
    paths=[]
    for feature in features:
        props=feature['properties'];code=props['EMD_CD'];amount=totals.get(code,0)
        name=props['FULL_NM'];d=' '.join('M'+'L'.join(f'{40+(p[0]*cosine-x0)*scale:.2f},{30+(y1-p[1])*scale:.2f}' for p in ring)+'Z' for ring in rings(feature))
        color=f'hsl(266 68% {88-48*amount/max(totals.values(),default=1):.1f}%)' if amount else 'transparent'
        title=f'{name} · {amount:,}건' if amount else f'{name} · 자료 없음'
        if code==report.get('clinic_region'):title+=' · 병원 소재 법정동'
        paths.append(f'<path d="{d}" fill="{color}" fill-rule="evenodd" class="region" data-region="{escape(code)}" tabindex="0" role="button" aria-label="{escape(title)}"><title>{escape(title)}</title></path>')
    return '<svg viewBox="0 0 780 500" role="group" aria-label="법정동별 환자 기록 지도">'+''.join(paths)+'</svg>'

def render_report(report,clinic,*,embedded=False,periods=(),checked_at=None):
    validate_report(report,clinic['id'] if report.get('clinic_id') else None)
    esc=lambda value:escape(str(value),quote=True)
    total=report['total_records'];rows=sorted(report['rows'],key=lambda r:(-r['records'],r['name']));period=report['period']
    top=sum(r['records'] for r in rows[:2]);mapped=sum(r['records'] for r in rows if r.get('region_code'))
    chart=''.join(f'<button class="bar-row" data-pick="{i}" data-region="{esc(r.get("region_code") or "")}"><span class="rank">{i+1:02}</span><span class="bar-name">{esc(r["name"])}</span><span class="track"><i style="width:{100*r["records"]/max(rows[0]["records"],1):.3f}%"></i></span><strong>{r["records"]:,}<small>건 · {100*r["records"]/total:.1f}%</small></strong></button>' for i,r in enumerate(rows))
    table=''.join(f'<tr data-row="{i}" data-region="{esc(r.get("region_code") or "")}"><td>{i+1}</td><th scope="row">{esc(r["name"])}</th><td>{esc(r["address"])}</td><td>{esc(r.get("region_name","미확인"))}</td><td class="number">{r["records"]:,}</td><td class="number">{100*r["records"]/total:.2f}%</td></tr>' for i,r in enumerate(rows))
    base='/api/hospital-analytics/runtime/'+clinic['id']
    controls=f'<a class="button primary" href="{base}/api/address-reports/{period}/html" download>HTML 내려받기</a><button class="button" id="print">PDF 인쇄</button>' if embedded else '<button class="button" id="print">PDF 인쇄</button>'
    selector='<nav class="periods" aria-label="분석 기간">'+''.join(f'<a class="{"current" if month==period else ""}" href="{base}/index.html?month={month}">{month}</a>' for month in periods)+'</nav>' if embedded else ''
    checked=f'<span>저장자료 확인 {esc(checked_at)}</span>' if checked_at else '<span>다운로드한 시점의 저장 보고서 · 인터넷 연결 없이 열람 가능</span>'
    template=(WEB/'address-summary.html').read_text('utf8')
    prepared=report.get('prepared_at','')
    if prepared:
        prepared=datetime.fromisoformat(prepared).astimezone(timezone(timedelta(hours=9))).strftime('%Y-%m-%d %H:%M:%S KST')
    data={'TITLE':esc(clinic['name']),'PERIOD':esc(period),'ADDRESS':esc(report.get('clinic_address','')),
        'MEASURE':esc(report.get('measure','환자 기록')),'TOTAL':f'{total:,}','COMPLEXES':str(len(rows)),
        'TOP_SHARE':f'{100*top/total:.1f}','TOP_RECORDS':f'{top:,}','MAPPED':f'{mapped:,}',
        'CHART':chart,'TABLE':table,'MAP':map_svg(report),'CONTROLS':controls,'PERIODS':selector,'CHECKED':checked,
        'SOURCE':esc(report.get('source_name','')),'HASH':esc(report.get('source_sha256','')),
        'BOUNDARY':esc(report.get('boundary_date') or '미확인'),'REFERENCE':esc(report.get('address_reference_date') or '미확인'),
        'VALIDATION':'두 시트의 순위·건수를 대조하고 주소 집계표를 한 번만 합산했습니다.' if report.get('ranking_verified') else '주소 집계표의 각 단지 기록과 전체 합계를 대조했습니다.',
        'PREPARED':esc(prepared),'SCRIPT':(WEB/'address-summary.js').read_text('utf8')}
    # One pass: workbook text containing template-like tokens is never substituted again.
    return re.sub(r'\{\{([A-Z_]+)\}\}',lambda m:data[m[1]],template)
