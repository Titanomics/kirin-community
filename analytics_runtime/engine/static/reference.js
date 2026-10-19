import {esc,num,won,compactMoney,columnChart,table,empty} from './charts.js';
import {seriesChart,groupedColumns} from './reference-charts.js';
const $=id=>document.getElementById(id);
const colors=['#3595ff','#39c5bd','#ff994f'];
const delta=v=>v==null?'<span class="delta">비교 불가</span>':`<span class="delta ${v>=0?'up':'down'}">${v>=0?'▲':'▼'} ${num(Math.abs(v))}%</span>`;
const kpi=(label,value,unit,change,previous)=>`<article class="kpi"><div class="kpi-head">${label}</div><div class="reference-kpi-value"><strong>${value}</strong><small>${unit}</small>${delta(change)}</div><p>비교기간 ${previous}</p></article>`;
export function periodStart(end,range){
  const day=new Date(end+'T00:00:00Z');
  if(String(range)==='7')day.setUTCDate(day.getUTCDate()-6);
  else{
    const original=day.getUTCDate(),months={30:1,90:3,365:12}[range];
    day.setUTCDate(1);day.setUTCMonth(day.getUTCMonth()-months);
    const last=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()+1,0)).getUTCDate();
    day.setUTCDate(Math.min(original,last)+1);
  }
  return day.toISOString().slice(0,10);
}
export function alignedComparison(d,key){
  const monthIndex=value=>Number(value.slice(0,4))*12+Number(value.slice(5,7))-1;
  const first=monthIndex(d.period.start),priorFirst=monthIndex(d.comparison_period.start);
  const count=Math.max(monthIndex(d.period.end)-first+1,monthIndex(d.comparison_period.end)-priorFirst+1);
  const now=new Map(d.trend.map(x=>[monthIndex(x.month)-first,x])),old=new Map(d.previous_trend.map(x=>[monthIndex(x.month)-priorFirst,x]));
  return Array.from({length:count},(_,i)=>({label:`${i+1}월차`,current:now.get(i)?.[key],previous:old.get(i)?.[key],patients:now.get(i)?.patients,oldPatients:old.get(i)?.patients}));
}
export function renderReference(d,{money='treatment',metric='money',grain='day'}={}){
  const key=money==='treatment'?'treatment_total':'collection_recorded',name=money==='treatment'?'총진료비':'기록된 수납액',a=d.current,b=d.previous;
  $('kpis').innerHTML=kpi('누적 '+name,a.has_data?won(a[key]):'—','',d.change[key],won(b[key]))+kpi('전체 환자수',a.has_data?num(a.patients):'—','명',d.change.patients,num(b.patients)+'명')+kpi('신규 환자수',a.has_data?num(a.new_patients):'—','명',d.change.new_patients,num(b.new_patients)+'명')+kpi('재방문 환자수',a.has_data?num(a.existing_patients):'—','명',d.change.existing_patients,num(b.existing_patients)+'명');
  const series=metric==='money'?[{key,label:'전체 '+name},{key:money==='treatment'?'new_treatment_total':'new_collection',label:'신규 환자군 '+name},{key:money==='treatment'?'existing_treatment_total':'existing_collection',label:'재방문 환자군 '+name}]:[{key:'patients',label:'전체 환자'},{key:'new_patients',label:'신규 환자군'},{key:'existing_patients',label:'재방문 환자군'}];
  series.forEach((s,i)=>s.color=colors[i]);
  $('trend-legend').innerHTML=series.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  $('trend-chart').innerHTML=seriesChart(grain==='day'?d.daily_trend:d.trend,series,{money:metric==='money',height:290});
  $('cohort-note').textContent=d.definitions.cohorts;
  $('overview-money-note').textContent=money==='treatment'?d.definitions.treatment:d.definitions.collection;
  const growth=d.growth;
  $('growth-period').textContent=`${growth.start} ~ ${growth.end} / 비교 ${growth.previous_start} ~ ${growth.previous_end}${growth.complete?'':' · 비교자료 부족'}`;
  $('growth-summary').innerHTML=[['신규 환자 유입','new_patients'],['누적 '+name,key],['재방문 환자 유입','existing_patients'],['평균 내원 횟수','average_visits']].map(([label,k])=>`<div class="growth-row"><span>${label}</span><strong>${k===key?compactMoney(growth.current[k])+'원':num(growth.current[k])}</strong>${delta(growth.change[k])}</div>`).join('');
  $('overview-age').innerHTML=columnChart(d.demographics.age,'value','#81b5ed');
  $('weekday-money-title').textContent='요일별 '+name;
  $('weekday-money').innerHTML=columnChart(d.weekday_metrics.map(x=>({label:x.label,value:x[key]})),'value','#95dcd2',{money:true});
  $('weekday-patients').innerHTML=groupedColumns(d.weekday_metrics,[{key:'new_patients',label:'신규 환자군',color:'#85b4eb'},{key:'existing_patients',label:'재방문 환자군',color:'#eeabc2'}]);
  renderComparison(d,key,name);renderRegionStats(d);renderChannelAge(d);renderSettings(d);
}
function renderComparison(d,key,name){
  $('comparison-ranges').innerHTML=`<span class="period-chip current-period">조회 ${d.period.start} ~ ${d.period.end}</span><span class="period-chip">비교 ${d.comparison_period.start} ~ ${d.comparison_period.end}</span>${d.coverage_warning||d.comparison_coverage_warning?'<strong class="coverage-warning">자료 범위 부족 · 증감률 미표시</strong>':''}`;
  const definitions=[[name,key],['전체 환자수','patients'],['내원 횟수','visits'],['신규 환자수','new_patients'],['재방문 환자수','existing_patients'],['환자당 '+name,key==='treatment_total'?'treatment_per_patient':'collection_per_patient']];
  const rows=definitions.map(([label,k])=>({label,current:d.current[k],previous:d.previous[k],difference:d.current.has_data&&d.previous.has_data&&d.current[k]!=null&&d.previous[k]!=null?d.current[k]-d.previous[k]:null,change:d.change[k]}));
  $('comparison-table').innerHTML=table(rows,[{key:'label',label:'지표'},{key:'current',label:'조회 기간',number:true},{key:'previous',label:'비교 기간',number:true},{key:'difference',label:'기록된 값의 차이',number:true},{key:'change',label:'증감률',render:delta}]);
  const aligned=alignedComparison(d,key);
  $('comparison-money').innerHTML=seriesChart(aligned,[{key:'current',label:'조회 '+name,color:colors[0]},{key:'previous',label:'비교 '+name,color:'#a3adb9'}],{money:true});
  $('comparison-patients').innerHTML=seriesChart(aligned,[{key:'patients',label:'조회 환자수',color:colors[0]},{key:'oldPatients',label:'비교 환자수',color:'#a3adb9'}]);
  const regions=d.regions.sig.filter(r=>!r.suppressed).sort((a,b)=>(b[key]||0)-(a[key]||0)).slice(0,15);
  $('comparison-regions').innerHTML=table(regions,[{key:'name',label:'시군구'},{key, label:'조회 '+name,render:won},{key:'previous',label:'비교 '+name,render:v=>won(v[key])},{key:'changes',label:'금액 증감률',render:v=>delta(v[key])},{key:'change',label:'환자수 증감률',render:delta}]);
}
export function renderRegionStats(d){
  const level=$('stats-level').value,query=$('stats-search').value.trim(),sort=$('stats-sort').value;
  const rows=d.regions[level].filter(x=>x.name.includes(query)).sort((a,b)=>(b[sort]??-Infinity)-(a[sort]??-Infinity));
  $('stats-summary').textContent=`${rows.length}개 지역 · 주소 연결 ${num(d.region_coverage[level].percent)}% · 5명 미만 상세 비공개 · 금액 대사 전`;
  $('stats-table').innerHTML=table(rows,[{key:'name',label:'지역',render:(name,r)=>`<button class="region-link" data-region-open="${r.code}" data-region-level="${level}">${esc(name)}</button>`},{key:'patients',label:'내원 환자수',number:true},{key:'visits',label:'내원 횟수',number:true},{key:'new_patients',label:'신규',number:true},{key:'existing_patients',label:'재방문',number:true},{key:'treatment_total',label:'총진료비',render:won},{key:'collection_recorded',label:'기록된 수납액',render:won},{key:'treatment_per_visit',label:'내원당 진료비',render:won},{key:'treatment_per_patient',label:'환자당 진료비',render:won},{key:'change',label:'환자 증감률',render:delta}]);
}
export function renderChannelAge(d){
  const mode=$('channel-age-mode').value,ages=[...new Set(d.channel_age.map(x=>x.age))].sort(),channels=[...new Set(d.channel_age.map(x=>x.channel))].sort();
  if(!ages.length){$('channel-age-table').innerHTML=empty();return;}
  const byKey=new Map(d.channel_age.map(x=>[x.age+'|'+x.channel,x]));
  $('channel-age-table').innerHTML=`<table class="matrix"><thead><tr><th>연령대</th>${channels.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${ages.map(age=>`<tr><th>${esc(age)}</th>${channels.map(ch=>{const x=byKey.get(age+'|'+ch),v=x?.[mode]||0;return `<td style="background:rgba(72,151,218,${Math.min(.5,(x?.percent||0)/130)})">${num(v)}${mode==='percent'?'%':''}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderSettings(d){
  $('settings-definitions').innerHTML=[['신규·재방문 환자군',d.definitions.cohorts],['총진료비',d.definitions.treatment],['수납액',d.definitions.collection],['지역 기준',d.definitions.region],['자료 기준일',d.available.end+' · 화면 확인시각과 원자료 기준일을 구분합니다.']].map(([title,value])=>`<p><strong>${title}</strong>${esc(value)}</p>`).join('');
  const rows=[['대시보드·기간 비교·지역 지도/통계','실제 엑셀 연결 · 지도 기본 고유환자 수'],['엑셀 업로드·정정·이력','8개 보고서 형식 · 연도별 전체 교체 · 최근 반영 복원'],['지역 이름·도로/하천 배경','공개 경계 + OpenStreetMap'],['수도권 인구·성별·연령',d.regional_context?.connected?`${d.regional_context.as_of} · ${d.regional_context.mapped_dongs}개 법정읍면동 연결`:'공개 인구자료 확인 필요'],['도로명 주소 연결',d.address_diagnostics?.reference?.connected?`${d.address_diagnostics.reference.scope} 공개 DB ${d.address_diagnostics.reference.as_of} · 로컬 건물번호 대조`:'도로명 DB 미연결'],['서울 치과 현황',d.competitors?.connected?`${num(d.competitors.active_dental)}곳 자료상 영업중 · 법정동 ${num(d.competitors.matched_emd)}곳 연결`:'공개 의료기관 자료 미연결'],['시군구 상권·소득 참고',d.market_context?.connected?'서울 25개 자치구 직장인구·점포·의료비 추정 / 국민연금 지역가입자 소득 · 조회 종료일 이전 제공기간 선택':'공개 상권 참고자료 미연결'],['지역 내원 비율','같은 기준일·포함 범위 확인 필요'],['행정동·소구역·500m 분석','해당 경계·환자 좌표 필요'],['광고비·캠페인·관측 관리','지역 전략·집행 위치·지출 장부·광고파일 열 연결·문의 연결·월 보고 구현 / 실제 집행 자료 업로드 필요'],['캠페인 지역 변화 비교','저장된 타깃·집행기간과 직전/전년 비교 · 참고 지역·비용 범위 구분·CSV · 미관측/소수/부분기간 증감 제외'],['월 보고서 캠페인 비교','선택 캠페인의 보고월 내 관측 · 직전 동일 일수 비교 · 저장본/HTML/PDF · 겹치는 소수 집계 비공개'],['EMR 자동 수집','공식 지원 API 또는 내보내기 연결 필요'],['병원 자료·콘텐츠·리뷰 기록','출처·유효기간·승인본 연결과 수동 검수·대응 기록'],['병원 근거 질의응답','승인 자료 검색·출처 인용 · 확인 후 Claude 구독 답변 · 현재 연결은 해당 화면에서 검사'],['AI 지역 전략','지역·기간·연령 집계 + 선택 승인자료 · Claude 구독 후보 → 새 전략 초안 → 캠페인 연결 · 검증 전 가설'],['공개 채널 확인','홈페이지·RSS 변화 확인·예약 확인·실패 이력 · 제한된 리뷰 채널은 수동 확인'],['다병원 백업·복구','관리자용 로컬 백업·무결성 검사 · 기존 병원을 유지하는 별도 공간 복구'],['자동 리뷰 수집·GEO·채널 발행','공식 채널 권한·연결 미확인']].map(([feature,status])=>({feature,status}));
  $('feature-coverage').innerHTML=table(rows,[{key:'feature',label:'공개 기능 범위'},{key:'status',label:'현재 연결 상태'}]);
  const context=d.regional_context;if(context?.connected&&context.province_summary)$('feature-coverage').insertAdjacentHTML('beforeend','<details class=population-coverage><summary>공개 인구자료 연결 범위 · 원본 행과 지역 그룹 구분</summary>'+table(Object.values(context.province_summary),[{key:'name',label:'시도'},{key:'source_rows',label:'원본 행',render:num},{key:'source_groups',label:'지역 그룹',render:num},{key:'mapped_dongs',label:'연결 지역',render:num},{key:'boundary_dongs',label:'지도 지역',render:num},{key:'ri_aggregated_dongs',label:'리 합계 지역',render:num},{key:'excluded_groups',label:'미연결 그룹',render:num}])+'<p>'+esc(context.boundary_note)+' '+esc(context.ri_note)+'</p></details>');
}
