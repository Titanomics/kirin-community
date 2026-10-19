"""Manual daily media reports: versioned corrections, never expense creation."""
import hashlib
import io
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from pathlib import Path
import openpyxl
from .loader import DataError
from .marketing import now,text,period,ACTOR
from .knowledge import day,today
from .conversions import opaque

from .ad_uploads import HEADERS,MAX_BYTES,parse_upload,inspect_upload
LOCK=threading.Lock()


def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))


def metadata(raw):
    if not isinstance(raw,dict):raise DataError('보고 기준을 입력해 주세요.')
    value={k:text(raw.get(k),label,500,True) for k,label in [('source_label','보고서 출처'),('account_label','계정·집계 범위'),('conversion_definition','매체 전환 정의')]}
    value['tax_basis']=raw.get('tax_basis')
    if value['tax_basis'] not in ('included','excluded','unknown'):raise DataError('광고비 부가세 기준을 선택해 주세요.')
    if raw.get('timezone')!='Asia/Seoul' or raw.get('currency')!='KRW':raise DataError('현재 양식은 한국시간 일자와 원화(KRW)만 받습니다.')
    value.update(timezone='Asia/Seoul',currency='KRW',as_of=day(raw.get('as_of'),'보고 확인 기준일',True))
    if value['as_of']>today():raise DataError('보고 확인 기준일은 오늘까지 입력할 수 있습니다.')
    return value

