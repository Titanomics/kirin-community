"""Supabase calls with the caller's JWT. No administrative key or auth fallback."""
import hashlib
import json
import os
import re
import uuid
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from urllib.parse import quote
from .snapshots import MAX_ARCHIVE

UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')


class CloudError(Exception):
    def __init__(self,message,status=503): super().__init__(message); self.status=status


def identifier(value):
    if not isinstance(value,str) or not UUID.fullmatch(value): raise CloudError('병원을 선택해 주세요.',400)
    return value


class SupabaseBackend:
    def __init__(self,token):
        self.url=os.environ.get('NEXT_PUBLIC_SUPABASE_URL','').strip().rstrip('/')
        self.key=os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY','').strip()
        if not self.url.startswith('https://') or not self.key: raise CloudError('분석 저장소 연결을 준비 중입니다.')
        if not token or len(token)>16000: raise CloudError('ERP 로그인이 필요합니다.',401)
        self.token=token; self.user=None; self.clinic=None; self.role=None

    def request(self,path,method='GET',data=None,binary=False,content_type='application/json',limit=MAX_ARCHIVE):
        if not path.startswith(('/auth/v1/','/rest/v1/','/storage/v1/')): raise CloudError('허용되지 않은 저장소 요청입니다.',400)
        body=data if isinstance(data,bytes) else json.dumps(data).encode() if data is not None else None
        headers={'Authorization':'Bearer '+self.token,'apikey':self.key,'Content-Type':content_type}
        try:
            with urlopen(Request(self.url+path,data=body,method=method,headers=headers),timeout=60) as response:
                result=response.read(limit+1)
                if len(result)>limit: raise CloudError('저장 자료의 크기가 한도를 초과했습니다.')
                return result if binary else json.loads(result) if result else None
        except HTTPError as error:
            with error:
                try: code=json.loads(error.read(8192)).get('code')
                except (ValueError,TypeError,AttributeError): code=None
            if code=='40001': raise CloudError('다른 담당자가 먼저 저장했습니다. 새로고침 후 다시 시도해 주세요.',409) from None
            if error.code in (401,403): raise CloudError('현재 계정에 접근 권한이 없습니다.',error.code) from None
            raise CloudError('분석 저장소 요청에 실패했습니다. 기존 자료는 유지됩니다.') from None
        except (URLError,TimeoutError,ValueError): raise CloudError('분석 저장소 연결을 확인하지 못했습니다.') from None

    def authorize(self,clinic_id,write=False):
        identifier(clinic_id)
        user=self.request('/auth/v1/user'); uid=identifier(user.get('id'))
        profiles=self.request(f'/rest/v1/profiles?id=eq.{uid}&select=id,display_name,role,resigned_at')
        if len(profiles)!=1 or profiles[0].get('resigned_at') is not None: raise CloudError('현재 계정은 분석에 접근할 수 없습니다.',403)
        clinics=self.request(f'/rest/v1/ha_clinics?id=eq.{clinic_id}&select=id,name,emr,owner,created_at')
        if len(clinics)!=1: raise CloudError('접근할 수 있는 병원 작업공간이 아닙니다.',403)
        profile=profiles[0]
        if profile['role']=='admin': role='admin'
        else:
            memberships=self.request(f'/rest/v1/ha_memberships?clinic_id=eq.{clinic_id}&user_id=eq.{uid}&select=role')
            if len(memberships)!=1 or memberships[0]['role'] not in ('editor','viewer'): raise CloudError('병원 접근 권한이 없습니다.',403)
            role=memberships[0]['role']
        if write and role=='viewer': raise CloudError('조회 권한으로는 변경할 수 없습니다.',403)
        self.clinic=clinics[0]; self.role=role
        self.user={'id':uid,'username':uid,'name':profile.get('display_name') or 'ERP 사용자','role':role,'version':1,'clinic_ids':[clinic_id]}
        return self.user,self.clinic

    def read_snapshot(self,clinic_id):
        rows=self.request(f'/rest/v1/ha_snapshots?clinic_id=eq.{identifier(clinic_id)}&select=revision,object_path,sha256')
        if len(rows)!=1: raise CloudError('병원 저장 이력을 찾지 못했습니다. 초기화하지 않습니다.')
        state=rows[0]
        if state['revision']==0 and state['object_path'] is None: return state,None
        data=self.download(clinic_id,state['object_path'],'snapshots',MAX_ARCHIVE)
        if hashlib.sha256(data).hexdigest()!=state['sha256']: raise CloudError('병원 저장 자료의 무결성 검사에 실패했습니다.')
        return state,data

    def download(self,clinic_id,path,kind,limit):
        extension='zip' if kind=='snapshots' else 'xlsx'
        if not isinstance(path,str) or not re.fullmatch(re.escape(identifier(clinic_id))+r'/'+kind+r'/[0-9a-f-]{36}\.'+extension,path): raise CloudError('파일의 병원이 일치하지 않습니다.',403)
        return self.request('/storage/v1/object/authenticated/hospital-analytics/'+quote(path,safe='/'),binary=True,limit=limit)

    def commit(self,clinic_id,revision,data):
        path=f'{identifier(clinic_id)}/snapshots/{uuid.uuid4()}.zip'
        self.request('/storage/v1/object/hospital-analytics/'+path,'POST',data,content_type='application/zip')
        return self.request('/rest/v1/rpc/ha_commit_snapshot','POST',{'target':clinic_id,'expected_revision':revision,'new_path':path,'new_sha256':hashlib.sha256(data).hexdigest()})
