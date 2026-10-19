"""Clinic-scoped local operations with transactional revisions and an audit trail."""
import json
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date,datetime
from pathlib import Path
from .loader import DataError,KST

CHANNELS={'naver_place':'네이버 플레이스','naver_blog':'네이버 블로그','naver_search':'네이버 검색광고','meta':'META','community':'지역 커뮤니티','offline':'오프라인','other':'기타'}
KINDS=('strategies','campaigns','expenses','reports','knowledge','contents','reviews')
ACTOR=ContextVar('marketing_actor',default=None)
INITIALIZE_LOCK=threading.Lock()


@contextmanager
def record_actor(principal):
    token=ACTOR.set(principal)
    try:yield
    finally:ACTOR.reset(token)


def now():return datetime.now(KST).isoformat()


def text(value,label,max_length=2000,required=False):
    if value is None:value=''
    if not isinstance(value,str) or len(value)>max_length:raise DataError(f'{label} 입력 길이와 형식을 확인해 주세요.')
    value=value.strip()
    if required and not value:raise DataError(f'{label}을 입력해 주세요.')
    return value


def money(value,label,optional=False):
    if value is None and optional:return None
    if type(value)!=int or not 0<=value<=10**12:raise DataError(f'{label}은 0 이상 정수 원 단위로 입력해 주세요.')
    return value


def period(start,end):
    try:
        left=date.fromisoformat(start);right=date.fromisoformat(end)
        if left>right or (right-left).days>3660:raise ValueError
        return left.isoformat(),right.isoformat()
    except (ValueError,TypeError):raise DataError('시작일·종료일을 확인해 주세요. 최대 10년입니다.') from None


def totals(state):
    campaigns={x['id']:x for x in state['campaigns']}
    result={key:{'net_spend':0,'charges':0,'refunds':0,'child_budget':0} for key in campaigns}
    all_charges=all_refunds=0
    for entry in state['expenses']:
        if entry.get('voided'):continue
        refund=entry['direction']=='refund';field='refunds' if refund else 'charges'
        if refund:all_refunds+=entry['amount']
        else:all_charges+=entry['amount']
        campaign=campaigns[entry['campaign_id']]
        for key in {campaign['id'],campaign.get('parent_id')}-{None,''}:
            result[key][field]+=entry['amount'];result[key]['net_spend']+=(-1 if refund else 1)*entry['amount']
    for campaign in campaigns.values():
        if campaign.get('parent_id'):result[campaign['parent_id']]['child_budget']+=campaign.get('budget') or 0
    summary={'charges':all_charges,'refunds':all_refunds,'net_spend':all_charges-all_refunds,
        'root_budget':sum(x.get('budget') or 0 for x in campaigns.values() if not x.get('parent_id') and x['status']!='cancelled'),
        'strategies':len(state['strategies']),'campaigns':len(campaigns),'running':sum(x['status']=='running' for x in campaigns.values()),
        'approval_waiting':sum(x['status']=='review' for x in state['strategies'])}
    return summary,result


