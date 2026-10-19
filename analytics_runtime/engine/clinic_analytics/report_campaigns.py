"""Selected campaign regional observations frozen with a monthly report."""
import re
from html import escape
from .campaign_analysis import analyze_snapshot
from .loader import DataError
from .marketing import now

LIMITS=[
    '관측기간은 보고월과 저장된 집행기간이 겹치는 날짜입니다. 비교기간은 그 직전 동일 일수이며 이미 집행 중이던 날짜가 포함될 수 있습니다.',
    '캠페인별 환자·지역이 겹칠 수 있어 표 사이의 환자수·진료비·수납액을 합산하지 않습니다. 환자 변화는 광고 인과효과가 아닙니다.',
    '여기 표시한 집행비는 월간 장부 비용의 참고 내역입니다. 월간 지출에 다시 더하지 않습니다. 기록이 없는 비용은 0원으로 확정하지 않습니다.',
    '생성 당시 동일한 EMR 원본과 장부 버전을 사용했습니다. 나중에 수정한 지역·기간·금액은 이 보관본에 반영되지 않습니다.'
    ,'같은 보고서의 겹치는 관측을 빼서 5명 미만의 기록이 드러나는 경우 관련 집계와 주소 연결 수치를 비공개 처리합니다.'
]
STATES={'observed':'관측 기록 있음','no_matched_visits':'연결된 지역 내원 0명','unobserved':'미관측','suppressed':'소수 집계 비공개','partial':'부분기간 관측'}
CAMPAIGN_STATES={'planned':'기획','approved':'검토 완료','running':'진행 중','paused':'보류','completed':'종료','cancelled':'취소'}


def capture(snapshot,workspace,period,campaign_ids,*,comparison_period):
    if not isinstance(campaign_ids,list) or len(campaign_ids)>8 or any(not isinstance(i,str) or not re.fullmatch('[a-f0-9]{32}',i) for i in campaign_ids):
        raise DataError('보고서에 넣을 캠페인은 목록에서 최대 8개 선택해 주세요.')
    if len(campaign_ids)!=len(set(campaign_ids)):raise DataError('같은 캠페인을 중복 선택할 수 없습니다.')
    campaigns={c['id']:c for c in workspace['campaigns']};selected=[]
    for identifier in campaign_ids:
        campaign=campaigns.get(identifier)
        if not campaign:raise DataError('이 병원에 없는 캠페인은 보고서에 넣을 수 없습니다.')
        if campaign.get('parent_id') in campaign_ids:raise DataError('상위 캠페인과 그 하위 집행을 함께 선택하지 마세요. 상위를 선택하면 하위 비용을 포함합니다.')
        start=max(period['start'],campaign['start']);end=min(period['end'],campaign['end'])
        if start>end:raise DataError('보고월과 집행기간이 겹치는 캠페인을 선택해 주세요.')
        selected.append((identifier,{'start':start,'end':end}))
    items=[analyze_snapshot(snapshot,workspace,identifier,observation_period=bounds) for identifier,bounds in selected]
    _protect_overlaps(snapshot,period,comparison_period,items)
    return {'version':1,'period':dict(period),'baseline':'previous','selected_ids':list(campaign_ids),'items':items,
        'source_fingerprint':snapshot.fingerprint,'source_checked_at':snapshot.checked_at,'workspace_revision':workspace['revision'],'captured_at':now(),'limitations':LIMITS}


def _protect_overlaps(snapshot,period,comparison_period,items):
    """Check record remainders, including repeated visits; never serialize sets/IDs."""
    if not items:return
    records=snapshot.records;nodes=[];date_cache={}
    def indices(bounds):
        key=(bounds['start'],bounds['end'])
        if key not in date_cache:date_cache[key]={i for i,r in enumerate(records) if key[0]<=r['date'].isoformat()<=key[1]}
        return date_cache[key]
    def scopes(rows,level,code):
        return [rows,{i for i in rows if records[i]['region'][level]},{i for i in rows if records[i]['region'][level]==code}]
    def add(rows,mark,period_rows):
        people={records[i]['key'] for i in rows};new={records[i]['key'] for i in period_rows if records[i]['new']}
        nodes.append((rows,people,people&new,people-new,mark))
    for bounds in (period,comparison_period):
        rows=indices(bounds);add(rows,None,rows)
        for level,code in {(d['target']['region_level'],d['target']['region_code']) for d in items}:
            for group in scopes(rows,level,code)[1:]:add(group,None,rows)
    for item_index,item in enumerate(items):
        for side,bounds in [('current',item['period']),('previous',item['comparison_period'])]:
            rows=indices(bounds)
            for group in scopes(rows,item['target']['region_level'],item['target']['region_code']):add(group,(item_index,side),rows)
    hidden=set()
    for i,left in enumerate(nodes):
        for right in nodes[i+1:]:
            left_mark,right_mark=left[4],right[4]
            if not (left_mark or right_mark) or not left[1].intersection(right[1]):continue
            small_rows=any(remainder and len({records[n]['key'] for n in remainder})<5 for remainder in (left[0]-right[0],right[0]-left[0]))
            small_cohort=any(0<len(a-b)<5 or 0<len(b-a)<5 for a,b in zip(left[1:4],right[1:4]))
            if small_rows or small_cohort:
                if left_mark:hidden.add(left_mark)
                if right_mark:hidden.add(right_mark)
    for item_index,side in hidden:
        item=items[item_index];region=item['regions'][0]
        region[side]={key:None for key in region[side]};region[side+'_status']='suppressed'
        region['money_complete'][side]={key:None for key in region['money_complete'][side]}
        region['delta']={key:None for key in region['delta']};region['percent']={key:None for key in region['percent']}
        item['coverage'][side]={key:None for key in item['coverage'][side]}
        item['privacy_note']='기간·지역 집계 사이의 차이로 소수 기록이 드러날 수 있어 관련 수치를 비공개 처리했습니다.'


