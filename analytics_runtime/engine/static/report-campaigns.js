import {esc,empty} from './charts.js';
import {renderAnalysis} from './campaign-analysis.js';

export function reportCampaigns(section){
  const head='<section class="report-campaign-comparisons"><h4>캠페인별 지역 관측 비교</h4>';
  if(!section)return head+empty('당시 미수집: 이 보고서에는 캠페인 지역 비교를 포함하지 않았습니다.')+'</section>';
  if(!section.items.length)return head+empty('보고서 생성 시 지역 비교 캠페인을 선택하지 않았습니다.')+'</section>';
  return head+`<ul class="marketing-note">${section.limitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`+section.items.map(d=>`<article class="campaign-analysis report-campaign-item"><p class="marketing-note">저장된 전체 집행기간 ${esc(d.campaign.start)} ~ ${esc(d.campaign.end)}<br>아래 집행기간은 보고월 안의 관측기간입니다.</p>${d.privacy_note?`<p class="campaign-analysis-warning">${esc(d.privacy_note)}</p>`:''}${renderAnalysis(d,{captured:true})}</article>`).join('')+'</section>';
}

export function initReportCampaigns(form){
  let workspace=null,selectedIds=new Set();
  const box=document.createElement('fieldset');box.className='report-campaign-picker';
  box.innerHTML='<legend>보고서에 담을 지역 비교 · 선택사항</legend><p class="marketing-note">보고월과 겹치는 캠페인을 최대 8개 선택하세요. 상위를 선택하면 하위 비용을 포함합니다. 관측기간은 보고월 안의 집행일이며 직전 동일 일수와 비교합니다.</p><div id="report-campaign-choices"></div><p id="report-campaign-selection-note" class="marketing-note" role="status"></p>';
  form.querySelector('button[type=submit]').before(box);
  const choices=box.querySelector('#report-campaign-choices'),note=box.querySelector('[role=status]');
  const month=()=>form.elements.month.value;
  const overlaps=c=>/^\d{4}-\d{2}$/.test(month())&&c.start.slice(0,7)<=month()&&c.end.slice(0,7)>=month();
  function strategy(c){const parent=workspace?.campaigns.find(p=>p.id===c?.parent_id);return workspace?.strategies.find(s=>s.id===(c?.strategy_id||parent?.strategy_id));}
  function selected(){
    if(!workspace)throw Error('장부를 새로 확인한 후 보고서를 생성해 주세요.');
    const ids=[...selectedIds];if(ids.length>8)throw Error('지역 비교 캠페인은 최대 8개 선택해 주세요.');
    for(const id of ids){const c=workspace.campaigns.find(x=>x.id===id);if(!c||!overlaps(c)||!strategy(c))throw Error('선택한 캠페인의 기간·지역 연결이 바뀌었습니다. 목록에서 해제하고 다시 선택해 주세요.');if(selectedIds.has(c.parent_id))throw Error('상위 캠페인과 그 하위 집행을 함께 선택하지 마세요. 상위를 선택하면 하위 비용을 포함합니다.');}
    return ids;
  }
  function selectionNote(){try{note.textContent=`${selected().length}개 선택 · 생성 당시 집계로 보관합니다.`;}catch(e){note.textContent=e.message;}}
  function refresh(){
    box.disabled=!workspace;if(!workspace){choices.innerHTML=empty('장부를 확인한 후 캠페인을 선택할 수 있습니다.');return;}
    const campaigns=workspace.campaigns.filter(c=>overlaps(c)||selectedIds.has(c.id));
    for(const id of selectedIds)if(!campaigns.some(c=>c.id===id))campaigns.push({id,title:'현재 장부에서 확인되지 않는 선택',missing:true});
    choices.innerHTML=campaigns.map(c=>{const s=strategy(c),eligible=!c.missing&&overlaps(c)&&!!s,checked=selectedIds.has(c.id);return `<label><input type="checkbox" value="${esc(c.id)}" ${checked?'checked':''} ${!eligible&&!checked?'disabled':''}><span><strong>${c.parent_id?'↳ ':''}${esc(c.title)}</strong><small>${c.missing?'선택 해제 필요':esc(c.start+' ~ '+c.end)} · ${eligible?esc(s.title):'기간·지역 전략 연결 확인 필요'}</small></span></label>`;}).join('')||empty('선택한 보고월과 겹치는 캠페인이 없습니다.');selectionNote();
  }
  choices.addEventListener('change',event=>{const input=event.target;if(input.matches('input[type=checkbox]')){if(input.checked)selectedIds.add(input.value);else selectedIds.delete(input.value);selectionNote();}});
  form.elements.month.addEventListener('input',()=>{selectedIds.clear();refresh();});
  for(const event of ['session-required','identity-changed'])document.addEventListener(event,()=>{workspace=null;selectedIds.clear();refresh();note.textContent='로그인과 병원 권한을 다시 확인해 주세요.';});
  return {selected,refresh,update(next){if(workspace&&workspace.clinic_id!==next.clinic_id)selectedIds.clear();workspace=next;refresh();},unavailable(){workspace=null;refresh();note.textContent='장부를 새로 확인해 주세요.';}};
}
