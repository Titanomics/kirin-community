import {esc,num,table,empty} from './charts.js';
import {apiFetch} from './scope.js';
import {initAdMapping,describeMapping} from './ad-mapping.js';
const $=id=>document.getElementById(id);
const taxes={included:'부가세 포함',excluded:'부가세 제외',unknown:'부가세 미확인'};
const channels={meta:'META',naver_search:'네이버 검색광고',naver_place:'네이버 플레이스',naver_blog:'네이버 블로그',community:'지역 커뮤니티',offline:'오프라인',other:'기타'};
const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const bytes64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
const decimal=v=>v===null?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
const money=v=>v===null?'—':decimal(v)+'원';
const count=v=>{if(v===null)return '—';const [whole,fraction]=String(v).split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');};
const basis=m=>m.operation==='withdraw'?'선택 행 철회':`${m.source_label} · ${m.account_label} · ${m.conversion_definition} · ${taxes[m.tax_basis]}${m.as_of?' · 확인 '+m.as_of:''}`;

export function initAdReports(){
  let revision=null,preview=null,rollbackRevision=null,seq=0,busy=false,workspace=null,previewPage=0,daily=[],dailyPage=0;
  const section=document.createElement('section');section.id='page-adreports';section.className='page-view marketing-page ad-reports-page';section.hidden=true;
  section.innerHTML=`<div class="marketing-topline"><div><h2>광고 보고서 · 지출 대조</h2><p>파일의 일별 매체 수치를 확인하고 지출 장부와 비교합니다.</p><p id="ad-checked"></p></div><button id="ad-refresh" class="button secondary">현재 자료 확인</button></div><div id="ad-message" class="marketing-message" role="status" hidden></div>
  <form id="ad-period" class="marketing-toolbar"><label>시작일<input name="start" type="date" required></label><label>종료일<input name="end" type="date" required></label><button class="button primary">조회</button></form>
  <div id="ad-summary" class="marketing-summary"></div><article class="panel"><h3>캠페인별 매체 보고 수치</h3><p>전환은 매체가 보고한 값입니다. 병원 환자수·문의·내원 수치와 별도로 봅니다.</p><div id="ad-results" class="table-scroll"></div><details id="ad-daily"><summary>일별 원자료 확인 · 잘못 올린 행 철회</summary><p>날짜·캠페인을 잘못 입력했다면 해당 행을 철회한 뒤 올바른 행을 올립니다. 다음 단계에서 선택한 행과 사유를 확인합니다.</p><div id="ad-daily-rows" class="table-scroll"></div><div id="ad-daily-pages" class="ad-preview-pages"></div><button id="ad-withdraw-preview" class="button secondary" type="button">현재 페이지 선택 행 철회 검토</button></details></article>
  <article class="panel marketing-section"><h3>연결한 지출과 비교</h3><p>조회기간에 포함된 보고 행이 연결한 원 지출을 표시합니다. 금액 비교는 그 지출에 연결된 <strong>전체 일자</strong>의 보고비와 원 지출 − 유효한 환불 기준입니다.</p><div id="ad-comparisons" class="table-scroll"></div><p id="ad-unlinked"></p></article><div id="ad-warnings" class="marketing-note"></div>
  <article class="panel marketing-section"><div class="panel-heading"><h3>광고 보고서 올리기</h3><button id="ad-template" class="button secondary">엑셀 양식 받기</button></div><p>한 행은 내부 캠페인별 하루 합계입니다. 표준 양식을 쓰거나 원본 열을 직접 연결할 수 있습니다. 같은 광고 수치를 서로 다른 캠페인 ID에 중복 입력하지 마세요.</p>
  <form id="ad-upload" class="marketing-form" inert><label class="full">파일 · 5MB 이하 CSV/XLSX<input id="ad-file" type="file" accept=".csv,.xlsx" required></label><label>보고서 출처<input name="source_label" maxlength="500" placeholder="예: 매체 관리자 일별 보고서" required></label><label>계정·집계 범위<input name="account_label" maxlength="500" placeholder="계정 별칭 / 내부 캠페인 하루 합계" required></label><label class="full">매체 전환 정의<input name="conversion_definition" maxlength="500" placeholder="전환 이벤트와 클릭·조회 귀속 기간" required></label><label>광고비 부가세 기준<select name="tax_basis"><option value="unknown">미확인</option><option value="excluded">제외</option><option value="included">포함</option></select></label><label>보고 확인 기준일<input name="as_of" type="date" required></label><p class="marketing-note full">한국시간(Asia/Seoul) 일자 · 원화(KRW). 수치 빈칸은 받지 않습니다. 전환 소수 3자리까지 가능하며, 지출장부ID만 선택 입력입니다.</p><button type="submit" class="button primary">미리보기</button></form><div id="ad-preview" hidden></div>
  <details class="ad-id-guide"><summary>양식에 넣을 캠페인·지출 ID 확인</summary><div id="ad-ids"></div></details></article>
  <article class="panel marketing-section"><h3>업로드·정정 이력</h3><p>파일에 있는 일자·캠페인만 추가하거나 정정합니다. 파일에 없는 행은 유지됩니다. 정정도 새 이력으로 기록하며 최근 반영을 되돌리면 직전 값이 복구됩니다.</p><div id="ad-history" class="table-scroll"></div><form id="ad-rollback" class="marketing-form" inert><label class="full">되돌림 사유<input name="reason" maxlength="500" required></label><label class="ad-check full"><input type="checkbox" name="confirmed">현재 이력의 가장 최근 반영을 되돌립니다.</label><button class="button secondary">최근 반영 되돌리기</button></form></article>`;
  document.querySelector('.main-footer').before(section);
  const period=$('ad-period'),upload=$('ad-upload'),rollback=$('ad-rollback');
  period.elements.start.value=localDay().slice(0,7)+'-01';period.elements.end.value=localDay();upload.elements.as_of.value=localDay();
  const note=(s,error=false)=>{const n=$('ad-message');n.hidden=!s;n.textContent=s;n.classList.toggle('error',error);};
  async function api(path,data){const r=await apiFetch(path,{cache:'no-store',...(data!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'dday'},body:JSON.stringify(data)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error||'광고 보고서를 확인하지 못했습니다.');return result;}
  function resetPreview(){preview=null;$('ad-preview').hidden=true;$('ad-preview').replaceChildren();}
  const mapping=initAdMapping({upload,file:$('ad-file'),api,run,resetPreview,getWorkspace:()=>workspace});
  function render(r,status,w){
    const t=r.totals;$('ad-checked').textContent='확인 '+new Date(r.checked_at).toLocaleString('ko-KR',{hour12:false})+` · 보고 행 ${num(status.active_rows)}개`;
    $('ad-summary').innerHTML=!r.has_data?empty('선택기간의 광고 보고서가 없습니다. 수치를 0으로 해석하지 마세요.'):t?[['노출',num(t.impressions)],['클릭',num(t.clicks)],['매체 보고 전환',count(t.conversions)],['매체 보고 광고비',money(t.spend)],['클릭률',t.ctr===null?'—':decimal(t.ctr)+'%'],['클릭당 보고비',money(t.cpc)]].map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join(''):empty('캠페인 계층이 겹쳐 전체 합계를 표시하지 않습니다.');
    $('ad-results').innerHTML=table(r.campaigns,[{key:'title',label:'캠페인'},{key:'channel',label:'업로드 시 채널',render:(v,row)=>esc(channels[v]||v)+(row.channel_changed?' · 현재와 다름':'')},{key:'basis',label:'보고 기준',render:v=>esc(basis(v))},{key:'impressions',label:'노출',render:num},{key:'clicks',label:'클릭',render:num},{key:'conversions',label:'매체 보고 전환',render:count},{key:'spend',label:'보고 광고비',render:money},{key:'ctr',label:'CTR',render:v=>v===null?'—':decimal(v)+'%'},{key:'cpc',label:'CPC',render:money}]);
    const labels={missing:'장부 확인 필요',voided:'원 지출 취소됨',mixed_tax:'부가세 기준 혼합',comparison_only:'참고 비교 · 대사 미확정'};
    $('ad-comparisons').innerHTML=table(r.comparisons,[{key:'reference',label:'증빙 번호'},{key:'status',label:'상태',render:v=>esc(labels[v])},{key:'first_date',label:'전체 연결 시작일'},{key:'last_date',label:'전체 연결 종료일'},{key:'linked_rows',label:'전체 연결 행',render:num},{key:'reported_spend_all_dates',label:'전체 연결 보고비',render:money},{key:'original_charge',label:'원 지출',render:money},{key:'refunds',label:'유효 환불',render:money},{key:'ledger_net',label:'원 지출 − 환불',render:money},{key:'difference',label:'보고비 − 장부',render:money}]);
    $('ad-unlinked').textContent=`선택기간 중 지출 미연결 ${num(r.unlinked_rows)}행`;$('ad-warnings').innerHTML=r.warnings.map(x=>`<p>${esc(x)}</p>`).join('');
    $('ad-history').innerHTML=table(status.batches,[{key:'created_at',label:'반영 시각',render:v=>esc(new Date(v).toLocaleString('ko-KR'))},{key:'metadata',label:'보고 기준',render:v=>esc(basis(v))+describeMapping(v.input_mapping,v.input_columns,w)},{key:'inserted',label:'추가',render:num},{key:'replaced',label:'정정',render:num},{key:'skipped',label:'동일 제외',render:num},{key:'voided',label:'상태',render:v=>v?'되돌림':'반영 중'},{key:'reason',label:'정정 사유'},{key:'void_reason',label:'되돌림 사유'}]);
    $('ad-ids').innerHTML='<h4>캠페인 ID</h4>'+table(w.campaigns,[{key:'title',label:'캠페인'},{key:'id',label:'캠페인ID',render:v=>`<code>${esc(v)}</code>`},{key:'start',label:'시작일'},{key:'end',label:'종료일'}])+'<h4>연결 가능한 원 지출 ID</h4>'+table(w.expenses.filter(e=>e.direction==='charge'&&!e.voided),[{key:'campaign_id',label:'캠페인',render:v=>esc(w.campaigns.find(c=>c.id===v)?.title||'확인 필요')},{key:'reference',label:'증빙 번호'},{key:'id',label:'지출장부ID',render:v=>`<code>${esc(v)}</code>`},{key:'amount',label:'원 지출',render:money}]);
  }
  function renderDaily(){
    const pages=Math.max(1,Math.ceil(daily.length/50));
    $('ad-daily-rows').innerHTML=table(daily.slice(dailyPage*50,(dailyPage+1)*50),[{key:'date',label:'철회 선택',render:(v,r)=>`<input type="checkbox" data-ad-key="${esc(v+'|'+r.campaign_id)}" aria-label="${esc(v+' '+(workspace.campaigns.find(c=>c.id===r.campaign_id)?.title||r.campaign_id))} 철회 선택">`},{key:'date',label:'일자'},{key:'campaign_id',label:'캠페인',render:v=>esc(workspace.campaigns.find(c=>c.id===v)?.title||v)},{key:'impressions',label:'노출',render:num},{key:'clicks',label:'클릭',render:num},{key:'conversions',label:'매체 보고 전환',render:count},{key:'spend',label:'매체 보고 광고비',render:money},{key:'metadata',label:'보고 기준',render:v=>esc(basis(v))}]);
    $('ad-daily-pages').innerHTML=`<button type="button" data-daily-page="-1" ${dailyPage===0?'disabled':''}>이전</button><span>${dailyPage+1} / ${pages} 페이지 · 이동 시 선택 해제</span><button type="button" data-daily-page="1" ${dailyPage+1>=pages?'disabled':''}>다음</button>`;
    $('ad-withdraw-preview').disabled=!daily.length;
  }
  $('ad-daily-pages').addEventListener('click',e=>{const b=e.target.closest('[data-daily-page]');if(b){dailyPage+=Number(b.dataset.dailyPage);renderDaily();}});
  $('ad-withdraw-preview').addEventListener('click',()=>run(async()=>{
    const keys=[...$('ad-daily-rows').querySelectorAll('input:checked')].map(el=>{const [date,campaign_id]=el.dataset.adKey.split('|');return {date,campaign_id};});
    if(!keys.length)throw Error('철회할 행을 선택해 주세요.');resetPreview();preview={...await api('/api/ad-reports/withdraw-preview',{keys}),upload:{keys}};previewPage=0;showPreview();$('ad-preview').scrollIntoView({block:'start'});note('선택한 행의 철회 전 수치와 사유를 확인해 주세요.');
  }));
  async function load(){
    const request=++seq,query=new URLSearchParams(new FormData(period));upload.inert=true;rollback.inert=true;$('ad-daily').inert=true;
    try{
      let status,w,r,consistent=false;
      for(let attempt=0;attempt<3;attempt++){
        [status,w,r]=await Promise.all([api('/api/ad-reports'),api('/api/workspace'),api('/api/ad-reports/report?'+query)]);
        if(request!==seq)return false;
        if(status.revision===r.revision&&w.revision===r.workspace_revision){consistent=true;break;}
      }
      if(!consistent)throw Error('조회 중 자료가 바뀌었습니다. 다시 확인해 주세요.');
      if(preview&&(preview.revision!==status.revision||preview.workspace_revision!==w.revision))resetPreview();
      if(revision!==status.revision){rollbackRevision=null;rollback.elements.confirmed.checked=false;}
      revision=status.revision;workspace=w;daily=r.daily;dailyPage=0;render(r,status,w);renderDaily();$('ad-daily').inert=false;upload.inert=false;rollback.inert=!status.batches.some(b=>!b.voided);return true;
    }catch(e){if(request!==seq)return false;revision=null;rollbackRevision=null;workspace=null;resetPreview();rollback.elements.confirmed.checked=false;for(const id of ['ad-summary','ad-results','ad-comparisons','ad-history','ad-ids','ad-warnings','ad-daily-rows','ad-daily-pages'])$(id).replaceChildren();$('ad-unlinked').textContent='';$('ad-checked').textContent='이번 자료 확인에 실패했습니다.';note(e.message,true);return false;}
  }
  async function run(task){if(busy)return;busy=true;section.inert=true;note('처리 중입니다.');try{await task();}catch(e){note(e.message,true);}finally{busy=false;section.inert=false;if($('ad-message').textContent==='처리 중입니다.')note('');}}
  function showPreview(){
    const p=preview,changes=p.changes.slice(previewPage*50,(previewPage+1)*50),totalPages=Math.max(1,Math.ceil(p.changes.length/50));
    $('ad-preview').innerHTML=`<div class="marketing-evidence"><h4>반영 전 확인</h4><p>추가 ${num(p.inserted)} · 정정 ${num(p.replaced)} · 동일 제외 ${num(p.skipped)}</p><p>${p.action==='withdraw'?'선택한 행을 현재 집계에서 철회합니다. 원래 값과 사유는 이력에 남습니다.':esc(basis(p.metadata))+' · 한국시간 · KRW'}</p>${p.action==='withdraw'?'':describeMapping(p.input_mapping,p.input_columns,workspace)}<div class="table-scroll">${table(changes,[{key:'after',label:'일자 / 캠페인',render:(v,row)=>{v=v||row.before;return esc(v.date+' / '+(workspace.campaigns.find(c=>c.id===v.campaign_id)?.title||v.campaign_id));}},{key:'before',label:'변경 전',render:v=>v?metricsText(v):'새 행'},{key:'after',label:'변경 후',render:metricsText}])}</div><div class="ad-preview-pages"><button type="button" data-ad-page="-1" ${previewPage===0?'disabled':''}>이전</button><span>${previewPage+1} / ${totalPages} 페이지 · 페이지당 50행</span><button type="button" data-ad-page="1" ${previewPage+1>=totalPages?'disabled':''}>다음</button></div><form id="ad-confirm-form" class="marketing-form"><label class="ad-check full"><input name="confirmed" type="checkbox">보고 범위·전환 정의·변경 수치를 확인했습니다.</label>${p.replaced?'<label class="ad-check full"><input name="replace" type="checkbox">표시된 행의 변경 또는 철회를 확인했습니다.</label><label class="full">정정 사유<input name="reason" maxlength="500" required></label>':''}<button class="button primary">보고 수치 반영</button></form></div>`;$('ad-preview').hidden=false;
  }
  function metricsText(v){if(!v)return '집계에서 철회';return `<p>노출 ${num(v.impressions)} · 클릭 ${num(v.clicks)} · 매체 전환 ${count(v.conversions)} · ${money(v.spend)}</p><small>${esc(basis(v.metadata))}<br>지출 ID: ${esc(v.expense_id||'미연결')}</small>`;}
  period.addEventListener('submit',e=>{e.preventDefault();run(load);});$('ad-refresh').addEventListener('click',()=>run(load));upload.addEventListener('input',resetPreview);upload.addEventListener('change',resetPreview);
  upload.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const file=$('ad-file').files[0];if(!file||file.size>5*1024*1024)throw Error('5MB 이하 CSV 또는 XLSX를 선택해 주세요.');
    const metadata={...Object.fromEntries(new FormData(upload)),timezone:'Asia/Seoul',currency:'KRW'},data={filename:file.name,data:bytes64(new Uint8Array(await file.arrayBuffer())),metadata,mapping:mapping.getMapping()};resetPreview();
    preview={...await api('/api/ad-reports/preview',data),upload:data};previewPage=0;showPreview();note('기존 행의 정정은 변경 전후와 사유를 확인한 뒤 반영합니다.');
  });});
  $('ad-preview').addEventListener('click',e=>{const b=e.target.closest('[data-ad-page]');if(!b||!preview)return;const f=$('ad-confirm-form'),draft=Object.fromEntries(new FormData(f));previewPage+=Number(b.dataset.adPage);showPreview();for(const [k,v] of Object.entries(draft)){const field=$('ad-confirm-form').elements.namedItem(k);if(field.type==='checkbox')field.checked=true;else field.value=v;}});
  $('ad-preview').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
    const f=e.target,p=preview;if(!p||!f.elements.confirmed.checked)throw Error('미리보기 확인란을 선택해 주세요.');
    if(p.replaced&&!f.elements.namedItem('replace')?.checked)throw Error('기존 행의 변경 또는 철회를 확인해 주세요.');
    const saved=await api(p.action==='withdraw'?'/api/ad-reports/withdraw':'/api/ad-reports/commit',{...p.upload,revision:p.revision,digest:p.digest,confirmed:true,replace:f.elements.namedItem('replace')?.checked||false,reason:f.elements.namedItem('reason')?.value||''});
    resetPreview();$('ad-file').value='';mapping.reset();if(await load())note(p.action==='withdraw'?`선택한 ${saved.withdrawn}행을 철회했습니다. 사유와 원래 값은 보관합니다.`:`보고 수치 추가 ${saved.inserted}행 · 정정 ${saved.replaced}행 · 동일 제외 ${saved.skipped}행. 지출 장부 금액은 늘리지 않았습니다.`);
  });});
  rollback.elements.confirmed.addEventListener('change',e=>{rollbackRevision=e.target.checked?revision:null;});
  rollback.addEventListener('submit',e=>{e.preventDefault();run(async()=>{if(rollbackRevision===null||revision!==rollbackRevision)throw Error('최신 이력과 확인란을 다시 확인해 주세요.');await api('/api/ad-reports/rollback',{revision:rollbackRevision,reason:rollback.elements.reason.value,confirmed:rollback.elements.confirmed.checked});rollback.reset();rollbackRevision=null;resetPreview();if(await load())note('최근 반영을 되돌렸습니다. 정정 이전 값과 이력은 보존합니다.');});});
  $('ad-template').addEventListener('click',()=>run(async()=>{const r=await apiFetch('/api/ad-reports/template');if(!r.ok)throw Error('양식을 읽지 못했습니다.');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='광고보고서_일별합계_양식.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
  const activate=()=>{if(location.hash==='#adreports'&&!busy)load();};window.addEventListener('hashchange',activate);window.addEventListener('pageshow',e=>{if(e.persisted)activate();});activate();return {refresh:activate};
}
