"""Loopback-only synthetic Supabase HTTP fixture and real Python entrypoint.

No production env or credentials are read. This fixture is never deployed.
"""
import base64
import json
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,parse_qs,unquote

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from analytics_runtime.backend import SupabaseBackend
from api import analytics_runtime as entry

AUTH_PORT=54842;RUNTIME_PORT=54840
FIRST='11111111-1111-4111-8111-111111111111';SECOND='22222222-2222-4222-8222-222222222222'
ADMIN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';EDITOR='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';VIEWER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';OUTSIDER='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
profiles={uid:{'id':uid,'display_name':label,'email':label.lower()+'@example.test','role':role,'resigned_at':None,'team':None} for uid,label,role in ((ADMIN,'Admin','admin'),(EDITOR,'Editor','user'),(VIEWER,'Viewer','user'),(OUTSIDER,'Outsider','user'))}
clinics=[{'id':cid,'name':name,'emr':'dentweb','owner':'','created_at':'2026-10-19T00:00:00Z'} for cid,name in ((FIRST,'검증 A 병원'),(SECOND,'검증 B 병원'))]
members=[{'clinic_id':FIRST,'user_id':EDITOR,'role':'editor'},{'clinic_id':FIRST,'user_id':VIEWER,'role':'viewer'}]
tab_members=[{'user_id':EDITOR}]
states={cid:{'clinic_id':cid,'revision':0,'object_path':None,'sha256':None} for cid in (FIRST,SECOND)}
objects={};lock=threading.Lock()

