import {esc,num,table} from './charts.js';
const $=id=>document.getElementById(id);
const fields={date:'일자',impressions:'노출수',clicks:'클릭수',conversions:'매체 보고 전환수',spend:'매체 보고 광고비'};
const dates={iso:'2026-01-01',dot:'2026.01.01',slash:'2026/01/01'};
const bytes64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};

export function describeMapping(mapping,columns,workspace){
  if(!mapping)return '<p>앱 표준 양식</p>';
  const label=i=>`${i+1}열 · ${columns?.find(c=>c.index===i)?.label||'제목 미기록'}`;
  const campaign=id=>workspace?.campaigns.find(c=>c.id===id)?.title||id;
  const links=mapping.campaign_column===null?[['파일 전체',campaign(mapping.campaign_id)]]:Object.entries(mapping.campaign_bindings).map(([name,id])=>[name,campaign(id)]);
  return `<details class="ad-mapping-summary"><summary>원본 열 연결 기준 · 제목 ${mapping.header_row}행</summary><p>날짜 표기 ${esc(dates[mapping.date_format])} · 쉼표는 세 자리 구분만 허용 · 노출/클릭/광고비는 정수</p>${table(Object.entries(mapping.columns).map(([field,index])=>({field:fields[field],column:label(index)})),[{key:'field',label:'항목'},{key:'column',label:'파일 열'}])}<p>${mapping.campaign_column===null?'파일 전체가 한 캠페인의 일별 합계임을 확인함':esc(label(mapping.campaign_column))+'의 값을 연결'}</p>${table(links.map(([source,target])=>({source,target})),[{key:'source',label:'원본 범위'},{key:'target',label:'병원 캠페인'}])}<p>${mapping.expense_id?'원 지출 ID: '+esc(mapping.expense_id):'지출 장부 미연결'}</p></details>`;
}

