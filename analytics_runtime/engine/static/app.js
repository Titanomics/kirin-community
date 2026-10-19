import {esc,num,won,compactMoney,empty,bars,lineChart,columnChart,donut,table} from './charts.js';
import {HeatMap} from './map.js';
import {initImports} from './imports.js';
import {initMarketing} from './marketing.js';
import {initAgency} from './agency.js';
import {initKnowledge} from './knowledge.js';
import {initConversions} from './conversions.js';
import {initAdReports} from './ad-reports.js';
import {initInternalFinance} from './internal-finance.js';
import {initCampaignMap} from './campaign-map.js';
import {initClinicLocation} from './clinic-location.js';
import {initAssistant} from './assistant.js';
import {initMonitoring} from './monitoring.js';
import {initRecovery} from './recovery.js';
import {apiFetch as fetch} from './scope.js';
import {renderReference,renderRegionStats,renderChannelAge,periodStart} from './reference.js';

const $=id=>document.getElementById(id);
const pages={overview:['대시보드','대시보드','선택 기간의 병원 현황과 환자·금액 흐름'],comparison:['기간 비교 분석','기간 비교 분석','두 기간의 환자·금액과 지역별 변화를 비교합니다.'],map:['지역별 분석 / 지도','지역별 분석','지역을 선택해 상세 정보를 확인하세요.'],regions:['지역별 분석 / 지역별 통계','지역별 통계','지역별 환자·금액·변화를 같은 기준으로 비교합니다.'],patients:['유입경로 분석','유입경로 분석','연령대별 경로와 기록된 환자 흐름'],operations:['예약 · 진료 보고서','예약 · 진료 보고서','제공된 연도별 원보고서'],quality:['데이터 업데이트','데이터 업데이트','원본 파일과 집계 기준을 확인합니다.'],settings:['설정','분석 설정과 기준','현재 연결된 기능과 필요한 자료']};
const state={data:null,available:null,page:'overview',controller:null,request:0,loaded:false};
Object.assign(pages,{strategies:['마케팅 운영 / 지역 전략','지역별 전략','환자·지역 근거를 캠페인 계획으로 연결합니다.'],campaigns:['마케팅 운영 / 캠페인','캠페인 · 집행비','상위 캠페인·하위 집행·실제 지출을 관리합니다.'],clientreports:['마케팅 운영 / 월간 보고서','월간 고객 보고서','집계 결과와 담당자의 해석을 나누어 보관합니다.']});
const heatmap=new HeatMap();
heatmap.campaigns=initCampaignMap(heatmap);
pages.agency=['대행사 / 담당 병원','담당 병원 현황','병원별 자료 기준일·집행 현황과 담당자 권한을 확인합니다.'];
Object.assign(pages,{knowledge:['마케팅 운영 / 병원 자료','병원 자료','병원 정보의 출처와 유효기간을 확인합니다.'],contents:['마케팅 운영 / 콘텐츠','콘텐츠 기획 · 검수','레퍼런스 구조와 승인 자료를 연결해 제작·검토합니다.'],reviews:['마케팅 운영 / 리뷰','리뷰 대응 기록','발견부터 대응·처리 결과까지 담당자의 확인을 기록합니다.']});
pages.conversions=['마케팅 운영 / 문의·내원','문의 · 내원 연결 분석','연결 가능한 기록으로 문의부터 내원·수납까지 관측합니다.'];
pages.adreports=['마케팅 운영 / 광고 보고서','광고 보고서 · 지출 대조','매체 보고 수치와 지출 장부를 구분해 확인합니다.'];
pages.internalfinance=['대행사 / 내부 운영','내부 비용 · 작업시간','대행료·외주비·작업시간을 관리자 전용으로 기록합니다.'];
Object.assign(pages,{assistant:['마케팅 운영 / 근거 질의응답','병원 근거 질의응답','승인 자료의 출처와 함께 질문을 확인합니다.'],monitoring:['마케팅 운영 / 채널 확인','채널 확인 · 알림','공개 채널 변화와 리뷰 대응을 확인합니다.'],recovery:['대행사 / 백업 · 복구','백업 · 복구','병원 자료를 보관하고 별도 공간으로 복구합니다.']});

