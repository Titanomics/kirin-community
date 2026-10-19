"""Verified local clinic snapshots and non-overwriting, admin-only recovery."""
import hashlib
import json
import sqlite3
import uuid
import re
from contextlib import ExitStack,closing,contextmanager
from pathlib import Path,PurePosixPath
from .loader import DataError,WorkbookStore
from .marketing import MarketingStore,now,text,INITIALIZE_LOCK
from .access import AccessError

DATABASES=('marketing.sqlite','ad-reports.sqlite','conversions.sqlite','internal-finance.sqlite','clinic-location.sqlite','monitoring.sqlite')
EXCLUDED=['담당자 계정·비밀번호·로그인 세션','공유 지도·인구·주소 사전','앱 실행 파일·설정','아직 반영하지 않은 업로드 미리보기']
MAX_TOTAL=2*1024**3


def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,allow_nan=False).encode('utf-8')
def digest(data):return hashlib.sha256(data).hexdigest()
def read_json(path):
    try:return json.loads(path.read_text(encoding='utf-8'))
    except (OSError,ValueError):raise DataError('복구 자료의 JSON 기록을 확인하지 못했습니다.') from None


def child(root,relative):
    if not isinstance(relative,str) or not relative or '\\' in relative or ':' in relative or any(x in ('..','.') for x in relative.split('/')):raise DataError('백업 파일 위치가 올바르지 않습니다.')
    name=PurePosixPath(relative)
    path=(root/relative).resolve()
    if name.is_absolute() or not path.is_relative_to(root.resolve()) or path==root.resolve():raise DataError('백업 파일 위치가 올바르지 않습니다.')
    return path


def validate_db(conn,name,clinic_id):
    if conn.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise DataError('저장소 무결성 검사를 통과하지 못했습니다.')
    table='workspace' if name=='marketing.sqlite' else 'meta'
    row=conn.execute(f'SELECT clinic_id,revision FROM {table} WHERE id=1').fetchone()
    if not row:
        if name=='marketing.sqlite' and conn.execute('SELECT count(*) FROM audit').fetchone()[0]==0:return 0
        raise DataError('저장소의 병원 정보가 없습니다.')
    if row[0]!=clinic_id:raise DataError('백업 저장소의 병원이 일치하지 않습니다.')
    return row[1]


