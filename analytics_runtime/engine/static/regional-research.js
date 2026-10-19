import {esc,num} from './charts.js';

export function addressDiagnostics(data){
  const d=data.address_diagnostics;if(!d)return '';
  const source=d.reference||{},methods=d.methods||{};
  return `<div class="address-diagnostics"><p><strong>주소 연결 방법</strong>법정동 이름 확인 ${num(methods.explicit_legal_dong||0)}명 · 도로명·건물번호 대조 ${num(methods.road_building||0)}명. ${esc(d.basis)}</p><p>${source.connected?`<a href="https://www.epost.go.kr/search/zipcode/areacdAddressDown.jsp" target="_blank" rel="noopener noreferrer">인터넷우체국 공개 주소 DB</a> · ${esc(source.scope)} · 자료 기준 ${esc(source.as_of)} · 파일 확인 ${esc(new Date(source.checked_at).toLocaleString('ko-KR'))}. 공개 주소 ${num(source.source_rows)}행 중 코드·명칭이 일치하는 ${num(source.accepted_rows)}행을 사용합니다. 제외 ${num(source.rejected_rows)}행은 연결하지 않습니다. 현재 주소 참고자료이며 과거 거주지를 증명하지 않습니다.`:'공개 도로명 주소 DB 미연결 · 법정동 이름으로 확인 가능한 주소만 사용합니다.'}</p><details><summary>법정동 미연결 사유 보기</summary><ul class="address-reasons">${(d.reasons||[]).map(r=>`<li><span>${esc(r.label)}</span><b>${num(r.patients)}명</b></li>`).join('')}</ul></details></div>`;
}

export function competitorContext(data,level,code){
  if(!data?.connected)return '<section class="competitor-context"><h4>지역 치과 현황</h4><p class="detail-note">공개 의료기관 자료 미연결</p></section>';
  if(!String(code).startsWith('11'))return '<section class="competitor-context"><h4>지역 치과 현황</h4><p class="detail-note">현재 서울 자료를 제공합니다. 다른 지역은 0곳으로 표시하지 않습니다.</p></section>';
  const rows=(data.regions?.[level]?.[code]||[]).map(id=>data.facilities[id]).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  const clinics=rows.filter(r=>r.kind==='치과의원').length,hospitals=rows.filter(r=>r.kind==='치과병원').length;
  const dates=[...new Set(data.sources.map(s=>s.downloaded_at.slice(0,10)))].join(', ');
  const missing=level==='emd'?data.unmatched_emd:data.unmatched_sig;
  return `<section class="competitor-context"><h4>지역 치과 현황 <small>자료상 영업중</small></h4><div class="reference-stat-grid"><div class="reference-stat"><span>치과의원</span><strong>${num(clinics)}곳</strong></div><div class="reference-stat"><span>치과병원</span><strong>${num(hospitals)}곳</strong></div></div><p class="detail-note">자료 수집 ${esc(dates)} · 행별 갱신일은 목록에 표시합니다. 서울 전체 ${num(data.active_dental)}곳 중 이 지도 단위에 ${num(missing)}곳 미연결. 지역 수치는 연결이 확인된 기관 수입니다.</p><details class="competitor-list"><summary>기관 목록 보기 · ${num(rows.length)}곳</summary><ul>${rows.map(r=>`<li><strong>${esc(r.name)}</strong><span>${esc(r.kind)} · ${esc(r.status)}</span><span>${esc(r.address)}</span><small>자료 갱신 ${esc(r.updated_at)} · 허가 ${esc(r.licensed_at||'미제공')}</small></li>`).join('')||'<li>이 지역에 연결된 영업중 기록이 없습니다.</li>'}</ul></details><p class="detail-note">${esc(data.note)} 인허가 정보는 변경 신고와 공개까지 시차가 있습니다.</p><p class="detail-note">서울 열린데이터광장 <a href="https://data.seoul.go.kr/dataList/OA-16480/S/1/datasetView.do" target="_blank" rel="noopener noreferrer">의원</a> · <a href="https://data.seoul.go.kr/dataList/OA-16479/S/1/datasetView.do" target="_blank" rel="noopener noreferrer">병원</a> · 공공누리 1유형<br>파일 확인 ${esc(new Date(data.checked_at).toLocaleString('ko-KR'))}</p></section>`;
}

export function marketEvidence(data){
  if(!data)return '<p class="detail-note">지역 상권 참고자료 미연결</p>';
  const parent=data.relation==='parent_district';
  return `<div class="market-evidence"><p class="market-scope"><strong>${parent?'상위 시군구 참고':'시군구 참고'} · ${esc(data.district_name)}</strong>${parent?'<br>선택한 법정동 자체의 값이 아닙니다.':''}</p><p class="detail-note">조회 종료일 ${esc(data.selection_end)} 기준 · ${esc(data.policy)}</p><div class="reference-stat-grid">${data.indicators.map(r=>`<div class="reference-stat ${r.status==='available'?'':'unavailable'}" data-market-indicator="${esc(r.id)}"><span>${esc(r.label)}</span><strong>${r.value===null?'—':`${num(r.value)}<small>${esc(r.unit)}</small>`}</strong><em>${r.status==='available'?`${esc(r.period)} 제공값${r.industry_count?' · '+num(r.industry_count)+'개 업종':''}`:r.status==='after_query_end'?'조회 종료일 이전 자료 없음':'해당 지역 자료 미연결'}</em></div>`).join('')}</div><details class="market-definitions"><summary>지표 정의·기준기간·공식 출처</summary>${data.indicators.map(r=>`<p><strong>${esc(r.label)}</strong><br>${esc(r.note)}<br>사용 기간 ${esc(r.period||'없음')} · 최신 보유 ${esc(r.latest_period||'없음')}${r.source?`<br>수집 ${esc(r.source.downloaded_at.slice(0,10))} · ${esc(r.id==='income'?'이용허락범위 제한 없음':'공공누리 1유형')}`:''}<br><a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${esc(r.provider)} · 공식 출처</a></p>`).join('')}<p>${esc(data.boundary_note)}</p></details></div>`;
}

export function marketContext(data,level,code){
  const district=data?.connected?data.districts?.[String(code).slice(0,5)]:null;
  return `<section class="market-context"><h4>상권·소득 참고</h4>${marketEvidence(district?{...district,relation:level==='emd'?'parent_district':'same_district'}:null)}${data?.checked_at?`<p class="detail-note">공개 파일 확인 ${esc(new Date(data.checked_at).toLocaleString('ko-KR'))}</p>`:''}</section>`;
}
