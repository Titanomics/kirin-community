"""Synthetic monthly aggregates through Next -> Python -> snapshot -> HTML."""
import base64,json,sys,tempfile
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from browser_fixture import SyntheticBackend,ADMIN,EDITOR,FIRST,SECOND
from test_address_summary import aggregate_book
from analytics_runtime.address_summary import parse_workbook,enrich_regions
from analytics_runtime.runtime import public_road
from analytics_runtime.snapshots import pack
from clinic_analytics.regions import RegionIndex
BASE='http://127.0.0.1:54843';FIXTURE='http://127.0.0.1:54842'
with urlopen(FIXTURE+'/__fixture/reset') as r:assert json.load(r)['ok']
with urlopen(FIXTURE+'/__fixture/session?user='+ADMIN) as r:session=json.load(r)
backend=SyntheticBackend(session['access_token']);backend.authorize(FIRST,write=True)
report=parse_workbook(aggregate_book(),period='2026-09',source_name='synthetic.xlsx');report['clinic_id']=FIRST
enrich_regions(report,RegionIndex(road_path=public_road()))
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder);(root/'address-reports').mkdir()
 (root/'address-reports/2026-09.json').write_text(json.dumps(report),encoding='utf8')
 backend.commit(FIRST,0,pack(root))
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(accept_downloads=True)
 cookie='base64-'+base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip('=')
 c.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':BASE,'sameSite':'Lax'}])
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/hospital-analytics');page.get_by_label('분석할 병원').select_option(FIRST)
 frame=page.frame_locator('iframe');expect(frame.locator('tbody tr')).to_have_count(2)
 expect(frame.locator('.card').first).to_contain_text('10')
 frame.locator('[data-pick="0"]').click();expect(frame.locator('tr.selected')).to_have_count(1)
 with page.expect_download() as download:frame.get_by_role('link',name='HTML 내려받기').click()
 output=ROOT/'.local/managed-synthetic.html';download.value.save_as(output)
 offline=b.new_context(offline=True);opened=offline.new_page();opened.goto(output.resolve().as_uri())
 expect(opened.locator('tbody tr')).to_have_count(2);assert not errors,errors
 assert c.request.get(BASE+f'/api/hospital-analytics/runtime/{SECOND}/api/address-reports/2026-09/html').status==404
 with urlopen(FIXTURE+'/__fixture/session?user='+EDITOR) as r:staff=json.load(r)
 denied=c.request.post('http://127.0.0.1:54840/api/analytics_runtime',headers={'Authorization':'Bearer '+staff['access_token']},data={'clinic':FIRST,'method':'POST','path':'/api/imports/rollback','payload':{'revision':1,'confirmed':True}})
 assert denied.status==403
 print('PASS aggregate snapshot -> ERP monthly view -> CSP interactive map -> offline HTML; cross-clinic 404 and staff import 403')
 b.close()
