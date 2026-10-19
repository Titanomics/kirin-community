"""Cold-start-safe adapter. Every operation gets a private clinic directory."""
import base64
import gzip
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import threading
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse,parse_qs
from urllib.parse import quote
from datetime import datetime,timezone

from .backend import CloudError,identifier
from .snapshots import pack,restore,SnapshotError
from .address_summary import read_reports,render_report,summary_script,SummaryError,PERIOD

ENGINE=Path(__file__).resolve().parent/'engine'
sys.path.insert(0,str(ENGINE))
from clinic_analytics.server import Handler,ASSETS,STATIC
from clinic_analytics import loader
from clinic_analytics.loader import WorkbookStore
from clinic_analytics.marketing import MarketingStore
from clinic_analytics.access import AccessError

ROAD_LOCK=threading.Lock()
ROAD_PATH=None
ADAPTER_ASSETS=Path(__file__).resolve().parent/'web'
GET_EXACT={'/api/imports','/api/workspace','/api/dashboard','/api/region-options','/api/geo/sig','/api/geo/emd','/api/clinic-location','/api/internal-finance','/api/internal-finance/export','/api/conversions','/api/conversions/template','/api/conversions/report','/api/ad-reports','/api/ad-reports/template','/api/ad-reports/report','/api/knowledge/search','/api/campaign-analysis','/api/strategy-evidence','/api/monitoring','/api/assistant/evidence'}
POST_PREFIXES=('/api/imports/','/api/workspace/','/api/conversions/','/api/ad-reports/','/api/internal-finance/','/api/clinic-location/')


def public_road():
    global ROAD_PATH
    with ROAD_LOCK:
        if ROAD_PATH and ROAD_PATH.is_file(): return ROAD_PATH
        entry=next(x for x in json.loads((ENGINE/'inventory.json').read_text('utf8')) if x['path'].endswith('.sqlite.gz'))
        path=Path(tempfile.gettempdir())/('ha-public-roads-'+entry['source_sha256']+'.sqlite')
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=entry['source_sha256']:
            content=gzip.decompress((ENGINE/entry['path']).read_bytes())
            if hashlib.sha256(content).hexdigest()!=entry['source_sha256']: raise CloudError('공개 주소 기준자료 검사에 실패했습니다.')
            with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as output: output.write(content); temporary=Path(output.name)
            try: os.replace(temporary,path)
            finally: temporary.unlink(missing_ok=True)
        # The same reference must have a stable timestamp across cold starts.
        os.utime(path,ns=(1700000000000000000,1700000000000000000))
        ROAD_PATH=path
        return path


class CloudStore(WorkbookStore):
    def snapshot(self):
        config,overrides=self._configuration()
        if config.get('allow_empty') is True and not config['files'] and not overrides:
            raise loader.DataError('아직 분석 자료가 반영되지 않았습니다. 엑셀 파일을 담당자에게 전달해 주세요.')
        return super().snapshot()
    def import_baseline(self):
        snapshot=super().import_baseline()
        if not snapshot.inventory:
            return replace(snapshot,fingerprint=hashlib.sha256(json.dumps([self.imports.clinic_id,snapshot.clinic,[]]).encode()).hexdigest())
        return snapshot


class CloudAccess:
    def __init__(self,principal,clinic_id,public_location_write=False):
        self.principal=principal; self.clinic_id=clinic_id; self.public_location_write=public_location_write
    def authorize(self,principal,clinic_id=None,write=False,admin=False):
        if principal!=self.principal or (clinic_id and clinic_id!=self.clinic_id): raise AccessError('병원 접근 권한이 없습니다.',403)
        # Public map coordinates belong to the clinic's shared editable content.
        # This exception is set only for the two allowlisted location mutations.
        location_editor=self.public_location_write and principal['role']=='editor'
        if (write and principal['role']=='viewer') or (admin and principal['role']!='admin' and not location_editor): raise AccessError('작업 권한이 없습니다.',403)
        return principal


class CloudHandler(Handler):
    def _allowed(self): return True  # Outer runtime has verified the bearer token and clinic.
    def _principal(self): return True,self.cloud_principal
    def _context(self,parsed,enabled,principal,write=False):
        claims=parse_qs(parsed.query,keep_blank_values=True).get('clinic',[])
        if len(claims)>1 or (claims and claims[0]!=self.clinic_id): raise AccessError('병원 선택이 일치하지 않습니다.',403)
        self.server.agency.access.authorize(principal,self.clinic_id,write=write)
        return self.cloud_context
    def _send(self,status,body,kind='application/json; charset=utf-8',headers=None,policy=None):
        if isinstance(body,(dict,list)): body=json.dumps(body,ensure_ascii=False,allow_nan=False).encode('utf8')
        if isinstance(body,str): body=body.encode('utf8')
        self.result=(status,body,kind,headers or {},policy)


