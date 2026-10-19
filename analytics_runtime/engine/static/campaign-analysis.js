import {esc,num,won,table} from './charts.js';

const statuses={observed:'관측 기록 있음',no_matched_visits:'연결된 지역 내원 0명',unobserved:'집행기간 미관측',suppressed:'소수 집계 비공개',partial:'부분기간 관측'};
const campaignStatuses={planned:'기획',approved:'검토 완료',running:'진행 중',paused:'보류',completed:'종료',cancelled:'취소'};
const moneyKey=k=>['treatment_total','collection_recorded'].includes(k);
const precise=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n);
const stamp=v=>v?new Date(v).toLocaleString('ko-KR',{hour12:false}):'—';
const cell=value=>{let s=String(value??'—');if(/^\s*[=+@\-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};

export function campaignCSV(d){
  const rows=[['병원',d.clinic],['캠페인',d.campaign.title],['집계 확인',d.checked_at],['EMR 마지막 접수일',d.source_last_record],['장부 버전',d.workspace_revision],
    ['기준','시작','종료','일수'],['집행기간',d.period.start,d.period.end,d.period.days],['비교기간',d.comparison_period.start,d.comparison_period.end,d.comparison_period.days],
    ['비교 기준',d.baseline==='year'?'전년 같은 기간':'직전 동일 일수'],['집행기간 자료 부족',d.coverage.current_incomplete?'예':'아니오'],['비교기간 자료 부족',d.coverage.previous_incomplete?'예':'아니오'],
    ['주소 연결률 · 전체 병원',d.coverage.previous.percent,d.coverage.current.percent],[],['지역 역할','지역','지표','비교기간','집행기간','차이','증감률 %','비교기간 상태','집행기간 상태']];
  for(const r of d.regions)for(const [key,label] of Object.entries(d.metric_labels))rows.push([r.role==='target'?'대상':'참고',r.name,label,r.previous[key],r.current[key],r.delta[key],r.percent[key],statuses[r.previous_status],statuses[r.current_status]]);
  rows.push([],['비용 범위',d.costs.scope],['거래 기록 수',d.costs.entry_count],['계획 예산',d.costs.planned_budget],['기록된 지출',d.costs.has_records?d.costs.charges:null],['기록된 환불',d.costs.has_records?d.costs.refunds:null],['기록된 순집행비',d.costs.has_records?d.costs.net_spend:null],['비용 참고',d.costs.note]);
  for(const r of d.regions)for(const side of ['previous','current'])for(const [key,complete] of Object.entries(r.money_complete[side]))rows.push(['금액 누락 확인',r.name,side==='current'?'집행기간':'비교기간',d.metric_labels[key],complete===null?'확인 불가':complete?'해당 금액 칸 모두 기록':'누락 또는 내원 기록 없음']);
  rows.push([],['해석 한계'],...d.limitations.map(x=>[x]));
  return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

export function renderAnalysis(d,{captured=false}={}){
  const ranges=`<div class="campaign-periods"><p><strong>비교기간</strong>${esc(d.comparison_period.start)} ~ ${esc(d.comparison_period.end)} · ${d.comparison_period.days}일</p><p><strong>집행기간</strong>${esc(d.period.start)} ~ ${esc(d.period.end)} · ${d.period.days}일</p></div>`;
  const regions=d.regions.map(r=>{
    const rows=Object.entries(d.metric_labels).map(([key,label])=>({key,label,previous:r.previous[key],current:r.current[key],delta:r.delta[key],percent:r.percent[key]}));
    const value=(n,row)=>n===null?'—':moneyKey(row.key)?precise(n)+'원':precise(n);
    return `<section class="campaign-region-result"><h4>${r.role==='target'?'대상 지역':'참고 지역'} · ${esc(r.name)}</h4><p class="marketing-note">비교기간: ${esc(statuses[r.previous_status].replace('집행기간 ','해당 기간 '))} / 집행기간: ${esc(statuses[r.current_status])}</p>${table(rows,[{key:'label',label:'지표'},{key:'previous',label:'비교기간',render:value},{key:'current',label:'집행기간',render:value},{key:'delta',label:'차이',render:value},{key:'percent',label:'증감률',render:n=>n===null?'비교 불가':precise(n)+'%'}])}<p class="marketing-note">${['previous','current'].map(side=>`${side==='current'?'집행기간':'비교기간'} 금액: ${Object.entries(r.money_complete[side]).map(([key,complete])=>`${moneyKey(key)&&key==='treatment_total'?'총진료비':'수납액'} ${complete===null?'확인 불가':complete?'칸 누락 없음':'누락 또는 내원 기록 없음'}`).join(' · ')}`).map(esc).join('<br>')}</p></section>`;
  }).join('');
  return `<h3>${esc(d.campaign.title)}</h3><p class="marketing-note">저장된 캠페인 기준 · ${captured?'생성 당시':'현재'} 업무 상태 ${esc(campaignStatuses[d.campaign.status]||d.campaign.status)}<br>연결 전략: ${esc(d.target.strategy_title)}${d.target.strategy_source==='parent_campaign'?' · 상위 캠페인에서 이어받음':''}</p>${ranges}${!d.equal_days?'<p class="campaign-analysis-warning">윤일 등으로 두 기간의 일수가 다릅니다. 증감은 계산하지 않습니다.</p>':''}${d.coverage.current_incomplete||d.coverage.previous_incomplete?'<p class="campaign-analysis-warning">자료 범위가 부족한 기간이 있어 증감을 계산하지 않습니다. 마지막 접수일과 비교기간을 확인해 주세요.</p>':''}${regions}<div class="campaign-analysis-cost"><h4>집행기간 내 거래 기록</h4><p>${esc(d.costs.scope)} · ${num(d.costs.entry_count)}건</p><dl>${[['기록된 지출',d.costs.charges],['기록된 환불',d.costs.refunds],['기록된 순집행비',d.costs.net_spend]].map(([label,v])=>`<div><dt>${esc(label)}</dt><dd>${d.costs.has_records?won(v):'—'}</dd></div>`).join('')}</dl>${!d.costs.has_records?'<p>해당 기간 거래 기록 없음 · 실제 비용 0원으로 확정하지 않습니다.</p>':''}<p class="marketing-note">${esc(d.costs.note)} 계획 예산 ${won(d.costs.planned_budget)}은 집행비와 별도입니다.</p></div><p class="marketing-note">병원 전체 주소 연결률 · 비교기간 ${d.coverage.previous.percent===null?'확인 불가':num(d.coverage.previous.percent)+'%'} / 집행기간 ${d.coverage.current.percent===null?'확인 불가':num(d.coverage.current.percent)+'%'}<br>EMR 마지막 접수일 ${esc(d.source_last_record)} · 원본 확인 ${esc(stamp(d.source_checked_at))}<br>장부 버전 ${d.workspace_revision} · 계산 ${esc(stamp(d.checked_at))}</p><details><summary>비교 해석 기준</summary><ul>${d.limitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`;
}

export function initCampaignAnalysis({api,getNames}){
  let workspace=null,regionNames=null,sequence=0,result=null,active=false;
  const section=document.createElement('article');section.className='panel marketing-section campaign-analysis';section.id='campaign-analysis';
  section.innerHTML=`<div class="panel-heading"><div><h3>캠페인 지역 변화 비교</h3><p class="marketing-note">저장된 집행기간과 연결 전략의 지역을 비교합니다. 캠페인 저장 후 다시 확인하세요.</p></div></div><form id="campaign-analysis-form" class="marketing-form"><label>저장된 캠페인<select name="campaign_id" required><option value="">캠페인 선택</option></select></label><label>비교 기준<select name="baseline"><option value="previous">직전 동일 일수</option><option value="year">전년 같은 기간</option></select></label><label class="full">참고 지역 · 선택사항<input name="reference_name" list="campaign-analysis-regions" placeholder="대상과 다른 같은 지도 단위의 지역" autocomplete="off"><datalist id="campaign-analysis-regions"></datalist></label><p id="campaign-analysis-target" class="marketing-note full"></p><div class="full marketing-actions"><button type="submit" class="button primary" id="campaign-analysis-run" disabled>현재 자료로 비교</button><button type="button" class="button secondary" id="campaign-analysis-download" disabled>비교표 CSV</button></div></form><p id="campaign-analysis-message" class="marketing-message" role="status"></p><div id="campaign-analysis-result"></div>`;
  document.getElementById('expense-form').closest('article').before(section);
  const form=section.querySelector('form'),pick=form.elements.campaign_id,baseline=form.elements.baseline,reference=form.elements.reference_name;
  const button=section.querySelector('#campaign-analysis-run'),download=section.querySelector('#campaign-analysis-download'),output=section.querySelector('#campaign-analysis-result'),message=section.querySelector('#campaign-analysis-message'),targetLabel=section.querySelector('#campaign-analysis-target');
  function invalidate(note='조건이 바뀌었습니다. 현재 자료로 다시 비교해 주세요.'){
    ++sequence;active=false;result=null;output.innerHTML='';download.disabled=true;button.disabled=!workspace||!pick.value;message.textContent=note;
  }
  function target(){
    const campaign=workspace?.campaigns.find(c=>c.id===pick.value),parent=workspace?.campaigns.find(c=>c.id===campaign?.parent_id);
    return workspace?.strategies.find(s=>s.id===(campaign?.strategy_id||parent?.strategy_id));
  }
  async function referenceChoices(){
    const token=sequence;
    try{regionNames=await getNames();if(token!==sequence)return;const strategy=target(),options=regionNames[strategy?.region_level]||{};
      section.querySelector('datalist').innerHTML=Object.entries(options).filter(([code])=>code!==strategy?.region_code).map(([code,name])=>`<option value="${esc(name)}"></option>`).join('');
      targetLabel.textContent=strategy?'대상 지역: '+(options[strategy.region_code]||strategy.region_code):'선택 캠페인 또는 상위 캠페인에 지역 전략을 연결해 주세요.';
    }catch(e){if(token===sequence)message.textContent=e.message;}
  }
  async function query(){
    invalidate('자료를 확인하고 있습니다…');const token=sequence;active=true;button.disabled=true;
    try{
      if(!pick.value)throw Error('저장된 캠페인을 선택해 주세요.');
      regionNames=await getNames();if(token!==sequence)return;
      const strategy=target(),name=reference.value.trim();let referenceCode='';
      if(name){referenceCode=Object.entries(regionNames[strategy?.region_level]||{}).find(([code,label])=>label===name||code===name)?.[0]||'';if(!referenceCode)throw Error('목록의 전체 지역명을 선택해 주세요.');}
      const params=new URLSearchParams({campaign_id:pick.value,baseline:baseline.value,reference_code:referenceCode});
      const data=await api('/api/campaign-analysis?'+params);if(token!==sequence)return;
      result=data;output.innerHTML=renderAnalysis(data);download.disabled=false;message.textContent='현재 원본과 저장된 캠페인으로 비교했습니다. 환자 변화는 관측 결과입니다.';
    }catch(e){if(token===sequence){result=null;output.innerHTML='';download.disabled=true;message.textContent=e.message;}}
    finally{if(token===sequence){active=false;button.disabled=!workspace||!pick.value;}}
  }
  pick.addEventListener('change',()=>{reference.value='';invalidate();referenceChoices();});
  baseline.addEventListener('change',()=>invalidate());reference.addEventListener('input',()=>invalidate());
  form.addEventListener('submit',e=>{e.preventDefault();query();});
  download.addEventListener('click',()=>{if(!result)return;const url=URL.createObjectURL(new Blob([campaignCSV(result)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`캠페인_지역비교_${result.period.start}_${result.period.end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  window.addEventListener('hashchange',()=>{if(location.hash!=='#campaigns')invalidate('캠페인 화면을 열면 자료를 다시 확인합니다.');});
  for(const event of ['session-required','identity-changed'])document.addEventListener(event,()=>{workspace=null;invalidate('로그인과 병원 권한을 다시 확인해 주세요.');});
  return {
    updateWorkspace(next){const changed=workspace?.revision!==next.revision||workspace?.clinic_id!==next.clinic_id;workspace=next;const selected=pick.value;pick.innerHTML='<option value="">캠페인 선택</option>'+next.campaigns.map(c=>`<option value="${esc(c.id)}">${c.parent_id?'↳ ':''}${esc(c.title)}</option>`).join('');pick.value=selected;if(changed)invalidate(next.campaigns.length?'저장된 캠페인을 선택하고 비교해 주세요.':'등록된 캠페인이 없습니다. 지역 전략에서 캠페인을 연결해 시작하세요.');button.disabled=!pick.value;referenceChoices();},
    selectCampaign(id){pick.value=id||'';reference.value='';invalidate(id?'현재 자료로 비교해 주세요.':'저장된 캠페인을 선택해 주세요.');referenceChoices();},
    onShow(){if(pick.value&&!active)query();},
    unavailable(note){workspace=null;invalidate(note);},
  };
}
