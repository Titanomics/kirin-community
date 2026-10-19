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
 # Exercise pan/zoom without fetching public map tiles through automated tests.
 tiles=[]
 def tile(route):
  tiles.append(route.request.url)
  assert route.request.headers.get('referer')==BASE+'/'
  route.fulfill(status=200,content_type='image/png',body=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='))
 c.route('https://tile.openstreetmap.org/**',tile)
 cookie='base64-'+base64.urlsafe_b64encode(json.dumps(session).encode()).decode().rstrip('=')
 c.add_cookies([{'name':'sb-127-auth-token','value':cookie,'url':BASE,'sameSite':'Lax'}])
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/hospital-analytics');page.get_by_label('분석할 병원').select_option(FIRST)
 frame=page.frame_locator('iframe');expect(frame.locator('tbody tr')).to_have_count(2)
 expect(frame.locator('.card').first).to_contain_text('10')
 svg=frame.locator('#map-container svg');expect(frame.locator('.region-name').first).to_be_visible()
 expect(frame.locator('.basemap-layer image').first).to_be_attached()
 assert tiles and all('/' in url for url in tiles)
 home=svg.get_attribute('viewBox');frame.get_by_role('button',name='지도 확대',exact=True).click()
 assert float(svg.get_attribute('viewBox').split()[2])<float(home.split()[2])
 frame.get_by_role('button',name='화면 맞춤').click();expect(svg).to_have_attribute('viewBox',home)
 frame.get_by_label('지역명 검색',exact=True).fill('삼성동');frame.get_by_role('button',name='지역 검색',exact=True).click()
 expect(frame.locator('#selected-region')).to_contain_text('삼성동');expect(frame.locator('#region-records')).to_have_text('3건')
 svg.scroll_into_view_if_needed()
 box=svg.bounding_box();before=svg.get_attribute('viewBox');page.mouse.move(box['x']+120,box['y']+200);page.mouse.down();page.mouse.move(box['x']+180,box['y']+240,steps=5);page.mouse.up()
 assert svg.get_attribute('viewBox')!=before
 frame.get_by_label('지역명',exact=True).uncheck();expect(frame.locator('.region-name')).to_have_count(0)
 frame.get_by_label('지역명',exact=True).check()
 frame.get_by_label('배경지도',exact=True).uncheck();expect(frame.locator('.basemap-layer image')).to_have_count(0)
 frame.locator('[data-pick="0"]').click();expect(frame.locator('tr.selected')).to_have_count(1)
 with page.expect_download() as download:frame.get_by_role('link',name='HTML 내려받기').click()
 output=ROOT/'.local/managed-synthetic.html';download.value.save_as(output)
 offline=b.new_context(offline=True);opened=offline.new_page();external=[]
 opened.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:')) else None)
 opened.goto(output.resolve().as_uri())
 expect(opened.locator('tbody tr')).to_have_count(2);assert not errors,errors
 expect(opened.locator('.region-name').first).to_be_visible();assert not external
 opened.get_by_label('지역명 검색',exact=True).fill('삼성동');opened.get_by_role('button',name='지역 검색',exact=True).click()
 expect(opened.locator('#region-records')).to_have_text('3건')
 opened.set_viewport_size({'width':390,'height':844});assert opened.evaluate('document.documentElement.scrollWidth <= innerWidth')
 assert c.request.get(BASE+f'/api/hospital-analytics/runtime/{SECOND}/api/address-reports/2026-09/html').status==404
 with urlopen(FIXTURE+'/__fixture/session?user='+EDITOR) as r:staff=json.load(r)
 denied=c.request.post('http://127.0.0.1:54840/api/analytics_runtime',headers={'Authorization':'Bearer '+staff['access_token']},data={'clinic':FIRST,'method':'POST','path':'/api/imports/rollback','payload':{'revision':1,'confirmed':True}})
 assert denied.status==403
 print('PASS aggregate snapshot -> ERP monthly view -> CSP interactive map -> offline HTML; cross-clinic 404 and staff import 403')
 b.close()