function showToast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('toast').hidden=true,3500);}
function formattedTime(value){return new Date(value).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});}
function difference(value){if(value==null)return '<span class="delta">비교 불가</span>';return `<span class="delta ${value>0?'up':value<0?'down':''}">${value>0?'↗':value<0?'↘':'−'} ${num(Math.abs(value))}%</span>`;}
function kpi(label,value,unit,delta,note,icon){return `<article class="kpi"><div class="kpi-head"><span>${esc(label)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${esc(value)}<small>${esc(unit)}</small></div><div class="kpi-bottom">${delta!==undefined?difference(delta):''}<span>${esc(note||'')}</span></div></article>`;}

function setPage(renderMap=true){
  const requested=location.hash.slice(1),page=Object.hasOwn(pages,requested)?requested:'overview';state.page=page;
  document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);a.setAttribute('aria-current',a.dataset.page===page?'page':'false');});
  document.querySelectorAll('.page-view').forEach(el=>el.hidden=(el.dataset.relatedPage||el.id)!=='page-'+page);
  $('breadcrumb').textContent=pages[page][0];$('page-title').textContent=pages[page][1];$('page-description').textContent=pages[page][2];
  $('sidebar').classList.remove('open');
  document.body.dataset.page=page;
  if(page==='map'&&state.data&&renderMap)heatmap.update(state.data).then(()=>{if(state.pendingRegion){heatmap.focus(state.pendingRegion);state.pendingRegion=null;}}).catch(e=>showToast(e.message));
}

function comparisonParams(start,end){
  if($('compare').value==='custom')return {compare_start:$('compare-start').value,compare_end:$('compare-end').value};
  if($('compare').value==='previous'&&start&&end){
    const a=new Date(start+'T00:00:00Z'),b=new Date(end+'T00:00:00Z'),length=(b-a)/86400000+1;
    return {compare_end:new Date(a-86400000).toISOString().slice(0,10),compare_start:new Date(a-length*86400000).toISOString().slice(0,10)};
  }
  return {};
}

async function loadData(initial=false){
  const id=++state.request;state.controller?.abort();state.controller=new AbortController();
  $('error').hidden=true;$('refresh').disabled=true;$('apply').disabled=true;$('export').disabled=true;
  if(!state.loaded){$('loading').hidden=false;$('content').hidden=true;}
  $('freshness').textContent='원본 파일 상태를 다시 확인하고 있습니다…';
  try{
    const params=new URLSearchParams();
    if(!initial){
      const start=$('start').value,end=$('end').value;
      if(!start||!end)throw Error('시작일과 종료일을 선택해 주세요.');
      params.set('start',start);params.set('end',end);
      const comparison=comparisonParams(start,end);
      if($('compare').value==='custom'&&(!comparison.compare_start||!comparison.compare_end))throw Error('비교할 기간을 모두 선택해 주세요.');
      for(const [k,v]of Object.entries(comparison))params.set(k,v);
    }
    const response=await fetch('/api/dashboard?'+params,{cache:'no-store',signal:state.controller.signal});
    const data=await response.json();if(!response.ok)throw Error(data.error||'데이터를 읽지 못했습니다.');
    if(id!==state.request)return;
    state.data=data;state.available=data.available;state.loaded=true;
    $('start').value=data.period.start;$('end').value=data.period.end;
    $('compare-start').value=data.comparison_period.start;$('compare-end').value=data.comparison_period.end;
    $('content').hidden=false;$('loading').hidden=true;$('export').disabled=false;
    render(data);marketing.dashboardReady();setPage();
  }catch(error){
    if(error.name==='AbortError')return;
    state.data=null;$('content').hidden=true;$('loading').hidden=true;
    $('error').textContent=error.message+' 이전 값을 최신 결과로 표시하지 않습니다.';$('error').hidden=false;
    $('freshness').textContent='이번 확인에 실패했습니다.';
  }finally{if(id===state.request){$('refresh').disabled=false;$('apply').disabled=false;}}
}

