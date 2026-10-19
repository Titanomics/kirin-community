"""Clinic registry and request-local contexts. Never switches a shared active clinic."""
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager,closing
from pathlib import Path
from types import SimpleNamespace
from .access import AccessStore,AccessError
from .loader import WorkbookStore,DataError
from .marketing import MarketingStore,now,text
from .work_queue import work_queue

EMRS={'dentweb':'덴트웹','ysarang':'의사랑','other':'기타·미정'}


class AgencyRegistry:
    def __init__(self,root,primary):
        self.root=Path(root).resolve();self.primary=primary;self.primary_id=primary.store.imports.clinic_id
        self.path=self.root/'clinics.sqlite';self.marker=self.root/'registry-initialized'
        if self.marker.exists() and not self.path.is_file():raise DataError('병원 목록 저장소가 없습니다.')
        existing=self.path.exists()
        self.root.mkdir(parents=True,exist_ok=True)
        self.access=AccessStore(self.root/'access');self._contexts={};self._lock=threading.RLock()
        try:
            config=json.loads(primary.store.manifest.read_text(encoding='utf-8'))
            with closing(sqlite3.connect(self.path)) as conn:
                if existing:
                    conn.execute('SELECT id,name,emr,owner,created_at,state FROM clinics LIMIT 0')
                    if not conn.execute("SELECT 1 FROM clinics WHERE id=? AND state='ready'",(self.primary_id,)).fetchone():raise DataError('등록된 기본 병원 정보가 없습니다. 목록을 초기화하지 않습니다.')
                else:
                    conn.execute('CREATE TABLE clinics(id TEXT PRIMARY KEY,name TEXT,emr TEXT,owner TEXT,created_at TEXT,state TEXT)')
                    conn.execute('INSERT INTO clinics VALUES(?,?,?,?,?,?)',(self.primary_id,config.get('clinic','병원'),'other','',now(),'ready'))
                conn.commit()
            self.marker.write_text('initialized\n',encoding='ascii')
        except (sqlite3.Error,OSError,ValueError):raise DataError('병원 목록을 준비하지 못했습니다.') from None

    @contextmanager
    def connection(self,write=False):
        if not self.path.is_file():raise DataError('병원 목록 저장소가 없습니다.')
        conn=None
        try:
            conn=sqlite3.connect(self.path,timeout=25,isolation_level=None);conn.row_factory=sqlite3.Row
            conn.execute('BEGIN IMMEDIATE' if write else 'BEGIN');yield conn;conn.commit()
        except (sqlite3.Error,OSError,ValueError,TypeError,KeyError):
            if conn:conn.rollback()
            raise DataError('병원 작업공간을 확인하지 못했습니다.') from None
        except Exception:
            if conn:conn.rollback()
            raise
        finally:
            if conn:conn.close()

    def ids(self):
        with self.connection() as conn:return [r[0] for r in conn.execute("SELECT id FROM clinics WHERE state='ready'")]

    def list(self,principal):
        user=self.access.authorize(principal)
        with self.connection() as conn:rows=[dict(r) for r in conn.execute("SELECT * FROM clinics WHERE state='ready' ORDER BY created_at,id")]
        return [r for r in rows if user is None or user['role']=='admin' or r['id'] in user['clinic_ids']]

    def create(self,principal,data):
        self.access.authorize(principal,admin=True)
        if not isinstance(data,dict):raise DataError('병원 정보를 입력해 주세요.')
        name=text(data.get('name'),'병원명',120,True);owner=text(data.get('owner'),'담당자',100);emr=data.get('emr','other')
        if emr not in EMRS:raise DataError('EMR 종류를 확인해 주세요.')
        identifier=uuid.uuid4().hex
        folder=(self.root/'clinics'/identifier).resolve()
        if not folder.is_relative_to(self.root/'clinics'):raise DataError('작업공간 위치가 올바르지 않습니다.')
        # A preparing row records an interrupted setup; only ready rows can be selected.
        with self.connection(True) as conn:
            if conn.execute('SELECT count(*) FROM clinics').fetchone()[0]>=100:raise DataError('이 PC의 병원 등록 한도에 도달했습니다.')
            conn.execute('INSERT INTO clinics VALUES(?,?,?,?,?,?)',(identifier,name,emr,owner,now(),'preparing'))
        try:
            folder.mkdir(parents=True,exist_ok=False);(folder/'sources').mkdir()
            config={'clinic_id':identifier,'clinic':name,'source_directory':str(folder/'sources'),'files':[],'allow_empty':True}
            (folder/'manifest.json').write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
            store=WorkbookStore(folder/'manifest.json');store.enable_imports(folder/'imports')
            marketing=MarketingStore(folder/'marketing.sqlite',identifier);marketing.snapshot()
            with self.connection(True) as conn:conn.execute("UPDATE clinics SET state='ready' WHERE id=?",(identifier,))
            with self._lock:self._contexts[identifier]=SimpleNamespace(store=store,marketing=marketing)
            return next(x for x in self.list(principal) if x['id']==identifier)
        except Exception:
            with self.connection(True) as conn:conn.execute("UPDATE clinics SET state='setup_failed' WHERE id=?",(identifier,))
            raise

    def resolve(self,identifier):
        if not isinstance(identifier,str) or not identifier or len(identifier)>64:raise AccessError('병원을 선택해 주세요.',400)
        with self.connection() as conn:row=conn.execute("SELECT id FROM clinics WHERE id=? AND state='ready'",(identifier,)).fetchone()
        if row is None:raise AccessError('선택한 병원 작업공간이 없습니다.',404)
        if identifier==self.primary_id:return self.primary
        with self._lock:
            if identifier not in self._contexts:
                folder=(self.root/'clinics'/identifier).resolve()
                if not folder.is_relative_to(self.root/'clinics'):raise DataError('작업공간 위치가 올바르지 않습니다.')
                store=WorkbookStore(folder/'manifest.json');store.enable_imports(folder/'imports')
                if store.imports.clinic_id!=identifier:raise DataError('병원 식별자가 일치하지 않습니다.')
                self._contexts[identifier]=SimpleNamespace(store=store,marketing=MarketingStore(folder/'marketing.sqlite',identifier))
            return self._contexts[identifier]

    def context(self,principal,identifier,write=False):
        self.access.authorize(principal,identifier,write=write)
        return self.resolve(identifier)

    def overview(self,principal):
        rows=[];tasks=[]
        for clinic in self.list(principal):
            row={**clinic,'operations':None,'operations_checked_at':now(),'source_checked_at':now(),'tasks_count':None}
            try:context=self.context(principal,clinic['id'])
            except AccessError:raise
            except (DataError,OSError,ValueError,TypeError,KeyError):
                message='병원 작업공간 설정이나 저장소를 읽지 못했습니다.'
                row.update(operations_state='unavailable',operations_message=message,source_state='unavailable',last_record=None,source_count=None,source_message=message)
                rows.append(row);continue
            try:
                workspace=context.marketing.snapshot();pending=work_queue(workspace)
                row.update(operations=workspace['summary'],operations_state='ready',operations_checked_at=workspace['checked_at'],tasks_count=len(pending))
                tasks.extend({**task,'clinic_id':clinic['id'],'clinic_name':clinic['name']} for task in pending)
            except DataError as error:row.update(operations_state='unavailable',operations_message=str(error))
            try:
                snapshot=context.store.snapshot()
                row.update(source_state='ready',last_record=snapshot.records[-1]['date'].isoformat(),source_count=len(snapshot.inventory),source_checked_at=snapshot.checked_at)
            except DataError as error:row.update(source_state='unavailable',last_record=None,source_count=None,source_message=str(error))
            rows.append(row)
        tasks.sort(key=lambda x:(x['priority'],x['due'] or '9999-99-99',x['clinic_name'],x['kind'],x['title']))
        return {'clinics':rows,'tasks':tasks,'unavailable_ledgers':sum(x['operations_state']!='ready' for x in rows),'checked_at':now()}
