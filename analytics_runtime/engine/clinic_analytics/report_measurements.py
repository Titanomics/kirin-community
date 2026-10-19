"""Captured media and linked-case evidence for immutable client reports."""
from decimal import Decimal
from contextlib import contextmanager
from html import escape
from .ad_reports import AdReportStore
from .conversions import ConversionStore
from .loader import DataError
from .marketing import CHANNELS

TAX={'included':'부가세 포함','excluded':'부가세 제외','unknown':'부가세 미확인'}

def stores(context):
    path=context.marketing.path;clinic=context.marketing.clinic_id
    return AdReportStore(path.with_name('ad-reports.sqlite'),clinic),ConversionStore(path.with_name('conversions.sqlite'),clinic)

def capture(context,period,workspace,window):
    ads,cases=stores(context)
    media=ads.report(period['start'],period['end'],workspace)
    linked=cases.report(period['start'],period['end'],window,workspace)
    media.pop('daily',None)
    result={'media':media,'linked_cases':linked}
    verify(context,result)
    return result

def verify(context,measurements):
    ads,cases=stores(context)
    if ads.status()['revision']!=measurements['media']['revision'] or cases.status()['revision']!=measurements['linked_cases']['revision']:
        raise DataError('보고서 생성 중 광고·문의 연결자료가 바뀌었습니다. 새로 생성해 주세요.')

@contextmanager
def source_guard(context,measurements):
    """Keep source read transactions open until the marketing report commits."""
    ads,cases=stores(context)
    with ads.connection() as (ad_connection,ad_revision),cases.connection() as (case_connection,case_revision):
        if any(conn.execute('PRAGMA journal_mode').fetchone()[0] not in ('delete','truncate','persist') for conn in (ad_connection,case_connection)):
            raise DataError('자료 저장소의 동시 기록 설정이 변경됐습니다. 일관된 보고서를 저장하지 못했습니다.')
        if ad_revision!=measurements['media']['revision'] or case_revision!=measurements['linked_cases']['revision']:
            raise DataError('보고서 생성 중 광고·문의 연결자료가 바뀌었습니다. 새로 생성해 주세요.')
        yield

def measurement_html(measurements):
    esc=lambda v:escape(str(v if v is not None else '—'),quote=True)
    def number(v):return '—' if v is None else format(Decimal(str(v)),',f')
    def table(headers,rows):return '<table><thead><tr>'+''.join('<th>'+esc(h)+'</th>' for h in headers)+'</tr></thead><tbody>'+(''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in row)+'</tr>' for row in rows) or '<tr><td colspan="'+str(len(headers))+'">미연결·미관측</td></tr>')+'</tbody></table>'
    if measurements is None:return '<h2>광고 보고 · 문의 연결자료</h2><p>당시 미수집: 이 보고서 생성 시 광고 보고서와 문의 연결 집계를 포함하지 않았습니다.</p>'
    m=measurements['media'];c=measurements['linked_cases']
    def basis(b):return ' · '.join([b['source_label'],b['account_label'],b['conversion_definition'],TAX[b['tax_basis']]])
    media='<h2>매체 보고 수치 · 보고월 일자 기준</h2><p class="muted">확인 '+esc(m['checked_at'])+' · 광고 자료 버전 '+esc(m['revision'])+' · 장부 버전 '+esc(m['workspace_revision'])+'</p>'
    if not m['has_data']:media+='<p>미연결·미관측: 선택한 보고월의 광고 보고 수치가 없습니다. 성과 0으로 확정하지 않습니다.</p>'
    elif m['aggregation_blocked']:media+='<p class="warning">계층 중복: 상위·하위 캠페인 보고가 겹쳐 전체·그룹 합계를 표시하지 않습니다.</p>'
    else:
        t=m['totals'];media+=table(['노출','클릭','매체 보고 전환','매체 보고비 · 원','클릭률 %','클릭당 보고비 · 원'],[[number(t[k]) for k in ('impressions','clicks','conversions','spend','ctr','cpc')]])
    media+=table(['캠페인 / 업로드 시 채널','보고 기준','보고 일자 범위','자료 확인 기준일 범위','노출','클릭','매체 보고 전환','보고비 · 원'],[[r['title']+' / '+CHANNELS.get(r['channel'],r['channel'])+(' · 현재 채널과 다름' if r['channel_changed'] else ''),basis(r['basis']),str(r['first_report_date'])+' ~ '+str(r['last_report_date']),str(r['as_of_min'])+' ~ '+str(r['as_of_max']),number(r['impressions']),number(r['clicks']),number(r['conversions']),number(r['spend'])] for r in m['campaigns']])
    states={'missing':'장부 확인 필요','voided':'원 지출 취소','mixed_tax':'부가세 기준 혼합','comparison_only':'참고 비교 · 대사 미확정'}
    media+='<h3>증빙 참고 비교 · 전체 연결기간</h3>'+table(['증빙','상태','전체 연결 일자','전체 연결 보고비','원 지출 − 환불','차이 · 원'],[[r['reference'],states[r['status']],r['first_date']+' ~ '+r['last_date'],number(r['reported_spend_all_dates']),number(r['ledger_net']),number(r['difference'])] for r in m['comparisons']])+'<p>지출 미연결 '+number(m['unlinked_rows'])+'행 · 보고비를 월간 지출에 더하지 않습니다.</p>'
    media+='<ul>'+''.join('<li>'+esc(w)+'</li>' for w in m['warnings'])+'</ul>'
    linked='<h2>문의월 연결건 · '+esc(c['window_days'])+'일 관측</h2><p>문의 시작 '+esc(c['period']['start'])+' ~ '+esc(c['period']['end'])+'<br>연결건별 예정 관측 종료일 '+esc(c['observation_end_min'])+' ~ '+esc(c['observation_end_max'])+'<br>관측에 포함된 기록 일자 '+esc(c['cohort_event_first'])+' ~ '+esc(c['cohort_event_last'])+'<br>최소 자료 확인 기준일 '+esc(c['observed_through'])+'</p><p class="muted">확인 '+esc(c['checked_at'])+' · 문의 자료 버전 '+esc(c['revision'])+' · 장부 버전 '+esc(c['workspace_revision'])+'</p>'
    linked+='<p>관측 완료 '+number(c['complete_cases'])+'건 · 관측 미완료 '+number(c['incomplete_cases'])+'건 · 문의 미연결 제외 '+number(c['orphan_cases'])+'건</p>'
    if not c['has_data']:linked+='<p>미연결·미관측: 이 보고월에 시작한 문의 연결자료가 없습니다. 성과 0으로 확정하지 않습니다.</p>'
    else:
        t=c['totals'];linked+=table(['문의 연결건','예약 확인','내원 확인','치료 확인','연결기록 수납 − 환불 · 원'],[[number(t[k]) for k in ('inquiry','booking','attendance','treatment','net_collections')]])
    linked+=table(['캠페인','문의','예약','내원','미완료','관측 수납 − 환불 · 원'],[[r['title'],number(r['inquiry']) if r['inquiry'] else '—',number(r['booking']) if r['inquiry'] else '—',number(r['attendance']) if r['inquiry'] else '—',number(r['incomplete_cases']),number(r['net_collections'])] for r in c['campaigns']])
    linked+='<p>코호트 수납은 다음 달까지 포함할 수 있습니다. 보고월 EMR 수납·매체 전환·거래일 기준 지출과 합산하지 않습니다.</p><ul>'+''.join('<li>'+esc(w)+'</li>' for w in c['warnings'])+'</ul>'
    return media+linked
