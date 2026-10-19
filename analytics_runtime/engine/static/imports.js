import {esc,num,won,table} from './charts.js';
import {apiFetch as fetch} from './scope.js';
const $=id=>document.getElementById(id);
async function request(path,payload){
  const response=await fetch(path,{method:payload?'POST':'GET',cache:'no-store',headers:payload?{'Content-Type':'application/json','X-Local-App':'dday'}:{},body:payload?JSON.stringify(payload):undefined});
  const data=await response.json();if(!response.ok)throw Error(data.error||'처리하지 못했습니다.');return data;
}
function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('파일을 읽지 못했습니다.'));reader.readAsDataURL(file);});}

export function initImports(onChanged){
  let encoded=null,inspection=null,preview=null,history=null,selection=0,busy=false;
  const workspace=document.createElement('section');workspace.id='import-workspace';workspace.className='import-workspace';workspace.hidden=true;
  workspace.innerHTML=`<article class="panel"><div class="panel-heading"><div><h2>엑셀 업로드</h2><p>보고서 검사 → 변경 내용 확인 → 분석에 반영</p></div><span class="muted"><span data-clinic-label>병원 확인 중</span> · 이 PC에 저장</span></div>
    <p class="panel-footnote">같은 연도·종류의 보고서는 전체를 교체합니다. 해당 연도의 시작일부터 최신일까지 내보낸 파일을 선택해 주세요. 월별 분할 파일을 누적하는 방식은 지원하지 않습니다. 기존 원본 파일은 수정하지 않습니다.</p>
    <form id="import-form"><div class="upload-fields"><label class="upload-file">엑셀 파일 (.xlsx · 최대 25MB)<input id="import-file" type="file" accept=".xlsx" required></label><label>보고서 연도<input id="import-year" type="number" min="2000" max="${new Date().getFullYear()}" required></label><label>보고서 종류<select id="import-kind" required><option value="">파일을 선택해 주세요</option></select></label></div>
    <details id="import-mapping"><summary>열 연결 확인 · 다른 이름의 열 직접 연결</summary><p class="panel-footnote">아래 연결은 파일 형식만 맞춥니다. 다른 EMR의 신환·금액 정의까지 같다는 뜻은 아닙니다.</p><div id="import-columns" class="mapping-grid"></div></details>
    <button id="import-preview-button" class="button primary" type="submit" disabled>검사하고 변경 내용 보기</button></form>
    <p id="import-message" role="status" aria-live="polite"></p><div id="import-preview" hidden></div></article>
    <article class="panel"><div class="panel-heading"><div><h2>업로드 반영 이력</h2><p id="import-checked"></p></div><button id="import-rollback" class="button secondary" disabled>최근 반영 되돌리기</button></div><div id="import-history"></div></article>`;
  $('content').before(workspace);
  function message(text,error=false){$('import-message').textContent=text;$('import-message').className=error?'import-error':'';}
  function invalidate(){preview=null;$('import-preview').hidden=true;}
  function setBusy(value){busy=value;workspace.querySelectorAll('input,select,button').forEach(el=>el.disabled=value);if(!value){$('import-preview-button').disabled=!encoded;$('import-rollback').disabled=!history?.can_rollback;if($('import-commit'))$('import-commit').disabled=!$('import-confirm').checked;}}
  function mapping(){
    invalidate();if(!inspection)return;
    const schema=inspection.schemas[$('import-kind').value];
    $('import-columns').innerHTML=schema?[...schema.required,...schema.optional].map(field=>`<label>${esc(field)}${schema.required.includes(field)?' *':''}<select data-map-field="${esc(field)}"><option value="">${schema.required.includes(field)?'원본 열 선택':'연결하지 않음'}</option>${inspection.columns.map(column=>`<option value="${esc(column.id)}" ${column.label===field?'selected':''}>${esc(column.label)}</option>`).join('')}</select></label>`).join(''):'';
  }
  async function loadHistory(){
    try{history=await request('/api/imports');$('import-checked').textContent=`확인 ${new Date(history.checked_at).toLocaleString('ko-KR')} · 반영 버전 ${history.revision}`;
      $('import-history').innerHTML=history.history.length?table(history.history,[{key:'at',label:'시각',render:v=>new Date(v).toLocaleString('ko-KR')},{key:'file',label:'보고서'},{key:'action',label:'내용',render:v=>v==='import'?'전체 교체·추가':'이전 버전 복원'}]):'<p class="panel-footnote">아직 업로드로 반영한 내역이 없습니다. 기존 연결 파일을 사용하고 있습니다.</p>';
      $('import-rollback').disabled=busy||!history.can_rollback;
    }catch(error){message(error.message,true);}
  }
  $('import-file').addEventListener('change',async()=>{
    const id=++selection;encoded=null;inspection=null;invalidate();$('import-columns').replaceChildren();
    const file=$('import-file').files[0];if(!file){setBusy(false);return;}
    if(!/\.xlsx$/i.test(file.name)||file.size>25*1024*1024){message('.xlsx 파일을 25MB 이하로 선택해 주세요.',true);setBusy(false);return;}
    setBusy(true);message('열 구조를 확인하고 있습니다…');
    try{
      const data=await fileData(file);const result=await request('/api/imports/inspect',{filename:file.name,data});if(id!==selection)return;
      encoded=data;inspection=result;
      $('import-year').value=result.year||'';
      $('import-kind').innerHTML='<option value="">종류 선택</option>'+Object.entries(result.schemas).map(([key,schema])=>`<option value="${key}">${esc(schema.label)}</option>`).join('');
      $('import-kind').value=result.kind||'';mapping();message('보고서 종류·연도·열 연결을 확인한 뒤 검사해 주세요.');
    }catch(error){message(error.message,true);}finally{if(id===selection)setBusy(false);}
  });
  $('import-kind').addEventListener('change',mapping);$('import-year').addEventListener('input',invalidate);$('import-columns').addEventListener('change',invalidate);
  $('import-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!encoded||busy)return;invalidate();setBusy(true);message('기존 자료와 대조하고 있습니다. 파일 크기에 따라 시간이 걸릴 수 있습니다…');
    try{
      const schema=inspection.schemas[$('import-kind').value],columns={};
      for(const select of workspace.querySelectorAll('[data-map-field]')){if(select.value){const column=inspection.columns.find(c=>c.id===select.value);if(column.label!==select.dataset.mapField)columns[select.dataset.mapField]=select.value;}else if(schema.required.includes(select.dataset.mapField))throw Error('필수 열을 모두 연결해 주세요.');else if(inspection.columns.some(c=>c.label===select.dataset.mapField))columns[select.dataset.mapField]=null;}
      preview=await request('/api/imports/preview',{filename:$('import-file').files[0].name,data:encoded,year:Number($('import-year').value),kind:$('import-kind').value,mapping:columns});
      const file=preview.files[0],q=preview.quality;const duplicate=file.action==='duplicate';
      $('import-preview').innerHTML=`<div class="import-summary"><h3>${duplicate?'이미 반영된 내용입니다':file.action==='replace'?'기존 보고서 전체 교체':'새 보고서 추가'}</h3><strong>${esc(file.name)}</strong>${file.records!=null?`<p>접수 기록 ${num(file.previous_records)} → ${num(file.records)}건 · ${esc(file.start)} ~ ${esc(file.end)}</p>`:''}${file.records!=null&&file.records<file.previous_records?'<p class="import-error">기록 수가 줄어듭니다. 일부 기간만 내보낸 파일이 아닌지 확인해 주세요.</p>':''}<p>환자·접수·신환 월별 대조 ${num(q.monthly_passed)} / ${num(q.monthly_checks)} 일치 · 중복 행 ${num(q.duplicate_rows)}건 제외</p><p>총진료비 보고서 간 차이 ${won(q.financial.difference)} · 수납원장 대사 전</p>${q.monthly_checks===0?'<p class="import-error">월별접수환자수 보고서가 없어 원보고서 대조를 하지 못했습니다.</p>':''}${q.monthly_mismatches.length?`<p class="import-error">원보고서와 다른 항목이 ${q.monthly_mismatches.length}개 있습니다. 같은 기간의 관련 보고서를 함께 갱신해 주세요.</p>`:''}<label class="import-confirm"><input type="checkbox" id="import-confirm">선택한 연도·종류의 전체 보고서이며, 위 변경 범위와 대조 결과를 확인했습니다.</label><button id="import-commit" class="button primary" disabled>${duplicate?'중복 확인 완료':'분석에 반영'}</button></div>`;
      $('import-preview').hidden=false;message('검사가 끝났습니다. 아직 분석에는 반영하지 않았습니다.');
      $('import-confirm').addEventListener('change',()=>$('import-commit').disabled=!$('import-confirm').checked);
      $('import-commit').addEventListener('click',async()=>{
        if(!preview||!$('import-confirm').checked||busy)return;setBusy(true);
        try{const result=await request('/api/imports/commit',{id:preview.id,revision:preview.revision,confirmed:true});invalidate();message(result.status==='duplicate'?'중복 파일이므로 집계를 변경하지 않았습니다.':'반영했습니다. 최신 자료로 분석을 다시 계산합니다.');await loadHistory();await onChanged();}
        catch(error){invalidate();message(error.message,true);}finally{setBusy(false);}
      });
    }catch(error){message(error.message,true);}finally{setBusy(false);}
  });
  $('import-rollback').addEventListener('click',async()=>{
    if(!history?.can_rollback||!confirm('가장 최근 업로드 반영을 이전 버전으로 되돌립니다. 계속할까요?'))return;
    setBusy(true);invalidate();try{await request('/api/imports/rollback',{revision:history.revision,confirmed:true});message('이전 버전으로 되돌렸습니다.');await loadHistory();await onChanged();}catch(error){message(error.message,true);}finally{setBusy(false);}
  });
  function show(){workspace.hidden=location.hash!=='#quality';if(!workspace.hidden)loadHistory();}
  window.addEventListener('hashchange',show);show();
}