export function initAdMapping({upload,file,api,run,resetPreview,getWorkspace}){
  let inspection=null,inspectedFile=null,values=null,version=0;
  file.closest('label').insertAdjacentHTML('beforebegin','<label class="full">파일 읽기 방식<select id="ad-input-mode"><option value="standard">앱 표준 양식</option><option value="mapped">원본 열 직접 연결</option></select></label>');
  file.closest('label').insertAdjacentHTML('afterend',`<fieldset id="ad-mapping" class="full ad-mapping" hidden disabled><legend>원본 열 연결</legend><p>한 행이 캠페인별 하루 합계인 CSV·단일 시트 XLSX를 사용합니다. 표 머리글이나 합계 행을 데이터로 넣지 마세요. 같은 일자·캠페인 행은 합산하지 않습니다.</p><div class="marketing-form"><label>열 제목이 있는 행<input id="ad-header-row" type="number" min="1" max="30" value="1"></label><button id="ad-inspect" type="button" class="button secondary">파일 열 확인</button></div><div id="ad-mapping-fields" hidden></div></fieldset>`);
  const mode=$('ad-input-mode'),root=$('ad-mapping'),area=$('ad-mapping-fields');
  function invalidate(){version++;inspection=null;inspectedFile=null;values=null;area.replaceChildren();area.hidden=true;resetPreview();}
  mode.addEventListener('change',()=>{invalidate();root.hidden=mode.value!=='mapped';root.disabled=root.hidden;});
  file.addEventListener('change',invalidate);$('ad-header-row').addEventListener('input',invalidate);
  const campaignOptions=()=>'<option value="">병원 캠페인 선택</option>'+getWorkspace().campaigns.map(c=>`<option value="${esc(c.id)}">${esc(c.title)} · ${esc(c.start)} ~ ${esc(c.end)}</option>`).join('');
  async function inspect(campaignColumn=null){
    const selected=file.files[0],headerRow=Number($('ad-header-row').value);
    if(!selected||selected.size>5*1024*1024)throw Error('5MB 이하 CSV 또는 XLSX를 선택해 주세요.');
    const request=++version;
    const result=await api('/api/ad-reports/inspect',{filename:selected.name,data:bytes64(new Uint8Array(await selected.arrayBuffer())),header_row:headerRow,campaign_column:campaignColumn});
    if(request!==version||file.files[0]!==selected||mode.value!=='mapped'||Number($('ad-header-row').value)!==headerRow)return null;
    return {result,selected};
  }
  function expenseOptions(){
    const w=getWorkspace(),target=$('ad-fixed-campaign').value,expense=$('ad-mapped-expense'),previous=expense.value;
    expense.innerHTML='<option value="">지출 장부 미연결</option>'+w.expenses.filter(e=>e.campaign_id===target&&e.direction==='charge'&&!e.voided).map(e=>`<option value="${esc(e.id)}">${esc(e.reference||e.id)} · ${num(e.amount)}원</option>`).join('');
    if([...expense.options].some(o=>o.value===previous))expense.value=previous;
  }
  function campaignMode(){
    version++;values=null;resetPreview();$('ad-campaign-bindings').replaceChildren();
    const single=$('ad-source-campaign').value==='';$('ad-single-campaign').hidden=!single;$('ad-multiple-campaign').hidden=single;
    $('ad-single-confirmed').checked=false;$('ad-mapped-expense').value='';
  }
  $('ad-inspect').addEventListener('click',()=>run(async()=>{
    invalidate();const checked=await inspect();if(!checked)return;
    inspection=checked.result;inspectedFile=checked.selected;
    const options='<option value="">열 선택</option>'+inspection.columns.map(c=>`<option value="${c.index}">${c.index+1}열 · ${esc(c.label)}</option>`).join('');
    area.innerHTML=`<p>${num(inspection.row_count)}개 데이터 행 · 선택한 열의 값만 미리보기에 사용합니다.</p><div class="marketing-form">${Object.entries(fields).map(([k,label])=>`<label>${label}<select data-ad-column="${k}">${options}</select></label>`).join('')}<label>문자 날짜 표기<select id="ad-date-format">${Object.entries(dates).map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select></label><label class="full">원본 캠페인 열<select id="ad-source-campaign"><option value="">캠페인 열 없음 · 파일 전체를 한 캠페인에 연결</option>${inspection.columns.map(c=>`<option value="${c.index}">${c.index+1}열 · ${esc(c.label)}</option>`).join('')}</select></label><div id="ad-single-campaign" class="full marketing-form"><label>연결할 병원 캠페인<select id="ad-fixed-campaign">${campaignOptions()}</select></label><label>원 지출 연결 · 선택<select id="ad-mapped-expense"><option value="">지출 장부 미연결</option></select></label><label class="ad-check full"><input id="ad-single-confirmed" type="checkbox">파일 전체가 선택한 한 캠페인의 일별 합계입니다.</label></div><div id="ad-multiple-campaign" class="full" hidden><button id="ad-read-campaigns" type="button" class="button secondary">원본 캠페인 값 확인</button><div id="ad-campaign-bindings" class="marketing-form"></div><p>모든 원본 캠페인을 연결해야 합니다. 지출은 미연결로 가져옵니다.</p></div></div>`;
    area.hidden=false;
    $('ad-source-campaign').addEventListener('change',campaignMode);
    $('ad-fixed-campaign').addEventListener('change',expenseOptions);
    $('ad-read-campaigns').addEventListener('click',()=>run(async()=>{
      values=null;$('ad-campaign-bindings').replaceChildren();resetPreview();
      const selected=Number($('ad-source-campaign').value),checked=await inspect(selected);
      if(!checked||Number($('ad-source-campaign').value)!==selected)return;
      if(checked.result.sha256!==inspection.sha256)throw Error('파일이 바뀌었습니다. 파일 열부터 다시 확인해 주세요.');
      values=checked.result.campaign_values;
      $('ad-campaign-bindings').innerHTML=values.map((value,i)=>`<label>${esc(value)}<select data-ad-binding="${i}">${campaignOptions()}</select></label>`).join('');
    }));
  }));
  function getMapping(){
    if(mode.value==='standard')return null;
    if(!inspection||inspectedFile!==file.files[0])throw Error('현재 파일의 열을 먼저 확인해 주세요.');
    const columns=Object.fromEntries([...area.querySelectorAll('[data-ad-column]')].map(s=>{
      if(s.value==='')throw Error('일자와 수치 항목의 열 연결을 확인해 주세요.');return [s.dataset.adColumn,Number(s.value)];
    }));
    const raw=$('ad-source-campaign').value,single=raw==='';
    if(!single&&!values)throw Error('원본 캠페인 값을 확인하고 병원 캠페인을 연결해 주세요.');
    const bindings=single?{}:Object.fromEntries(values.map((v,i)=>[v,area.querySelector(`[data-ad-binding="${i}"]`).value]));
    return {header_row:inspection.header_row,columns,date_format:$('ad-date-format').value,campaign_column:single?null:Number(raw),campaign_bindings:bindings,campaign_id:single?$('ad-fixed-campaign').value:null,single_campaign_confirmed:single&&$('ad-single-confirmed').checked,expense_id:single?$('ad-mapped-expense').value||null:null};
  }
  return {getMapping,reset:invalidate};
}
