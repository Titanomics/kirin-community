"""Deterministic aggregate responses; no record serialization."""
from collections import Counter,defaultdict
from datetime import date,datetime,timedelta
from decimal import Decimal
from calendar import monthrange

from .loader import MONEY_COLUMNS,KST


def sum_money(records,key):
    observed=[r['amounts'][key] for r in records if r['amounts'].get(key) is not None]
    return float(sum(observed,Decimal(0))) if observed else None


def summarize(records,new_keys=None):
    keys={r['key'] for r in records};counts=Counter(r['key'] for r in records)
    if new_keys is None:new_keys={r['key'] for r in records if r['new']}
    amounts={k:sum_money(records,k) for k in MONEY_COLUMNS}
    collections=[amounts[k] for k in ('card','cash','other') if amounts[k] is not None]
    collection=sum(collections) if collections else None
    result={'has_data':bool(records),'visits':len(records),'patients':len(keys),
        'new_patients':len(keys&new_keys),'existing_patients':len(keys-new_keys),
        'repeat_patients':sum(n>1 for n in counts.values()),
        'collection_recorded':collection,'treatment_total':amounts['treatment_total'],
        'amounts':amounts,'money_missing_cells':sum(v is None for r in records for v in r['amounts'].values()),
        'average_visits':round(len(records)/len(keys),2) if keys else None}
    for prefix,amount in [('treatment',amounts['treatment_total']),('collection',collection)]:
        columns=('treatment_total',) if prefix=='treatment' else ('card','cash','other')
        complete=bool(records) and all(r['amounts'].get(k) is not None for r in records for k in columns)
        result[prefix+'_per_visit']=amount/len(records) if amount is not None and complete else None
        result[prefix+'_per_patient']=amount/len(keys) if amount is not None and complete else None
    for label,selected in [('new',[r for r in records if r['key'] in new_keys]),('existing',[r for r in records if r['key'] not in new_keys])]:
        result[label+'_treatment_total']=sum_money(selected,'treatment_total') if selected else (0 if records else None)
        values=[sum_money(selected,k) for k in ('card','cash','other')]
        result[label+'_collection']=sum(v for v in values if v is not None) if any(v is not None for v in values) else (0 if records and not selected else None)
    return result


PUBLIC_METRICS=('patients','visits','new_patients','existing_patients','repeat_patients','treatment_total','collection_recorded','treatment_per_visit','treatment_per_patient','collection_per_visit','collection_per_patient','average_visits')


def time_series(records,new_keys,grain='month',small_cells=False):
    buckets=defaultdict(list)
    for r in records:buckets[r['date'].isoformat() if grain=='day' else r['date'].strftime('%Y-%m')].append(r)
    hide_series=small_cells and any(len({r['key'] for r in rows})<5 for rows in buckets.values())
    result=[]
    for label,rows in sorted(buckets.items()):
        s=summarize(rows,new_keys);entry={'month':label,**s}
        entry.pop('amounts',None)
        if hide_series:
            entry={k:(v if k=='month' else None) for k,v in entry.items()}
        elif small_cells:
            for key in ('new_patients','existing_patients','repeat_patients'):
                if 0<s[key]<5:entry[key]=None
            if any(0<s[k]<5 for k in ('new_patients','existing_patients')):
                entry['new_patients']=None;entry['existing_patients']=None
            # Region series exposes totals only, avoiding disclosure of small cohort finances.
            for key in ('new_treatment_total','existing_treatment_total','new_collection','existing_collection'):entry.pop(key,None)
        result.append(entry)
    return result


def shift_month(d,offset):
    number=d.year*12+d.month-1+offset;year,month=divmod(number,12);month+=1
    return date(year,month,min(d.day,monthrange(year,month)[1]))


def previous_year(d):
    try:return d.replace(year=d.year-1)
    except ValueError:return d.replace(year=d.year-1,day=28)


def change(a,b,has_a=True,has_b=True):
    if not has_a or not has_b or a is None or b is None or b==0:return None
    return round((a-b)/abs(b)*100,2)


def group_summary(records,field):
    grouped=defaultdict(list)
    for r in records:grouped[r[field]].append(r)
    result=[]
    for label,rs in grouped.items():
        summary=summarize(rs)
        result.append({'label':label,**{k:summary[k] for k in ('patients','visits','new_patients','collection_recorded')}})
    return sorted(result,key=lambda r:r['patients'],reverse=True)


