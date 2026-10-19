"""Curated clinic facts and manual content/review workflows; no patient or model access."""
from datetime import date,datetime
from html import escape
from urllib.parse import urlsplit
from .loader import DataError,KST
from .marketing import text,now

CATEGORIES={'treatment':'진료 · 시술','equipment':'장비','hours':'진료시간','location':'위치 · 주차','doctor':'의료진','philosophy':'진료 철학','difference':'차별점','tone':'표현 · 말투','faq':'자주 묻는 질문','other':'기타'}
FORMATS={'blog':'블로그','place':'플레이스','meta':'META','image':'이미지','video':'영상','community':'지역 커뮤니티','other':'기타'}


def today():return datetime.now(KST).date().isoformat()


def day(value,label,required=False):
    value=text(value,label,10,required)
    if not value:return ''
    try:return date.fromisoformat(value).isoformat()
    except ValueError:raise DataError(f'{label} 날짜를 확인해 주세요.') from None


def url(value,label,required=False):
    value=text(value,label,1500,required)
    if value:
        try:
            parsed=urlsplit(value)
            if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or any(c.isspace() for c in value):raise ValueError
            parsed.port
        except ValueError:raise DataError(f'{label}은 http 또는 https 주소로 입력해 주세요.') from None
    return value


def valid(fact,as_of=None):
    current=as_of or today()
    return fact['status']=='approved' and (not fact['valid_from'] or fact['valid_from']<=current) and (not fact['valid_until'] or current<=fact['valid_until'])


def source_refs(state,ids,required=False,fallback=None,preserve=False):
    if not isinstance(ids,list) or len(ids)>50 or any(not isinstance(i,str) for i in ids) or len(set(ids))!=len(ids):raise DataError('연결할 병원 자료를 확인해 주세요. 최대 50개입니다.')
    if required and not ids:raise DataError('검토를 마친 유효한 병원 자료를 연결해 주세요.')
    available={x['id']:x for x in state['knowledge']};saved={x['id']:x for x in fallback or []};result=[]
    for identifier in ids:
        if preserve and identifier in saved:result.append(dict(saved[identifier]));continue
        fact=available.get(identifier)
        if not fact or not valid(fact):
            if identifier in saved:result.append(dict(saved[identifier]));continue
            raise DataError('연결 자료가 없거나 검토 전·유효기간 밖입니다. 병원 자료를 먼저 확인해 주세요.')
        result.append({k:fact[k] for k in ('id','version','title','category','body','source_type','source_label','source_url','source_date','valid_from','valid_until')})
    return result


def stale_sources(entity,state):
    facts={x['id']:x for x in state['knowledge']}
    return [ref['title'] for ref in entity.get('knowledge_refs',[]) if ref['id'] not in facts or not valid(facts[ref['id']]) or facts[ref['id']]['version']!=ref['version']]


def annotate(state):
    for fact in state['knowledge']:fact['eligible']=valid(fact)
    for item in state['contents']+state['strategies']:
        stale=stale_sources(item,state);item['stale_sources']=stale
        item['effective_status']='needs_review' if stale and item['status']!='archived' else item['status']
    return state


def prepare(kind,data,state,previous):
    entity={key:text(data.get(key),label,limit,key=='title') for key,label,limit in [('title','제목',150),('owner','담당자',100),('reviewer','검토자',100),('notes','메모',4000)]}
    entity['version']=(previous.get('version',0) if previous else 0)+1
    if kind=='knowledge':return fact_record(entity,data,previous)
    if kind=='contents':return content_record(entity,data,state,previous)
    return review_record(entity,data,state,previous)


def approval(entity,data,previous,changed,statuses):
    status=data.get('status','draft')
    if status not in statuses:raise DataError('업무 상태를 확인해 주세요.')
    old_approval=previous.get('approved_at') if previous else None
    if old_approval and changed and status!='archived':status='draft';entity['reviewer']='';old_approval=None
    if status in ('approved','published'):
        if not entity['owner'] or not entity['reviewer']:raise DataError('검토 완료에는 담당자와 검토자 기록이 필요합니다.')
        entity['approved_at']=old_approval or now()
    else:entity['approved_at']=None
    entity['status']=status
    return entity


