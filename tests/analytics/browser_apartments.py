"""Offline browser regression: nearby apartment labels, drilldown, missing points."""
import json,sys,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from test_address_summary import aggregate_book
from analytics_runtime.address_summary import parse_workbook,enrich_regions,render_report
from analytics_runtime.runtime import public_road
from clinic_analytics.regions import RegionIndex
report=parse_workbook(aggregate_book(),period='2026-09',source_name='synthetic.xlsx')
enrich_regions(report,RegionIndex(road_path=public_road()))
for i,row in enumerate(report['rows']):
 row['region_code']=report['rows'][0]['region_code'];row['region_name']=report['rows'][0]['region_name']
 row['location']={'longitude':127.04+i*.0001,'latitude':37.5+i*.0001,'source_url':'https://example.org/address/'+str(i),'source_name':'Synthetic location','verified_at':'2026-10-20','precision':'address'}
with tempfile.TemporaryDirectory() as folder,sync_playwright() as p:
 output=Path(folder)/'report.html';output.write_text(render_report(report,{'id':'synthetic','name':'검증병원'}),encoding='utf8')
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(offline=True,viewport={'width':1440,'height':1000});page=c.new_page();errors=[];network=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:network.append(r.url) if r.url.startswith(('http:','https:')) else None)
 page.goto(output.as_uri());expect(page.locator('.apartment-name')).to_have_count(2)
 boxes=page.locator('.apartment-name rect').evaluate_all('(els)=>els.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})')
 a,d=boxes;assert a['right']<=d['left'] or d['right']<=a['left'] or a['bottom']<=d['top'] or d['bottom']<=a['top']
 page.locator('.apartment-marker[data-apartment="0"] .apartment-name').click()
 expect(page.locator('#selected-region')).to_have_text('검증단지 A');expect(page.locator('#region-records')).to_have_text('7건');expect(page.locator('#within-region-share')).to_have_text('70.0%')
 expect(page.locator('tr.selected')).to_have_count(1)
 page.get_by_label('지역명 검색',exact=True).fill('검증단지 B');page.get_by_role('button',name='지역 검색',exact=True).click()
 expect(page.locator('#region-records')).to_have_text('3건');expect(page.locator('#within-region-share')).to_have_text('30.0%')
 page.get_by_role('button',name='법정동',exact=True).click();expect(page.locator('.apartment-marker')).to_have_count(0)
 page.get_by_role('button',name='아파트',exact=True).click();expect(page.locator('.apartment-marker')).to_have_count(2)
 page.get_by_label('아파트명',exact=True).uncheck();expect(page.locator('.apartment-name')).to_have_count(0);page.get_by_label('아파트명',exact=True).check()
 page.set_viewport_size({'width':390,'height':844});expect(page.locator('.apartment-name')).to_have_count(2);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 # No guessed centroid for an unlocated row; still reachable from the list.
 del report['rows'][1]['location'];output.write_text(render_report(report,{'id':'synthetic','name':'검증병원'}),encoding='utf8');page.reload()
 expect(page.locator('.apartment-marker')).to_have_count(1);page.locator('[data-apartment-row="1"]').click()
 expect(page.locator('#region-records')).to_have_text('3건');expect(page.locator('#apartment-location-note')).to_contain_text('좌표가 없어')
 assert not errors and not network,(errors,network);b.close()
 print('PASS close labels, marker click, exact apartment search, within-dong share, toggle, mobile, missing coordinates, offline')