def context(root,clinic):
    (root/'sources').mkdir(exist_ok=True)
    config={'clinic_id':clinic['id'],'clinic':clinic['name'],'source_directory':str(root/'sources'),'files':[],'allow_empty':True}
    manifest=root/'manifest.json'; manifest.write_text(json.dumps(config,ensure_ascii=False),encoding='utf8')
    loader.ROAD_DB=public_road()
    store=CloudStore(manifest); store.enable_imports(root/'imports')
    pending_file=root/'pending.json'
    if pending_file.exists():
        pending=json.loads(pending_file.read_text('utf8'))
        if not isinstance(pending,dict) or len(pending)>20: raise CloudError('업로드 검사 이력이 올바르지 않습니다.')
        for item in pending.values(): item['path']=store.imports._path(item['path'])
        store.imports.pending=pending
    return SimpleNamespace(store=store,marketing=MarketingStore(root/'marketing.sqlite',clinic['id']))


def save_pending(root,ctx):
    pending={}
    for key,item in ctx.store.imports.pending.items():
        pending[key]={**item,'path':item['path'].relative_to(ctx.store.imports.root).as_posix()}
    (root/'pending.json').write_text(json.dumps(pending,ensure_ascii=False),encoding='utf8')


def static_asset(path,clinic_id):
    relative=ASSETS[path]; file=STATIC/relative
    if relative in ('scope.js','agency.js','internal-finance.js'): file=ADAPTER_ASSETS/relative
    data=file.read_bytes()
    prefix=f'/api/hospital-analytics/runtime/{clinic_id}'
    if relative=='index.html':
        html=data.decode('utf8')
        html=re.sub(r'<a\b[^>]*data-page="(?:internalfinance|quality)"[^>]*>.*?</a>', '', html)
        html=re.sub(r'<section id="page-quality".*?</section>', '', html, flags=re.S)
        html=html.replace('병원별 접근 권한 적용','병원 분석 탭 접근 권한 적용')
        data=html.replace('href="/','href="'+prefix+'/').replace('src="/','src="'+prefix+'/').encode('utf8')
    if relative=='imports.js':
        data=b'export function initImports() {}\n'
    if relative=='app.js':
        script=data.decode('utf8').replace("import {initImports} from './imports.js';",'').replace('initImports(()=>loadData(true));','')
        script=re.sub(r'quality:\[[^\]]*\],','',script)
        script=script.replace('renderReports(d);renderQuality(d);','renderReports(d);').replace("$('source-count').textContent=d.sources.length;",'')
        data=script.encode('utf8')
    if relative=='clinic-location.css':
        data=data.decode('utf8').replace('body:not([data-access="local"]):not([data-access="admin"])',
            'body:not([data-access="editor"]):not([data-access="admin"])').encode('utf8')
    import mimetypes
    kind=mimetypes.guess_type(relative)[0] or 'application/octet-stream'
    if file.suffix=='.js': kind='text/javascript'
    if file.suffix in ('.js','.html','.css'): kind+='; charset=utf-8'
    return 200,data,kind,{},None