def fact_record(entity,data,previous):
    category=data.get('category');source_type=data.get('source_type')
    if category not in CATEGORIES or source_type not in ('website','document','interview','manual'):raise DataError('자료 분류와 출처 유형을 선택해 주세요.')
    entity.update(category=category,source_type=source_type,body=text(data.get('body'),'확인된 내용',12000,True),
        source_label=text(data.get('source_label'),'출처 이름',300,True),source_url=url(data.get('source_url'),'출처 링크',source_type=='website'),
        source_date=day(data.get('source_date'),'출처 확인일',True),valid_from=day(data.get('valid_from'),'유효 시작일'),valid_until=day(data.get('valid_until'),'유효 종료일'))
    if entity['valid_from'] and entity['valid_until'] and entity['valid_from']>entity['valid_until']:raise DataError('유효 종료일은 시작일 이후로 입력해 주세요.')
    if entity['source_date']>today():raise DataError('출처 확인일은 오늘까지의 실제 확인 날짜로 입력해 주세요.')
    keys=('title','body','category','source_type','source_label','source_url','source_date','valid_from','valid_until','notes')
    changed=bool(previous and any(previous.get(k)!=entity[k] for k in keys))
    # Versions identify factual content, not an administrative status transition.
    entity['version']=previous['version']+(1 if changed else 0) if previous else 1
    return approval(entity,data,previous,changed,{'draft','review','approved','archived'})


def content_record(entity,data,state,previous):
    fmt=data.get('format');status=data.get('status','draft')
    if fmt not in FORMATS:raise DataError('콘텐츠 형식을 선택해 주세요.')
    campaign=data.get('campaign_id') or None
    if campaign and not any(x['id']==campaign for x in state['campaigns']):raise DataError('이 병원의 캠페인을 선택해 주세요.')
    entity.update(format=fmt,campaign_id=campaign,reference_url=url(data.get('reference_url'),'레퍼런스 링크'),
        reference_structure=text(data.get('reference_structure'),'레퍼런스 구성',8000),
        generation_brief=text(data.get('generation_brief'),'생성으로 받을 것',8000),editing_brief=text(data.get('editing_brief'),'편집으로 처리할 것',8000),
        draft=text(data.get('draft'),'검토할 문안',16000),due_date=day(data.get('due_date'),'예정일'))
    ids=data.get('knowledge_ids',[])
    fallback=previous.get('knowledge_refs') if previous and status in ('draft','archived') else None
    entity['knowledge_refs']=source_refs(state,ids,status in ('review','approved','published'),fallback,status=='archived')
    entity['knowledge_ids']=ids
    if status in ('review','approved','published') and (not entity['reference_url'] or not entity['reference_structure']):raise DataError('검토 전에 레퍼런스 링크와 구조를 기록해 주세요.')
    entity['published_url']=url(data.get('published_url'),'게시 확인 링크')
    entity['published_at']=day(data.get('published_at'),'게시 확인일')
    if entity['published_at'] and entity['published_at']>today():raise DataError('게시 확인일은 오늘까지의 실제 게시 날짜로 입력해 주세요.')
    keys=('title','format','campaign_id','reference_url','reference_structure','generation_brief','editing_brief','draft','knowledge_refs','notes')
    changed=bool(previous and any(previous.get(k)!=entity[k] for k in keys))
    if status=='published':
        if not previous or previous['status'] not in ('approved','published') or changed or stale_sources(previous,state):raise DataError('최신 자료로 콘텐츠 검토를 마친 뒤 게시 사실을 기록해 주세요.')
        if not entity['published_url'] or not entity['published_at']:raise DataError('게시 확인 링크와 날짜를 입력해 주세요.')
    result=approval(entity,data,previous,changed,{'draft','review','approved','published','archived'})
    if result['status']!='published':result['published_url']='';result['published_at']=''
    return result


def instant(value,label,required=False):
    value=text(value,label,40,required)
    if not value:return '',None
    try:
        stamp=datetime.fromisoformat(value)
        if stamp.tzinfo is None:raise ValueError
        if stamp>datetime.now(KST):raise ValueError
        return stamp.astimezone(KST).isoformat(),stamp
    except ValueError:raise DataError(f'{label} 시각과 시간대를 확인해 주세요.') from None