function render(d){
  const current=d.current;const value=k=>current.has_data?num(current[k]):'—';
  document.querySelector('.presets').innerHTML=d.available.years.map(year=>`<button data-year="${year}">${year}</button>`).join('')+'<button data-year="all">전체</button>';
  $('freshness').textContent=`원본 확인 ${formattedTime(d.freshness.checked_at)} · 계산 ${formattedTime(d.freshness.calculated_at)}`;
  $('period-note').textContent=`자료 마지막 접수일 ${d.available.end}${d.coverage_warning?' · 조회기간 일부는 자료 범위 밖입니다':''}`;
  $('source-count').textContent=d.sources.length;
  document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('active',b.dataset.range==='all'?d.period.start===d.available.start&&d.period.end===d.available.end:d.period.start===periodStart(d.period.end,b.dataset.range)));
  $('comparison-caption').textContent=`비교 ${d.comparison_period.start} — ${d.comparison_period.end}${d.comparison_coverage_warning?' · 비교자료 부족: 증감률 미표시':''}`;
  document.querySelectorAll('[data-year]').forEach(b=>b.classList.toggle('active',b.dataset.year==='all'?d.period.start===d.available.start&&d.period.end===d.available.end:d.period.start===b.dataset.year+'-01-01'&&d.period.end.startsWith(b.dataset.year)));
  renderReference(d,{money:$('money-basis').value,metric:document.querySelector('[name="overview-metric"]:checked').value,grain:$('trend-grain').value});
  $('patients-channels').innerHTML=bars(d.channels,{limit:12});
  $('weekday-chart').innerHTML=columnChart(d.weekdays);
  $('patients-age').innerHTML=bars(d.demographics.age.map(x=>({label:x.label,patients:x.value})),{limit:15});
  $('patients-sex').innerHTML=donut(d.demographics.sex);
  $('channel-table').innerHTML=table(d.channels,[{key:'label',label:'기록된 경로 그룹'},{key:'patients',label:'고유환자',number:true},{key:'new_patients',label:'신환',number:true},{key:'visits',label:'접수횟수',number:true},{key:'collection_recorded',label:'기록된 수납액 · 대사 전',render:won}]);
  renderReports(d);renderQuality(d);
}

function renderReports(d){
  const r=d.reports;
  $('report-scope').textContent=`${r.year}년 제공 보고서 · 원보고서 전체 범위`;
  $('reservation-chart').innerHTML=columnChart(r.reservations.map(x=>({label:x.label,value:x.general})));
  $('reservation-table').innerHTML=table(r.reservations,[{key:'label',label:'월'},{key:'general',label:'일반 예약',number:true},{key:'checkup',label:'정기검진',number:true},{key:'scaling',label:'치석제거',number:true},{key:'new',label:'신환 예약',number:true},{key:'fulfillment',label:'예약 이행률',render:v=>v==null?'—':num(v)+'%'}]);
  $('consultation-table').innerHTML=table(r.consultations,[{key:'label',label:'상담자'},{key:'plans',label:'계획 수',number:true},{key:'confirmed',label:'확정건수',number:true},{key:'confirmed_amount',label:'확정금액',render:v=>compactMoney(v)+'원'}]);
  const treatments=[...r.treatments].sort((a,b)=>(b.amount||0)-(a.amount||0));
  $('treatment-bars').innerHTML=bars(treatments,{key:'amount',money:true,limit:7});
  $('treatment-table').innerHTML=table(treatments,[{key:'label',label:'진료 분류'},{key:'patients',label:'환자수',number:true},{key:'visits',label:'진료횟수',number:true},{key:'amount',label:'진료금액',render:won}]);
  $('fee-table').innerHTML=table([...r.fees].sort((a,b)=>(b.amount||0)-(a.amount||0)).slice(0,20),[{key:'label',label:'수가 항목'},{key:'patients',label:'환자수',number:true},{key:'visits',label:'진료횟수',number:true},{key:'entries',label:'입력횟수',number:true},{key:'amount',label:'진료금액',render:won}]);
}