def execute(backend,clinic_id,method,path,payload=None,expected_identity=None):
    identifier(clinic_id)
    if method not in ('GET','POST') or not isinstance(path,str) or len(path)>8000 or not path.startswith('/') or '#' in path: raise CloudError('지원하지 않는 요청입니다.',400)
    parsed=urlparse(path)
    if parsed.scheme or parsed.netloc or '%' in parsed.path or '..' in parsed.path or '\\' in path: raise CloudError('지원하지 않는 경로입니다.',400)
    principal,clinic=backend.authorize(clinic_id,write=method=='POST')
    if expected_identity and expected_identity!=f"{principal['id']}:{principal['version']}": raise CloudError('ERP 로그인 계정이 바뀌었습니다. 화면을 다시 열어 주세요.',412)
    route=parsed.path
    claims=parse_qs(parsed.query,keep_blank_values=True).get('clinic',[])
    if len(claims)>1 or (claims and claims[0]!=clinic_id):raise CloudError('병원 선택이 일치하지 않습니다.',403)
    if method=='POST' and route.startswith('/api/imports/') and principal['role']!='admin':
        raise CloudError('원본 자료 반영은 관리자 작업입니다. 파일을 담당자에게 전달해 주세요.',403)
    if method=='GET' and route in ASSETS and route!='/index.html': return static_asset(route,clinic_id)
    if route=='/api/internal-finance' or route.startswith('/api/internal-finance/'):
        raise CloudError('내부 비용 기능은 준비 중입니다. 엑셀 분석과 병원 보고서는 사용할 수 있습니다.',503)
    if route in ('/api/assistant/status','/api/recovery') or route.startswith(('/api/assistant/generate','/api/recovery/','/api/strategy-ai/')) or route=='/api/monitoring/check':
        raise CloudError('PC 구독 AI·자동 모니터링·로컬 복구는 ERP에 아직 연결되지 않았습니다. 엑셀 분석과 보고서는 사용할 수 있습니다.',503)
    summary_route=route=='/api/address-reports' or bool(re.fullmatch(r'/api/address-reports/20\d{2}-(?:0[1-9]|1[0-2])/html',route))
    if method=='GET' and route not in GET_EXACT and route!='/index.html' and not summary_route and not re.fullmatch(r'/api/workspace/(reports/[a-f0-9]{32}/(html|presentation)|contents/[a-f0-9]{32}/html)',route): raise CloudError('지원하지 않는 분석 경로입니다.',404)
    if method=='POST' and not route.startswith(POST_PREFIXES) and route not in ('/api/monitoring/save','/api/monitoring/ack'): raise CloudError('지원하지 않는 분석 작업입니다.',404)
    if method=='POST':
        if not isinstance(payload,dict): raise CloudError('요청 내용을 확인해 주세요.',400)
        payload=dict(payload)
        if 'upload_path' in payload:
            if 'data' in payload or not route.startswith(('/api/imports/','/api/conversions/','/api/ad-reports/')): raise CloudError('업로드 요청을 확인해 주세요.',400)
            data=backend.download(clinic_id,payload.pop('upload_path'),'uploads',25*1024*1024)
            payload['data']=base64.b64encode(data).decode('ascii')
    state,archive=backend.read_snapshot(clinic_id)
    try:
        with tempfile.TemporaryDirectory(prefix='ha-clinic-') as folder:
            root=Path(folder)
            if archive: restore(archive,root)
            if method=='GET' and (route=='/index.html' or summary_route):
                reports=read_reports(root,clinic_id)
                if route=='/api/address-reports':
                    body={'reports':[{'period':p,'total_records':r['total_records'],'complexes':len(r['rows'])} for p,r in reports.items()],
                          'checked_at':datetime.now(timezone.utc).isoformat()}
                    return 200,json.dumps(body).encode(),'application/json; charset=utf-8',{},None
                if reports or summary_route:
                    months=parse_qs(parsed.query,keep_blank_values=True).get('month',[])
                    if len(months)>1 or (months and not PERIOD.fullmatch(months[0])):raise CloudError('보고서 기간을 확인해 주세요.',400)
                    month=route.split('/')[-2] if summary_route else months[0] if months else max(reports)
                    if month not in reports:raise CloudError('해당 기간의 집계 보고서가 없습니다.',404)
                    embedded=route=='/index.html'
                    html=render_report(reports[month],clinic,embedded=embedded,periods=sorted(reports,reverse=True),checked_at=datetime.now(timezone.utc).astimezone(loader.KST).strftime('%Y-%m-%d %H:%M:%S KST'))
                    script=summary_script()
                    digest=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
                    images='data: https://tile.openstreetmap.org' if embedded else 'data:'
                    policy=f"default-src 'none'; script-src 'sha256-{digest}'; style-src 'unsafe-inline'; img-src {images}; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors "+("'self'" if embedded else "'none'")
                    headers={} if embedded else {'Content-Disposition':"attachment; filename*=UTF-8''"+quote(clinic['name']+'_'+month+'_지역분석.html',safe='')}
                    return 200,html.encode('utf8'),'text/html; charset=utf-8',headers,policy
                return static_asset(route,clinic_id)
            ctx=context(root,clinic)
            access=CloudAccess(principal,clinic_id,public_location_write=method=='POST' and route in
                ('/api/clinic-location/save','/api/clinic-location/clear'))
            instance=CloudHandler.__new__(CloudHandler)
            instance.cloud_context=ctx; instance.cloud_principal=principal; instance.clinic_id=clinic_id
            instance.server=SimpleNamespace(agency=SimpleNamespace(access=access))
            body=json.dumps(payload,ensure_ascii=False).encode('utf8') if payload is not None else b''
            instance.path=path; instance.headers={'X-Local-App':'dday','Content-Type':'application/json','Content-Length':str(len(body))}
            instance.connection=SimpleNamespace(settimeout=lambda _:None); instance.rfile=io.BytesIO(body)
            instance.result=None
            (instance.do_POST if method=='POST' else instance.do_GET)()
            if not instance.result: raise CloudError('분석 결과를 확인하지 못했습니다.')
            if method=='POST' and instance.result[0]<300:
                save_pending(root,ctx)
                backend.commit(clinic_id,state['revision'],pack(root))
            return instance.result
    except (SnapshotError,SummaryError) as error: raise CloudError(str(error)) from None


def dispatch(backend,envelope):
    try:
        if not isinstance(envelope,dict) or set(envelope)-{'clinic','method','path','payload','identity'}: raise CloudError('요청 내용을 확인해 주세요.',400)
        return execute(backend,envelope.get('clinic'),envelope.get('method'),envelope.get('path'),envelope.get('payload'),envelope.get('identity'))
    except CloudError as error: return error.status,json.dumps({'error':str(error)},ensure_ascii=False).encode(),'application/json; charset=utf-8',{},None
    except Exception: return 503,json.dumps({'error':'분석 저장 자료를 처리하지 못했습니다. 기존 자료는 유지됩니다.'},ensure_ascii=False).encode(),'application/json; charset=utf-8',{},None
