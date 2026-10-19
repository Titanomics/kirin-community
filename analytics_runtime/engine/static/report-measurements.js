import {esc,table,empty} from './charts.js';
const n=v=>{if(v===null||v===undefined)return '—';const [whole,fraction]=String(v).split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');};
const taxes={included:'부가세 포함',excluded:'부가세 제외',unknown:'부가세 미확인'};
const basis=b=>[b.source_label,b.account_label,b.conversion_definition,taxes[b.tax_basis]].join(' · ');
const stamp=s=>esc(new Date(s).toLocaleString('ko-KR',{hour12:false}));
const range=(a,b)=>esc((a||'—')+' ~ '+(b||'—'));
const wrap=html=>`<div class="table-scroll">${html}</div>`;
const warnings=items=>`<ul class="marketing-note">${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
export function reportMeasurements(measurements){
  if(!measurements)return '<section class="report-measurements"><h4>광고 보고 · 문의 연결자료</h4>'+empty('당시 미수집: 이 보고서에는 해당 집계를 포함하지 않았습니다.')+'</section>';
  const m=measurements.media,c=measurements.linked_cases,t=m.totals;
  const mediaSummary=!m.has_data?empty('미연결·미관측: 보고월의 광고 보고 수치가 없습니다.'):m.aggregation_blocked?empty('계층 중복: 전체·그룹 합계를 표시하지 않습니다.'):wrap(table([t],[{key:'impressions',label:'노출',render:n},{key:'clicks',label:'클릭',render:n},{key:'conversions',label:'매체 보고 전환',render:n},{key:'spend',label:'매체 보고비 · 원',render:n}]));
  const mediaRows=wrap(table(m.campaigns,[{key:'title',label:'캠페인'},{key:'basis',label:'보고 기준',render:v=>esc(basis(v))},{key:'first_report_date',label:'보고 일자',render:(v,r)=>range(v,r.last_report_date)},{key:'as_of_min',label:'자료 확인 기준일',render:(v,r)=>range(v,r.as_of_max)},{key:'conversions',label:'매체 보고 전환',render:n},{key:'spend',label:'보고비 · 원',render:n}]));
  const states={missing:'장부 확인 필요',voided:'원 지출 취소',mixed_tax:'부가세 기준 혼합',comparison_only:'참고 비교 · 대사 미확정'};
  const comparisons=wrap(table(m.comparisons,[{key:'reference',label:'증빙'},{key:'status',label:'상태',render:v=>esc(states[v])},{key:'first_date',label:'전체 연결기간',render:(v,r)=>range(v,r.last_date)},{key:'reported_spend_all_dates',label:'전체 보고비',render:n},{key:'ledger_net',label:'원 지출 − 환불',render:n},{key:'difference',label:'차이 · 원',render:n}]));
  const linkedSummary=!c.has_data?empty('미연결·미관측: 보고월에 시작한 문의 연결자료가 없습니다.'):wrap(table([c.totals],[{key:'inquiry',label:'문의 연결건',render:n},{key:'booking',label:'예약 확인',render:n},{key:'attendance',label:'내원 확인',render:n},{key:'treatment',label:'치료 확인',render:n},{key:'net_collections',label:'관측 수납 − 환불 · 원',render:n}]));
  return `<section class="report-measurements"><h4>매체 보고 수치 · 보고월 일자 기준</h4><p class="marketing-note">확인 ${stamp(m.checked_at)} · 광고 자료 v${m.revision} · 장부 v${m.workspace_revision}</p>${mediaSummary}${mediaRows}<h4>증빙 비교 · 전체 연결기간</h4>${comparisons}<p>지출 미연결 ${n(m.unlinked_rows)}행 · 보고비를 월간 집행비에 더하지 않습니다.</p>${warnings(m.warnings)}<h4>문의월 연결건 · ${c.window_days}일 관측</h4><p>문의 시작 ${range(c.period.start,c.period.end)}<br>연결건별 예정 관측 종료 ${range(c.observation_end_min,c.observation_end_max)}<br>관측에 포함된 기록 일자 ${range(c.cohort_event_first,c.cohort_event_last)}<br>최소 자료 확인 기준일 ${esc(c.observed_through||'—')}</p><p class="marketing-note">확인 ${stamp(c.checked_at)} · 문의 자료 v${c.revision} · 장부 v${c.workspace_revision}</p><p>관측 완료 ${n(c.complete_cases)}건 · 관측 미완료 ${n(c.incomplete_cases)}건 · 문의 미연결 제외 ${n(c.orphan_cases)}건</p>${linkedSummary}<p>코호트 수납은 다음 달까지 포함할 수 있습니다. 보고월 EMR 수납·매체 전환·거래일 기준 지출과 합산하지 않습니다.</p>${warnings(c.warnings)}</section>`;
}
