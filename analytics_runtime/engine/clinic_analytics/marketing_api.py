"""Allowlisted workspace commands. Clinical evidence is always computed here."""
from .loader import DataError
from .marketing import period
from .marketing_reports import monthly_report,region_evidence
from .regional_context import read_context
from .competitors import read_competitors
from .market_context import read_market,region_market
from .report_measurements import capture as capture_measurements,source_guard
from .report_campaigns import capture as capture_campaigns


def evidence(server,level,code,dates):
    if level not in ('sig','emd') or not isinstance(code,str) or code not in server.store.index.names[level]:
        raise DataError('공식 지도에 있는 지역을 선택해 주세요.')
    if dates:
        if not isinstance(dates,dict):raise DataError('근거 조회기간을 확인해 주세요.')
        start,end=period(dates.get('start'),dates.get('end'))
    else:start=end=None
    result=region_evidence(server.store.snapshot(),level,code,start,end,read_context(),read_competitors())
    result['market_context']=region_market(read_market(),level,code,result['period']['end'])
    return result


def command(server,path,payload):
    store=server.marketing;revision=payload.get('revision')
    if path=='/api/workspace/save':
        kind=payload.get('kind');data=payload.get('data');measured=None
        if not isinstance(data,dict):raise DataError('저장할 내용을 확인해 주세요.')
        if kind=='strategies':
            previous=next((x for x in store.snapshot()['strategies'] if x['id']==data.get('id')),None)
            level,code=data.get('region_level'),data.get('region_code')
            if level not in ('sig','emd') or not isinstance(code,str) or code not in server.store.index.names[level]:
                raise DataError('공식 지도에 있는 지역을 선택해 주세요.')
            if not previous or payload.get('refresh_evidence') is True or (level,code)!=(previous['region_level'],previous['region_code']):
                measured=evidence(server,level,code,data.get('evidence_period'))
        return store.save(kind,data,revision,evidence=measured)
    if path=='/api/workspace/expenses/void':return store.void_expense(payload.get('id'),revision,payload.get('reason'))
    if path=='/api/workspace/reports/generate':
        workspace=store.snapshot()
        store._check_revision(revision,workspace['revision'])
        snapshot=server.store.snapshot()
        report=monthly_report(snapshot,workspace,payload.get('month'))
        report['campaign_comparisons']=capture_campaigns(snapshot,workspace,report['period'],payload.get('campaign_ids',[]),comparison_period=report['comparison_period'])
        report['measurements']=capture_measurements(server,report['period'],workspace,payload.get('window_days',30))
        with source_guard(server,report['measurements']):
            return store.create_report(report,revision,payload.get('notes',{}))
    if path=='/api/workspace/reports/notes':return store.update_report_notes(payload.get('id'),revision,payload.get('notes'))
    if path=='/api/workspace/reports/review':return store.review_report(payload.get('id'),revision,payload.get('reviewer'))
    raise DataError('지원하는 작업이 아닙니다.')
