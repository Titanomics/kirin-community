"""Read-only campaign-period observations. Never estimates ad attribution."""
import re
from datetime import date,timedelta
from .analytics import build_dashboard,previous_year,change
from .loader import DataError
from .marketing import now,period

METRICS=('patients','new_patients','visits','average_visits','treatment_total','collection_recorded')
LABELS={'patients':'고유환자','new_patients':'신규 환자군','visits':'내원 횟수','average_visits':'평균 내원 횟수','treatment_total':'기록된 총진료비 · 대사 전','collection_recorded':'기록된 수납액 · 대사 전'}
LIMITS=[
    '대상 지역에 연결된 내원 기록의 기간별 관측입니다. 광고로 유입된 환자나 광고 기여 매출을 뜻하지 않습니다.',
    '신규 환자군은 각 기간 안에서 신환 표기가 있는 고유환자입니다. 두 기간의 환자를 합산한 값이 아닙니다.',
    '소수 비공개·미관측·부분기간·일수 불일치에서는 증감 계산을 숨깁니다. 금액 누락이 있으면 해당 금액의 증감은 계산하지 않습니다.',
    '참고 지역은 담당자가 선택한 비교 대상입니다. 광고에 노출되지 않았다는 검증을 거친 대조군이 아닙니다.',
    '기간에 따라 주소 연결률·계절·요일·진료 일정이 달라질 수 있습니다. 주소는 제공 파일에서 최근 확인된 주소로 내원 당시 거주지와 다를 수 있습니다.',
    '지역·일정·업무 상태는 현재 저장된 캠페인과 연결 전략 기준입니다. 실제 집행 여부나 당시 설정 이력을 증명하지 않습니다.',
    '표시 비용은 선택 캠페인 범위의 집행기간 내 거래일 기준 기록입니다. 기록이 없어도 실제 비용 0원으로 확정하지 않습니다. 환자·금액과 나누어 ROAS·환자 획득비용을 계산하지 않습니다.'
]

def _dates(campaign,baseline):
    start,end=period(campaign.get('start'),campaign.get('end'));left=date.fromisoformat(start);right=date.fromisoformat(end)
    days=(right-left).days+1
    if days>366:raise DataError('캠페인 지역 비교는 집행기간이 366일 이내인 항목을 선택해 주세요.')
    try:
        if baseline=='previous':prior_end=left-timedelta(days=1);prior_start=left-timedelta(days=days)
        elif baseline=='year':prior_start=previous_year(left);prior_end=previous_year(right)
        else:raise DataError('비교 기준은 직전 동일 일수 또는 전년 같은 기간을 선택해 주세요.')
    except (ValueError,OverflowError):raise DataError('비교기간을 만들 수 없는 집행일입니다.') from None
    if prior_end>=left:raise DataError('비교기간과 집행기간이 겹칩니다. 집행기간을 줄여 주세요.')
    return {'start':start,'end':end,'days':days},{'start':prior_start.isoformat(),'end':prior_end.isoformat(),'days':(prior_end-prior_start).days+1}

def _target(workspace,campaign,index):
    strategy_id=campaign.get('strategy_id');origin='campaign'
    if not strategy_id and campaign.get('parent_id'):
        parent=next((c for c in workspace['campaigns'] if c['id']==campaign['parent_id']),None)
        strategy_id=parent.get('strategy_id') if parent else None;origin='parent_campaign'
    strategy=next((s for s in workspace['strategies'] if s['id']==strategy_id),None)
    if not strategy:raise DataError('지역 전략이 연결된 캠페인을 선택해 주세요. 하위 집행은 상위 캠페인의 전략을 이어받을 수 있습니다.')
    level,code=strategy.get('region_level'),strategy.get('region_code')
    if level not in ('sig','emd') or code not in index.names[level]:raise DataError('연결 전략의 공식 지도 지역을 확인해 주세요.')
    return {'region_level':level,'region_code':code,'region_name':index.names[level][code],
        'strategy_id':strategy_id,'strategy_title':strategy['title'],'strategy_source':origin,'strategy_status':strategy['status']}

def analyze(context,campaign_id,baseline='previous',reference_code=''):
    workspace=context.marketing.snapshot()
    return analyze_snapshot(context.store.snapshot(),workspace,campaign_id,baseline,reference_code)