def demographics(records):
    # One observation per patient; uses the latest record in the selected range.
    people={r['key']:r for r in records}
    return {'age':[{'label':k,'value':v} for k,v in sorted(Counter(r['age'] for r in people.values()).items())],
            'sex':[{'label':k,'value':v} for k,v in Counter(r['sex'] for r in people.values()).items()]}


def build_dashboard(snapshot,start=None,end=None,compare_start=None,compare_end=None,**ignored):
    earliest=snapshot.records[0]['date'];latest=snapshot.records[-1]['date']
    try:
        end=date.fromisoformat(end) if end else latest
        start=date.fromisoformat(start) if start else date(end.year,1,1)
        if bool(compare_start)!=bool(compare_end):raise ValueError
        cs=date.fromisoformat(compare_start) if compare_start else previous_year(start)
        ce=date.fromisoformat(compare_end) if compare_end else previous_year(end)
        if start>end or cs>ce or (end-start).days>3660 or (ce-cs).days>3660:raise ValueError
    except (ValueError,TypeError):raise ValueError('조회 기간을 올바르게 입력해 주세요. 최대 10년까지 조회할 수 있습니다.') from None
    source_years={r['year'] for r in snapshot.records}
    # Annual exports include days without visits; the latest export has an explicit last-record cutoff.
    def incomplete(left,right):
        return left<date(earliest.year,1,1) or right>latest or any(y not in source_years for y in range(left.year,right.year+1))
    current_incomplete=incomplete(start,end);prior_incomplete=incomplete(cs,ce)
    comparable=not current_incomplete and not prior_incomplete
    current=[r for r in snapshot.records if start<=r['date']<=end]
    prior=[r for r in snapshot.records if cs<=r['date']<=ce]
    new_keys={r['key'] for r in current if r['new']};old_new_keys={r['key'] for r in prior if r['new']}
    a=summarize(current);b=summarize(prior)
    trend=time_series(current,new_keys)
    weekday=Counter(r['date'].weekday() for r in current)
    people={r['key']:r for r in current}
    region_output={};coverage={}
    for level in ('sig','emd'):
        grouped=defaultdict(list);old=defaultdict(list)
        for r in current:
            if r['region'][level]:grouped[r['region'][level]].append(r)
        for r in prior:
            if r['region'][level]:old[r['region'][level]].append(r)
        covered={r['key'] for rs in grouped.values() for r in rs}
        coverage[level]={'patients':len(covered),'percent':round(100*len(covered)/len(people),2) if people else None,'unmatched_patients':len(people)-len(covered)}
        entries=[]
        for code in set(grouped)|set(old):
            rs=grouped.get(code,[]);old_rs=old.get(code,[])
            summary=summarize(rs,new_keys);past=summarize(old_rs,old_new_keys)
            suppressed=0<summary['patients']<5
            # Overlapping period totals must not reveal a small hidden remainder.
            remainders=({r['key'] for r in rs if not cs<=r['date']<=ce},
                        {r['key'] for r in old_rs if not start<=r['date']<=end})
            comparison_suppressed=any(0<len(keys)<5 for keys in remainders)
            previous_suppressed=0<past['patients']<5 or comparison_suppressed
            detail={'code':code,'name':snapshot.index.names[level].get(code,code),'suppressed':suppressed,
                    'comparison_suppressed':comparison_suppressed,
                    'patients':None if suppressed else summary['patients'],'visits':None if suppressed else summary['visits'],
                    'new_patients':None if suppressed or 0<summary['new_patients']<5 else summary['new_patients'],
                    'collection_recorded':None if suppressed else summary['collection_recorded'],
                    'change':None if suppressed or previous_suppressed or not comparable else change(summary['patients'],past['patients'],bool(rs),past['has_data'])}
            if not suppressed and summary['patients']>=5:
                demo=demographics(rs)
                detail['demographics']={k:[{'label':v['label'],'value':None if any(0<x['value']<5 for x in values) else v['value']} for v in values] for k,values in demo.items()}
            hide_cohorts=any(0<summary[k]<5 for k in ('new_patients','existing_patients'))
            hide_past_cohorts=any(0<past[k]<5 for k in ('new_patients','existing_patients'))
            for key in PUBLIC_METRICS:
                small_count=key in ('new_patients','existing_patients','repeat_patients') and 0<summary[key]<5
                detail[key]=None if suppressed or small_count or (hide_cohorts and key in ('new_patients','existing_patients')) else summary[key]
            detail['previous']={key:None if previous_suppressed or (key in ('new_patients','existing_patients','repeat_patients') and 0<past[key]<5) or (hide_past_cohorts and key in ('new_patients','existing_patients')) else past[key] for key in PUBLIC_METRICS}
            detail['changes']={key:change(detail[key],detail['previous'][key],summary['has_data'],past['has_data']) if comparable and not suppressed and not previous_suppressed else None for key in PUBLIC_METRICS}
            detail['trend']=time_series(rs,new_keys,small_cells=True) if not suppressed else []
            detail.update(population=None,inflow_rate=None,regional_income=None,medical_spend=None)
            entries.append(detail)
        ranked=sorted((e for e in entries if e['treatment_total'] is not None and e['patients']>=5),key=lambda e:e['treatment_total'],reverse=True)
        for rank,e in enumerate(ranked,1):e['rank']=rank
        for e in entries:e.setdefault('rank',None)
        region_output[level]=sorted(entries,key=lambda r:r['patients'] or 0,reverse=True)
    address_count=sum(r['region']['address_present'] for r in people.values())
    reason_labels={'no_address':'주소 미기록','unknown_parent':'시·군·구 식별 불가','no_legal_dong':'법정동 정보 부족',
        'ambiguous_dong':'여러 법정동이 기록됨','ambiguous_road':'건물 주소가 여러 동에 연결됨','conflicting_evidence':'도로명과 법정동 불일치',
        'road_not_found':'공개 DB에 일치하는 건물 없음','road_reference_unavailable':'해당 지역 도로명 DB 미연결'}
    address_reasons=Counter(r['region'].get('reason','no_address' if not r['region']['address_present'] else 'no_legal_dong') for r in people.values() if not r['region']['emd'])
    address_methods=Counter(r['region'].get('method','explicit_legal_dong') for r in people.values() if r['region']['emd'])
    reconciliation=[]
    for year,reports in sorted(snapshot.reports.items()):
        for row in reports.get('monthly',[]):
            month=int(row['label'].removesuffix('월'))
            recs=[r for r in snapshot.records if r['date'].year==year and r['date'].month==month]
            observed=summarize(recs)
            for metric in ('patients','visits','new_patients'):
                if row.get(metric) is not None:
                    reconciliation.append({'period':f'{year}-{month:02d}','metric':metric,'reported':row[metric],'calculated':observed[metric],'matches':row[metric]==observed[metric]})
    report_year=end.year if end.year in snapshot.reports else max(snapshot.reports,default=end.year)
    report=snapshot.reports.get(report_year,{})
    annual_records=[r for r in snapshot.records if r['year']==report_year]
    report_total=report.get('channel_totals',{}).get('총진료비')
    treatment_sum=sum_money(annual_records,'treatment_total')
    data_end=latest.isoformat()
    growth_end=min(end,latest);growth_start=shift_month(growth_end,-3)+timedelta(days=1)
    growth_prior_end=growth_start-timedelta(days=1);growth_prior_start=shift_month(growth_prior_end,-3)+timedelta(days=1)
    ga=summarize([r for r in snapshot.records if growth_start<=r['date']<=growth_end])
    gb=summarize([r for r in snapshot.records if growth_prior_start<=r['date']<=growth_prior_end])
    growth_ok=not incomplete(growth_start,growth_end) and not incomplete(growth_prior_start,growth_prior_end)
    channel_age=Counter((r['age'],r['channel']) for r in people.values())
    age_totals=Counter(r['age'] for r in people.values())
    return {
        'clinic':snapshot.clinic,'period':{'start':start.isoformat(),'end':end.isoformat()},
        'comparison_period':{'start':cs.isoformat(),'end':ce.isoformat()},
        'available':{'start':earliest.isoformat(),'end':data_end,'years':sorted({r['year'] for r in snapshot.records})},
        'freshness':{'checked_at':snapshot.checked_at,'calculated_at':datetime.now(KST).isoformat(),'loaded_at':snapshot.loaded_at,'source_last_record':data_end,'source_live':False},
        'current':a,'previous':b,
        'change':{k:change(a[k],b[k],a['has_data'] and comparable,b['has_data']) for k in PUBLIC_METRICS},
        'coverage_warning':current_incomplete,'comparison_coverage_warning':prior_incomplete,
        'trend':trend,'channels':group_summary(current,'channel'),'demographics':demographics(current),
        'daily_trend':time_series(current,new_keys,'day'),'previous_trend':time_series(prior,old_new_keys),
        'weekday_metrics':[{'label':label,**summarize([r for r in current if r['date'].weekday()==i],new_keys)} for i,label in enumerate(['월','화','수','목','금','토','일'])],
        'channel_age':[{'age':age,'channel':ch,'patients':n,'percent':round(n/age_totals[age]*100,2)} for (age,ch),n in sorted(channel_age.items())],
        'growth':{'start':growth_start.isoformat(),'end':growth_end.isoformat(),'previous_start':growth_prior_start.isoformat(),'previous_end':growth_prior_end.isoformat(),'complete':growth_ok,'current':ga,'previous':gb,'change':{key:change(ga[key],gb[key],growth_ok and ga['has_data'],gb['has_data']) for key in PUBLIC_METRICS}},
        'weekdays':[{'label':label,'value':weekday[i]} for i,label in enumerate(['월','화','수','목','금','토','일'])],
        'regions':region_output,'region_coverage':coverage,
        'address_coverage':{'patients':address_count,'total':len(people),'percent':round(100*address_count/len(people),2) if people else None},
        'address_diagnostics':{'reasons':[{'code':k,'label':reason_labels.get(k,'추가 확인 필요'),'patients':v} for k,v in address_reasons.most_common()],
            'methods':dict(address_methods),'reference':snapshot.address_source,
            'basis':'제공 보고서에서 가장 최근에 확인된 주소를 사용합니다. 내원 당시 거주지와 다를 수 있습니다.'},
        'map_provenance':snapshot.index.provenance,
        'reports':{'year':report_year,'scope':'연도별 제공 보고서 전체 · 상단 날짜필터와 별도','reservations':report.get('reservations',[]),'consultations':report.get('consultations',[]),'treatments':report.get('treatments',[]),'fees':report.get('fees',[]),'age_report':report.get('age_report',[])},
        'quality':{**snapshot.quality,'monthly_checks':len(reconciliation),'monthly_passed':sum(x['matches'] for x in reconciliation),'monthly_mismatches':[x for x in reconciliation if not x['matches']],
            'financial':{'year':report_year,'reception_treatment_total':treatment_sum,'channel_report_treatment_total':report_total,'difference':report_total-treatment_sum if report_total is not None and treatment_sum is not None else None,'reconciled':False}},
        'sources':snapshot.inventory,
        'definitions':{'new_patients':'EMR 신구=신환인 기간 내 고유환자. 최초내원일 기준 분류와 다를 수 있습니다.',
            'cohorts':'신규군: 선택기간에 신환 표시가 한 번 이상 있는 환자. 재방문군: 나머지 환자. 일자·요일·지역 추이도 선택기간의 동일 환자군을 유지합니다. 재방문군은 기간 중 2회 이상 방문한 인원과 다릅니다.',
            'treatment':'접수목록 총진료비의 기록 합계. 공단부담·본인부담·비급여 등 포함 여부와 조회조건을 원장 대사하기 전의 값이며 실제 수납과 다릅니다.',
            'collection':'카드·현금·기타(온라인)에 기록된 금액 합계. 접수일 기준이며 결제일 기준 수납원장과 대사 전입니다.',
            'region':'내보낸 파일에 기록된 주소를 공개 법정동·시군구에 연결. 내원 당시 거주지 또는 정확한 위치를 검증한 자료가 아닙니다.',
            'suppression':'지역 고유환자 5명 미만은 상세 지표 비공개. 소수 환자군은 보완 집계도 숨기며 소수 월이 있으면 월별 추이를 공개하지 않습니다. 파일럿 표시 규칙이며 모든 질의의 통계적 익명성을 보장하지는 않습니다.'},
    }
