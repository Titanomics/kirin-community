"""Vercel Python entrypoint; direct calls require a verified Supabase bearer JWT."""
import gzip
import json
from http.server import BaseHTTPRequestHandler
from analytics_runtime.backend import SupabaseBackend,CloudError
from analytics_runtime.runtime import dispatch
from analytics_runtime.version import VERSION


class handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self): self.respond(405,b'{"error":"Use the ERP application"}','application/json',{},None)
    def do_POST(self):
        try:
            auth=self.headers.get('Authorization','')
            if not auth.startswith('Bearer '): raise CloudError('ERP 로그인이 필요합니다.',401)
            if self.headers.get('X-HA-Engine-Version') and self.headers['X-HA-Engine-Version']!=VERSION:
                raise CloudError('배포된 화면과 분석 엔진의 버전이 다릅니다. 잠시 후 다시 열어 주세요.',409)
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=4*1024*1024: raise CloudError('요청 크기를 줄여 주세요.',413)
            if self.headers.get('Content-Type','').split(';')[0]!='application/json': raise CloudError('지원하지 않는 요청입니다.',415)
            envelope=json.loads(self.rfile.read(size))
            result=dispatch(SupabaseBackend(auth[7:]),envelope)
        except CloudError as error: result=(error.status,json.dumps({'error':str(error)},ensure_ascii=False).encode(),'application/json',{},None)
        except (ValueError,TypeError): result=(400,b'{"error":"Invalid request"}','application/json',{},None)
        self.respond(*result)
    def respond(self,status,body,kind,headers,policy):
        compressed=len(body)>16384
        if compressed: body=gzip.compress(body)
        if len(body)>4*1024*1024:
            status=413;body=b'{"error":"Response exceeds the online limit; narrow the report period"}';kind='application/json';compressed=False
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','private, no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-HA-Engine-Version',VERSION)
        if compressed: self.send_header('Content-Encoding','gzip')
        if policy: self.send_header('Content-Security-Policy',policy)
        for key,value in headers.items(): self.send_header(key,value)
        self.end_headers();self.wfile.write(body)