def analyze_snapshot(snapshot,workspace,campaign_id,baseline='previous',reference_code='',*,observation_period=None):
    """Use one captured source/workspace pair, including for saved monthly reports."""
    if not isinstance(campaign_id,str) or not re.fullmatch(r'[a-f0-9]{32}',campaign_id):raise DataError('저장된 캠페인을 선택해 주세요.')
    campaign=next((c for c in workspace['campaigns'] if c['id']==campaign_id),None)
    if not campaign:raise DataError('이 병원에 해당 캠페인이 없습니다.')
    target=_target(workspace,campaign,snapshot.index);level=target['region_level'];code=target['region_code']
    if not isinstance(reference_code,str) or (reference_code and (reference_code not in snapshot.index.names[level] or reference_code==code)):
        raise DataError('대상과 다른 같은 지도 단위의 참고 지역을 선택해 주세요.')
    bounds=campaign
    if observation_period is not None:
        start,end=period(observation_period.get('start'),observation_period.get('end'))
        if start<campaign['start'] or end>campaign['end']:raise DataError('관측기간은 저장된 집행기간 안에 있어야 합니다.')
        bounds={'start':start,'end':end}
    current,prior=_dates(bounds,baseline)
    if not snapshot.records:raise DataError('접수수납 자료가 없어 캠페인 지역 변화를 확인할 수 없습니다.')
    dashboard=build_dashboard(snapshot,current['start'],current['end'],prior['start'],prior['end'])
    equal_days=current['days']==prior['days']
    comparable=not dashboard['coverage_warning'] and not dashboard['comparison_coverage_warning'] and equal_days
    items={r['code']:r for r in dashboard['regions'][level]}
    region_rows=[];coverage={}
    # Reuse the existing display-safe region aggregates, including complementary suppression.
    for region_code,role in [(code,'target')]+([(reference_code,'reference')] if reference_code else []):
        item=items.get(region_code);row={'role':role,'code':region_code,'name':snapshot.index.names[level][region_code],'money_complete':{}}
        for side,bounds,top,warning in [('current',current,'current','coverage_warning'),('previous',prior,'previous','comparison_coverage_warning')]:
            observed=dashboard[top]['has_data']
            values=item if side=='current' else item['previous'] if item else None
            counts={k:values.get(k) if values else (0 if k in ('patients','new_patients','visits') else None) for k in METRICS}
            if not observed:counts={k:None for k in METRICS};status='unobserved'
            elif counts['patients'] is None:status='suppressed'
            elif dashboard[warning]:status='partial'
            elif counts['patients']==0:status='no_matched_visits'
            else:status='observed'
            # Only completeness booleans leave this calculation. Rows/IDs/addresses never do.
            matching=[r for r in snapshot.records if r['region'][level]==region_code and bounds['start']<=r['date'].isoformat()<=bounds['end']]
            row['money_complete'][side]={key:bool(matching) and all(r['amounts'].get(k) is not None for r in matching for k in columns)
                for key,columns in [('treatment_total',('treatment_total',)),('collection_recorded',('card','cash','other'))]}
            if status in ('suppressed','unobserved'):row['money_complete'][side]={key:None for key in row['money_complete'][side]}
            row[side]=counts;row[side+'_status']=status
        row['delta']={};row['percent']={}
        for metric in METRICS:
            a,b=row['current'][metric],row['previous'][metric]
            eligible=comparable and a is not None and b is not None
            if metric in ('treatment_total','collection_recorded'):eligible=eligible and all(row['money_complete'][side][metric] for side in ('current','previous'))
            row['delta'][metric]=round(a-b,2) if eligible else None
            row['percent'][metric]=change(a,b) if eligible else None
        region_rows.append(row)
    # Whole-clinic address coverage is shown for each period; it is not a regional conversion rate.
    for side,bounds in [('current',current),('previous',prior)]:
        records=[r for r in snapshot.records if bounds['start']<=r['date'].isoformat()<=bounds['end']]
        people={r['key'] for r in records};matched={r['key'] for r in records if r['region'][level]}
        coverage[side]={'patients':len(people),'matched_patients':len(matched),'percent':round(100*len(matched)/len(people),2) if people else None}
    family=[campaign_id]+[c['id'] for c in workspace['campaigns'] if c.get('parent_id')==campaign_id]
    entries=[e for e in workspace['expenses'] if not e.get('voided') and e['campaign_id'] in family and current['start']<=e['date']<=current['end']]
    charges=sum(e['amount'] for e in entries if e['direction']=='charge');refunds=sum(e['amount'] for e in entries if e['direction']=='refund')
    costs={'campaign_ids':family,'entry_count':len(entries),'has_records':bool(entries),'charges':charges,'refunds':refunds,'net_spend':charges-refunds,
        'scope':'선택 캠페인과 하위 집행' if len(family)>1 else '선택한 집행 항목만','planned_budget':campaign.get('budget'),
        'note':'하위 집행의 대상 지역이 다를 수 있습니다. 이 비용 전체를 선택 지역 환자에게 귀속하지 않습니다.'}
    return {'clinic':snapshot.clinic,'clinic_id':workspace['clinic_id'],'workspace_revision':workspace['revision'],
        'campaign':{k:campaign.get(k) for k in ('id','title','channel','status','start','end','parent_id')},'target':target,
        'baseline':baseline,'period':current,'comparison_period':prior,'equal_days':equal_days,'regions':region_rows,
        'coverage':{**coverage,'current_incomplete':dashboard['coverage_warning'],'previous_incomplete':dashboard['comparison_coverage_warning']},
        'costs':costs,'source_last_record':dashboard['available']['end'],'source_fingerprint':snapshot.fingerprint,
        'source_checked_at':snapshot.checked_at,'workspace_checked_at':workspace.get('checked_at'),'checked_at':now(),
        'metric_labels':LABELS,'limitations':LIMITS}
