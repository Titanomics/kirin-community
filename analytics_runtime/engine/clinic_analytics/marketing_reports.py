"""Measured evidence and exportable monthly snapshots; no generative claims."""
import re
from calendar import monthrange
from datetime import date
from html import escape
from .analytics import build_dashboard
from .loader import DataError
from .marketing import CHANNELS,now
from .report_measurements import measurement_html
from .report_campaigns import campaign_html
from .presentation import capture as capture_presentation


def region_evidence(snapshot,level,code,start,end,population,competitors):
    if level not in ('sig','emd') or code not in snapshot.index.names[level]:raise DataError('공식 지도에 있는 지역을 선택해 주세요.')
    d=build_dashboard(snapshot,start=start,end=end)
    item=next((r for r in d['regions'][level] if r['code']==code),None)
    metrics={k:item.get(k) if item else None for k in ('patients','new_patients','visits','average_visits','treatment_total','collection_recorded','change')}
    local=population.get('regions',{}).get(level,{}).get(code) if population.get('connected') else None
    facilities=competitors.get('regions',{}).get(level,{}).get(code,[]) if competitors.get('connected') and code.startswith('11') else None
    return {'region_level':level,'region_code':code,'region_name':snapshot.index.names[level][code],'period':d['period'],'metrics':metrics,
        'suppressed':bool(item and item['suppressed']),'has_matched_records':bool(item),'coverage':d['region_coverage'][level],
        'source_last_record':d['available']['end'],'source_fingerprint':snapshot.fingerprint,'checked_at':d['freshness']['checked_at'],
        'comparison_period':d['comparison_period'],'coverage_warning':d['coverage_warning'],'comparison_coverage_warning':d['comparison_coverage_warning'],
        'previous':{k:item.get('previous',{}).get(k) if item else None for k in metrics},
        'changes':{k:item.get('changes',{}).get(k) if item else None for k in metrics},
        'demographics':item.get('demographics',{}) if item else {},
        'population':{'population':local['population'],'average_age':local['average_age'],'as_of':population['as_of'],'complete':local.get('complete')} if local else None,
        'competitors':{'count':len(facilities),'collected_at':sorted({s['downloaded_at'][:10] for s in competitors['sources']}),'unmatched':competitors['unmatched_'+level]} if facilities is not None else None,
        'limitations':['지역 연결이 확인된 환자 집계입니다.','총진료비·수납액은 원장 대사 전입니다.','공공자료 기준일과 환자 조회기간은 다릅니다.','지역 변화만으로 광고 효과를 확정하지 않습니다.']}


def monthly_report(snapshot,workspace,month):
    if not isinstance(month,str) or not re.fullmatch(r'20\d{2}-(?:0[1-9]|1[0-2])',month):raise DataError('보고할 월을 선택해 주세요.')
    year,number=map(int,month.split('-'));start=f'{month}-01';end=f'{month}-{monthrange(year,number)[1]:02d}'
    previous=date(year-1,12,1) if number==1 else date(year,number-1,1)
    d=build_dashboard(snapshot,start,end,previous.isoformat(),previous.replace(day=monthrange(previous.year,previous.month)[1]).isoformat())
    entries=[x for x in workspace['expenses'] if not x.get('voided') and start<=x['date']<=end]
    campaigns={x['id']:x for x in workspace['campaigns']}
    roots={}
    for entry in entries:
        campaign=campaigns[entry['campaign_id']];root=campaigns[campaign['parent_id']] if campaign.get('parent_id') else campaign
        row=roots.setdefault(root['id'],{'title':root['title'],'charges':0,'refunds':0,'net_spend':0})
        refund=entry['direction']=='refund';row['refunds' if refund else 'charges']+=entry['amount'];row['net_spend']+=(-1 if refund else 1)*entry['amount']
    charges=sum(x['amount'] for x in entries if x['direction']=='charge');refunds=sum(x['amount'] for x in entries if x['direction']=='refund')
    relevant={x['campaign_id'] for x in entries}|{x['id'] for x in campaigns.values() if x['start']<=end and x['end']>=start}
    keys=('patients','new_patients','existing_patients','visits','treatment_total','collection_recorded')
    return {'clinic':snapshot.clinic,'month':month,'period':d['period'],'comparison_period':d['comparison_period'],
        'has_data':d['current']['has_data'],'previous_has_data':d['previous']['has_data'],
        'metrics':{k:d['current'][k] if d['current']['has_data'] else None for k in keys},
        'previous':{k:d['previous'][k] if d['previous']['has_data'] else None for k in keys},
        'changes':{k:d['change'][k] if d['current']['has_data'] and d['previous']['has_data'] else None for k in keys},
        'coverage_warning':d['coverage_warning'],'comparison_coverage_warning':d['comparison_coverage_warning'],
        'source_last_record':d['available']['end'],'checked_at':d['freshness']['checked_at'],'generated_at':now(),'source_fingerprint':snapshot.fingerprint,
        'workspace_revision':workspace['revision'],'costs':{'charges':charges,'refunds':refunds,'net_spend':charges-refunds,'entry_count':len(entries),'by_campaign':list(roots.values())},
        'campaigns':[{k:x.get(k) for k in ('id','title','parent_id','channel','start','end','status','vendor','evidence_url')} for x in campaigns.values() if x['id'] in relevant],
        'channels':d['channels'],'top_regions':[{k:r.get(k) for k in ('name','patients','new_patients','visits','change')} for r in d['regions']['emd'] if not r['suppressed']][:10],
        'address_coverage':d['region_coverage']['emd'],'definitions':d['definitions'],'presentation':capture_presentation(snapshot,d),
        'limits':['월간 집행비는 거래일 기준 지출에서 환불을 뺀 금액입니다. 캠페인 예산과 별도입니다.',
            '환자·매출 변화는 관측 결과입니다. 문의 연결기록도 EMR 금액 대사와 광고 귀속 검증 전이므로 ROAS·광고 기여 매출을 계산하지 않습니다.',
            '자료 범위가 부족하면 부분기간으로 표시하고 증감률을 숨깁니다. 접수기록이 없는 보고월은 미관측(—)으로 표시합니다.','캠페인 상태는 보고서 생성 당시의 업무 기록입니다. 과거 시점의 상태를 복원한 값이 아닙니다.']}


