import {esc,num,table,empty} from './charts.js';
import {apiFetch} from './scope.js';
const $=id=>document.getElementById(id);
const taxes={included:'부가세 포함',excluded:'부가세 제외',unknown:'부가세 미확인'};
const directions={income:'수입',cost:'지출',income_refund:'수입 환불',cost_refund:'지출 환불'};
const money=v=>v==null?'—':num(v)+'원';
const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const field=(name,label,type='text',attrs='')=>`<label>${label}<input name="${name}" type="${type}" ${attrs}></label>`;

export function initInternalFinance(){
  let revision=null,seq=0,busy=false,records=[],originals=[],page=0,voidTarget=null,voidRevision=null;
  const requests=new Map();
  const section=document.createElement('section');section.id='page-internalfinance';section.className='page-view marketing-page internal-finance-page';section.hidden=true;
  section.innerHTML=`<div class="marketing-topline"><div><h2>내부 비용 · 작업시간</h2><p>대행사 관리자용 수동 기록입니다. 병원 고객 보고서에는 포함되지 않습니다.</p><p id="finance-checked"></p></div><button id="finance-refresh" class="button secondary">현재 자료 확인</button></div><p class="finance-permission">관리자 또는 이 PC 단독 모드에서 볼 수 있습니다.</p><div id="finance-message" class="marketing-message" role="status" hidden></div>
  <div class="finance-private"><form id="finance-period" class="marketing-toolbar">${field('start','시작일','date','required')}${field('end','종료일','date','required')}<button class="button primary">조회</button><button id="finance-export" type="button" class="button secondary" disabled>이 기간 기록 CSV</button></form>
  <div id="finance-summary" class="marketing-summary"></div><article class="panel"><h3>부가세 기준별 기록 금액</h3><p>기록 금액 차액 = 수입 − 수입 환불 − 지출 + 지출 환불. 회계상 이익이나 확정 현금수지를 뜻하지 않습니다.</p><div id="finance-groups" class="table-scroll"></div><p id="finance-limits" class="marketing-note"></p></article>
  <div class="finance-forms"><article class="panel"><h3>금액 기록</h3><p>실제 입출금일과 증빙에 기재된 원화 금액을 입력하세요. 정정은 기존 기록을 취소한 뒤 새로 입력합니다.</p><form id="finance-transaction" class="marketing-form" inert><label>거래 구분<select name="direction">${Object.entries(directions).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>${field('date','실제 입출금일','date','required')}${field('amount','기록 금액 · 원','number','required min="1" max="1000000000000" step="1"')}<label data-finance-normal>부가세 기준<select name="tax_basis"><option value="unknown">미확인</option><option value="included">포함</option><option value="excluded">제외</option></select></label>${field('category','항목 · 대행료/외주비 등','text','required maxlength="100"')}${field('owner','담당자','text','required maxlength="100"')}${field('reference','거래 증빙번호','text','required maxlength="200"')}<label class="full" id="finance-original-label" hidden>환불할 원거래<select name="original_id"><option value="">원거래 선택</option></select></label><p id="finance-original-note" class="marketing-note full" hidden></p><label class="full">연결 캠페인 · 선택<select name="campaign_id"><option value="">연결 안 함</option></select></label><label class="full">메모<textarea name="note" maxlength="1000"></textarea></label><button class="button primary">금액 기록 저장</button></form></article>
  <article class="panel"><h3>작업시간 기록</h3><p>작업시간만 기록하며 인건비로 환산하지 않습니다. 같은 날 여러 작업을 나누어 적을 수 있습니다.</p><form id="finance-time" class="marketing-form" inert>${field('date','작업일','date','required')}${field('owner','담당자','text','required maxlength="100"')}${field('minutes','작업시간 · 분','number','required min="1" max="1440" step="1"')}${field('task','작업 내용','text','required maxlength="300"')}<label class="full">연결 캠페인 · 선택<select name="campaign_id"><option value="">연결 안 함</option></select></label><label class="full">메모<textarea name="note" maxlength="1000"></textarea></label><p class="marketing-note full">이 병원에서 같은 담당자명·일자의 합계가 24시간을 넘으면 저장하지 않습니다. 병원 간 동일인 여부는 확인하지 않습니다.</p><button class="button primary">작업시간 저장</button></form></article></div>
  <article class="panel marketing-section"><h3>선택기간 기록 · 취소 이력 포함</h3><div id="finance-records" class="table-scroll"></div><div id="finance-pages" class="finance-pages"></div><form id="finance-void" class="marketing-form" hidden><h4 id="finance-void-target" class="full"></h4><label class="full">취소 사유<input name="reason" maxlength="500" required></label><label class="finance-check full"><input name="confirmed" type="checkbox" required>선택한 기록을 합계에서 제외하고 취소 사유를 남깁니다.</label><div class="full"><button class="button secondary">기록 취소 확정</button><button id="finance-void-close" type="button" class="button secondary">닫기</button></div></form></article>
  <article class="panel marketing-section"><h3>최근 변경 이력 · 전체 기간 100건</h3><div id="finance-audit" class="table-scroll"></div></article></div>`;
  document.querySelector('.main-footer').before(section);
  const period=$('finance-period'),transaction=$('finance-transaction'),time=$('finance-time'),voidForm=$('finance-void');
  const note=(s,error=false)=>{const el=$('finance-message');el.textContent=s;el.hidden=!s;el.classList.toggle('error',error);};
  period.elements.start.value=localDay().slice(0,7)+'-01';period.elements.end.value=localDay();transaction.elements.date.value=localDay();time.elements.date.value=localDay();
  async function api(path,data){const r=await apiFetch(path,{cache:'no-store',...(data!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'dday'},body:JSON.stringify(data)}:{})});const result=await r.json();if(!r.ok)throw Error(result.error||'내부 기록을 확인하지 못했습니다.');return result;}
  const refund=()=>transaction.elements.direction.value.endsWith('_refund');
  function updateOriginals(){
    const old=transaction.elements.original_id.value,direction=transaction.elements.direction.value.replace('_refund','');
    const options=originals.filter(e=>e.direction===direction);
    transaction.elements.original_id.innerHTML='<option value="">원거래 선택</option>'+options.map(e=>`<option value="${esc(e.id)}">${esc(e.date+' · '+e.reference+' · '+e.category+' · 환불 가능 '+money(e.remaining))}</option>`).join('');
    if(options.some(e=>e.id===old))transaction.elements.original_id.value=old;
    else if(old&&requests.has(transaction)){
      const option=document.createElement('option');option.value=old;option.textContent='이전 선택 · 현재 환불 가능 목록에서 제외됨';transaction.elements.original_id.append(option);transaction.elements.original_id.value=old;
    }
    const isRefund=refund();$('finance-original-label').hidden=!isRefund;transaction.elements.original_id.required=isRefund;transaction.elements.original_id.disabled=!isRefund;
    for(const name of ['tax_basis','category','campaign_id']){const el=transaction.elements.namedItem(name);el.disabled=isRefund;el.closest('label').hidden=isRefund;}
    const original=originals.find(e=>e.id===transaction.elements.original_id.value);$('finance-original-note').hidden=!isRefund;
    $('finance-original-note').textContent=original?`원거래 기준 유지: ${taxes[original.tax_basis]} · ${original.category} · ${original.campaign_title||'캠페인 미연결'} · 환불 가능 ${money(original.remaining)}`:transaction.elements.original_id.value?'현재 환불 가능한 원거래가 아닙니다. 응답을 받지 못한 저장은 내용을 그대로 재시도해 결과를 확인할 수 있습니다. 새 환불을 추가하지 않습니다.':'원거래의 부가세 기준·항목·캠페인을 그대로 사용합니다.';
  }
  transaction.elements.direction.addEventListener('change',()=>{transaction.elements.original_id.value='';updateOriginals();});transaction.elements.original_id.addEventListener('change',updateOriginals);
  function clearVoid(){voidTarget=null;voidRevision=null;voidForm.hidden=true;voidForm.reset();requests.delete(voidForm);}
  function renderRecords(){
    const pages=Math.max(1,Math.ceil(records.length/50));page=Math.min(page,pages-1);
    $('finance-records').innerHTML=table(records.slice(page*50,(page+1)*50),[{key:'date',label:'일자'},{key:'kind',label:'유형',render:(v,e)=>esc(v==='time'?'시간':directions[e.direction])},{key:'category',label:'항목·작업',render:(v,e)=>esc(v||e.task)},{key:'amount',label:'기록 금액',render:money},{key:'tax_basis',label:'부가세 기준',render:v=>esc(taxes[v]||'—')},{key:'minutes',label:'작업 분',render:v=>v==null?'—':num(v)},{key:'owner',label:'담당자'},{key:'reference',label:'거래 증빙번호'},{key:'campaign_title',label:'기록 당시 캠페인'},{key:'note',label:'메모'},{key:'voided',label:'상태',render:(v,e)=>v?'취소 · '+esc(e.void_reason):'유효'},{key:'id',label:'정정',render:(v,e)=>e.voided?'—':`<button type="button" data-finance-void="${esc(v)}" class="marketing-small-button">취소 검토</button>`}]);
    $('finance-pages').innerHTML=`<button type="button" data-finance-page="-1" ${page===0?'disabled':''}>이전</button><span>${page+1} / ${pages} 페이지 · ${num(records.length)}건</span><button type="button" data-finance-page="1" ${page+1>=pages?'disabled':''}>다음</button>`;
  }
  function render(report,workspace){
    $('finance-checked').textContent='확인 '+new Date(report.checked_at).toLocaleString('ko-KR',{hour12:false})+' · 기록 버전 '+report.revision;
    const t=report.totals;
    $('finance-summary').innerHTML=[['순수입 기록',t?money(t.net_income):'—'],['순지출 기록',t?money(t.net_cost):'—'],['기록 금액 차액',t?money(t.difference):'—'],['작업시간',report.time_minutes==null?'미기록':num(report.time_minutes)+'분']].map(([k,v])=>`<div><span>${k}</span><strong>${esc(v)}</strong></div>`).join('');
    $('finance-groups').innerHTML=report.has_transactions?table(report.groups,[{key:'tax_basis',label:'부가세 기준',render:v=>esc(taxes[v])},{key:'income',label:'수입',render:money},{key:'income_refund',label:'수입 환불',render:money},{key:'cost',label:'지출',render:money},{key:'cost_refund',label:'지출 환불',render:money},{key:'difference',label:'기록 금액 차액',render:money}]):empty('선택기간에 유효한 금액 기록이 없습니다. 0원으로 해석하지 마세요.');
    $('finance-limits').textContent=(report.mixed_tax?'부가세 기준 혼합으로 전체 금액 합계는 표시하지 않습니다. ':'')+report.limitations.join(' ');
    $('finance-audit').innerHTML=table(report.audit,[{key:'at',label:'변경 시각',render:v=>esc(new Date(v).toLocaleString('ko-KR',{hour12:false}))},{key:'action',label:'작업',render:v=>v==='create'?'기록 추가':'기록 취소'},{key:'actor',label:'계정',render:v=>esc(v?.name||'이 PC 단독 모드')},{key:'reason',label:'취소 사유'},{key:'revision',label:'버전',render:num}]);
    for(const form of [transaction,time]){const el=form.elements.campaign_id,selected=el.value;el.innerHTML='<option value="">연결 안 함</option>'+workspace.campaigns.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');if(workspace.campaigns.some(c=>c.id===selected))el.value=selected;}
    updateOriginals();renderRecords();
  }
  function clear(){revision=null;records=[];originals=[];clearVoid();for(const id of ['finance-summary','finance-groups','finance-records','finance-pages','finance-audit'])$(id).replaceChildren();$('finance-limits').textContent='';$('finance-export').disabled=true;transaction.inert=true;time.inert=true;$('finance-records').inert=true;}
  async function load(){
    const current=++seq;transaction.inert=true;time.inert=true;$('finance-records').inert=true;voidForm.inert=true;$('finance-export').disabled=true;
    try{
      const [report,workspace]=await Promise.all([api('/api/internal-finance?'+new URLSearchParams(new FormData(period))),api('/api/workspace')]);
      if(current!==seq)return false;
      if(revision!==report.revision)clearVoid();revision=report.revision;records=report.entries;originals=report.originals;page=0;render(report,workspace);transaction.inert=false;time.inert=false;voidForm.inert=false;$('finance-records').inert=false;$('finance-export').disabled=false;return true;
    }catch(e){if(current!==seq)return false;clear();$('finance-checked').textContent='이번 자료 확인에 실패했습니다.';note(e.message,true);return false;}
  }
  async function run(task){if(busy)return;busy=true;section.inert=true;note('처리 중입니다.');try{await task();}catch(e){note(e.message,true);}finally{busy=false;section.inert=false;if($('finance-message').textContent==='처리 중입니다.')note('');}}
  const requestId=form=>{if(!requests.has(form))requests.set(form,crypto.randomUUID());return requests.get(form);};
  for(const form of [transaction,time,voidForm])form.addEventListener('input',()=>requests.delete(form));
  for(const [form,kind] of [[transaction,'transaction'],[time,'time']])form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    if(revision===null)throw Error('현재 자료를 먼저 확인해 주세요.');
    const data={...Object.fromEntries(new FormData(form)),kind};if(kind==='transaction')data.amount=Number(data.amount);else data.minutes=Number(data.minutes);
    const saved=await api('/api/internal-finance/save',{data,revision,request_id:requestId(form)});requests.delete(form);form.reset();form.elements.date.value=localDay();updateOriginals();if(await load())note(saved.duplicate?'이미 저장된 기록을 확인했습니다. 중복 추가하지 않았습니다.':'기록을 저장했습니다.');
  });});
  $('finance-records').addEventListener('click',e=>{const button=e.target.closest('[data-finance-void]');if(!button||revision===null)return;const target=records.find(r=>r.id===button.dataset.financeVoid);if(!target||target.voided)return;clearVoid();voidTarget=target.id;voidRevision=revision;voidForm.hidden=false;voidForm.inert=false;$('finance-void-target').textContent=`취소 대상: ${target.date} · ${target.reference||target.task} · ${target.kind==='time'?target.minutes+'분':money(target.amount)}`;voidForm.scrollIntoView({block:'nearest'});});
  voidForm.addEventListener('submit',e=>{e.preventDefault();run(async()=>{if(!voidTarget||voidRevision!==revision)throw Error('취소할 기록을 다시 선택해 주세요.');await api('/api/internal-finance/void',{id:voidTarget,revision:voidRevision,reason:voidForm.elements.reason.value,confirmed:voidForm.elements.confirmed.checked,request_id:requestId(voidForm)});clearVoid();if(await load())note('취소 사유를 남겼습니다. 정정 금액은 새 기록으로 입력해 주세요.');});});
  $('finance-void-close').addEventListener('click',clearVoid);
  $('finance-pages').addEventListener('click',e=>{const b=e.target.closest('[data-finance-page]');if(b){page+=Number(b.dataset.financePage);renderRecords();}});
  $('finance-refresh').addEventListener('click',()=>run(load));period.addEventListener('submit',e=>{e.preventDefault();run(load);});
  $('finance-export').addEventListener('click',()=>run(async()=>{const r=await apiFetch('/api/internal-finance/export?'+new URLSearchParams(new FormData(period)));if(!r.ok){const value=await r.json();throw Error(value.error||'기록을 내려받지 못했습니다.');}const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`내부운영기록_${period.elements.start.value}_${period.elements.end.value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);note('조회기간의 기록과 취소 이력을 내려받았습니다.');}));
  document.addEventListener('session-required',()=>{++seq;clear();$('finance-checked').textContent='로그인 후 다시 확인해 주세요.';});
  const activate=()=>{if(location.hash==='#internalfinance'&&!busy)load();};window.addEventListener('hashchange',activate);window.addEventListener('pageshow',e=>{if(e.persisted)activate();});activate();return {refresh:activate};
}
