"""Private agency manual records. No accounting/tax or inferred profit model."""
import csv
import hashlib
import io
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from .loader import DataError
from .marketing import text,period,now,ACTOR
from .knowledge import day,today
from .conversions import opaque

LOCK=threading.Lock()
TAXES={'included':'부가세 포함','excluded':'부가세 제외','unknown':'부가세 미확인'}
DIRECTIONS={'income':'수입','cost':'지출','income_refund':'수입 환불','cost_refund':'지출 환불'}
def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def fingerprint(value):return hashlib.sha256(encoded(value).encode()).hexdigest()
def positive(value,label,maximum):
    if type(value)!=int or not 1<=value<=maximum:raise DataError(f'{label}은 1~{maximum:,} 범위의 정수로 입력해 주세요.')
    return value

class InternalFinanceStore:
    def __init__(self,path,clinic_id):self.path=Path(path);self.clinic_id=clinic_id;self.marker=self.path.with_suffix(self.path.suffix+'.initialized')

    @contextmanager
    def connection(self,write=False):
        conn=None
        try:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            with LOCK:
                exists=self.path.exists()
                if not exists and self.marker.exists():raise DataError('내부 운영 기록 저장소가 없습니다. 빈 자료로 초기화하지 않습니다.')
                if not exists:self.marker.write_text('initialized\n',encoding='ascii')
                conn=sqlite3.connect(self.path,timeout=25,isolation_level=None);conn.row_factory=sqlite3.Row
                if not exists:
                    conn.executescript('''CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1),clinic_id TEXT,revision INTEGER);
                    CREATE TABLE entries(id TEXT PRIMARY KEY,payload TEXT,created_at TEXT,voided INTEGER DEFAULT 0,void_reason TEXT DEFAULT '',voided_at TEXT);
                    CREATE TABLE requests(id TEXT PRIMARY KEY,fingerprint TEXT,entity_id TEXT);
                    CREATE TABLE audit(revision INTEGER PRIMARY KEY,action TEXT,entity_id TEXT,at TEXT,actor TEXT,reason TEXT);''')
                    conn.execute('INSERT INTO meta VALUES(1,?,0)',(self.clinic_id,))
                else:
                    for query in ('SELECT id,clinic_id,revision FROM meta LIMIT 0','SELECT id,payload,created_at,voided,void_reason,voided_at FROM entries LIMIT 0','SELECT id,fingerprint,entity_id FROM requests LIMIT 0','SELECT revision,action,entity_id,at,actor,reason FROM audit LIMIT 0'):conn.execute(query)
                    if not self.marker.exists():self.marker.write_text('initialized\n',encoding='ascii')
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            meta=conn.execute('SELECT * FROM meta WHERE id=1').fetchone()
            if not meta or meta['clinic_id']!=self.clinic_id or type(meta['revision'])!=int or meta['revision']<0:raise DataError('내부 기록의 병원 정보나 버전을 확인하지 못했습니다.')
            yield conn,meta['revision'];conn.commit()
        except (sqlite3.Error,OSError,ValueError,TypeError,KeyError):
            if conn:conn.rollback()
            raise DataError('내부 운영 기록 저장소를 확인하지 못했습니다.') from None
        except Exception:
            if conn:conn.rollback()
            raise
        finally:
            if conn:conn.close()

    def _entries(self,conn):
        entries=[]
        try:
            for r in conn.execute('SELECT * FROM entries ORDER BY created_at,id'):
                item=json.loads(r['payload']);base={'kind','date','owner','note','campaign_id','campaign_title'}
                extra={'minutes','task'} if item['kind']=='time' else {'direction','amount','reference','currency','original_id','tax_basis','category'}
                if set(item)!=base|extra or item['kind'] not in ('time','transaction'):raise ValueError
                if day(item['date'],'기록 일자',True)!=item['date'] or not '2000-01-01'<=item['date']<=today():raise ValueError
                for key,limit,required in [('owner',100,True),('note',1000,False),('campaign_title',2000,bool(item['campaign_id']))]:
                    if text(item[key],key,limit,required)!=item[key]:raise ValueError
                if item['campaign_id'] is not None:opaque(item['campaign_id'])
                elif item['campaign_title']:raise ValueError
                if item['kind']=='time':positive(item['minutes'],'작업 분',1440);text(item['task'],'작업',300,True)
                else:
                    positive(item['amount'],'금액',10**12);text(item['reference'],'증빙',200,True);text(item['category'],'항목',100,True)
                    if item['direction'] not in DIRECTIONS or item['tax_basis'] not in TAXES or item['currency']!='KRW':raise ValueError
                    if item['direction'].endswith('_refund'):opaque(item['original_id'])
                    elif item['original_id'] is not None:raise ValueError
                opaque(r['id'])
                if r['voided'] not in (0,1) or datetime.fromisoformat(r['created_at']).tzinfo is None:raise ValueError
                if r['voided']:
                    text(r['void_reason'],'취소 사유',500,True)
                    if datetime.fromisoformat(r['voided_at']).tzinfo is None:raise ValueError
                elif r['void_reason'] or r['voided_at'] is not None:raise ValueError
                entries.append({**item,'id':r['id'],'created_at':r['created_at'],'voided':bool(r['voided']),'void_reason':r['void_reason'],'voided_at':r['voided_at']})
            by_id={e['id']:e for e in entries};refunds={};times={};references=set()
            for item in entries:
                original_id=item.get('original_id')
                if original_id:
                    original=by_id.get(original_id)
                    if not original or original.get('direction')!=item['direction'].removesuffix('_refund') or item['date']<original['date']:raise ValueError
                    if any(item[k]!=original[k] for k in ('tax_basis','category','campaign_id','campaign_title','currency')):raise ValueError
                    if not item['voided']:
                        if original['voided']:raise ValueError
                        refunds[original_id]=refunds.get(original_id,0)+item['amount']
                        if refunds[original_id]>original['amount']:raise ValueError
                if item['voided']:continue
                if item['kind']=='time':
                    key=(item['date'],item['owner'].casefold());times[key]=times.get(key,0)+item['minutes']
                    if times[key]>1440:raise ValueError
                else:
                    key=(item['direction'],item['reference'].casefold())
                    if key in references:raise ValueError
                    references.add(key)
            return entries
        except (ValueError,TypeError,KeyError,AttributeError,DataError):raise DataError('내부 기록의 값이나 연결이 올바르지 않습니다. 이전 값을 빈 자료로 대체하지 않습니다.') from None

    def _request(self,conn,request_id,signature,revision):
        identifier=opaque(request_id);old=conn.execute('SELECT * FROM requests WHERE id=?',(identifier,)).fetchone()
        if old:
            if old['fingerprint']!=signature:raise DataError('같은 저장 요청의 내용이 달라졌습니다. 새 입력으로 저장해 주세요.')
            item=next((x for x in self._entries(conn) if x['id']==old['entity_id']),None)
            if item is None:raise DataError('저장 요청의 기록을 확인하지 못했습니다.')
            return {'revision':revision,'entity':item,'duplicate':True}
        return None

    def _revision(self,requested,current):
        if type(requested)!=int or requested!=current:raise DataError('내부 기록이 바뀌었습니다. 현재 자료를 확인하고 다시 저장해 주세요.')

    def _audit(self,conn,current,action,identifier,reason,request_id,signature):
        actor=ACTOR.get();actor={k:actor[k] for k in ('id','username','name')} if actor else None
        conn.execute('UPDATE meta SET revision=? WHERE id=1',(current+1,))
        conn.execute('INSERT INTO audit VALUES(?,?,?,?,?,?)',(current+1,action,identifier,now(),encoded(actor),reason))
        conn.execute('INSERT INTO requests VALUES(?,?,?)',(opaque(request_id),signature,identifier))

    def _prepare(self,raw,entries,workspace):
        if raw.get('currency') not in (None,'KRW'):raise DataError('현재 내부 기록은 원화(KRW)만 받습니다.')
        stamp=day(raw.get('date'),'기록 일자',True)
        if not '2000-01-01'<=stamp<=today():raise DataError('기록 일자는 2000년부터 오늘까지 입력할 수 있습니다.')
        item={'kind':raw.get('kind'),'date':stamp,'owner':text(raw.get('owner'),'담당자',100,True),'note':text(raw.get('note'),'메모',1000)}
        campaign_id=opaque(raw['campaign_id']) if raw.get('campaign_id') else None
        campaign=next((c for c in workspace['campaigns'] if c['id']==campaign_id),None)
        if campaign_id and not campaign:raise DataError('현재 병원의 캠페인을 선택해 주세요.')
        item.update(campaign_id=campaign_id,campaign_title=campaign['title'] if campaign else '')
        active=[e for e in entries if not e['voided']]
        if item['kind']=='time':
            item.update(minutes=positive(raw.get('minutes'),'작업 분',1440),task=text(raw.get('task'),'작업 내용',300,True))
            total=sum(e['minutes'] for e in active if e['kind']=='time' and e['date']==stamp and e['owner'].casefold()==item['owner'].casefold())
            if total+item['minutes']>1440:raise DataError('이 병원에서 같은 담당자명·일자의 유효 작업시간이 24시간을 넘습니다.')
        elif item['kind']=='transaction':
            direction=raw.get('direction')
            if direction not in DIRECTIONS:raise DataError('거래 구분을 선택해 주세요.')
            item.update(direction=direction,amount=positive(raw.get('amount'),'기록 금액',10**12),reference=text(raw.get('reference'),'거래 증빙번호',200,True),currency='KRW',original_id=None)
            if any(e['kind']=='transaction' and e['direction']==direction and e['reference'].casefold()==item['reference'].casefold() for e in active):raise DataError('같은 거래 구분·증빙번호의 유효 기록이 있습니다. 정정은 기존 거래를 취소한 뒤 입력해 주세요.')
            if direction.endswith('_refund'):
                original_id=opaque(raw.get('original_id'));original=next((e for e in active if e['id']==original_id),None)
                if not original or original['kind']!='transaction' or original['direction']!=direction.removesuffix('_refund'):raise DataError('같은 거래 방향의 유효한 원거래를 선택해 주세요.')
                if stamp<original['date']:raise DataError('환불일은 원거래일 이후여야 합니다.')
                refunded=sum(e['amount'] for e in active if e.get('original_id')==original_id)
                if refunded+item['amount']>original['amount']:raise DataError('유효 환불 합계가 원거래 금액을 넘습니다.')
                supplied={**raw,'campaign_id':campaign_id} if 'campaign_id' in raw else raw
                if any(k in supplied and supplied[k]!=original[k] for k in ('tax_basis','category','campaign_id','currency')):raise DataError('환불은 원거래의 부가세 기준·항목·캠페인·통화를 유지해야 합니다.')
                item.update({k:original[k] for k in ('tax_basis','category','campaign_id','campaign_title','currency')});item['original_id']=original_id
            else:
                if raw.get('original_id'):raise DataError('원거래 연결은 환불에만 사용합니다.')
                if raw.get('tax_basis') not in TAXES:raise DataError('부가세 기준을 선택해 주세요.')
                item.update(tax_basis=raw['tax_basis'],category=text(raw.get('category'),'거래 항목',100,True))
        else:raise DataError('금액 기록 또는 작업시간을 선택해 주세요.')
        return item

    def save(self,raw,revision,request_id,workspace):
        if not isinstance(raw,dict):raise DataError('입력 내용을 확인해 주세요.')
        if workspace.get('clinic_id')!=self.clinic_id:raise DataError('병원 작업공간이 일치하지 않습니다.')
        signature=fingerprint({'operation':'create','data':raw})
        with self.connection(True) as (conn,current):
            retry=self._request(conn,request_id,signature,current)
            if retry:return retry
            self._revision(revision,current);entries=self._entries(conn)
            if len(entries)>=5000:raise DataError('내부 기록 한도에 도달했습니다.')
            item=self._prepare(raw,entries,workspace);identifier=uuid.uuid4().hex
            conn.execute('INSERT INTO entries(id,payload,created_at) VALUES(?,?,?)',(identifier,encoded(item),now()))
            self._audit(conn,current,'create',identifier,'',request_id,signature)
            return {'revision':current+1,'entity':next(x for x in self._entries(conn) if x['id']==identifier),'duplicate':False}

    def void(self,identifier,revision,reason,confirmed,request_id):
        identifier=opaque(identifier);reason=text(reason,'취소 사유',500,True)
        if confirmed is not True:raise DataError('선택한 기록의 취소를 확인해 주세요.')
        signature=fingerprint({'operation':'void','id':identifier,'reason':reason})
        with self.connection(True) as (conn,current):
            retry=self._request(conn,request_id,signature,current)
            if retry:return retry
            self._revision(revision,current);entries=self._entries(conn);item=next((x for x in entries if x['id']==identifier),None)
            if not item or item['voided']:raise DataError('취소할 유효 기록이 없습니다.')
            if any(e.get('original_id')==identifier and not e['voided'] for e in entries):raise DataError('연결된 환불을 먼저 취소해 주세요. 원거래와 환불 이력은 남습니다.')
            conn.execute('UPDATE entries SET voided=1,void_reason=?,voided_at=? WHERE id=?',(reason,now(),identifier))
            self._audit(conn,current,'void',identifier,reason,request_id,signature)
            return {'revision':current+1,'entity':next(x for x in self._entries(conn) if x['id']==identifier),'duplicate':False}

    def report(self,start,end):
        start,end=period(start,end)
        with self.connection() as (conn,revision):
            all_entries=self._entries(conn);entries=[e for e in all_entries if start<=e['date']<=end];active=[e for e in entries if not e['voided']]
            transactions=[e for e in active if e['kind']=='transaction'];times=[e for e in active if e['kind']=='time'];groups=[]
            for basis in TAXES:
                rows=[e for e in transactions if e['tax_basis']==basis]
                if not rows:continue
                amounts={direction:sum(e['amount'] for e in rows if e['direction']==direction) for direction in DIRECTIONS}
                income=amounts['income']-amounts['income_refund'];cost=amounts['cost']-amounts['cost_refund']
                groups.append({'tax_basis':basis,**amounts,'net_income':income,'net_cost':cost,'difference':income-cost,'count':len(rows)})
            originals=[]
            refunds={}
            for e in all_entries:
                if not e['voided'] and e.get('original_id'):refunds[e['original_id']]=refunds.get(e['original_id'],0)+e['amount']
            for e in all_entries:
                if e['voided'] or e.get('direction') not in ('income','cost'):continue
                refunded=refunds.get(e['id'],0)
                if refunded<e['amount']:originals.append({**e,'remaining':e['amount']-refunded})
            audit=[{**dict(row),'actor':json.loads(row['actor'])} for row in conn.execute('SELECT * FROM audit ORDER BY revision DESC LIMIT 100')]
            return {'clinic_id':self.clinic_id,'revision':revision,'checked_at':now(),'period':{'start':start,'end':end},'currency':'KRW','has_transactions':bool(transactions),'mixed_tax':len(groups)>1,'totals':groups[0] if len(groups)==1 else None,'groups':groups,'time_minutes':sum(e['minutes'] for e in times) if times else None,'time_count':len(times),'entries':sorted(entries,key=lambda e:(e['date'],e['created_at'],e['id']),reverse=True),'originals':originals,'audit':audit,'limitations':['수동 입력한 기록 금액 차액이며 회계상 이익이나 확정 현금수지를 뜻하지 않습니다.','부가세 기준이 다르면 전체 금액을 합산하지 않습니다. 환불은 환불일에 반영합니다.','병원 광고 집행비는 자동으로 더하지 않습니다. 작업시간으로 인건비를 추정하지 않습니다.','기간 밖 원거래도 환불 연결용 목록에는 포함됩니다. 작업시간의 담당자명은 수동 입력입니다.']}