class AdReportStore:
    def __init__(self,path,clinic_id):self.path=Path(path);self.clinic_id=clinic_id;self.marker=self.path.with_suffix(self.path.suffix+'.initialized')

    @contextmanager
    def connection(self,write=False):
        conn=None
        try:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            with LOCK:
                exists=self.path.exists()
                if not exists and self.marker.exists():raise DataError('광고 보고서 저장소가 없습니다. 빈 자료로 초기화하지 않습니다.')
                if not exists:self.marker.write_text('initialized\n',encoding='ascii')
                conn=sqlite3.connect(self.path,timeout=25,isolation_level=None);conn.row_factory=sqlite3.Row
                if not exists:
                    conn.executescript('''CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1),clinic_id TEXT,revision INTEGER);
                    CREATE TABLE batches(id TEXT PRIMARY KEY,revision INTEGER UNIQUE,created_at TEXT,metadata TEXT,sha256 TEXT,inserted INTEGER,replaced INTEGER,skipped INTEGER,reason TEXT,voided INTEGER DEFAULT 0,void_reason TEXT DEFAULT '');
                    CREATE TABLE versions(batch_id TEXT,date TEXT,campaign_id TEXT,payload TEXT,PRIMARY KEY(batch_id,date,campaign_id));
                    CREATE TABLE audit(revision INTEGER PRIMARY KEY,action TEXT,batch_id TEXT,at TEXT,actor TEXT,reason TEXT);''')
                    conn.execute('INSERT INTO meta VALUES(1,?,0)',(self.clinic_id,))
                else:
                    conn.execute('SELECT clinic_id,revision FROM meta LIMIT 0');conn.execute('SELECT id,revision,created_at,metadata,sha256,inserted,replaced,skipped,reason,voided,void_reason FROM batches LIMIT 0')
                    conn.execute('SELECT batch_id,date,campaign_id,payload FROM versions LIMIT 0');conn.execute('SELECT revision,action,batch_id,at,actor,reason FROM audit LIMIT 0')
                    if not self.marker.exists():self.marker.write_text('initialized\n',encoding='ascii')
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            meta=conn.execute('SELECT * FROM meta WHERE id=1').fetchone()
            if not meta or meta['clinic_id']!=self.clinic_id:raise DataError('광고 보고서의 병원 정보가 일치하지 않습니다.')
            yield conn,meta['revision'];conn.commit()
        except (sqlite3.Error,OSError,ValueError,TypeError,KeyError):
            if conn:conn.rollback()
            raise DataError('광고 보고서 저장소를 확인하지 못했습니다.') from None
        except Exception:
            if conn:conn.rollback()
            raise
        finally:
            if conn:conn.close()

    def _active(self,conn):
        rows={}
        for r in conn.execute('SELECT v.date,v.campaign_id,v.payload FROM versions v JOIN batches b ON b.id=v.batch_id WHERE b.voided=0 ORDER BY b.revision'):
            key=(r['date'],r['campaign_id']);payload=json.loads(r['payload'])
            if payload is None:rows.pop(key,None)
            else:rows[key]=payload
        return rows

    def _prepare(self,conn,rows,meta,workspace):
        if workspace.get('clinic_id')!=self.clinic_id:raise DataError('병원 작업공간이 일치하지 않습니다.')
        campaigns={c['id']:c for c in workspace['campaigns']};expenses={e['id']:e for e in workspace['expenses']}
        existing=self._active(conn);changes=[];skipped=0
        for row in rows:
            campaign=campaigns.get(row['campaign_id'])
            if not campaign:raise DataError('이 병원에 등록된 캠페인 ID를 사용해 주세요.')
            if row['date']>meta['as_of']:raise DataError('보고 확인 기준일은 모든 보고 일자 이후여야 합니다.')
            if not campaign['start']<=row['date']<=campaign['end']:raise DataError('보고 일자가 캠페인 집행 기간 밖입니다.')
            key=(row['date'],row['campaign_id']);old=existing.get(key)
            # Existing historical channel is retained even when the campaign is later edited.
            item={**row,'channel':old['channel'] if old else campaign['channel'],'metadata':meta}
            if row['expense_id']:
                e=expenses.get(row['expense_id'])
                if not e or e['campaign_id']!=row['campaign_id'] or e['direction']!='charge':raise DataError('같은 캠페인의 원 지출 ID를 선택해 주세요.')
                if e.get('voided') and (not old or old.get('expense_id')!=e['id']):raise DataError('취소된 지출에는 새 보고 수치를 연결할 수 없습니다.')
            if item==old:skipped+=1
            else:changes.append({'before':old,'after':item})
        combined={**existing,**{(c['after']['date'],c['after']['campaign_id']):c['after'] for c in changes}}
        if len(combined)>200000:raise DataError('광고 보고서 행 한도에 도달했습니다.')
        def overlaps(records):return {(stamp,cid) for stamp,cid in records if (stamp,campaigns.get(cid,{}).get('parent_id')) in records}
        if overlaps(combined)-overlaps(existing):raise DataError('같은 날짜에 상위 캠페인 합계와 하위 집행을 함께 더할 수 없습니다. 한 집계 단위만 사용해 주세요.')
        return changes,skipped

    def _digest(self,data,meta,workspace,revision,mapping=None):return hashlib.sha256(encoded({'file':hashlib.sha256(data).hexdigest(),'metadata':meta,'clinic':self.clinic_id,'workspace_revision':workspace['revision'],'revision':revision,**({'mapping':mapping} if mapping is not None else {})}).encode()).hexdigest()

    def preview(self,filename,data,meta,workspace,mapping=None):
        rows=parse_upload(filename,data,mapping=mapping);meta=metadata(meta)
        with self.connection() as (conn,revision):
            changes,skipped=self._prepare(conn,rows,meta,workspace)
            return {'revision':revision,'workspace_revision':workspace['revision'],'digest':self._digest(data,meta,workspace,revision,mapping),'input_mapping':mapping,'input_columns':inspect_upload(filename,data,header_row=mapping['header_row'])['columns'] if mapping else None,'metadata':meta,'rows':len(rows),'inserted':sum(c['before'] is None for c in changes),'replaced':sum(c['before'] is not None for c in changes),'skipped':skipped,'changes':changes,'checked_at':now()}

    def _audit(self,conn,revision,action,identifier,reason):
        actor=ACTOR.get();actor={k:actor[k] for k in ('id','username','name')} if actor else None
        conn.execute('UPDATE meta SET revision=? WHERE id=1',(revision+1,));conn.execute('INSERT INTO audit VALUES(?,?,?,?,?,?)',(revision+1,action,identifier,now(),encoded(actor),reason))

    def commit(self,filename,data,meta,workspace,revision,digest,confirmed,replace,reason,mapping=None):
        if confirmed is not True:raise DataError('보고 기준과 변경 전후 수치를 확인해 주세요.')
        rows=parse_upload(filename,data,mapping=mapping);meta=metadata(meta)
        with self.connection(True) as (conn,current):
            if type(revision)!=int or current!=revision or digest!=self._digest(data,meta,workspace,current,mapping):raise DataError('자료나 보고 기준이 바뀌었습니다. 미리보기를 다시 확인해 주세요.')
            changes,skipped=self._prepare(conn,rows,meta,workspace);replaced=sum(c['before'] is not None for c in changes)
            reason=text(reason,'정정 사유',500,replaced>0)
            if replaced and replace is not True:raise DataError('변경 전후를 확인하고 기존 행 정정을 선택해 주세요.')
            if not changes:return {'revision':current,'inserted':0,'replaced':0,'skipped':skipped,'duplicate':True}
            if conn.execute('SELECT count(*) FROM batches').fetchone()[0]>=5000:raise DataError('광고 보고서 이력 한도에 도달했습니다.')
            identifier=uuid.uuid4().hex;inserted=len(changes)-replaced
            conn.execute('INSERT INTO batches(id,revision,created_at,metadata,sha256,inserted,replaced,skipped,reason) VALUES(?,?,?,?,?,?,?,?,?)',(identifier,current+1,now(),encoded({**meta,**({'input_mapping':mapping,'input_columns':inspect_upload(filename,data,header_row=mapping['header_row'])['columns']} if mapping is not None else {})}),hashlib.sha256(data).hexdigest(),inserted,replaced,skipped,reason))
            conn.executemany('INSERT INTO versions VALUES(?,?,?,?)',[(identifier,c['after']['date'],c['after']['campaign_id'],encoded(c['after'])) for c in changes])
            self._audit(conn,current,'import',identifier,reason)
            return {'revision':current+1,'batch_id':identifier,'inserted':inserted,'replaced':replaced,'skipped':skipped,'duplicate':False}

    def _withdraw_rows(self,conn,keys,workspace):
        if workspace.get('clinic_id')!=self.clinic_id:raise DataError('병원 작업공간이 일치하지 않습니다.')
        if not isinstance(keys,list) or not 0<len(keys)<=25000:raise DataError('철회할 일자·캠페인 행을 선택해 주세요.')
        try:
            normalized=[(date.fromisoformat(k['date']).isoformat(),opaque(k['campaign_id'])) for k in keys]
            if len(set(normalized))!=len(normalized):raise ValueError
        except (KeyError,ValueError,TypeError,AttributeError):raise DataError('철회 대상의 일자·캠페인을 확인해 주세요.') from None
        active=self._active(conn)
        if any(k not in active for k in normalized):raise DataError('철회할 행이 바뀌었습니다. 다시 조회해 주세요.')
        return [active[k] for k in sorted(normalized)]

    def withdraw_preview(self,keys,workspace):
        with self.connection() as (conn,revision):
            rows=self._withdraw_rows(conn,keys,workspace)
            return {'action':'withdraw','revision':revision,'workspace_revision':workspace['revision'],'digest':self._digest(encoded(rows).encode(),{'operation':'withdraw'},workspace,revision),'changes':[{'before':r,'after':None} for r in rows],'inserted':0,'replaced':len(rows),'skipped':0,'checked_at':now()}

    def withdraw(self,keys,workspace,revision,digest,reason,confirmed):
        reason=text(reason,'행 철회 사유',500,True)
        if confirmed is not True:raise DataError('철회할 행과 사유를 확인해 주세요.')
        with self.connection(True) as (conn,current):
            rows=self._withdraw_rows(conn,keys,workspace)
            if type(revision)!=int or revision!=current or digest!=self._digest(encoded(rows).encode(),{'operation':'withdraw'},workspace,current):raise DataError('철회 대상이나 장부가 바뀌었습니다. 다시 확인해 주세요.')
            if conn.execute('SELECT count(*) FROM batches').fetchone()[0]>=5000:raise DataError('광고 보고서 이력 한도에 도달했습니다.')
            identifier=uuid.uuid4().hex
            conn.execute('INSERT INTO batches(id,revision,created_at,metadata,sha256,inserted,replaced,skipped,reason) VALUES(?,?,?,?,?,?,?,?,?)',(identifier,current+1,now(),encoded({'operation':'withdraw'}),'',0,len(rows),0,reason))
            conn.executemany('INSERT INTO versions VALUES(?,?,?,?)',[(identifier,r['date'],r['campaign_id'],'null') for r in rows])
            self._audit(conn,current,'withdraw',identifier,reason)
            return {'revision':current+1,'batch_id':identifier,'withdrawn':len(rows)}

    def rollback(self,revision,reason,confirmed):
        reason=text(reason,'되돌림 사유',500,True)
        if confirmed is not True:raise DataError('최근 반영을 되돌릴지 확인해 주세요.')
        with self.connection(True) as (conn,current):
            if type(revision)!=int or revision!=current:raise DataError('이력이 바뀌었습니다. 다시 확인해 주세요.')
            batch=conn.execute('SELECT id FROM batches WHERE voided=0 ORDER BY revision DESC LIMIT 1').fetchone()
            if not batch:raise DataError('되돌릴 업로드가 없습니다.')
            conn.execute('UPDATE batches SET voided=1,void_reason=? WHERE id=?',(reason,batch['id']));self._audit(conn,current,'rollback',batch['id'],reason)
            return {'revision':current+1,'batch_id':batch['id']}

    def status(self):
        with self.connection() as (conn,revision):
            batches=[{**dict(r),'metadata':json.loads(r['metadata'])} for r in conn.execute('SELECT id,revision,created_at,metadata,inserted,replaced,skipped,reason,voided,void_reason FROM batches ORDER BY revision DESC')]
            return {'revision':revision,'batches':batches,'active_rows':len(self._active(conn)),'checked_at':now()}

    def report(self,start,end,workspace):
        if workspace.get('clinic_id')!=self.clinic_id:raise DataError('병원 작업공간이 일치하지 않습니다.')
        start,end=period(start,end)
        with self.connection() as (conn,revision):all_rows=list(self._active(conn).values())
        rows=[r for r in all_rows if start<=r['date']<=end];campaigns={c['id']:c for c in workspace['campaigns']};expenses={e['id']:e for e in workspace['expenses']}
        groups={};by_campaign={}
        for row in rows:
            m=row['metadata'];basis=tuple(m[k] for k in ('source_label','account_label','conversion_definition','tax_basis'))
            groups.setdefault(basis,[]).append(row);by_campaign.setdefault((row['campaign_id'],row['channel'],basis),[]).append(row)
        output=[]
        for (cid,channel,basis),items in by_campaign.items():
            c=campaigns.get(cid,{})
            output.append({**metrics(items),'campaign_id':cid,'title':c.get('title','캠페인 확인 필요'),'channel':channel,'channel_changed':channel!=c.get('channel'),'basis':dict(zip(('source_label','account_label','conversion_definition','tax_basis'),basis))})
        comparisons=[];all_links={};refund_totals={}
        for r in all_rows:
            if r['expense_id']:all_links.setdefault(r['expense_id'],[]).append(r)
        for e in expenses.values():
            if e.get('refund_of') and not e.get('voided'):refund_totals[e['refund_of']]=refund_totals.get(e['refund_of'],0)+e['amount']
        for eid in sorted({r['expense_id'] for r in rows if r['expense_id']}):
            linked=all_links[eid];e=expenses.get(eid);reported=sum(r['spend'] for r in linked);mixed=len({r['metadata']['tax_basis'] for r in linked})>1
            state='missing' if not e else 'voided' if e.get('voided') else 'mixed_tax' if mixed else 'comparison_only'
            refunds=refund_totals.get(eid,0)
            net=e['amount']-refunds if e and not e.get('voided') else None
            comparisons.append({'expense_id':eid,'reference':e.get('reference','') if e else '', 'status':state,'reported_spend_all_dates':None if mixed else reported,'original_charge':e['amount'] if e else None,'refunds':refunds,'ledger_net':net,'difference':reported-net if net is not None and not mixed else None,'linked_rows':len(linked),'first_date':min(r['date'] for r in linked),'last_date':max(r['date'] for r in linked)})
        warnings=['매체 보고 전환은 실제 문의·내원·고유환자수와 다릅니다. 광고 인과효과와 ROAS를 계산하지 않습니다.','지출 장부에는 자동 합산하지 않습니다. 증빙 비교는 선택기간과 무관하게 해당 지출에 연결된 전체 일자의 보고비를 사용합니다.','금액 차이는 부가세·수수료·보고 범위에서 생길 수 있으며, 차이 0도 대사 완료를 뜻하지 않습니다.','전환 정의·계정·출처가 다르면 전환을 합산하지 않습니다. 부가세 기준이 다르면 광고비 합계를 표시하지 않습니다.','내부 캠페인별 하루 합계만 올려 주세요. 여러 계정은 먼저 같은 기준으로 합쳐야 하며, 다른 캠페인 ID로 중복 입력한 매체 수치는 자동 판별할 수 없습니다.']
        daily_keys={(r['date'],r['campaign_id']) for r in rows}
        hierarchy=any((r['date'],campaigns.get(r['campaign_id'],{}).get('parent_id')) in daily_keys for r in rows)
        if hierarchy:warnings.append('업로드 이후 캠페인 계층이 바뀌어 상위·하위 합계가 겹칩니다. 정정 전 전체 합계는 표시하지 않습니다.')
        return {'revision':revision,'workspace_revision':workspace['revision'],'checked_at':now(),'period':{'start':start,'end':end},'has_data':bool(rows),'aggregation_blocked':hierarchy,'totals':None if hierarchy else metrics(rows),'campaigns':output,'groups':[] if hierarchy else [{'basis':dict(zip(('source_label','account_label','conversion_definition','tax_basis'),b)),**metrics(items)} for b,items in groups.items()],'daily':sorted(rows,key=lambda r:(r['date'],r['campaign_id'])),'comparisons':comparisons,'unlinked_rows':sum(not r['expense_id'] for r in rows),'warnings':warnings}

