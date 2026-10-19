"""Loopback-only aggregate API and static UI. No arbitrary filesystem access."""
import json
import base64
import binascii
import mimetypes
import re
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from http.cookies import SimpleCookie,CookieError
from pathlib import Path
from urllib.parse import urlparse,parse_qs,unquote

from .loader import WorkbookStore,DataError
from .analytics import build_dashboard
from .regional_context import read_context
from .competitors import read_competitors
from .market_context import read_market,dashboard_market
from .marketing import MarketingStore,record_actor
from .marketing_api import command as workspace_command,evidence as strategy_evidence
from .marketing_reports import report_html
from .presentation import render as presentation_html,assets as presentation_assets
from .agency import AgencyRegistry,EMRS
from .access import AccessError,SESSION_SECONDS
from .knowledge import search as search_knowledge,content_html
from .conversions import ConversionStore,template_xlsx
from .ad_reports import AdReportStore,template_xlsx as ad_template,inspect_upload as inspect_ad_upload
from .internal_finance import InternalFinanceStore,export_csv as internal_finance_csv
from .clinic_location import ClinicLocationStore
from . import operations_bundle
from . import strategy_assistant
from .campaign_analysis import analyze as analyze_campaign
from .monitoring import MonitorService

STATIC=Path(__file__).resolve().parents[1]/'static'
ASSETS={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/charts.js':'charts.js','/map.js':'map.js','/favicon.svg':'favicon.svg'}
ASSETS.update({f'/{name}':name for name in ('map-layout.js','reference-charts.js','reference.js','reference.css')})
ASSETS.update({'/imports.js':'imports.js','/imports.css':'imports.css'})
ASSETS['/regional-research.js']='regional-research.js'
ASSETS.update({f'/{name}':name for name in ('marketing.js','marketing.css','campaign-map.js','report-measurements.js')})
ASSETS.update({f'/{name}':name for name in ('strategy-ai.js','strategy-ai.css')})
ASSETS['/campaign-analysis.js']='campaign-analysis.js'
ASSETS['/report-campaigns.js']='report-campaigns.js'
ASSETS.update({f'/{name}':name for name in ('scope.js','agency.js','agency.css')})
ASSETS.update({f'/{name}':name for name in ('knowledge.js','knowledge.css')})
ASSETS.update({f'/{name}':name for name in ('conversions.js','conversions.css')})
ASSETS.update({f'/{name}':name for name in ('ad-reports.js','ad-reports.css','ad-mapping.js')})
ASSETS.update({f'/{name}':name for name in ('internal-finance.js','internal-finance.css')})
ASSETS.update({f'/{name}':name for name in ('clinic-location.js','clinic-location.css')})
ASSETS.update({f'/{name}':name for name in ('assistant.js','monitoring.js','recovery.js','operations-ui.js','operations-bundle.css')})


class Handler(BaseHTTPRequestHandler):
    server_version='DDayLocal/1.0'

    def log_message(self,*args):pass

    def _allowed(self):
        hosts={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in hosts:return False
        origin=self.headers.get('Origin')
        if origin and origin not in {f'http://{x}' for x in hosts}:return False
        if self.headers.get('Sec-Fetch-Site')=='cross-site':return False
        return True

    def _send(self,status,body,kind='application/json; charset=utf-8',headers=None,policy=None):
        if isinstance(body,(dict,list)):body=json.dumps(body,ensure_ascii=False,allow_nan=False).encode('utf-8')
        if isinstance(body,str):body=body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        for key,value in (headers or {}).items():self.send_header(key,value)
        self.send_header('Content-Security-Policy',policy or "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers();self.wfile.write(body)

    def _session(self):
        try:
            cookie=SimpleCookie();cookie.load(self.headers.get('Cookie',''))
            return cookie['dday_session'].value if 'dday_session' in cookie else None
        except CookieError:return None

    def _principal(self):
        access=self.server.agency.access;enabled=access.status()['enabled']
        principal=access.principal(self._session()) if enabled else None
        expected=self.headers.get('X-Operator-Identity')
        actual=f"{principal['id']}:{principal['version']}" if principal else 'local'
        if expected and expected!=actual:raise AccessError('로그인 계정이 변경됐습니다. 현재 계정으로 화면을 다시 엽니다.',412)
        return enabled,principal

    def _context(self,parsed,enabled,principal,write=False):
        query=parse_qs(parsed.query,keep_blank_values=True);claims=query.get('clinic',[])
        header=self.headers.get('X-Clinic-Id')
        if len(claims)>1 or (claims and header and claims[0]!=header):raise AccessError('병원 선택이 일치하지 않습니다.',400)
        identifier=header if header is not None else claims[0] if claims else None
        if identifier is None and not enabled:identifier=self.server.agency.primary_id
        if not identifier:raise AccessError('병원을 선택해 주세요.',400)
        return self.server.agency.context(principal,identifier,write=write)

    def _cookie(self,token=None):
        return {'Set-Cookie':f'dday_session={token or ""}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS if token else 0}'}

    def _conversions(self,context):return ConversionStore(context.marketing.path.with_name('conversions.sqlite'),context.marketing.clinic_id)
    def _ad_reports(self,context):return AdReportStore(context.marketing.path.with_name('ad-reports.sqlite'),context.marketing.clinic_id)
    def _internal_finance(self,context,principal):
        self.server.agency.access.authorize(principal,clinic_id=context.marketing.clinic_id,admin=True)
        return InternalFinanceStore(context.marketing.path.with_name('internal-finance.sqlite'),context.marketing.clinic_id)
    def _clinic_location(self,context):return ClinicLocationStore(context.marketing.path.with_name('clinic-location.sqlite'),context.marketing.clinic_id)

    def do_GET(self):
        if not self._allowed():self._send(403,{'error':'로컬 앱에서만 접근할 수 있습니다.'});return
        parsed=urlparse(self.path);path=unquote(parsed.path)
        try:
            if path=='/api/health':
                self._send(200,{'app':'dday-local-analytics','status':'running'});return
            if path=='/api/auth/status':
                self._send(200,self.server.agency.access.status(self._session()));return
            if path.startswith('/api/'):
                enabled,principal=self._principal()
                if path=='/api/agency':
                    clinics=self.server.agency.list(principal);ids={x['id'] for x in clinics}
                    default=self.server.agency.primary_id if self.server.agency.primary_id in ids else clinics[0]['id'] if clinics else None
                    self._send(200,{'clinics':clinics,'default_id':default,'emrs':EMRS,'access_mode':'accounts' if enabled else 'local','user':principal});return
                if path=='/api/agency/overview':
                    self._send(200,self.server.agency.overview(principal));return
                if path=='/api/agency/users':
                    self._send(200,{'users':self.server.agency.access.users(principal)});return
                context=self._context(parsed,enabled,principal)
            if path in operations_bundle.GET_PATHS:
                self._send(200,operations_bundle.get(path,parsed.query,self.server.agency,principal,context));return
            if path=='/api/imports':
                self._send(200,context.store.imports.status());return
            if path=='/api/workspace':
                self._send(200,context.marketing.snapshot());return
            if path=='/api/clinic-location':
                self._send(200,self._clinic_location(context).snapshot());return
            if path in ('/api/internal-finance','/api/internal-finance/export'):
                finance=self._internal_finance(context,principal)
                query=parse_qs(parsed.query,keep_blank_values=True);query.pop('clinic',None)
                if set(query)!={'start','end'} or any(len(v)!=1 for v in query.values()):raise ValueError
                report=finance.report(query['start'][0],query['end'][0])
                if path.endswith('/export'):self._send(200,internal_finance_csv(report),'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename="internal-finance.csv"'})
                else:self._send(200,report)
                return
            if path=='/api/conversions':
                self._send(200,self._conversions(context).status());return
            if path=='/api/ad-reports':
                self._send(200,self._ad_reports(context).status());return
            if path=='/api/ad-reports/template':
                self._send(200,ad_template(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{'Content-Disposition':'attachment; filename="ad-report-template.xlsx"'});return
            if path=='/api/ad-reports/report':
                query=parse_qs(parsed.query,keep_blank_values=True);query.pop('clinic',None)
                if set(query)!={'start','end'} or any(len(v)!=1 for v in query.values()):raise ValueError
                self._send(200,self._ad_reports(context).report(query['start'][0],query['end'][0],context.marketing.snapshot()));return
            if path=='/api/conversions/template':
                self._send(200,template_xlsx(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{'Content-Disposition':'attachment; filename="conversion-template.xlsx"'});return
            if path=='/api/conversions/report':
                query=parse_qs(parsed.query,keep_blank_values=True);query.pop('clinic',None)
                if set(query)!={'start','end','window'} or any(len(v)!=1 for v in query.values()):raise ValueError
                self._send(200,self._conversions(context).report(query['start'][0],query['end'][0],int(query['window'][0]),context.marketing.snapshot()));return
            if path=='/api/knowledge/search':
                query=parse_qs(parsed.query,keep_blank_values=True);query.pop('clinic',None)
                if set(query)!={'q'} or len(query['q'])!=1:raise ValueError
                self._send(200,search_knowledge(context.marketing.snapshot(),query['q'][0]));return
            match=re.fullmatch(r'/api/workspace/contents/([a-f0-9]{32})/html',path)
            if match:
                self._send(200,content_html(context.marketing.snapshot(),match[1]),'text/html; charset=utf-8');return
            if path=='/api/region-options':
                self._send(200,context.store.index.names);return
            if path=='/api/campaign-analysis':
                query=parse_qs(parsed.query,keep_blank_values=True);query.pop('clinic',None)
                if not 'campaign_id' in query or set(query)-{'campaign_id','baseline','reference_code'} or any(len(v)!=1 for v in query.values()):raise ValueError
                self._send(200,analyze_campaign(context,query['campaign_id'][0],query.get('baseline',['previous'])[0],query.get('reference_code',[''])[0]));return
            if path=='/api/strategy-evidence':
                query=parse_qs(parsed.query,keep_blank_values=True);query.pop('clinic',None)
                if set(query)-{'level','code','start','end'} or any(len(v)!=1 for v in query.values()):raise ValueError
                params={k:v[0] for k,v in query.items()}
                dates={'start':params.get('start'),'end':params.get('end')} if 'start' in params or 'end' in params else None
                self._send(200,strategy_evidence(context,params.get('level'),params.get('code'),dates));return
            match=re.fullmatch(r'/api/workspace/reports/([a-f0-9]{32})/(html|presentation)',path)
            if match:
                report=next((x for x in context.marketing.snapshot()['reports'] if x['id']==match[1]),None)
                if report is None:self._send(404,{'error':'보고서가 없습니다.'});return
                if match[2]=='presentation':
                    self._send(200,presentation_html(report),'text/html; charset=utf-8',policy=presentation_assets()[2]+"; frame-ancestors 'none'")
                else:self._send(200,report_html(report),'text/html; charset=utf-8')
                return
            if path=='/api/dashboard':
                query=parse_qs(parsed.query,keep_blank_values=True);query.pop('clinic',None)
                allowed={'start','end','compare_start','compare_end'}
                if set(query)-allowed or any(len(v)!=1 for v in query.values()):raise ValueError('지원하지 않는 조회조건입니다.')
                params={k:v[0] for k,v in query.items()}
                # Validate dates before opening workbooks as well as in the calculator.
                from datetime import date
                for value in params.values():
                    if value:date.fromisoformat(value)
                dashboard=build_dashboard(context.store.snapshot(),**params)
                dashboard['regional_context']=read_context()
                dashboard['competitors']=read_competitors()
                dashboard['market_context']=dashboard_market(read_market(),dashboard['period']['end'])
                self._send(200,dashboard);return
            if path in ('/api/geo/sig','/api/geo/emd'):
                self._send(200,context.store.index.public_geojson(path.rsplit('/',1)[1]));return
            if path in ASSETS:
                asset=STATIC/ASSETS[path]
                if not asset.is_file():self._send(404,{'error':'화면 파일이 없습니다.'});return
                kind=mimetypes.guess_type(asset)[0] or 'application/octet-stream'
                if asset.suffix=='.js':kind='text/javascript'
                if asset.suffix in ('.html','.css','.js'):kind+='; charset=utf-8'
                self._send(200,asset.read_bytes(),kind);return
            self._send(404,{'error':'요청한 경로가 없습니다.'})
        except AccessError as error:self._send(error.status,{'error':str(error)})
        except ValueError:self._send(400,{'error':'조회 기간이나 조건을 확인해 주세요.'})
        except DataError as e:self._send(503,{'error':str(e),'fresh':False})
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
        except Exception:self._send(500,{'error':'처리 중 오류가 발생했습니다. 원본은 변경되지 않았습니다.'})

    def do_POST(self):
        if not self._allowed() or self.headers.get('X-Local-App')!='dday' or self.headers.get('Content-Type','').split(';')[0]!='application/json':
            self._send(403,{'error':'로컬 앱 화면에서 요청해 주세요.'});return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=36*1024*1024 or self.headers.get('Transfer-Encoding'):
                self._send(413,{'error':'요청 크기가 허용 범위를 벗어났습니다.'});return
            self.connection.settimeout(30)
            raw=self.rfile.read(size)
            if len(raw)!=size:raise ValueError
            payload=json.loads(raw)
            if not isinstance(payload,dict):raise ValueError
            parsed=urlparse(self.path);path=parsed.path;access=self.server.agency.access
            if not path.startswith(('/api/imports/','/api/conversions/','/api/ad-reports/')) and size>2*1024*1024:raise DataError('요청 크기를 줄여 주세요.')
            if path.startswith(('/api/conversions/','/api/ad-reports/')) and size>8*1024*1024:raise DataError('업로드 요청 크기를 줄여 주세요.')
            if path in ('/api/auth/setup','/api/auth/login'):
                token=access.setup(payload.get('username'),payload.get('name'),payload.get('password')) if path.endswith('/setup') else access.login(payload.get('username'),payload.get('password'))
                self._send(200,{'ok':True},headers=self._cookie(token));return
            if path=='/api/auth/logout':
                access.logout(self._session());self._send(200,{'ok':True},headers=self._cookie());return
            enabled,principal=self._principal()
            if path=='/api/auth/password':
                access.change_password(principal,payload.get('current'),payload.get('password'));self._send(200,{'ok':True},headers=self._cookie());return
            if path=='/api/agency/clinics':
                self._send(200,self.server.agency.create(principal,payload));return
            if path=='/api/agency/users':
                self._send(200,access.save_user(principal,payload,self.server.agency.ids()));return
            context=self._context(parsed,enabled,principal,write=True);manager=context.store.imports
            if path in operations_bundle.POST_PATHS:
                with record_actor(principal):result=operations_bundle.post(path,payload,self.server.agency,principal,context)
            elif path in strategy_assistant.PATHS:
                with record_actor(principal):result=strategy_assistant.command(context,path,payload)
            elif path.startswith('/api/workspace/'):
                if size>2*1024*1024:raise DataError('작업공간 요청 크기를 줄여 주세요.')
                with record_actor(principal):result=workspace_command(context,path,payload)
            elif path.startswith('/api/internal-finance/'):
                finance=self._internal_finance(context,principal)
                with record_actor(principal):
                    if path=='/api/internal-finance/save':result=finance.save(payload.get('data'),payload.get('revision'),payload.get('request_id'),context.marketing.snapshot())
                    elif path=='/api/internal-finance/void':result=finance.void(payload.get('id'),payload.get('revision'),payload.get('reason'),payload.get('confirmed'),payload.get('request_id'))
                    else:self._send(404,{'error':'요청한 경로가 없습니다.'});return
            elif path.startswith('/api/clinic-location/'):
                self.server.agency.access.authorize(principal,clinic_id=context.marketing.clinic_id,admin=True)
                location=self._clinic_location(context)
                with record_actor(principal):
                    if path=='/api/clinic-location/save':result=location.save(payload.get('data'),payload.get('revision'))
                    elif path=='/api/clinic-location/clear':result=location.clear(payload.get('revision'),payload.get('reason'),payload.get('confirmed'))
                    else:self._send(404,{'error':'요청한 경로가 없습니다.'});return
            elif path.startswith('/api/ad-reports/'):
                reports=self._ad_reports(context);workspace=context.marketing.snapshot()
                with record_actor(principal):
                    if path=='/api/ad-reports/inspect':
                        data=base64.b64decode(payload['data'],validate=True)
                        result=inspect_ad_upload(payload.get('filename'),data,header_row=payload.get('header_row',1),campaign_column=payload.get('campaign_column'))
                    elif path=='/api/ad-reports/rollback':result=reports.rollback(payload.get('revision'),payload.get('reason'),payload.get('confirmed'))
                    elif path=='/api/ad-reports/withdraw-preview':result=reports.withdraw_preview(payload.get('keys'),workspace)
                    elif path=='/api/ad-reports/withdraw':result=reports.withdraw(payload.get('keys'),workspace,payload.get('revision'),payload.get('digest'),payload.get('reason'),payload.get('confirmed'))
                    elif path in ('/api/ad-reports/preview','/api/ad-reports/commit'):
                        data=base64.b64decode(payload['data'],validate=True)
                        if path.endswith('/preview'):result=reports.preview(payload.get('filename'),data,payload.get('metadata'),workspace,mapping=payload.get('mapping'))
                        else:result=reports.commit(payload.get('filename'),data,payload.get('metadata'),workspace,payload.get('revision'),payload.get('digest'),payload.get('confirmed'),payload.get('replace'),payload.get('reason'),mapping=payload.get('mapping'))
                    else:self._send(404,{'error':'요청한 경로가 없습니다.'});return
            elif path.startswith('/api/conversions/'):
                conversions=self._conversions(context);workspace=context.marketing.snapshot()
                with record_actor(principal):
                    if path=='/api/conversions/rollback':result=conversions.rollback(payload.get('revision'),payload.get('reason'),payload.get('confirmed'))
                    elif path in ('/api/conversions/preview','/api/conversions/commit'):
                        data=base64.b64decode(payload['data'],validate=True)
                        if path.endswith('/preview'):result=conversions.preview(payload.get('filename'),data,payload.get('observed_through'),workspace)
                        else:
                            context.marketing._check_revision(payload.get('workspace_revision'),workspace['revision'])
                            result=conversions.commit(payload.get('filename'),data,payload.get('observed_through'),workspace,payload.get('revision'),payload.get('sha256'),payload.get('confirmed'))
                    else:self._send(404,{'error':'요청한 경로가 없습니다.'});return
            elif path in ('/api/imports/inspect','/api/imports/preview'):
                data=base64.b64decode(payload['data'],validate=True)
                if path.endswith('/inspect'):result=manager.inspect(payload.get('filename',''),data)
                else:result=manager.preview(payload.get('filename',''),data,year=payload.get('year'),kind=payload.get('kind'),mapping=payload.get('mapping'))
            elif path=='/api/imports/commit':
                result=manager.commit(payload.get('id'),payload.get('revision'),confirmed=payload.get('confirmed') is True)
            elif path=='/api/imports/rollback':
                if payload.get('confirmed') is not True:raise DataError('최근 반영을 되돌릴지 확인해 주세요.')
                result=manager.rollback(payload.get('revision'))
            else:self._send(404,{'error':'요청한 경로가 없습니다.'});return
            self._send(200,result)
        except AccessError as error:self._send(error.status,{'error':str(error)})
        except DataError as error:self._send(400,{'error':str(error)})
        except (ValueError,TypeError,KeyError,binascii.Error):self._send(400,{'error':'파일과 입력 항목을 다시 확인해 주세요.'})
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
        except Exception:self._send(500,{'error':'반영하지 못했습니다. 원본 엑셀은 변경되지 않았습니다.'})


class LocalServer(ThreadingHTTPServer):
    def server_close(self):
        if hasattr(self,'monitor_service'):self.monitor_service.close()
        super().server_close()


def create_server(manifest,port=8765):
    server=LocalServer(('127.0.0.1',port),Handler)
    server.daemon_threads=True
    server.store=WorkbookStore(manifest)
    import hashlib
    namespace=hashlib.sha256(str(Path(manifest).resolve()).encode()).hexdigest()[:16]
    server.store.enable_imports(STATIC.parent/'.local'/'imports'/namespace)
    server.marketing=MarketingStore(STATIC.parent/'.local'/'marketing'/namespace/'workspace.sqlite',server.store.imports.clinic_id)
    server.agency=AgencyRegistry(STATIC.parent/'.local'/'agency'/namespace,server)
    server.monitor_service=MonitorService(server)
    return server