def campaign_html(section):
    esc=lambda v:escape(str(v if v is not None else '—'),quote=True)
    def number(v):return '—' if v is None else f'{v:,.2f}'.rstrip('0').rstrip('.')
    def table(headers,rows):return '<table><thead><tr>'+''.join('<th>'+esc(h)+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(v)+'</td>' for v in row)+'</tr>' for row in rows)+'</tbody></table>'
    heading='<h2>캠페인별 지역 관측 비교</h2>'
    if section is None:return heading+'<p>당시 미수집: 이 보고서에는 캠페인 지역 비교를 포함하지 않았습니다.</p>'
    if not section['items']:return heading+'<p>보고서 생성 시 지역 비교 캠페인을 선택하지 않았습니다.</p>'
    html=heading+'<ul>'+''.join('<li>'+esc(x)+'</li>' for x in section['limitations'])+'</ul>'
    for item in section['items']:
        campaign=item['campaign'];current=item['period'];prior=item['comparison_period'];region=item['regions'][0];cost=item['costs']
        html+='<section><h3>'+esc(campaign['title'])+' · '+esc(region['name'])+'</h3><p>생성 당시 업무 상태 '+esc(CAMPAIGN_STATES.get(campaign['status'],campaign['status']))+'<br>연결 전략 '+esc(item['target']['strategy_title'])+(' · 상위 캠페인에서 이어받음' if item['target']['strategy_source']=='parent_campaign' else '')+'<br>저장된 전체 집행기간 '+esc(campaign['start']+' ~ '+campaign['end'])+'<br>보고월 내 관측기간 '+esc(current['start']+' ~ '+current['end'])+' · '+str(current['days'])+'일<br>직전 비교기간 '+esc(prior['start']+' ~ '+prior['end'])+' · '+str(prior['days'])+'일</p>'
        html+='<p>비교기간 '+esc(STATES[region['previous_status']])+' / 관측기간 '+esc(STATES[region['current_status']])+'</p>'
        if item.get('privacy_note'):html+='<p class="warning">'+esc(item['privacy_note'])+'</p>'
        if item['coverage']['current_incomplete'] or item['coverage']['previous_incomplete']:html+='<p class="warning">자료 범위가 부족한 기간이 있어 증감을 계산하지 않았습니다.</p>'
        html+=table(['지표','비교기간','관측기간','차이','증감률'],[[label,number(region['previous'][key]),number(region['current'][key]),number(region['delta'][key]),'비교 불가' if region['percent'][key] is None else number(region['percent'][key])+'%'] for key,label in item['metric_labels'].items()])
        for side,label in [('previous','비교기간'),('current','관측기간')]:
            html+='<p class="muted">'+label+' 금액: '+esc(' · '.join(item['metric_labels'][key]+(' 확인 불가' if complete is None else ' 칸 누락 없음' if complete else ' 누락 또는 내원 기록 없음') for key,complete in region['money_complete'][side].items()))+'</p>'
        html+='<h4>관측기간 내 거래 기록 · '+esc(cost['scope'])+'</h4>'+table(['기록 수','지출 · 원','환불 · 원','순집행비 · 원'],[[cost['entry_count']]+[number(cost[key]) if cost['has_records'] else '—' for key in ('charges','refunds','net_spend')]])
        if not cost['has_records']:html+='<p>거래 기록 없음 · 실제 비용 0원으로 확정하지 않습니다.</p>'
        html+='<p class="muted">'+esc(cost['note'])+'<br>병원 전체 주소 연결률 · 비교기간 '+number(item['coverage']['previous']['percent'])+'% / 관측기간 '+number(item['coverage']['current']['percent'])+'%<br>EMR 마지막 접수일 '+esc(item['source_last_record'])+' · 원본 확인 '+esc(item['source_checked_at'])+' · 장부 버전 '+str(item['workspace_revision'])+'</p><ul>'+''.join('<li>'+esc(x)+'</li>' for x in item['limitations'])+'</ul></section>'
    return html
