"""Fresh, deterministic follow-up list from recorded dates and review states."""
from datetime import date,timedelta
from .knowledge import today
from .loader import DataError


def work_queue(state,as_of=None):
    try:
        for kind,fields in {'campaigns':('start','end','renewal_on'),'contents':('due_date',),'knowledge':('valid_until',),'expenses':('date',)}.items():
            for item in state[kind]:
                for field in fields:
                    if item.get(field):date.fromisoformat(item[field])
        return _queue(state,as_of)
    except (KeyError,TypeError,ValueError,AttributeError):
        raise DataError('저장된 검토·일정 항목의 형식을 확인해 주세요.') from None


def _queue(state,as_of=None):
    current=as_of or today();day=date.fromisoformat(current);soon=(day+timedelta(days=7)).isoformat();tasks=[]
    def add(kind,item,reason,priority=2,due='',**extra):
        tasks.append({'kind':kind,'entity_id':item.get('id',''),'title':item.get('title','월간 보고서'),'owner':item.get('owner',''),'reason':reason,'priority':priority,'due':due,**extra})
    for item in state['strategies']:
        if item['status']=='archived':continue
        if item.get('effective_status')=='needs_review':add('strategies',item,'전략에 연결한 병원 자료 재검토 필요',1)
        elif item['status']=='review':add('strategies',item,'전략 검토 요청')
    for item in state['knowledge']:
        if item['status']=='approved' and item.get('valid_until') and item['valid_until']<current:add('knowledge',item,'자료 유효기간 지남',1,item['valid_until'])
        elif item['status']=='review':add('knowledge',item,'병원 자료 검토 요청')
        elif item['status']=='approved' and item.get('valid_until') and current<=item['valid_until']<=soon:add('knowledge',item,'7일 내 자료 유효기간 종료',3,item['valid_until'])
    for item in state['contents']:
        if item['status']=='archived':continue
        due=item.get('due_date','')
        if item.get('effective_status')=='needs_review':add('contents',item,'연결한 병원 자료 재검토 필요',1,due)
        elif item['status']=='published':continue
        elif due and due<current:add('contents',item,'제작 예정일 지남',1,due)
        elif item['status']=='review':add('contents',item,'콘텐츠 검토 요청',2,due)
        elif due and due<=soon:add('contents',item,'오늘 제작 예정' if due==current else '7일 내 제작 예정',2 if due==current else 3,due)
    for item in state['campaigns']:
        renewal=item.get('renewal_on')
        if item['status']!='cancelled' and renewal and renewal<=soon:
            add('campaigns',item,'계약 갱신 확인일 지남' if renewal<current else '7일 내 계약 갱신 확인',1 if renewal<current else 2,renewal)
        if item['status'] in ('completed','cancelled'):continue
        if item['end']<current:add('campaigns',item,'계획 종료일 지남 · 상태 확인',1,item['end'])
        elif item['end']<=soon:add('campaigns',item,'7일 내 캠페인 종료 예정',3,item['end'])
    for item in state['reviews']:
        if item['status'] not in ('resolved','closed'):add('reviews',item,'리뷰 담당자 배정 필요' if not item.get('owner') else '리뷰 대응 상태 확인',1 if not item.get('owner') else 2)
    first=day.replace(day=1);last_previous=first-timedelta(days=1);month=last_previous.strftime('%Y-%m');start=month+'-01';end=last_previous.isoformat()
    active=any(c['status']!='cancelled' and c['start']<=end and c['end']>=start for c in state['campaigns'])
    active=active or any(not e.get('voided') and start<=e['date']<=end for e in state['expenses'])
    if active:
        reports=[r for r in state['reports'] if r['month']==month];latest=reports[-1] if reports else None
        if not latest or latest['status']!='reviewed':add('clientreports',{'id':latest['id'] if latest else '','title':month+' 월간 보고서'},'최신 월 보고서 검토 필요' if latest else '지난달 활동 보고서 준비',2,month=month)
    return sorted(tasks,key=lambda x:(x['priority'],x['due'] or '9999-99-99',x['kind'],x['title']))