def user(uid): return {'id':uid,'aud':'authenticated','role':'authenticated','email':profiles[uid]['email'],'app_metadata':{'provider':'email'},'user_metadata':{},'created_at':'2024-01-01T00:00:00Z'}
def b64(value): return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
def session(uid):
    token=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'sub':uid,'exp':int(time.time())+3600,'iat':int(time.time()),'aud':'authenticated'})+'.synthetic-signature'
    return {'access_token':token,'refresh_token':'synthetic-refresh','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user(uid)}
def identity(headers):
    try:
        value=headers.get('Authorization','').split(' ',1)[1].split('.')[1]
        uid=json.loads(base64.urlsafe_b64decode(value+'='*(-len(value)%4)))['sub']
        return uid if uid in profiles else None
    except Exception:return None
def can(uid,cid,write=False):
    return any(c['id']==cid for c in clinics) and uid in profiles and not profiles[uid]['resigned_at'] and (profiles[uid]['role']=='admin' or any(m['user_id']==uid for m in tab_members))

class Fixture(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send(self,status,body,kind='application/json'):
        if not isinstance(body,bytes):body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)))
        self.send_header('Access-Control-Allow-Origin','http://127.0.0.1:54843');self.send_header('Access-Control-Allow-Headers',self.headers.get('Access-Control-Request-Headers','authorization,apikey,content-type,x-client-info,x-upsert,prefer,accept,x-supabase-api-version'));self.send_header('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');self.end_headers();self.wfile.write(body)
    def do_OPTIONS(self):self.send(200,{})
    def do_GET(self):self.handle_request()
    def do_POST(self):self.handle_request()
    def do_DELETE(self):self.handle_request()
    def handle_request(self):
        parsed=urlparse(self.path);path=unquote(parsed.path);q=parse_qs(parsed.query);uid=identity(self.headers)
        raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
        if path=='/__fixture/reset':
            objects.clear()
            clinics[:]=[{'id':cid,'name':name,'emr':'dentweb','owner':'','created_at':'2026-10-19T00:00:00Z'} for cid,name in ((FIRST,'검증 A 병원'),(SECOND,'검증 B 병원'))]
            states.clear()
            states.update({cid:{'clinic_id':cid,'revision':0,'object_path':None,'sha256':None} for cid in (FIRST,SECOND)})
            members[:]=[{'clinic_id':FIRST,'user_id':EDITOR,'role':'editor'},{'clinic_id':FIRST,'user_id':VIEWER,'role':'viewer'}]
            tab_members[:]=[{'user_id':EDITOR}]
            return self.send(200,{'ok':True})
        if path=='/__fixture/empty-clinics':
            clinics.clear();states.clear();objects.clear();tab_members[:]=[{'user_id':EDITOR}]
            return self.send(200,{'ok':True})
        if path=='/__fixture/session':return self.send(200,session(q.get('user',[ADMIN])[0]))
        if path=='/__fixture/revoke':
            tab_members[:]=[m for m in tab_members if m['user_id']!=EDITOR];return self.send(200,{'ok':True})
        if not uid:return self.send(401,{'message':'Unauthorized'})
        if path=='/auth/v1/user':return self.send(200,user(uid))
        if path.startswith('/storage/v1/object/'):
            obj=path.split('/hospital-analytics/',1)[-1];cid=obj.split('/')[0]
            if not can(uid,cid,self.command=='POST'):return self.send(403,{'message':'Forbidden'})
            if self.command=='POST':
                if obj in objects:return self.send(409,{'message':'Exists'})
                objects[obj]=raw;return self.send(200,{'Key':obj})
            if obj not in objects:return self.send(404,{'message':'Missing'})
            return self.send(200,objects[obj],'application/octet-stream')
        if not path.startswith('/rest/v1/'):return self.send(404,{})
        table=path[len('/rest/v1/'):];data=json.loads(raw) if raw else {}
        if table=='rpc/ha_commit_snapshot':
            cid=data['target']
            if not can(uid,cid,True):return self.send(403,{'code':'42501'})
            with lock:
                state=states[cid]
                if state['revision']!=data['expected_revision']:return self.send(409,{'code':'40001'})
                state.update(revision=state['revision']+1,object_path=data['new_path'],sha256=data['new_sha256'])
                return self.send(200,state['revision'])
        if table=='ha_clinics' and self.command=='POST' and profiles[uid]['role']=='admin':
            # Measured against the real PostgreSQL policies: INSERT RETURNING
            # checks ha_can_access before its STABLE lookup can see the new row.
            if 'return=representation' in self.headers.get('Prefer',''):
                return self.send(403,{'code':'42501','message':'new row violates row-level security policy for table ha_clinics'})
            clinic={**data,'id':data.get('id') or str(uuid.uuid4()),'created_at':'2026-10-19T00:00:00Z'};clinics.append(clinic);states[clinic['id']]={'clinic_id':clinic['id'],'revision':0,'object_path':None,'sha256':None};return self.send(201,b'')
        if table=='ha_tab_memberships' and self.command in ('POST','DELETE') and profiles[uid]['role']=='admin':
            if self.command=='POST':
                tab_members[:]=[m for m in tab_members if m['user_id']!=data['user_id']];tab_members.append(data)
            else:tab_members[:]=[m for m in tab_members if not all(str(m.get(k))==v[0][3:] for k,v in q.items() if v[0].startswith('eq.'))]
            return self.send(200,[])
        if table=='profiles':rows=list(profiles.values()) if profiles[uid]['role']=='admin' else [profiles[uid]]
        elif table=='ha_clinics':rows=[c for c in clinics if can(uid,c['id'])]
        elif table=='ha_memberships':rows=members if profiles[uid]['role']=='admin' else [m for m in members if m['user_id']==uid]
        elif table=='ha_tab_memberships':rows=tab_members if profiles[uid]['role']=='admin' else [m for m in tab_members if m['user_id']==uid]
        elif table=='ha_snapshots':rows=[s for cid,s in states.items() if can(uid,cid)]
        else:rows=[]
        for key,values in q.items():
            value=values[0]
            if value.startswith('eq.'):rows=[r for r in rows if str(r.get(key))==value[3:]]
            elif value=='is.null':rows=[r for r in rows if r.get(key) is None]
        if 'application/vnd.pgrst.object+json' in self.headers.get('Accept',''):
            return self.send(200,rows[0]) if len(rows)==1 else self.send(406,{'message':'Missing'})
        return self.send(200,rows)

class SyntheticBackend(SupabaseBackend):
    def __init__(self,token):
        self.url=f'http://127.0.0.1:{AUTH_PORT}';self.key='synthetic-public-key';self.token=token
        self.user=None;self.clinic=None;self.role=None

if __name__=='__main__':
    ThreadingHTTPServer.allow_reuse_address=False
    entry.SupabaseBackend=SyntheticBackend
    auth=ThreadingHTTPServer(('127.0.0.1',AUTH_PORT),Fixture)
    threading.Thread(target=auth.serve_forever,daemon=True).start()
    runtime=ThreadingHTTPServer(('127.0.0.1',RUNTIME_PORT),entry.handler)
    print('Synthetic auth/storage and real Python runtime ready',flush=True)
    try:runtime.serve_forever()
    finally:runtime.server_close();auth.shutdown();auth.server_close()
