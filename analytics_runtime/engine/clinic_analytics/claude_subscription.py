"""Optional tools-disabled Claude subscription route. No API-key fallback."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from .loader import DataError
from .marketing import now

MODEL='claude-fable-5-1'
BUSY=threading.BoundedSemaphore(1)
BLOCKED_ENV=('ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY')
SCHEMA={'type':'object','properties':{'sections':{'type':'array','maxItems':12,'items':{'type':'object','properties':{'text':{'type':'string','maxLength':4000},'citations':{'type':'array','minItems':1,'maxItems':6,'items':{'type':'integer','minimum':1,'maximum':6}}},'required':['text','citations'],'additionalProperties':False}},'missing':{'type':'array','maxItems':20,'items':{'type':'string','maxLength':1000}}},'required':['sections','missing'],'additionalProperties':False}


def executable():
    found=shutil.which('claude')
    if not found:return None
    path=Path(found)
    if path.suffix.lower() in ('.cmd','.ps1','.bat'):
        native=path.parent/'node_modules'/'@anthropic-ai'/'claude-code'/'bin'/'claude.exe'
        return str(native) if native.is_file() else None
    return str(path)


def _run(args,prompt=None,timeout=15):
    binary=executable()
    if not binary or any(os.environ.get(k) for k in BLOCKED_ENV):raise DataError('구독 전용 실행 조건을 확인하지 못했습니다. API 키 방식은 사용하지 않습니다.')
    env=os.environ.copy();env.pop('CLAUDECODE',None);env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']='1'
    with tempfile.TemporaryDirectory(prefix='clinic-approved-facts-') as cwd:
        try:
            result=subprocess.run([binary,*args],input=prompt,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='strict',cwd=cwd,env=env,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            if result.returncode or len(result.stdout)>150000:raise ValueError
            data=json.loads(result.stdout)
            if not isinstance(data,dict):raise ValueError
            return data
        except (OSError,ValueError,UnicodeError,subprocess.SubprocessError):raise DataError('Claude 구독 실행이 완료되지 않았습니다. 로그인·이용 한도와 연결을 확인해 주세요.') from None


def subscription_status():
    status={'available':False,'requested_model':MODEL,'checked_at':now(),'route':'subscription_only'}
    try:
        auth=_run(['auth','status','--json'])
        available=auth.get('loggedIn') is True and auth.get('authMethod')=='claude.ai' and auth.get('apiProvider')=='firstParty' and auth.get('subscriptionType') in ('max','pro','team','enterprise')
        return {**status,'available':available,'message':'Claude 구독 로그인 확인' if available else '사용 가능한 Claude 구독 로그인이 필요합니다.'}
    except DataError as error:return {**status,'message':str(error)}


def run_claude(prompt,*,schema=None):
    if not BUSY.acquire(blocking=False):raise DataError('다른 답변을 작성 중입니다. 잠시 뒤 다시 요청해 주세요.')
    try:
        if not subscription_status()['available']:raise DataError('Claude 구독 로그인 상태를 확인해 주세요.')
        data=_run(['--print','--output-format','json','--model',MODEL,'--tools','','--strict-mcp-config','--setting-sources','','--settings','{"disableAllHooks":true}','--no-session-persistence','--disable-slash-commands','--json-schema',json.dumps(schema or SCHEMA,separators=(',',':'))],prompt,120)
        if data.get('is_error') or not isinstance(data.get('structured_output'),dict):raise DataError('Claude가 근거 답변을 반환하지 않았습니다. 근거와 이용 상태를 확인해 주세요.')
        actual=[name for name,usage in data.get('modelUsage',{}).items() if isinstance(usage,dict) and usage.get('outputTokens',0)>0]
        return {**data['structured_output'],'model':', '.join(actual) or '확인되지 않음'}
    finally:BUSY.release()
