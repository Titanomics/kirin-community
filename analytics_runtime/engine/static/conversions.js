import {esc,num,won,empty,table} from './charts.js';
import {apiFetch} from './scope.js';
const $=id=>document.getElementById(id);
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const bytes64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);};

export function initConversions(){
  let ledger=null,preview=null,request=0,busy=false,rollbackRevision=null;
  const section=document.createElement('section');section.id='page-conversions';section.className='page-view marketing-page conversions-page';section.hidden=true;
  section.innerHTML=`<div class="marketing-topline"><div><h2>문의 · 내원 연결 분석</h2><p id="conversion-checked">연결자료를 새로 확인합니다.</p></div><button class="button secondary" id="conversion-refresh">새로 확인</button></div><div id="conversion-message" class="marketing-message" role="status" hidden></div><article class="panel"><form id="conversion-period" class="marketing-toolbar"><label>문의 시작일<input name="start" type="date" required></label><label>문의 종료일<input name="end" type="date" required></label><label>문의일부터 관측<select name="window"><option value="30">30일</option><option value="60">60일</option><option value="90">90일</option></select></label><button class="button primary" type="submit">조회</button></form><p id="conversion-coverage" class="marketing-note"></p><div id="conversion-summary" class="marketing-summary"></div><div id="conversion-campaigns" class="table-scroll"></div><div id="conversion-warnings" class="marketing-note"></div></article><article class="panel marketing-section"><h3>다음 확인할 일</h3><p class="marketing-note">업로드된 기록과 장부에서 확인한 누락·관측 범위에 따른 제안입니다.</p><div id="conversion-actions"></div></article><article class="panel marketing-section" id="conversion-import-panel"><div class="panel-heading"><h3>연결자료 업로드</h3><button id="conversion-template" class="button secondary">엑셀 양식 내려받기</button></div><p class="marketing-note">기존 EMR 통계와 별도로 문의·예약·내원 기록에 같은 무작위 연결키를 붙인 자료를 사용합니다. 이름·전화번호·차트번호는 받지 않습니다. 한 문의 연결건은 하나의 캠페인에 귀속합니다.</p><details class="conversion-guide"><summary>양식의 7개 열과 연결 방법</summary><p>이벤트ID: 이벤트마다 새로운 UUID v4<br>연결키: 같은 문의 흐름은 동일한 UUID v4<br>단계: 문의 · 예약 · 내원 · 상담 · 치료 · 수납 · 환불 · 예약취소 · 미내원<br>발생일시: 실제 시각. 시간대가 없으면 한국시간으로 읽습니다.<br>캠페인ID: 아래 목록의 해당 캠페인 ID<br>금액: 수납·환불만 양의 정수 원, 나머지는 비움<br>원거래ID: 환불일 때 원 수납 이벤트ID</p><p>UUID는 자료 제공자가 무작위로 만든 식별자입니다. 같은 사람의 서로 다른 문의일 수 있으므로 연결건을 고유 환자수로 해석하지 않습니다. 원본과의 연결표는 병원에서 별도로 관리하세요.</p></details><div id="conversion-campaign-ids" class="conversion-ids"></div><form id="conversion-upload" class="marketing-form" inert><label>연결자료 파일<input id="conversion-file" type="file" accept=".xlsx,.csv" required></label><label>이 자료에서 확인을 마친 기준일<input name="observed_through" type="date" required></label><p class="full marketing-note">파일에 포함된 연결건의 후속 상태를 확인한 마지막 날짜입니다. 업로드한 오늘 날짜와 구분하며, 이 기준일까지의 기록이 포함됐는지 확인하세요.</p><div class="full"><button class="button primary" type="submit">반영 전 미리보기</button></div></form><div id="conversion-preview" hidden></div></article><article class="panel marketing-section"><h3>업로드 이력</h3><div id="conversion-history" class="table-scroll"></div><form id="conversion-rollback" class="marketing-form"><label>최근 반영을 되돌리는 사유<input name="reason" maxlength="300" required></label><label class="conversion-check"><input name="confirmed" type="checkbox" required>최근 활성 업로드의 반영을 되돌립니다.</label><div class="full"><button class="button secondary" type="submit">최근 업로드 되돌리기</button></div></form></article>`;
  document.querySelector('.main-footer').before(section);
  const form=$('conversion-period');form.elements.start.value=today().slice(0,7)+'-01';form.elements.end.value=today();
  $('conversion-upload').elements.observed_through.max=today();
  function note(message,error=false){$('conversion-message').textContent=message;$('conversion-message').hidden=!message;$('conversion-message').classList.toggle('error',error);}
  async function api(path,data){const response=await apiFetch(path,{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'dday'},body:JSON.stringify(data)}:{})});const body=await response.json();if(!response.ok)throw Error(body.error||'연결자료를 확인하지 못했습니다.');return body;}
  function resetPreview(){preview=null;$('conversion-preview').replaceChildren();$('conversion-preview').hidden=true;}
  function render(result){
    const m=result.totals,observed=key=>result.has_data?num(m[key])+'건':'—';
    $('conversion-checked').textContent='확인 '+new Date(result.checked_at).toLocaleString('ko-KR',{hour12:false});
    $('conversion-coverage').textContent=`문의 시작 ${result.period.start} ~ ${result.period.end} · ${result.window_days}일 관측 · 자료 확인 기준일 ${result.observed_through||'없음'} · 관측 완료 ${num(result.complete_cases)}건 / 미완료 ${num(result.incomplete_cases)}건`;
    $('conversion-summary').innerHTML=[['문의 연결건',observed('inquiry')],['예약 확인',observed('booking')],['내원 확인',observed('attendance')],['상담 확인',observed('consultation')],['치료 확인',observed('treatment')],['문의기간 장부 순집행비',won(m.net_spend)],['관측기간 기록 수납 − 환불',m.net_collections===null?'—':won(m.net_collections)],['관측 내원 연결건당 비용',m.cost_per_linked_attendance===null?'—':won(m.cost_per_linked_attendance)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('conversion-campaigns').innerHTML=table(result.campaigns,[{key:'title',label:'캠페인'},{key:'inquiry',label:'문의',render:num},{key:'booking',label:'예약',render:num},{key:'attendance',label:'내원',render:num},{key:'attendance_rate',label:'관측 내원율',render:v=>v===null?'—':num(v)+'%'},{key:'incomplete_cases',label:'관측 미완료',render:num},{key:'net_spend',label:'장부 순집행비',render:won},{key:'net_collections',label:'기록 수납 − 환불',render:v=>v===null?'—':won(v)}]);
    $('conversion-warnings').innerHTML=result.warnings.map(w=>`<p>${esc(w)}</p>`).join('');
    $('conversion-actions').innerHTML=result.suggestions.map(s=>`<div class="conversion-action"><strong>${esc(s.reason)}</strong><p>${esc(s.action)}</p></div>`).join('')||empty('현재 자료에서 추가 확인 항목이 없습니다. 자료가 없을 때는 양식에 맞는 연결자료를 먼저 올려 주세요.');
  }
  async function load(){
    const seq=++request,query=new URLSearchParams(Object.fromEntries(new FormData(form)));
    try{
      let status,workspace,result,consistent=false;
      for(let attempt=0;attempt<3;attempt++){
        [status,workspace,result]=await Promise.all([api('/api/conversions'),api('/api/workspace'),api('/api/conversions/report?'+query)]);
        if(seq!==request)return;
        if(status.revision===result.revision&&workspace.revision===result.workspace_revision){consistent=true;break;}
      }
      if(!consistent)throw Error('조회 중 자료가 변경됐습니다. 다시 확인해 주세요.');
      if(ledger?.revision!==status.revision){$('conversion-rollback').elements.confirmed.checked=false;rollbackRevision=null;}
      ledger=status;render(result);
      $('conversion-history').innerHTML=table(status.batches,[{key:'created_at',label:'반영 시각',render:v=>esc(new Date(v).toLocaleString('ko-KR'))},{key:'observed_through',label:'자료 확인 기준일'},{key:'inserted',label:'추가 이벤트',render:num},{key:'skipped',label:'기존 중복 제외',render:num},{key:'voided',label:'반영 상태',render:v=>v?'되돌림':'반영 중'},{key:'void_reason',label:'되돌림 사유'}]);
      $('conversion-campaign-ids').innerHTML=workspace.campaigns.length?'<h4>연결 자료용 캠페인 ID</h4>'+workspace.campaigns.map(c=>`<p><strong>${esc(c.title)}</strong><code>${c.id}</code></p>`).join(''):empty('캠페인 · 집행비에서 먼저 캠페인을 등록하세요.');
      $('conversion-upload').inert=false;$('conversion-rollback').querySelector('button').disabled=!status.batches.some(b=>!b.voided);
    }catch(e){if(seq!==request)return;ledger=null;rollbackRevision=null;$('conversion-rollback').elements.confirmed.checked=false;$('conversion-upload').inert=true;$('conversion-checked').textContent='이번 확인에 실패했습니다.';$('conversion-summary').replaceChildren();$('conversion-campaigns').replaceChildren();$('conversion-actions').replaceChildren();$('conversion-history').innerHTML=empty('최신 이력을 확인하지 못했습니다.');$('conversion-campaign-ids').replaceChildren();$('conversion-coverage').textContent='';$('conversion-warnings').textContent='';note(e.message,true);}
  }
  async function run(task){if(busy)return;busy=true;section.inert=true;try{await task();}catch(e){note(e.message,true);}finally{busy=false;section.inert=false;}}
  form.addEventListener('submit',event=>{event.preventDefault();run(load);});
  $('conversion-refresh').addEventListener('click',()=>run(load));
  $('conversion-upload').addEventListener('change',resetPreview);
  $('conversion-upload').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    const file=$('conversion-file').files[0];if(!file||file.size>5*1024*1024)throw Error('5MB 이하의 XLSX 또는 CSV를 선택해 주세요.');
    const upload={filename:file.name,data:bytes64(new Uint8Array(await file.arrayBuffer())),observed_through:event.target.elements.observed_through.value};
    resetPreview();const checked=await api('/api/conversions/preview',upload);preview={...checked,upload};
    $('conversion-preview').innerHTML=`<div class="marketing-evidence"><h4>반영 전 확인</h4><dl><div><dt>이벤트</dt><dd>${num(checked.rows)}개</dd></div><div><dt>추가</dt><dd>${num(checked.inserted)}개</dd></div><div><dt>기존 중복 제외</dt><dd>${num(checked.skipped)}개</dd></div></dl><p>연결키 ${num(checked.cases)}개 · 발생일 ${esc(checked.first_event)} ~ ${esc(checked.last_event)}<br>자료 확인 기준일 ${esc(checked.observed_through)}</p><p>${Object.entries(checked.stages).filter(([,v])=>v).map(([k,v])=>`${esc(k)} ${num(v)}건`).join(' · ')}</p><label class="conversion-check"><input id="conversion-confirm" type="checkbox">자료 출처·연결키·기준일을 확인했습니다.</label><button id="conversion-commit" class="button primary">연결자료 반영</button></div>`;$('conversion-preview').hidden=false;note('개별 연결키를 화면에 펼치지 않고 건수와 기간을 확인합니다.');
  });});
  $('conversion-preview').addEventListener('click',event=>{if(event.target.id!=='conversion-commit')return;run(async()=>{
    if(!preview||!$('conversion-confirm').checked)throw Error('미리보기를 확인하고 확인란을 선택해 주세요.');
    const current=preview;const saved=await api('/api/conversions/commit',{...current.upload,revision:current.revision,workspace_revision:current.workspace_revision,sha256:current.sha256,confirmed:true});
    resetPreview();$('conversion-upload').reset();await load();note(saved.duplicate?'같은 파일과 기준일이 이미 반영돼 있어 중복 저장하지 않았습니다.':`새 이벤트 ${num(saved.inserted)}개를 반영했습니다. 기존 중복 ${num(saved.skipped)}개는 제외했습니다.`);
  });});
  $('conversion-rollback').elements.confirmed.addEventListener('change',event=>{rollbackRevision=event.target.checked?ledger?.revision??null:null;});
  $('conversion-rollback').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    if(!ledger||rollbackRevision===null||rollbackRevision!==ledger.revision)throw Error('현재 업로드 이력을 확인하고 확인란을 다시 선택해 주세요.');
    await api('/api/conversions/rollback',{revision:rollbackRevision,reason:event.target.elements.reason.value,confirmed:event.target.elements.confirmed.checked});
    event.target.reset();resetPreview();await load();note('최근 업로드 반영을 되돌렸습니다. 이력과 사유는 보관합니다.');
  });});
  $('conversion-template').addEventListener('click',()=>run(async()=>{
    const response=await apiFetch('/api/conversions/template');if(!response.ok)throw Error('양식을 읽지 못했습니다.');
    const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='문의내원_연결자료_양식.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }));
  function activate(){if(location.hash==='#conversions')load();}
  window.addEventListener('hashchange',activate);window.addEventListener('pageshow',event=>{if(event.persisted)activate();});activate();return {refresh:activate};
}
