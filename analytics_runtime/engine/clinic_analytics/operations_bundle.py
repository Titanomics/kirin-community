"""HTTP operations for evidence assistance, channel checks and local recovery."""
from datetime import datetime
from urllib.parse import parse_qs
from .evidence_assistant import retrieve,generate
from .claude_subscription import subscription_status
from .monitoring import MonitorStore
from .recovery import RecoveryService
from .marketing import now
from .loader import DataError,KST

GET_PATHS={'/api/assistant/evidence','/api/assistant/status','/api/monitoring','/api/recovery'}
POST_PATHS={'/api/assistant/generate','/api/monitoring/save','/api/monitoring/check','/api/monitoring/ack','/api/recovery/create','/api/recovery/preview','/api/recovery/restore'}


def monitor(context):return MonitorStore(context.marketing.path.with_name('monitoring.sqlite'),context.marketing.clinic_id)


def recovery_status(registry,principal,context):
    service=RecoveryService(registry);result=service.list(principal,context);workspace=context.marketing.snapshot()
    latest=None;source_count=0;source_error=None
    try:
        source=context.store.import_baseline();source_count=len(source.inventory);latest=max((r['date'].isoformat() for r in source.records),default=None)
    except DataError as error:source_error=str(error)
    age=(datetime.now(KST).date()-datetime.fromisoformat(latest).date()).days if latest else None
    checks=[{'label':'접근권한','value':'담당자 계정 사용' if registry.access.status()['enabled'] else '이 PC 단독 모드','state':'configured' if registry.access.status()['enabled'] else 'local'},
        {'label':'EMR 원본','value':source_error or f'{source_count}개 · 최근 내원 {latest or "자료 없음"}','state':'unavailable' if source_error else 'ready'},
        {'label':'자료 경과일','value':f'{age}일 · 현재 성과 확인에는 최신 엑셀이 필요합니다.' if age is not None else '내원 기록 없음','state':'stale' if age is None or age>90 else 'current'},
        {'label':'승인된 병원 근거','value':f'{sum(f["eligible"] for f in workspace["knowledge"])}개 / 전체 {len(workspace["knowledge"])}개','state':'measured'},
        {'label':'접속 범위','value':'이 PC에서 실행 중 · 외부 서비스 배포 미실행','state':'local'},
        {'label':'백업 보관','value':f'{len(result["backups"])}개 · 같은 PC에 보관 · 다른 장치 복사 미확인','state':'local'}]
    return {**result,'checks':checks,'checked_at':now(),'limitations':['앱과 PC가 실행 중일 때만 자동 채널 확인이 동작합니다.','백업은 암호화한 외부 보관본이 아닙니다. PC 손실에 대비한 별도 보관은 아직 연결하지 않았습니다.','다른 PC로 옮길 때는 앱·공유 지역 데이터와 담당자 접근 설정을 별도로 준비해야 합니다.']}


def get(path,query,registry,principal,context):
    if path=='/api/assistant/status':return subscription_status()
    if path=='/api/assistant/evidence':
        params=parse_qs(query,keep_blank_values=True);params.pop('clinic',None)
        if set(params)!={'q'} or len(params['q'])!=1:raise DataError('질문을 하나 입력해 주세요.')
        return retrieve(context.marketing.snapshot(),params['q'][0])
    if path=='/api/monitoring':return monitor(context).snapshot(context.marketing.snapshot())
    return recovery_status(registry,principal,context)


def post(path,data,registry,principal,context):
    if path=='/api/assistant/generate':return generate(context.marketing,data.get('question'),data.get('digest'),data.get('confirmed'))
    if path=='/api/monitoring/save':return monitor(context).save(data.get('data'),data.get('revision'))
    if path=='/api/monitoring/check':return monitor(context).check(data.get('id'))
    if path=='/api/monitoring/ack':return monitor(context).ack(data.get('id'),data.get('note'),data.get('revision'))
    service=RecoveryService(registry)
    if path=='/api/recovery/create':return service.create(principal,context)
    if path=='/api/recovery/preview':return service.preview(principal,context,data.get('id'))
    return service.restore(principal,context,data.get('id'),data.get('digest'),data.get('name'),data.get('confirmed'),data.get('request_id'))