def metrics(rows):
    impressions=sum(r['impressions'] for r in rows);clicks=sum(r['clicks'] for r in rows)
    conv_basis={tuple(r['metadata'][k] for k in ('source_label','account_label','conversion_definition')) for r in rows};tax_basis={r['metadata']['tax_basis'] for r in rows}
    spend=sum(r['spend'] for r in rows) if len(tax_basis)<=1 else None
    return {'rows':len(rows),'impressions':impressions,'clicks':clicks,'conversions':format(sum((Decimal(r['conversions']) for r in rows),Decimal(0)),'f') if len(conv_basis)<=1 else None,'spend':spend,'ctr':round(clicks/impressions*100,2) if impressions else None,'cpc':round(spend/clicks,2) if clicks and spend is not None else None,
        'first_report_date':min((r['date'] for r in rows),default=None),'last_report_date':max((r['date'] for r in rows),default=None),'as_of_min':min((r['metadata']['as_of'] for r in rows),default=None),'as_of_max':max((r['metadata']['as_of'] for r in rows),default=None)}

def template_xlsx():
    book=openpyxl.Workbook();sheet=book.active;sheet.title='일별 캠페인 합계';sheet.append(list(HEADERS));sheet.freeze_panes='A2'
    for column in sheet.columns:sheet.column_dimensions[column[0].column_letter].width=24
    out=io.BytesIO();book.save(out);book.close();return out.getvalue()