class MarketingStore:
    def __init__(self,path,clinic_id):self.path=Path(path);self.clinic_id=clinic_id;self.marker=self.path.with_suffix(self.path.suffix+'.initialized')

    @contextmanager
    def connection(self,write=False):
        conn=None
        try:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            with INITIALIZE_LOCK:
                existing=self.path.exists()
                if not existing and self.marker.exists():raise DataError('작업공간 저장소가 없습니다. 기존 자료를 빈 장부로 바꾸지 않습니다.')
                if not existing:self.marker.write_text('initialized\n',encoding='ascii')
                conn=sqlite3.connect(self.path,timeout=25,isolation_level=None)
                if not existing:
                    conn.execute('CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), clinic_id TEXT, revision INTEGER, payload TEXT)')
                    conn.execute('CREATE TABLE audit (revision INTEGER PRIMARY KEY, at TEXT, action TEXT, entity_id TEXT, before_json TEXT, after_json TEXT)')
                else:
                    conn.execute('SELECT id,clinic_id,revision,payload FROM workspace LIMIT 0')
                    conn.execute('SELECT revision,at,action,entity_id,before_json,after_json FROM audit LIMIT 0')
                    if not self.marker.exists():self.marker.write_text('initialized\n',encoding='ascii')
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            row=conn.execute('SELECT clinic_id,revision,payload FROM workspace WHERE id=1').fetchone()
            if not row and conn.execute('SELECT count(*) FROM audit').fetchone()[0]:raise DataError('감사 이력과 작업공간이 일치하지 않습니다.')
            if row and row[0]!=self.clinic_id:raise DataError('병원 작업공간이 일치하지 않습니다.')
            state=json.loads(row[2]) if row else {kind:[] for kind in KINDS}
            if not isinstance(state,dict):raise DataError('마케팅 작업공간 형식이 올바르지 않습니다.')
            for kind in ('knowledge','contents','reviews'):state.setdefault(kind,[])
            if any(not isinstance(state.get(kind),list) for kind in KINDS):raise DataError('마케팅 작업공간을 읽지 못했습니다.')
            yield conn,state,row[1] if row else 0
            conn.commit()
        except (sqlite3.Error,OSError,ValueError,TypeError,KeyError):
            if conn:conn.rollback()
            raise DataError('작업공간을 읽거나 저장하지 못했습니다. 다시 확인해 주세요.') from None
        except Exception:
            if conn:conn.rollback()
            raise
        finally:
            if conn:conn.close()

    def snapshot(self):
        from .knowledge import annotate,CATEGORIES,FORMATS
        with self.connection() as (conn,state,revision):
            summary,by_campaign=totals(state)
            annotate(state)
            return {**state,'clinic_id':self.clinic_id,'revision':revision,'checked_at':now(),'summary':summary,'campaign_totals':by_campaign,
                'channels':CHANNELS,'knowledge_categories':CATEGORIES,'content_formats':FORMATS,'audit_count':conn.execute('SELECT count(*) FROM audit').fetchone()[0]}

    def _check_revision(self,expected,actual):
        if type(expected)!=int or expected!=actual:raise DataError('다른 화면에서 자료가 변경됐습니다. 새로고침 후 다시 저장해 주세요.')

    def _persist(self,conn,state,revision,action,entity,before=None):
        actor=ACTOR.get()
        if actor:entity['recorded_by']={k:actor[k] for k in ('id','username','name')}
        payload=json.dumps(state,ensure_ascii=False,allow_nan=False)
        conn.execute('INSERT OR REPLACE INTO workspace VALUES(1,?,?,?)',(self.clinic_id,revision+1,payload))
        conn.execute('INSERT INTO audit VALUES(?,?,?,?,?,?)',(revision+1,now(),action,entity['id'],json.dumps(before,ensure_ascii=False),json.dumps(entity,ensure_ascii=False)))
        return {'revision':revision+1,'entity':entity}

    def save(self,kind,data,revision,*,evidence=None):
        if kind not in ('strategies','campaigns','expenses','knowledge','contents','reviews') or not isinstance(data,dict):raise DataError('지원하는 입력 항목이 아닙니다.')
        with self.connection(True) as (conn,state,current):
            self._check_revision(revision,current)
            identifier=data.get('id') or uuid.uuid4().hex
            if not isinstance(identifier,str) or not re.fullmatch('[a-f0-9]{32}',identifier):raise DataError('항목 식별자가 올바르지 않습니다.')
            previous=next((x for x in state[kind] if x['id']==identifier),None)
            if data.get('id') and previous is None:raise DataError('수정할 항목이 없습니다.')
            if not previous and len(state[kind])>=5000:raise DataError('이 작업공간의 항목 수 한도에 도달했습니다.')
            if kind in ('knowledge','contents','reviews'):
                from .knowledge import prepare
                entity=prepare(kind,data,state,previous)
            else:entity=self._expense(data,state,previous) if kind=='expenses' else self._plan(kind,data,state,previous,evidence)
            entity.update(id=identifier,created_at=previous['created_at'] if previous else now(),updated_at=now())
            if previous:state[kind][state[kind].index(previous)]=entity
            else:state[kind].append(entity)
            return self._persist(conn,state,current,kind+'.save',entity,previous)

    def _plan(self,kind,data,state,previous,evidence):
        entity={k:text(data.get(k),label,limit,k=='title') for k,label,limit in [('title','제목',150),('owner','담당자',100),('notes','메모',4000),('reviewer','검토자',100)]}
        entity['start'],entity['end']=period(data.get('start'),data.get('end'))
        channel=data.get('channel')
        if channel not in CHANNELS:raise DataError('채널을 선택해 주세요.')
        entity.update(channel=channel,budget=money(data.get('budget'),'예산',True))
        statuses={'draft','review','approved','archived'} if kind=='strategies' else {'planned','approved','running','paused','completed','cancelled'}
        status=data.get('status','draft' if kind=='strategies' else 'planned')
        if status not in statuses:raise DataError('상태를 확인해 주세요.')
        if kind=='strategies':
            level=data.get('region_level');code=data.get('region_code')
            if level not in ('sig','emd') or not isinstance(code,str) or not re.fullmatch(r'\d{5}' if level=='sig' else r'\d{8}',code):raise DataError('대상 지역을 선택해 주세요.')
            entity.update(region_level=level,region_code=code)
            for key,label in [('hypothesis','가설'),('focus','주력 진료'),('audience','대상'),('keywords','키워드'),('goal','측정 목표')]:entity[key]=text(data.get(key),label)
            entity['evidence']=evidence if evidence is not None else previous.get('evidence') if previous else None
            from .knowledge import source_refs
            ids=data.get('knowledge_ids',previous.get('knowledge_ids',[]) if previous else [])
            fallback=previous.get('knowledge_refs') if previous and status in ('draft','archived') else None
            entity['knowledge_refs']=source_refs(state,ids,False,fallback,status=='archived')
            entity['knowledge_ids']=ids
            # Generation provenance is server-owned; later manual edits retain its original snapshot.
            if previous and previous.get('ai_origin'):entity['ai_origin']=previous['ai_origin']
        else:
            from .campaign_locations import prepare_location
            entity.update(prepare_location({**(previous or {}),**data}))
            parent=data.get('parent_id') or None;strategy=data.get('strategy_id') or None
            campaigns={x['id']:x for x in state['campaigns']}
            if strategy and not any(x['id']==strategy and x['status']!='archived' for x in state['strategies']):raise DataError('연결할 전략이 없거나 보관된 전략입니다.')
            if parent:
                root=campaigns.get(parent)
                if not root or root.get('parent_id') or parent==data.get('id'):raise DataError('상위 캠페인 아래 한 단계의 집행만 연결할 수 있습니다.')
                if root['status']=='cancelled' or entity['start']<root['start'] or entity['end']>root['end']:raise DataError('하위 집행은 유효한 상위 캠페인의 기간 안에 있어야 합니다.')
            children=[x for x in state['campaigns'] if data.get('id') and x.get('parent_id')==data['id']]
            if children and (parent or any(x['start']<entity['start'] or x['end']>entity['end'] for x in children)):raise DataError('기존 하위 집행의 구조와 기간을 유지해 주세요.')
            if previous and previous.get('parent_id')!=parent and any(x['campaign_id']==previous['id'] and not x.get('voided') for x in state['expenses']):raise DataError('집행비가 기록된 항목은 상위 캠페인을 변경할 수 없습니다.')
            entity.update(parent_id=parent,strategy_id=strategy,vendor=text(data.get('vendor'),'매체·외주사',150),evidence_url=text(data.get('evidence_url'),'집행 증빙 링크',1000))
            if entity['evidence_url'] and not re.match(r'^https?://',entity['evidence_url'],re.I):raise DataError('증빙 링크는 http 또는 https 주소로 입력해 주세요.')
        approved_at=previous.get('approved_at') if previous else None
        changed=bool(previous and any(entity.get(k)!=previous.get(k,[] if k in ('knowledge_ids','knowledge_refs') else None) for k in entity if k!='reviewer'))
        if changed and approved_at:
            if status not in ('archived','cancelled'):status='draft' if kind=='strategies' else 'planned'
            approved_at=None;entity['reviewer']=''
        elif status in ('approved','running','paused','completed'):
            if not entity['reviewer'] or not entity['owner']:raise DataError('승인·진행 상태에는 담당자와 검토자 기록이 필요합니다.')
            approved_at=approved_at or now()
        elif status in ('draft','review','planned'):
            approved_at=None
        entity.update(status=status,approved_at=approved_at)
        return entity

    def _expense(self,data,state,previous):
        if previous:raise DataError('저장된 집행비는 수정하지 않습니다. 취소 후 새 내역을 기록해 주세요.')
        campaign=next((x for x in state['campaigns'] if x['id']==data.get('campaign_id')),None)
        if not campaign:raise DataError('비용을 연결할 캠페인을 선택해 주세요.')
        day,_=period(data.get('date'),data.get('date'));amount=money(data.get('amount'),'금액')
        if amount==0:raise DataError('집행비는 0원보다 커야 합니다.')
        direction=data.get('direction','charge');category=data.get('category')
        if direction not in ('charge','refund') or category not in ('media','production','vendor','other'):raise DataError('비용 종류를 확인해 주세요.')
        reference=text(data.get('reference'),'거래·증빙 번호',150)
        active=[x for x in state['expenses'] if not x.get('voided')]
        if reference and any(x['reference']==reference for x in active):raise DataError('같은 거래·증빙 번호가 이미 기록돼 있습니다.')
        refund_of=data.get('refund_of') or None
        if direction=='refund':
            original=next((x for x in active if x['id']==refund_of and x['direction']=='charge'),None)
            if not original or original['campaign_id']!=campaign['id'] or day<original['date']:raise DataError('같은 캠페인의 원 지출과 환불 날짜를 확인해 주세요.')
            refunded=sum(x['amount'] for x in active if x.get('refund_of')==refund_of)
            if refunded+amount>original['amount']:raise DataError('환불 합계가 원 지출을 초과합니다.')
        elif refund_of:raise DataError('지출에는 환불 원거래를 연결하지 않습니다.')
        return {'campaign_id':campaign['id'],'date':day,'amount':amount,'direction':direction,'category':category,'reference':reference,
            'refund_of':refund_of,'notes':text(data.get('notes'),'비용 메모',2000),'voided':False}

    def void_expense(self,identifier,revision,reason):
        reason=text(reason,'취소 사유',500,True)
        with self.connection(True) as (conn,state,current):
            self._check_revision(revision,current)
            old=next((x for x in state['expenses'] if x['id']==identifier),None)
            if not old or old.get('voided'):raise DataError('취소할 지출 내역이 없습니다.')
            if any(x.get('refund_of')==identifier and not x.get('voided') for x in state['expenses']):raise DataError('환불이 연결된 원 지출은 환불 내역을 먼저 정정해 주세요.')
            entity={**old,'voided':True,'void_reason':reason,'updated_at':now()}
            state['expenses'][state['expenses'].index(old)]=entity
            return self._persist(conn,state,current,'expenses.void',entity,old)

    def create_report(self,data,revision,notes):
        notes=self._report_notes(notes)
        with self.connection(True) as (conn,state,current):
            self._check_revision(revision,current)
            if data.get('workspace_revision')!=current:raise DataError('보고서 생성 중 장부가 변경됐습니다. 다시 생성해 주세요.')
            if len(state['reports'])>=500:raise DataError('보고서 보관 한도에 도달했습니다.')
            entity={'id':uuid.uuid4().hex,'month':data['month'],'status':'draft','created_at':now(),'updated_at':now(),'notes':notes,'data':data,'reviewer':'','reviewed_at':None}
            state['reports'].append(entity)
            return self._persist(conn,state,current,'reports.create',entity)

    def _report_notes(self,notes):
        if not isinstance(notes,dict):raise DataError('담당자 해석과 다음 행동을 확인해 주세요.')
        return {key:text(notes.get(key),label,6000) for key,label in [('interpretation','담당자 해석'),('next_actions','다음 행동')]}

    def update_report_notes(self,identifier,revision,notes):
        notes=self._report_notes(notes)
        with self.connection(True) as (conn,state,current):
            self._check_revision(revision,current)
            old=next((x for x in state['reports'] if x['id']==identifier),None)
            if not old or old['status']!='draft':raise DataError('검토 전 초안만 수정할 수 있습니다. 새 보고서를 생성해 주세요.')
            entity={**old,'notes':notes,'updated_at':now()};state['reports'][state['reports'].index(old)]=entity
            return self._persist(conn,state,current,'reports.notes',entity,old)

    def review_report(self,identifier,revision,reviewer):
        reviewer=text(reviewer,'검토자',100,True)
        with self.connection(True) as (conn,state,current):
            self._check_revision(revision,current)
            old=next((x for x in state['reports'] if x['id']==identifier),None)
            if not old or old['status']!='draft':raise DataError('검토할 초안이 없습니다.')
            entity={**old,'status':'reviewed','reviewer':reviewer,'reviewed_at':now(),'updated_at':now()};state['reports'][state['reports'].index(old)]=entity
            return self._persist(conn,state,current,'reports.review',entity,old)
