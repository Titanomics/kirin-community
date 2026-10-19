"""Portable client presentations. Capture aggregate data once; export without I/O to EMR."""
import base64
import binascii
import gzip
import hashlib
import io
import json
from html import escape
from pathlib import Path
from .marketing import CHANNELS
from .loader import DataError
from .report_campaigns import campaign_html
from .report_measurements import measurement_html

STATIC=Path(__file__).resolve().parents[1]/'static'
REGION_KEYS=('code','name','suppressed','patients','new_patients','visits','average_visits','treatment_total','collection_recorded')
METRICS={'patients':'고유환자','new_patients':'신규 환자군','visits':'내원 횟수','treatment_total':'총진료비 · 대사 전','collection_recorded':'기록된 수납액 · 대사 전'}


def capture(snapshot,dashboard):
    """No patient rows, identifiers, source paths or workspace objects cross this boundary."""
    regions={level:[{k:r.get(k) for k in REGION_KEYS} for r in dashboard['regions'][level]] if dashboard['current']['has_data'] else [] for level in ('sig','emd')}
    districts={r['code'] for r in regions['sig']}
    provinces={c[:2] for c in districts}
    def rounded(value):
        return [rounded(v) for v in value] if isinstance(value,list) else round(value,5)
    geometry={}
    for level in ('sig','emd'):
        features=[]
        for f in snapshot.index.features[level]:
            p=f['properties'];code=p['SIG_CD' if level=='sig' else 'EMD_CD']
            if not (code[:2] in provinces if level=='sig' else p['SIG_CD'] in districts):continue
            features.append({'type':'Feature','properties':{'code':code,'name':p['FULL_NM'],'label':p['SIG_KOR_NM' if level=='sig' else 'EMD_KOR_NM']},
                             'geometry':{'type':f['geometry']['type'],'coordinates':rounded(f['geometry']['coordinates'])}})
        geometry[level]={'type':'FeatureCollection','features':features}
    packed=base64.b64encode(gzip.compress(json.dumps(geometry,ensure_ascii=False,separators=(',',':')).encode('utf8'),mtime=0)).decode('ascii')
    return {'version':1,'regions':regions,'geometry_gzip':packed,'coverage':dashboard['region_coverage'],
            'boundary_source':{k:snapshot.index.provenance.get(k) for k in ('source','boundary_date')},
            'geometry_note':'공개 시군구·법정동 경계. 자료 생성 당시 경계를 함께 저장했습니다.'}


def geometry(p):
    if 'geometry' in p:return p['geometry'] # Earlier local snapshots remain readable.
    try:
        value=p['geometry_gzip']
        if not isinstance(value,str) or len(value)>16*1024*1024:raise ValueError
        with gzip.GzipFile(fileobj=io.BytesIO(base64.b64decode(value,validate=True))) as stream:
            raw=stream.read(32*1024*1024+1)
        if len(raw)>32*1024*1024:raise ValueError
        result=json.loads(raw)
        if not isinstance(result,dict) or set(result)!={'sig','emd'}:raise ValueError
        return result
    except (KeyError,ValueError,TypeError,OSError,EOFError,binascii.Error):
        raise DataError('저장된 보고서 지도 경계를 읽지 못했습니다. 보관본을 확인해 주세요.') from None


def assets():
    geometry=(STATIC/'map-layout.js').read_text(encoding='utf-8').replace('export ','')
    script=geometry+'\n'+(STATIC/'presentation.js').read_text(encoding='utf-8')
    digest=base64.b64encode(hashlib.sha256(script.encode('utf-8')).digest()).decode('ascii')
    policy=f"default-src 'none'; script-src 'sha256-{digest}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    return script,(STATIC/'presentation.css').read_text(encoding='utf-8'),policy


