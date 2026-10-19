"""Real ERP browser -> Next server -> Python -> synthetic Supabase HTTP flow."""
import base64
import json
import sys
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT));sys.path.insert(0,str(Path(__file__).parent))
from test_engine_flow import workbook,channel_workbook,FIRST,SECOND
from browser_fixture import ADMIN,EDITOR,VIEWER,OUTSIDER

BASE='http://127.0.0.1:54843';FIXTURE='http://127.0.0.1:54842'
ARTIFACTS=ROOT/'.local';ARTIFACTS.mkdir(exist_ok=True)


def authenticated(browser,uid):
    with urlopen(FIXTURE+'/__fixture/session?user='+uid) as response: session=json.load(response)
    cookie='base64-'+base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip('=')
    context=browser.new_context(viewport={'width':1560,'height':1000},accept_downloads=True)
    context.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':BASE,'sameSite':'Lax'}]);return context


with sync_playwright() as p:
    expect.set_options(timeout=90000)
    with urlopen(FIXTURE+'/__fixture/reset') as response:assert json.load(response)['ok']
    browser=p.chromium.launch(channel='msedge',headless=True)
    context=authenticated(browser,ADMIN);page=context.new_page();page.set_default_timeout(90000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(BASE+'/hospital-analytics');expect(page.get_by_role('heading',name='병원 분석',exact=True)).to_be_visible()
    page.get_by_role('button',name='병원 분석 관리').click()
    page.locator('input[name="name"]').fill('검증 신규 병원')
    page.locator('input[name="owner"]').fill('합성 검증')
    with page.expect_response(lambda r:r.url.endswith('/hospital-analytics/admin') and r.request.method=='POST') as created:
        page.get_by_role('button',name='병원 등록',exact=True).click()
    assert created.value.status==201,created.value.text()
    created_id=created.value.json()['id']
    expect(page.get_by_label('분석할 병원')).to_have_value(created_id)
    expect(page.frame_locator('iframe').locator('#active-clinic-name')).to_have_text('검증 신규 병원')
    page.get_by_role('button',name='병원 분석 관리').click()
    print('PASS admin creates a clinic and immediately opens the returned workspace',flush=True)
    page.get_by_label('분석할 병원').select_option(FIRST)
    frame=page.frame_locator('iframe');expect(frame.locator('#active-clinic-name')).to_have_text('검증 A 병원')
    expect(frame.locator('a[data-page="internalfinance"]')).to_have_count(0)
    frame.locator('a[href="#quality"]').click();expect(frame.locator('#import-file')).to_be_visible()
    frame.locator('#import-file').set_input_files({'name':'2024 synthetic.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':workbook()})
    expect(frame.locator('#import-preview-button')).to_be_enabled();frame.locator('#import-year').fill('2024');frame.locator('#import-kind').select_option('receipts')
    frame.locator('#import-preview-button').click();expect(frame.locator('#import-confirm')).to_be_visible()
    frame.locator('#import-confirm').check();frame.locator('#import-commit').click();expect(frame.locator('#import-message')).to_contain_text('반영했습니다')
    expect(frame.locator('#import-file')).to_be_enabled()
    frame.locator('#import-file').set_input_files({'name':'2024년내원환자내원경로분포.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':channel_workbook()})
    expect(frame.locator('#import-preview-button')).to_be_enabled();frame.locator('#import-kind').select_option('channels')
    frame.locator('#import-preview-button').click();expect(frame.locator('#import-confirm')).to_be_visible()
    frame.locator('#import-confirm').check();frame.locator('#import-commit').click();expect(frame.locator('#import-message')).to_contain_text('반영했습니다')
    print('PASS browser Excel upload -> inspect -> preview -> commit',flush=True)
    page.reload();page.get_by_label('분석할 병원').select_option(FIRST)
    frame=page.frame_locator('iframe');expect(frame.locator('#active-clinic-name')).to_have_text('검증 A 병원')
    frame.locator('a[href="#map"]').click()
    expect(frame.locator('#map-container svg path').first).to_be_visible(timeout=90000)
    # The real engine must have retained the data across all cold HTTP calls.
    result=context.request.get(BASE+f'/api/hospital-analytics/runtime/{FIRST}/api/dashboard').json()
    assert result['current']['patients']==6,result.get('error')
    fills=frame.locator('#map-container .map-region').evaluate_all('(items)=>items.map(item=>item.getAttribute("fill"))')
    assert 'none' in fills and any(value!='none' for value in fills)
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(ARTIFACTS/'analytics-erp-map.png'),full_page=True)
    print('PASS refresh -> retained patient count -> regional map',flush=True)
    frame.locator('a[href="#clientreports"]').click();expect(frame.locator('#report-generate')).to_be_visible()
    frame.locator('#report-generate [name="month"]').fill('2024-02');frame.locator('#report-generate button[type="submit"]').click()
    expect(frame.locator('[data-download-presentation]')).to_be_visible(timeout=90000)
    with page.expect_download() as download_info:frame.locator('[data-download-presentation]').click()
    download=download_info.value;output=ARTIFACTS/'analytics-synthetic-report.html';download.save_as(str(output))
    html=output.read_text('utf8');assert '검증 A 병원' in html and '검증 B 병원' not in html and 'SYNTHETIC-0' not in html
    with page.expect_popup() as opened:frame.locator('[data-open-presentation]').click()
    report=opened.value;report.wait_for_load_state();report.pdf(path=str(ARTIFACTS/'analytics-synthetic-report.pdf'),print_background=True)
    assert (ARTIFACTS/'analytics-synthetic-report.pdf').stat().st_size>10000
    print('PASS report generation -> own-clinic HTML -> PDF',flush=True)
    assert not errors,errors
    assert context.request.post(BASE+'/api/hospital-analytics/upload-ticket',headers={'Origin':'https://unrelated.example'},data={'clinicId':FIRST,'size':100}).status==403
    page.get_by_role('button',name='병원 분석 관리').click()
    expect(page.get_by_role('form',name='탭 접근 권한').locator('select[name="clinicId"]')).to_have_count(0)
    page.locator('select[name="userId"]').select_option(OUTSIDER)
    page.locator('select[name="allowed"]').select_option('true')
    with page.expect_response(lambda r:r.url.endswith('/hospital-analytics/admin') and r.request.method=='POST') as saved:
        page.get_by_role('button',name='권한 저장',exact=True).click()
    assert saved.value.ok
    expect(page.locator('p[role="alert"]')).to_contain_text('저장했습니다')
    granted=authenticated(browser,OUTSIDER)
    assigned=granted.request.get(BASE+'/api/hospital-analytics/access').json()
    assert assigned['canAccessTab'] and {c['id'] for c in assigned['clinics']}=={FIRST,SECOND,created_id}
    granted_page=granted.new_page();granted_page.goto(BASE+'/hospital-analytics')
    expect(granted_page.get_by_role('link',name='병원 분석',exact=True)).to_be_visible()
    expect(granted_page.get_by_role('button',name='병원 분석 관리')).to_have_count(0)
    assert granted.request.get(BASE+'/api/hospital-analytics/admin').status==403
    assert granted.request.post(BASE+'/api/hospital-analytics/admin',headers={'Origin':BASE},data={'action':'set-tab-access','userId':VIEWER,'allowed':True}).status==403
    # This clinic has no receipts yet; dashboard correctly asks for an upload.
    # Its persisted workspace is readable immediately with the global tab grant.
    assert granted.request.get(BASE+f'/api/hospital-analytics/runtime/{SECOND}/api/workspace').status==200
    page.locator('select[name="allowed"]').select_option('false')
    with page.expect_response(lambda r:r.url.endswith('/hospital-analytics/admin') and r.request.method=='POST') as revoked:
        page.get_by_role('button',name='권한 저장',exact=True).click()
    assert revoked.value.ok
    expect(page.locator('p[role="alert"]')).to_contain_text('저장했습니다')
    assert granted.request.get(BASE+f'/api/hospital-analytics/runtime/{FIRST}/api/dashboard').status==403
    assert granted.request.get(BASE+f'/api/hospital-analytics/runtime/{SECOND}/api/dashboard').status==403
    granted_page.reload()
    expect(granted_page.get_by_role('link',name='병원 분석',exact=True)).to_have_count(0)
    expect(granted_page.get_by_role('heading',name='병원 분석 접근 권한이 없습니다.')).to_be_visible()
    granted.close();print('PASS admin grants/revokes tab without clinic; selected employee sees all clinics but cannot manage access',flush=True)
    context.close()
    # A historical per-clinic membership does not grant the tab anymore.
    context=authenticated(browser,VIEWER);page=context.new_page();page.goto(BASE+'/hospital-analytics')
    expect(page.get_by_role('heading',name='병원 분석 접근 권한이 없습니다.')).to_be_visible()
    expect(page.get_by_role('link',name='병원 분석',exact=True)).to_have_count(0)
    assert context.request.get(BASE+f'/api/hospital-analytics/runtime/{SECOND}/api/dashboard').status==403
    assert context.request.post(BASE+'/api/hospital-analytics/upload-ticket',headers={'Origin':BASE},data={'clinicId':FIRST,'size':100}).status==403
    context.close();print('PASS unselected employee with legacy clinic membership has no tab or API access',flush=True)
    context=authenticated(browser,EDITOR)
    editor_page=context.new_page();editor_page.goto(BASE+'/hospital-analytics')
    editor_page.get_by_label('분석할 병원').select_option(FIRST)
    editor_frame=editor_page.frame_locator('iframe')
    editor_frame.locator('a[href="#settings"]').click()
    location_form=editor_frame.locator('#clinic-location-form')
    expect(location_form).to_be_visible()
    expect(location_form).to_have_js_property('inert',False)
    for key,value in {'name':'검증 A 공개 위치','address':'합성 공개 주소','latitude':'37.5','longitude':'127',
                      'source_url':'https://example.com/clinic','checked_on':'2024-01-01','source_note':'합성 검증 근거'}.items():
        location_form.locator('[name="'+key+'"]').fill(value)
    location_form.get_by_role('button',name='병원 위치 저장',exact=True).click()
    expect(editor_frame.locator('#clinic-location-message')).to_contain_text('저장했습니다')
    editor_page.reload();editor_page.get_by_label('분석할 병원').select_option(FIRST)
    location=context.request.get(BASE+f'/api/hospital-analytics/runtime/{FIRST}/api/clinic-location').json()
    assert location['location']['name']=='검증 A 공개 위치'
    print('PASS editor public map location UI -> save -> cold persistence; finance menu unavailable',flush=True)
    ticket_response=context.request.post(BASE+'/api/hospital-analytics/upload-ticket',headers={'Origin':BASE},data={'clinicId':FIRST,'size':100});assert ticket_response.ok
    ticket=ticket_response.json()
    with urlopen(FIXTURE+'/__fixture/revoke') as response:response.read()
    denied=context.request.post(ticket['url'],headers={'Authorization':'Bearer '+ticket['accessToken'],'apikey':ticket['publicKey'],'Content-Type':'application/octet-stream'},data=b'synthetic')
    assert denied.status==403
    assert context.request.get(BASE+f'/api/hospital-analytics/runtime/{FIRST}/api/dashboard').status==403
    assert context.request.post('http://127.0.0.1:54840/api/analytics_runtime',headers={'Authorization':'Bearer '+ticket['accessToken']},data={'clinic':FIRST,'method':'GET','path':'/api/dashboard'}).status==403
    context.close();print('PASS membership revocation -> pending upload and reads denied',flush=True)
    with urlopen(FIXTURE+'/__fixture/empty-clinics') as response:assert json.load(response)['ok']
    context=authenticated(browser,EDITOR);page=context.new_page();page.goto(BASE+'/hospital-analytics')
    expect(page.get_by_role('link',name='병원 분석',exact=True)).to_be_visible()
    expect(page.get_by_text('등록된 병원이 없습니다. 관리자에게 등록을 요청해 주세요.')).to_be_visible()
    assert context.request.get(BASE+'/api/hospital-analytics/access').json()['canAccessTab'] is True
    context.close();print('PASS selected employee sees tab even with zero registered clinics',flush=True)
    context=browser.new_context()
    assert context.request.get(BASE+'/api/hospital-analytics/access').status==401
    assert context.request.get(BASE+f'/api/hospital-analytics/runtime/{FIRST}/index.html').status==401
    assert context.request.post('http://127.0.0.1:54840/api/analytics_runtime',data={'clinic':FIRST,'method':'GET','path':'/api/dashboard'}).status==401
    context.close();browser.close()
    print('PASS anonymous API, page assets, direct Python endpoint denied',flush=True)