def export_csv(report):
    out=io.StringIO();writer=csv.writer(out)
    def safe(value):
        value=str(value if value is not None else '')
        return "'"+value if value.lstrip().startswith(('=','+','-','@')) or value.startswith(('\t','\r','\n')) else value
    rows=[['내부 운영 기록 · 관리자 전용'],['조회 시작',report['period']['start'],'조회 종료',report['period']['end']],['확인 시각',report['checked_at'],'기록 버전',report['revision']],['정의',*report['limitations']],[],['기록ID','일자','유형','거래 구분','항목·작업','금액(KRW)','부가세 기준','작업 분','담당자','거래 증빙번호','원거래ID','캠페인ID','기록 당시 캠페인명','메모','상태','취소 사유','작성 시각','취소 시각']]
    for e in report['entries']:
        rows.append([e['id'],e['date'],'금액' if e['kind']=='transaction' else '시간',DIRECTIONS.get(e.get('direction'),''),e.get('category',e.get('task','')),e.get('amount'),TAXES.get(e.get('tax_basis'),''),e.get('minutes'),e['owner'],e.get('reference'),e.get('original_id'),e.get('campaign_id'),e.get('campaign_title'),e['note'],'취소' if e['voided'] else '유효',e['void_reason'],e['created_at'],e['voided_at']])
    writer.writerows([[safe(cell) for cell in row] for row in rows]);return out.getvalue().encode('utf-8-sig')