function renderQuality(d){
  const q=d.quality,f=q.financial;
  $('quality-kpis').innerHTML=kpi('연결된 파일',num(d.sources.length),'개',undefined,'원본 상태 다시 확인','▤')+kpi('월별 지표 대조',`${q.monthly_passed}/${q.monthly_checks}`,'',undefined,'환자 · 접수 · 신환','✓')+kpi('주소 연결',num(d.address_coverage.percent),'%',undefined,'선택 기간 고유환자','◈')+kpi('참고 파일 오류값',num(q.errors_in_workbooks),'셀',undefined,'원본 수정 없이 별도 표시','!');
  $('financial-check').innerHTML=`<p class="panel-footnote">${f.year}년 제공 보고서끼리 비교한 값입니다. 상단 상세 날짜 범위와 별도입니다.</p><div class="financial-row"><span>접수목록 총진료비 합계</span><strong>${won(f.reception_treatment_total)}</strong></div><div class="financial-row"><span>내원경로 보고서 총진료비</span><strong>${won(f.channel_report_treatment_total)}</strong></div><div class="financial-row"><span>보고서 간 차이</span><strong>${won(f.difference)}</strong></div><p class="panel-footnote">조회조건과 금액 정의를 대조하기 전에는 확정 매출로 통합하지 않습니다. 현재 금액 열의 빈칸·미확인 셀은 ${num(q.money_missing_cells)}개입니다. 빈칸을 값이 확인된 0원으로 표시하지 않습니다.</p>`;
  const definitions=[['신환 집계',d.definitions.new_patients],['신규·재방문 환자군',d.definitions.cohorts],['수납액 표시',d.definitions.collection],['자료의 최신성',`원본 엑셀의 마지막 접수일은 ${d.available.end}입니다. 파일 확인시각이 최신이어도 현재 EMR 현황을 뜻하지 않습니다.`],['환자 지역',d.definitions.region]];
  $('definitions').innerHTML=definitions.map(([title,body])=>`<p><strong>${esc(title)}</strong>${esc(body)}</p>`).join('');
  $('source-table').innerHTML=table(d.sources,[{key:'file',label:'파일',render:v=>`<span class="file-name" title="${esc(v)}">${esc(v)}</span>`},{key:'bytes',label:'크기',render:v=>num(v/1024)+' KB'},{key:'modified_at',label:'파일 수정시각',render:formattedTime},{key:'sheets',label:'시트',number:true},{key:'status',label:'상태',render:()=>'<span class="file-good">● 확인</span>'},{key:'error_cells',label:'오류값',render:v=>v?`<span class="warning-tag">${num(v)}셀</span>`:'—'}]);
  $('monthly-checks').innerHTML=q.monthly_mismatches.length?table(q.monthly_mismatches,[{key:'period',label:'월'},{key:'metric',label:'지표',render:v=>({patients:'고유환자',visits:'접수횟수',new_patients:'신환'})[v]},{key:'reported',label:'원보고서',number:true},{key:'calculated',label:'접수목록 집계',number:true}]):`<p class="panel-footnote">${q.monthly_checks?`${num(q.monthly_passed)}개 월별 환자·접수·신환 지표가 원보고서와 일치합니다.`:'월별접수환자수 보고서를 올리면 원보고서와 대조할 수 있습니다.'} 금액 원장 대사와는 별도입니다.</p>`;
}