class RecoveryService:
    def __init__(self,registry):self.registry=registry;self.root=registry.root/'backups'
    @contextmanager
    def restore_guard(self):
        conn=sqlite3.connect(self.registry.root/'recovery-lock.sqlite',timeout=0.2,isolation_level=None)
        try:
            try:conn.execute('BEGIN IMMEDIATE')
            except sqlite3.OperationalError:raise AccessError('다른 복구 검증이 진행 중입니다. 잠시 뒤 같은 요청으로 확인해 주세요.',409) from None
            yield
        finally:conn.rollback();conn.close()
    def authorize(self,principal,context):self.registry.access.authorize(principal,clinic_id=context.marketing.clinic_id,admin=True)
    def folder(self,context,identifier):
        if not isinstance(identifier,str) or not re.fullmatch('[a-f0-9]{32}',identifier):raise DataError('백업 식별자가 올바르지 않습니다.')
        return self.root/context.marketing.clinic_id/identifier
    def list(self,principal,context):
        self.authorize(principal,context);base=self.root/context.marketing.clinic_id;rows=[]
        for path in sorted(base.glob('*/info.json'),reverse=True) if base.exists() else []:
            if not re.fullmatch('[a-f0-9]{32}',path.parent.name):continue
            try:
                info=read_json(path)
                if info['clinic']['id']!=context.marketing.clinic_id:raise DataError('다른 병원 백업입니다.')
                rows.append(self.summary(info))
            except (DataError,KeyError,TypeError):rows.append({'id':path.parent.name,'status':'unreadable','created_at':None})
        rows.sort(key=lambda r:r.get('created_at') or '',reverse=True)
        return {'clinic_id':context.marketing.clinic_id,'backups':rows,'checked_at':now(),'excluded':EXCLUDED,'storage':'이 PC의 병원별 로컬 백업 폴더','offsite':False}
    def summary(self,info):return {'id':info['id'],'created_at':info['created_at'],'clinic_name':info['clinic']['name'],'source_files':info['source_files'],'version_files':info['version_files'],'file_count':len(info['files']),'bytes':sum(f['bytes'] for f in info['files'].values()),'databases':info['databases'],'status':'saved','verified':False}
    def create(self,principal,context):
        self.authorize(principal,context)
        identifier=uuid.uuid4().hex;folder=self.folder(context,identifier);folder.mkdir(parents=True,exist_ok=False)
        files={};total=0;revisions={}
        def put(relative,data):
            nonlocal total
            total+=len(data)
            if total>MAX_TOTAL or len(files)>=5000:raise DataError('로컬 백업 한도 2GB·5,000파일을 넘었습니다.')
            path=child(folder,relative);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);files[relative]={'bytes':len(data),'sha256':digest(data)}
        def copy(relative,path):
            data=path.read_bytes();put(relative,data)
            if digest(path.read_bytes())!=digest(data):raise DataError('백업 중 원본 파일이 바뀌었습니다. 다시 실행해 주세요.')
        try:
            context.marketing.snapshot()
            # Lock acquisition order matches the import writer. Hold all DB writers through capture.
            with context.store._lock,context.store.imports._write_guard(),INITIALIZE_LOCK,ExitStack() as stack:
                config=read_json(context.store.manifest);state=context.store.imports._state();connections=[]
                for name in DATABASES:
                    path=context.marketing.path if name=='marketing.sqlite' else context.marketing.path.with_name(name)
                    if not path.exists():
                        if path.with_suffix(path.suffix+'.initialized').exists():raise DataError('초기화 이력이 있는 저장소가 누락되어 백업하지 않았습니다.')
                        continue
                    conn=stack.enter_context(closing(sqlite3.connect(path,timeout=25,isolation_level=None)));conn.execute('BEGIN IMMEDIATE')
                    revisions[name]=validate_db(conn,name,context.marketing.clinic_id);connections.append((name,conn))
                for name,conn in connections:put(name,conn.serialize())
                source=Path(config['source_directory']).resolve()
                for name in config['files']:
                    if Path(name).name!=name or not name.endswith('.xlsx'):raise DataError('원본 파일 이름을 확인해 주세요.')
                    copy('sources/'+name,child(source,name))
                versions=set()
                for entries in [state['active'],*[r[k] for r in state['history'] for k in ('before','after')]]:
                    for entry in entries.values():
                        relative=entry['path']
                        if not relative.startswith('versions/'):raise DataError('업로드 버전 위치가 올바르지 않습니다.')
                        versions.add(relative)
                for relative in sorted(versions):copy('imports/'+relative,context.store.imports._path(relative))
                put('imports/state.json',encoded(state))
                put('manifest.json',encoded({k:config[k] for k in ('clinic','files','allow_empty') if k in config}))
                # Roll back read-only IMMEDIATE transactions before releasing any connection.
                for _,conn in connections:conn.rollback()
            clinic=next(c for c in self.registry.list(principal) if c['id']==context.marketing.clinic_id)
            info={'format':1,'id':identifier,'clinic':clinic,'created_at':now(),'source_files':len(config['files']),'version_files':len(versions),'files':files,'databases':revisions,'excluded':EXCLUDED}
            (folder/'info.json').write_bytes(encoded(info))
            return self.preview(principal,context,identifier)
        except (OSError,sqlite3.Error,KeyError,TypeError):raise DataError('백업을 완료하지 못했습니다. 원본은 변경하지 않았습니다.') from None
    def preview(self,principal,context,identifier):
        self.authorize(principal,context);folder=self.folder(context,identifier);info=read_json(folder/'info.json')
        try:
            if info['format']!=1 or info['id']!=identifier or info['clinic']['id']!=context.marketing.clinic_id:raise DataError('백업의 병원과 형식이 일치하지 않습니다.')
            files=info['files']
            if not isinstance(files,dict) or not 2<=len(files)<=5000 or sum(x['bytes'] for x in files.values())>MAX_TOTAL:raise DataError('백업 파일 목록을 확인해 주세요.')
            if not {'manifest.json','imports/state.json','marketing.sqlite'}.issubset(files):raise DataError('백업 필수 파일이 없습니다.')
            for relative,expected in files.items():
                if relative not in DATABASES and relative not in ('manifest.json','imports/state.json') and not relative.startswith(('sources/','imports/versions/')):raise DataError('허용하지 않는 백업 파일입니다.')
                path=child(folder,relative)
                if not path.is_file() or path.stat().st_size!=expected['bytes'] or digest(path.read_bytes())!=expected['sha256']:raise DataError('백업 파일 무결성 검사를 통과하지 못했습니다. 손상된 백업은 복구하지 않습니다.')
            return {**self.summary(info),'verified':True,'digest':digest(encoded(info)),'verified_at':now(),'excluded':EXCLUDED,'restore_mode':'새 병원 작업공간에 복구 · 기존 자료 유지'}
        except (OSError,KeyError,TypeError,ValueError):raise DataError('백업의 파일 목록이나 무결성을 확인하지 못했습니다.') from None
    def restore(self,principal,context,identifier,expected,name,confirmed,request_id):
        self.authorize(principal,context);name=text(name,'복구 병원 표시명',120,True)
        if confirmed is not True:raise DataError('복구할 백업과 새 병원 이름을 확인해 주세요.')
        if not isinstance(request_id,str) or not re.fullmatch('[a-f0-9]{32}',request_id):raise DataError('복구 요청 식별자를 확인해 주세요.')
        if not isinstance(expected,str) or not re.fullmatch('[a-f0-9]{64}',expected):raise DataError('검사한 백업 식별자를 확인해 주세요.')
        signature=digest(encoded([context.marketing.clinic_id,identifier,expected,name]))
        with self.registry._lock,self.restore_guard():
            # Completed requests resolve independently of later backup availability; no files are recopied.
            interrupted=False
            with self.registry.connection(True) as conn:
                exists=conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recoveries'").fetchone()
                prior=conn.execute('SELECT signature,target_id,state FROM recoveries WHERE request_id=?',(request_id,)).fetchone() if exists else None
                if prior:
                    if prior['signature']!=signature:raise DataError('복구 요청이 이전 내용과 다릅니다.')
                    if prior['state']=='ready':return {'clinic':next(c for c in self.registry.list(principal) if c['id']==prior['target_id']),'restored_from':identifier,'reused':True}
                    if prior['state']=='preparing':
                        # Acquiring the OS lock proves no conforming restore process is still running.
                        conn.execute("UPDATE recoveries SET state='failed' WHERE request_id=?",(request_id,));conn.execute("UPDATE clinics SET state='setup_failed' WHERE id=? AND state='preparing'",(prior['target_id'],));interrupted=True
                    else:raise DataError('이전 복구 검증에 실패했습니다. 백업을 다시 검사해 주세요.')
            if interrupted:raise DataError('중단된 복구를 확인했습니다. 원래 병원은 유지됩니다. 백업을 다시 검사해 새 복구 요청을 시작해 주세요.')
            preview=self.preview(principal,context,identifier)
            if not isinstance(expected,str) or preview['digest']!=expected:raise DataError('검사한 백업과 복구 요청이 다릅니다. 다시 검사해 주세요.')
            source=self.folder(context,identifier);info=read_json(source/'info.json')
            if digest(encoded(info))!=preview['digest']:raise DataError('검사 직후 백업 목록이 바뀌었습니다. 다시 검사해 주세요.')
            with self.registry.connection(True) as conn:
                conn.execute('CREATE TABLE IF NOT EXISTS recoveries(request_id TEXT PRIMARY KEY,signature TEXT,target_id TEXT,state TEXT)')
                found=conn.execute('SELECT signature,target_id,state FROM recoveries WHERE request_id=?',(request_id,)).fetchone()
                if found:
                    if found['signature']!=signature:raise DataError('복구 요청이 이전 내용과 다릅니다.')
                    if found['state']=='preparing':return {'status':'preparing','request_id':request_id}
                    if found['state']!='ready':raise DataError('이전 복구 검증에 실패했습니다. 백업을 다시 검사해 주세요.')
                    return {'clinic':next(c for c in self.registry.list(principal) if c['id']==found['target_id']),'restored_from':identifier,'reused':True}
                if conn.execute('SELECT count(*) FROM clinics').fetchone()[0]>=100:raise DataError('병원 작업공간 한도에 도달했습니다.')
                target_id=uuid.uuid4().hex;folder=self.registry.root/'clinics'/target_id
                conn.execute('INSERT INTO recoveries VALUES(?,?,?,?)',(request_id,signature,target_id,'preparing'))
                conn.execute('INSERT INTO clinics VALUES(?,?,?,?,?,?)',(target_id,name,'other','',now(),'preparing'))
            try:
                folder.mkdir(parents=True,exist_ok=False)
                for relative,expected_file in info['files'].items():
                    data=child(source,relative).read_bytes()
                    if digest(data)!=expected_file['sha256']:raise DataError('복구 중 백업 파일이 바뀌었습니다.')
                    destination=child(folder,relative);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(data)
                config=read_json(folder/'manifest.json');config.update(clinic_id=target_id,clinic=name,source_directory=str(folder/'sources'))
                (folder/'sources').mkdir(exist_ok=True);(folder/'manifest.json').write_bytes(encoded(config))
                state=read_json(folder/'imports'/'state.json')
                if state['clinic_id']!=context.marketing.clinic_id:raise DataError('업로드 이력의 병원이 다릅니다.')
                state['clinic_id']=target_id;(folder/'imports'/'state.json').write_bytes(encoded(state));(folder/'imports'/'state-initialized').write_text('initialized\n',encoding='ascii')
                for db in DATABASES:
                    path=folder/db
                    if not path.exists():continue
                    with closing(sqlite3.connect(path)) as conn:
                        validate_db(conn,db,context.marketing.clinic_id)
                        table='workspace' if db=='marketing.sqlite' else 'meta';conn.execute(f'UPDATE {table} SET clinic_id=? WHERE id=1',(target_id,))
                        if db=='monitoring.sqlite':
                            for row in conn.execute('SELECT id,payload FROM sources').fetchall():
                                payload=json.loads(row[1]);payload.update(auto=False,version=payload['version']+1)
                                conn.execute('UPDATE sources SET payload=? WHERE id=?',(json.dumps(payload,ensure_ascii=False),row[0]))
                            conn.execute('UPDATE meta SET revision=revision+1')
                        conn.commit()
                    path.with_suffix(path.suffix+'.initialized').write_text('initialized\n',encoding='ascii')
                store=WorkbookStore(folder/'manifest.json');store.enable_imports(folder/'imports');baseline=store.import_baseline()
                MarketingStore(folder/'marketing.sqlite',target_id).snapshot()
                (folder/'recovery-origin.json').write_bytes(encoded({'backup_id':identifier,'source_clinic':context.marketing.clinic_id,'restored_at':now(),'records':len(baseline.records),'automatic_monitoring_disabled':True}))
                with self.registry.connection(True) as conn:
                    conn.execute("UPDATE clinics SET state='ready',emr=?,owner=? WHERE id=?",(info['clinic']['emr'],info['clinic']['owner'],target_id));conn.execute("UPDATE recoveries SET state='ready' WHERE request_id=?",(request_id,))
                return {'clinic':next(c for c in self.registry.list(principal) if c['id']==target_id),'restored_from':identifier,'reused':False}
            except Exception:
                with self.registry.connection(True) as conn:
                    conn.execute("UPDATE clinics SET state='setup_failed' WHERE id=?",(target_id,));conn.execute("UPDATE recoveries SET state='failed' WHERE request_id=?",(request_id,))
                raise DataError('새 공간의 복구 검증에 실패했습니다. 기존 병원 자료는 변경하지 않았습니다.') from None