def review_record(entity,data,state,previous):
    status=data.get('status','detected');platform=data.get('platform','naver_place')
    if status not in ('detected','in_progress','submitted','resolved','closed') or platform not in ('naver_place','google','community','other'):raise DataError('리뷰 상태와 채널을 확인해 주세요.')
    entity.update(status=status,platform=platform,source_url=url(data.get('source_url'),'원문 링크',True),
        summary=text(data.get('summary'),'쟁점 요약',4000),reply_draft=text(data.get('reply_draft'),'응답 검토안',8000),
        resolution_note=text(data.get('resolution_note'),'처리 결과 기록',4000),outcome=text(data.get('outcome'),'확인 결과',40))
    if entity['outcome'] not in ('','still_visible','removed','restored','unconfirmed'):raise DataError('확인 결과를 선택해 주세요.')
    stamps={}
    for key,label in [('found_at','발견'),('started_at','대응 시작'),('submitted_at','플랫폼 접수'),('resolved_at','처리 확인')]:
        entity[key],stamps[key]=instant(data.get(key),label,key=='found_at')
    prior=None
    for stamp in stamps.values():
        if stamp and prior and stamp<prior:raise DataError('발견 → 대응 시작 → 접수 → 처리 확인 순서로 시각을 입력해 주세요.')
        if stamp:prior=stamp
    if status!='detected' and (not entity['owner'] or not stamps['started_at']):raise DataError('대응 담당자와 시작 시각을 입력해 주세요.')
    if status=='submitted' and not stamps['submitted_at']:raise DataError('플랫폼에 접수한 시각을 입력해 주세요.')
    if status in ('resolved','closed') and (not stamps['resolved_at'] or not entity['outcome'] or not entity['resolution_note']):raise DataError('처리 확인 시각·표시 상태·결과 기록을 입력해 주세요.')
    entity['response_minutes']=round((stamps['started_at']-stamps['found_at']).total_seconds()/60,1) if stamps['started_at'] else None
    entity['resolution_minutes']=round((stamps['resolved_at']-stamps['found_at']).total_seconds()/60,1) if stamps['resolved_at'] else None
    return entity


def search(state,query):
    query=text(query,'검색어',200,True);words=query.casefold().split();matches=[]
    for fact in state['knowledge']:
        if not valid(fact):continue
        haystack=(fact['title']+' '+fact['body']+' '+CATEGORIES[fact['category']]).casefold()
        if all(word in haystack for word in words):matches.append({**fact,'excerpt':fact['body'][:500]})
    matches.sort(key=lambda x:(-sum(w in x['title'].casefold() for w in words),x['title']))
    return {'query':query,'engine':'local_keyword','checked_at':now(),'total':len(matches),'matches':matches[:50]}


def content_html(state,identifier):
    content=next((x for x in state['contents'] if x['id']==identifier),None)
    if not content:raise DataError('콘텐츠 기획을 찾지 못했습니다.')
    e=lambda value:escape(str(value or ''),quote=True)
    rows=''.join(f'<article><h3>{e(x["title"])} · v{x["version"]}</h3><p>{e(x["body"])}</p><p>출처: {e(x["source_label"])} · 확인일 {e(x["source_date"])}<br>{e(x["source_url"])}</p></article>' for x in content['knowledge_refs'])
    stale=stale_sources(content,state)
    return f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(content['title'])}</title><style>body{{max-width:900px;margin:40px auto;padding:20px;font:15px/1.8 sans-serif;color:#28364e}}p{{white-space:pre-wrap;overflow-wrap:anywhere}}article,section{{border:1px solid #d9dfeb;padding:18px;margin:18px 0}}.brief{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}@media(max-width:600px){{.brief{{grid-template-columns:1fr}}}}@media print{{body{{margin:0}}article,section{{break-inside:avoid}}}}</style><h1>{e(content['title'])}</h1><p>자료 확인 {e(now())} · 상태 {e('재검토 필요' if stale else content['status'])}<br>담당자 {e(content['owner'])} · 검토자 기록 {e(content['reviewer'])}</p><p>{e('변경·만료된 근거: '+', '.join(stale) if stale else '')}</p><h2>레퍼런스 구조</h2><p>{e(content['reference_url'])}</p><p>{e(content['reference_structure'])}</p><div class="brief"><section><h2>생성으로 받을 것</h2><p>{e(content['generation_brief'])}</p></section><section><h2>편집으로 처리할 것</h2><p>{e(content['editing_brief'])}</p></section></div><h2>검토할 문안</h2><p>{e(content['draft'])}</p><h2>연결한 병원 자료</h2>{rows}<p>이 문서는 기획·검토 기록입니다. 외부 게시나 이미지·영상 생성은 실행하지 않습니다.</p></html>'''