function csvCell(value){const raw=String(value??'');const safe=/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"';}
function downloadCsv(){
  const d=state.data;if(!d)return;
  const rows=[[`${d.clinic} 집계 보고서`],['조회 시작',d.period.start],['조회 종료',d.period.end],['자료 마지막 접수일',d.available.end],['원본 확인시각',d.freshness.checked_at],['수납 기준',d.definitions.collection],['환자군 기준',d.definitions.cohorts],[],['월','고유환자','접수횟수','신규 환자군','재방문 환자군','총진료비(대사 전)','기록된 수납액(대사 전)'],...d.trend.map(x=>[x.month,x.patients,x.visits,x.new_patients,x.existing_patients,x.treatment_total,x.collection_recorded])];
  const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${d.clinic.replace(/[\\/:*?"<>|]/g,"_")}_집계_${d.period.start}_${d.period.end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('집계 보고서를 내려받았습니다.');
}

$('apply').addEventListener('click',()=>loadData());
$('refresh').addEventListener('click',()=>{if(bundlePages[state.page]){bundlePages[state.page].refresh();return;}loadData(!state.loaded);marketing.refresh();agency.refresh();knowledge.refresh();conversions.refresh();adReports.refresh();internalFinance.refresh();heatmap.clinic.refreshSettings();});
$('export').addEventListener('click',downloadCsv);
$('compare').addEventListener('change',()=>$('custom-comparison').hidden=$('compare').value!=='custom');
$('menu-toggle').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
document.querySelector('.presets').addEventListener('click',event=>{
  const button=event.target.closest('[data-year]');if(!button)return;
  const year=button.dataset.year,available=state.available;if(!available)return;
  if(year==='all'){$('start').value=available.start;$('end').value=available.end;}
  else{$('start').value=year+'-01-01';$('end').value=year===available.end.slice(0,4)?available.end:year+'-12-31';}
  loadData();
});
document.querySelectorAll('[data-range]').forEach(button=>button.addEventListener('click',()=>{
  const available=state.available;if(!available)return;
  const end=$('end').value||available.end;let start;
  if(button.dataset.range==='all'){start=available.start;$('end').value=available.end;}
  else{start=periodStart(end,button.dataset.range);$('end').value=end;}
  $('start').value=start;document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('active',b===button));loadData();
}));
const renderCurrent=()=>{if(state.data)render(state.data);};
document.querySelectorAll('[name="overview-metric"]').forEach(x=>x.addEventListener('change',renderCurrent));
$('trend-grain').addEventListener('change',renderCurrent);
$('money-basis').addEventListener('change',()=>{heatmap.money=$('money-basis').value;renderCurrent();if(state.page==='map')heatmap.detail();});
for(const id of ['stats-level','stats-sort'])$(id).addEventListener('change',()=>{if(state.data)renderRegionStats(state.data);});
$('stats-search').addEventListener('input',()=>{if(state.data)renderRegionStats(state.data);});
$('channel-age-mode').addEventListener('change',()=>{if(state.data)renderChannelAge(state.data);});
document.addEventListener('click',e=>{const target=e.target.closest('[data-region-open]');if(!target)return;heatmap.level=target.dataset.regionLevel;heatmap.area=target.dataset.regionOpen.startsWith('11')?'seoul':'all';$('map-area').value=heatmap.area;heatmap.zoom=1;heatmap.offset=[0,0];document.querySelectorAll('[data-level]').forEach(b=>b.classList.toggle('active',b.dataset.level===heatmap.level));state.pendingRegion=target.dataset.regionOpen;location.hash='map';});
document.querySelectorAll('[data-level]').forEach(button=>button.addEventListener('click',()=>{heatmap.level=button.dataset.level;document.querySelectorAll('[data-level]').forEach(b=>b.classList.toggle('active',b===button));if(state.data)heatmap.update(state.data,true).catch(e=>showToast(e.message));}));
$('map-metric').addEventListener('change',()=>{heatmap.metric=$('map-metric').value;if(['treatment_total','collection_recorded'].includes(heatmap.metric)){heatmap.money=heatmap.metric==='treatment_total'?'treatment':'collection';$('money-basis').value=heatmap.money;renderCurrent();}if(state.data)heatmap.update(state.data).catch(e=>showToast(e.message));});
$('map-area').addEventListener('change',()=>{heatmap.area=$('map-area').value;if(state.data)heatmap.update(state.data,true).catch(e=>showToast(e.message));});
$('zoom-in').addEventListener('click',()=>heatmap.zoomBy(1.35));$('zoom-out').addEventListener('click',()=>heatmap.zoomBy(1/1.35));$('map-reset').addEventListener('click',()=>heatmap.reset());
$('map-names').addEventListener('change',()=>{heatmap.names=$('map-names').checked;heatmap.renderLabels();});
$('map-basemap').addEventListener('change',()=>{heatmap.basemap=$('map-basemap').checked;heatmap.applyViewBox();$('map-tile-status').textContent='';});
const searchRegion=()=>{const found=heatmap.search($('map-search').value.trim());if(!found)showToast('현재 지도 범위에서 지역을 찾지 못했습니다. 전체 지역명을 선택해 주세요.');};
$('map-search-go').addEventListener('click',searchRegion);$('map-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchRegion();}});
window.addEventListener('hashchange',()=>{setPage(false);if(state.loaded&&!marketing.hasPage(state.page)&&!knowledge.hasPage(state.page)&&!['agency','conversions','adreports','internalfinance','assistant','monitoring','recovery'].includes(state.page))loadData();});
window.addEventListener('pageshow',event=>{if(event.persisted)loadData();});
let chartResizeTimer;
window.addEventListener('resize',()=>{clearTimeout(chartResizeTimer);chartResizeTimer=setTimeout(()=>{renderCurrent();if(state.page==='map'&&state.data)heatmap.detail();},160);});
const agency=initAgency();
initImports(()=>loadData(true));
const marketing=initMarketing({getPeriod:()=>state.data?.period||{start:$('start').value,end:$('end').value},getAvailable:()=>state.available,onToast:showToast});
const knowledge=initKnowledge();
const conversions=initConversions();
const adReports=initAdReports();
const internalFinance=initInternalFinance();
const bundlePages={assistant:initAssistant(),monitoring:initMonitoring(),recovery:initRecovery()};
heatmap.clinic=initClinicLocation(heatmap);
setPage(false);loadData(true);