def report_html(report):
    d=report['data'];notes=report['notes'];esc=lambda x:escape(str(x if x is not None else ''),quote=True)
    def number(value):return '—' if value is None else f'{value:,.0f}'
    def table(headers,rows):return '<table><thead><tr>'+''.join('<th>'+esc(h)+'</th>' for h in headers)+'</tr></thead><tbody>'+(''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in row)+'</tr>' for row in rows) or '<tr><td colspan="'+str(len(headers))+'">기록 없음</td></tr>')+'</tbody></table>'
    labels={'patients':'고유환자','new_patients':'신규 환자군','visits':'내원 횟수','treatment_total':'총진료비 · 대사 전','collection_recorded':'기록된 수납액 · 대사 전'}
    reviewed=report['status']=='reviewed'
    status='검토 완료 · '+report.get('reviewer','') if reviewed else '검토 전 초안'
    metrics=table(['지표','보고월','비교월','증감률'],[[label,number(d['metrics'][key]),number(d['previous'][key]),'비교 불가' if d['changes'][key] is None else str(d['changes'][key])+'%'] for key,label in labels.items()])
    costs=table(['캠페인','지출','환불','순집행비'],[[x['title'],number(x['charges']),number(x['refunds']),number(x['net_spend'])] for x in d['costs']['by_campaign']])
    regions=table(['법정동','고유환자','신규 환자군'],[[x['name'],number(x['patients']),number(x['new_patients'])] for x in d['top_regions']])
    campaigns=table(['캠페인·하위 집행','채널','기간','현재 기록 상태'],[[x['title'],CHANNELS.get(x['channel'],x['channel']),x['start']+' ~ '+x['end'],x['status']] for x in d['campaigns']])
    warning='<p class="warning">부분기간 또는 비교자료 부족: 자료 마지막 접수일과 조회기간을 확인해 주세요.</p>' if d['coverage_warning'] or d['comparison_coverage_warning'] else ''
    return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(d['clinic']+' '+d['month']+' 월간 보고서')+'''</title><style>
body{font:14px/1.6 system-ui,sans-serif;color:#25314a;max-width:1000px;margin:40px auto;padding:0 24px}h1{font-size:28px}h2{margin-top:32px;border-bottom:2px solid #7970ca;padding-bottom:8px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{padding:10px;border-bottom:1px solid #e4e8f1;text-align:left}th{background:#f0effa}p{white-space:pre-wrap}.muted{color:#66738b;font-size:12px}.badge{background:#eeecff;padding:6px 12px;border-radius:6px}.warning{background:#fff3de;padding:12px}tr{break-inside:avoid}@media print{body{margin:0;max-width:none;font-size:11px}h2{break-after:avoid}a{color:inherit;text-decoration:none}@page{size:A4;margin:15mm}}
</style><header><span class="badge">'''+esc(status)+'</span><h1>'+esc(d['clinic']+' · '+d['month']+' 월간 보고서')+'</h1><p>조회 '+esc(d['period']['start']+' ~ '+d['period']['end'])+'<br>비교 '+esc(d['comparison_period']['start']+' ~ '+d['comparison_period']['end'])+'</p><p class="muted">자료 마지막 접수일 '+esc(d['source_last_record'])+' · 원본 확인 '+esc(d['checked_at'])+'<br>보고서 생성 '+esc(report['created_at'])+' · 저장된 집계 기준</p></header>'+warning+'<h2>환자·금액 관측 결과</h2>'+metrics+'<h2>마케팅 집행비</h2><p>순집행비 '+number(d['costs']['net_spend'])+'원 · 지출 '+number(d['costs']['charges'])+'원 · 환불 '+number(d['costs']['refunds'])+'원</p>'+costs+'<h2>캠페인 기록</h2>'+campaigns+'<h2>환자 유입 지역</h2><p class="muted">법정동 연결 '+number(d['address_coverage']['patients'])+'명 · '+str(d['address_coverage']['percent'])+'% · 소수 지역 비공개</p>'+regions+measurement_html(d.get('measurements'))+campaign_html(d.get('campaign_comparisons'))+'<h2>담당자 해석</h2><p>'+esc(notes.get('interpretation') or '담당자 입력 전')+'</p><h2>다음 행동</h2><p>'+esc(notes.get('next_actions') or '담당자 입력 전')+'</p><h2>자료 기준과 한계</h2><ul>'+''.join('<li>'+esc(x)+'</li>' for x in d['limits'])+'</ul><p class="muted">'+esc(d['definitions']['collection'])+'</p></html>'