def render(report):
    d=report['data'];p=d.get('presentation');script,css,policy=assets()
    esc=lambda v:escape(str(v if v is not None else ''),quote=True)
    def num(v):return '—' if v is None else f'{v:,.2f}'.rstrip('0').rstrip('.') if isinstance(v,float) else f'{v:,}'
    def table(headers,rows):
        return '<div class="table-scroll"><table><thead><tr>'+''.join('<th>'+esc(v)+'</th>' for v in headers)+'</tr></thead><tbody>'+(''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in row)+'</tr>' for row in rows) or '<tr><td colspan="'+str(len(headers))+'">미연결·미관측</td></tr>')+'</tbody></table></div>'
    def region_table(level):
        rows=p['regions'][level] if p else []
        return table(['지역','고유환자','내원 횟수','총진료비 · 원','기록 수납액 · 원'],[[r['name'],*[num(r.get(k)) for k in ('patients','visits','treatment_total','collection_recorded')]] for r in rows])
    cards=''.join('<article class="metric"><span>'+label+'</span><strong>'+num(d['metrics'][k])+('원' if k in ('treatment_total','collection_recorded') and d['metrics'][k] is not None else '')+'</strong><small>'+('비교 불가' if d['changes'][k] is None else '전월 대비 '+str(d['changes'][k])+'%')+'</small></article>' for k,label in METRICS.items())
    comparison=table(['지표','보고월','비교월','증감률'],[[label,num(d['metrics'][k]),num(d['previous'][k]),'비교 불가' if d['changes'][k] is None else str(d['changes'][k])+'%'] for k,label in METRICS.items()])
    costs=table(['캠페인','지출 · 원','환불 · 원','순집행비 · 원'],[[r['title'],num(r['charges']),num(r['refunds']),num(r['net_spend'])] for r in d['costs']['by_campaign']])
    campaigns=table(['캠페인','채널','기간'],[[r['title'],CHANNELS.get(r['channel'],r['channel']),r['start']+' ~ '+r['end']] for r in d['campaigns']])
    # Only a documented display payload is embedded. Never serialize report/workspace wholesale.
    geo=geometry(p) if p is not None else None
    public_p=None if p is None else {'version':p['version'],
        'regions':{level:[{k:r.get(k) for k in REGION_KEYS} for r in p['regions'][level]] for level in ('emd','sig')},
        'geometry':{level:{'type':'FeatureCollection','features':[{'type':'Feature','properties':{k:f['properties'][k] for k in ('code','name','label')},'geometry':{k:f['geometry'][k] for k in ('type','coordinates')}} for f in geo[level]['features']]} for level in ('emd','sig')},
        'coverage':{level:{k:p['coverage'][level].get(k) for k in ('patients','percent')} for level in ('emd','sig')}}
    payload={'presentation':public_p,'has_data':d['has_data'],'metrics':{k:d['metrics'][k] for k in METRICS},'previous':{k:d['previous'][k] for k in METRICS},
             'month':d['month'],'comparison_month':d['comparison_period']['start'][:7],
             'channels':[{k:r.get(k) for k in ('label','patients','visits')} for r in d['channels']]}
    encoded=json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    legacy='<p class="notice">이 보고서는 지도 집계를 저장하기 전에 생성됐습니다. 지도가 필요한 경우 같은 월의 새 보고서를 생성해 주세요.</p>' if not p else ''
    boundary='<p class="muted">경계 출처 '+esc(p.get('boundary_source',{}).get('source','공개 행정경계'))+' · 경계 기준일 '+esc(p.get('boundary_source',{}).get('boundary_date','기존 보관본 확인 필요'))+'</p>' if p else ''
    spend=num(d['costs']['net_spend'])+'원' if d['costs']['entry_count'] else '기록 없음'
    warning='<p class="notice">부분기간 또는 비교자료 부족입니다. 자료 마지막 접수일과 보고기간을 함께 확인해 주세요.</p>' if d['coverage_warning'] or d['comparison_coverage_warning'] else ''
    notes=report.get('notes',{})
    # Reviewer/account identifiers belong to the internal workflow, not the client artifact.
    status='검토 완료' if report['status']=='reviewed' else '검토 전 초안'
    appendix=measurement_html(d.get('measurements'))+campaign_html(d.get('campaign_comparisons'))
    return '''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'''+escape(policy,quote=True)+'''"><title>'''+esc(d['clinic']+' '+d['month']+' 발표 보고서')+'''</title><style>'''+css+'''</style></head><body>
<header class="hero"><div><p class="eyebrow">MONTHLY CLINIC REPORT · '''+esc(status)+'''</p><h1>'''+esc(d['clinic'])+'''</h1><p class="month">'''+esc(d['month'])+''' 월간 마케팅 보고</p><p>조회 '''+esc(d['period']['start']+' ~ '+d['period']['end'])+'''<br>비교 '''+esc(d['comparison_period']['start']+' ~ '+d['comparison_period']['end'])+'''</p></div><div class="hero-aside"><button id="print-report" type="button">PDF 인쇄</button><button id="fullscreen" type="button">전체 화면</button><p>자료 마지막 접수일 '''+esc(d['source_last_record'])+'''<br>원본 확인 '''+esc(d['checked_at'])+'''<br>보고서 생성 '''+esc(report['created_at'])+'''<br>생성 시점에 저장한 자료입니다.</p></div></header>
<nav aria-label="발표 순서"><a href="#overview">01 요약</a><a href="#regions">02 지역 분석</a><a href="#channels">03 유입 경로</a><a href="#execution">04 마케팅 집행</a><a href="#actions">05 다음 행동</a><a href="#evidence">상세 근거</a></nav>
<main>'''+warning+'''<section id="overview"><p class="eyebrow">01 / OVERVIEW</p><h2>이번 달의 변화</h2><div class="metrics">'''+cards+'''</div><article class="panel"><div class="panel-heading"><h3>보고월 · 비교월</h3><label>지표 <select id="chart-metric">'''+''.join('<option value="'+k+'">'+v+'</option>' for k,v in METRICS.items())+'''</select></label></div><div id="comparison-chart" class="bar-chart" aria-live="polite"></div>'''+comparison+'''</article></section>
<section id="regions"><p class="eyebrow">02 / CATCHMENT AREA</p><h2>어느 지역에서 찾아왔나요?</h2><p>고유환자가 많을수록 보라색이 진해집니다. 내원 0명은 채우지 않고, 소수 지역은 회색으로 표시합니다.</p>'''+legacy+'''<div id="map-tools" class="map-tools"><label>지역 단위 <select id="region-level"><option value="emd">법정동</option><option value="sig">시군구</option></select></label><button id="zoom-in" type="button" aria-label="지도 확대">＋</button><button id="zoom-out" type="button" aria-label="지도 축소">−</button><button id="map-focus" type="button" title="고유환자 5명 이상으로 공개된 지역에 맞춰 봅니다">주요 유입 지역</button><button id="map-reset" type="button">전체 지역</button><label>지역 찾기 <select id="region-select"></select></label></div><p id="map-coverage" class="muted"></p><div class="map-layout"><div class="map-wrap"><svg id="region-map" role="group" aria-label="환자 수 지역 지도"></svg><p id="map-empty" hidden></p><div class="legend"><span>내원 0명 · 무색</span><i></i><span>많음</span><span>회색 · 비공개</span></div></div><aside id="region-detail" class="panel" aria-live="polite"><h3>지역을 선택해 주세요</h3><p>지도 또는 지역 목록을 누르면 해당 지역의 환자 수와 금액을 확인할 수 있습니다.</p></aside></div><p class="muted">공개 경계를 함께 담은 오프라인 지도입니다. 주소가 연결된 환자만 표시하며 최근 기록 주소는 내원 당시 주소와 다를 수 있습니다. 금액은 원장 대사 전입니다.</p><details class="region-tables"><summary>지역별 수치 전체 보기 · PDF에 포함</summary><h3>법정동</h3>'''+region_table('emd')+'''<h3>시군구</h3>'''+region_table('sig')+'''</details></section>
<section id="channels"><p class="eyebrow">03 / PATIENT SOURCES</p><h2>내원 경로</h2><p>EMR에 기록된 경로입니다. 광고 전환을 확정한 수치가 아닙니다.</p><div id="channel-chart" class="bar-chart"></div><p id="channel-detail" aria-live="polite">막대를 누르면 내원 횟수를 확인할 수 있습니다.</p></section>
<section id="execution"><p class="eyebrow">04 / EXECUTION</p><h2>마케팅 집행</h2><p class="spend">순집행비 <strong>'''+spend+'''</strong></p><p>거래일 기준 지출 − 환불 · 기록 '''+num(d['costs']['entry_count'])+'''건. 미입력은 실제 비용 0원을 뜻하지 않습니다.</p>'''+costs+campaigns+'''</section>
<section id="actions"><p class="eyebrow">05 / NEXT STEPS</p><h2>해석과 다음 행동</h2><div class="action-grid"><article class="panel"><h3>담당자 해석</h3><p class="prose">'''+esc(notes.get('interpretation') or '담당자 입력 전')+'''</p></article><article class="panel"><h3>다음 행동</h3><p class="prose">'''+esc(notes.get('next_actions') or '담당자 입력 전')+'''</p></article></div></section>
<section id="evidence"><p class="eyebrow">APPENDIX / EVIDENCE</p><h2>상세 근거와 자료 기준</h2>'''+appendix+'''<h3>해석 시 확인할 사항</h3><ul>'''+''.join('<li>'+esc(v)+'</li>' for v in d['limits'])+'''</ul><p>'''+esc(d['definitions']['collection'])+'''</p><p>'''+esc(d['definitions']['suppression'])+'''</p>'''+boundary+'''</section></main><footer>'''+esc(d['clinic']+' · '+d['month'])+''' · 저장된 보고 자료</footer><noscript><p>지도를 클릭하려면 JavaScript를 켜 주세요. 수치 표와 보고 내용은 그대로 확인할 수 있습니다.</p></noscript><script id="presentation-data" type="application/json">'''+encoded+'''</script><script>'''+script+'''</script></body></html>'''
