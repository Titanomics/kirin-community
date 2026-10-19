import {esc,num,won} from './charts.js';
import {marketEvidence} from './regional-research.js';

const $=id=>document.getElementById(id);
const stamp=value=>new Date(value).toLocaleString('ko-KR',{hour12:false});
const channelNames={naver_place:'네이버 플레이스',naver_blog:'네이버 블로그',naver_search:'네이버 검색광고',meta:'META',community:'지역 커뮤니티',offline:'오프라인',other:'기타'};
const list=items=>`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
const citations=items=>items.map(x=>`[${x}]`).join(' ');

function sourceMarkup(source){
  const d=source.data;
  let body='';
  if(source.kind==='emr_aggregate'){
    const rows=[['지역',d.region_name],['조회기간',`${d.period.start} ~ ${d.period.end}`],['고유환자',num(d.metrics.patients)+'명'],['신규 환자군',num(d.metrics.new_patients)+'명'],['내원 횟수',num(d.metrics.visits)+'회'],['평균 내원 횟수',num(d.metrics.average_visits)],['총진료비 · 대사 전',won(d.metrics.treatment_total)],['기록된 수납액 · 대사 전',won(d.metrics.collection_recorded)],['비교기간',`${d.comparison_period.start} ~ ${d.comparison_period.end}`],['고유환자 증감',d.changes.patients===null?'비교 불가':d.changes.patients+'%'],['신규 환자군 증감',d.changes.new_patients===null?'비교 불가':d.changes.new_patients+'%'],['주소 연결률',d.address_match_percent===null?'확인 불가':d.address_match_percent+'%']];
    body=`<dl class="strategy-ai-metrics">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p>마지막 접수일 ${esc(d.source_last_record)}${d.coverage_warning?' · 조회기간 일부 미관측':''}${d.comparison_coverage_warning?' · 비교기간 자료 부족':''}</p><p>연령 분포: ${(d.demographics.age||[]).map(a=>`${esc(a.label)} ${a.value===null?'비공개':num(a.value)+'명'}`).join(' · ')||'확인 가능한 집계 없음'}</p>`;
  }else if(source.kind==='population')body=`<p>주민등록 인구 ${num(d.population)}명 · 기준 ${esc(d.as_of)}${d.complete===false?' · 일부 동 누락':''}</p>`;
  else if(source.kind==='competitors')body=`<p>공개 치과 ${num(d.count)}곳 · 수집일 ${esc(d.collected_at.join(', '))} · 공개자료 전체 중 지역 미연결 ${num(d.unmatched)}건</p>`;
  else if(source.kind==='market_context')body=marketEvidence(d);
  else body=`<p>${esc(d.excerpt)}</p><small>v${d.version} · ${esc(d.source_label)} · 확인 ${esc(d.source_date)}${d.truncated?' · 일부 발췌':''}</small>${d.source_url?`<p><a href="${esc(d.source_url)}" target="_blank" rel="noopener noreferrer">병원 자료 출처</a></p>`:''}`;
  return `<section class="strategy-ai-source"><h5>[${source.citation}] ${esc(source.title)}</h5>${body}</section>`;
}

export function initStrategyAI({form,api,readInputs,readPlanning,onSaved,notice,withEditingLocked}){
  let preview=null,generated=null,sequence=0,busy=false;
  const root=document.createElement('section');root.className='strategy-ai full';root.id='strategy-ai';
  root.innerHTML=`<div class="panel-heading"><div><h4>지역 근거로 AI 전략 검토</h4><p class="marketing-note">선택 지역·기간과 체크한 승인 병원 자료를 사용합니다. 주력 진료 입력은 검토할 관심 주제로 전달됩니다.</p></div><button class="button secondary" type="button" id="strategy-ai-preview">AI 전송 근거 확인</button></div><p class="marketing-note">지역을 지도에서 선택하거나 위 지역명을 입력한 뒤 시작하세요. 원본 환자 행은 전송하지 않습니다.</p><p id="strategy-ai-message" role="status" class="marketing-message" hidden></p><div id="strategy-ai-packet" hidden><p id="strategy-ai-summary" class="marketing-note"></p><div id="strategy-ai-sources"></div><details><summary>전송할 내용 전체 확인</summary><pre id="strategy-ai-prompt" class="bundle-pre"></pre></details><details><summary>전략에 적용할 자료 한계</summary><div id="strategy-ai-limits"></div></details><label class="bundle-consent"><input type="checkbox" id="strategy-ai-consent"> 위 집계·병원 자료와 관심 주제에 개인정보가 없음을 확인했고 Claude 구독으로 전달합니다.</label><button type="button" class="button primary" id="strategy-ai-generate" disabled>Claude 전략 후보 작성</button></div><div id="strategy-ai-results" hidden></div><div id="strategy-ai-origin" hidden></div>`;
  form.querySelector('.marketing-actions').before(root);
  function message(value,error=false){const target=$('strategy-ai-message');target.textContent=value;target.hidden=!value;target.classList.toggle('error',error);}
  function controls(){
    $('strategy-ai-preview').disabled=busy;
    $('strategy-ai-generate').disabled=busy||!preview?.can_generate||!$('strategy-ai-consent').checked;
    root.querySelectorAll('[data-ai-adopt]').forEach(button=>button.disabled=busy);
  }
  function invalidate(){sequence++;preview=null;generated=null;$('strategy-ai-consent').checked=false;$('strategy-ai-packet').hidden=true;$('strategy-ai-results').hidden=true;controls();}
  function reset(item={}){
    invalidate();message('');const origin=item.ai_origin,target=$('strategy-ai-origin');target.hidden=!origin;
    target.innerHTML=origin?`<details><summary>저장 당시 AI 제안·출처 보기</summary><p>응답 모델 ${esc(origin.model)} · 작성 ${esc(stamp(origin.generated_at))}</p><p class="marketing-note">아래는 생성 당시 제안입니다. 담당자가 수정한 현재 전략은 위 입력란에 표시됩니다.</p><h5>${esc(origin.proposal.title)}</h5><p>${esc(origin.proposal.rationale)} <strong>${esc(citations(origin.proposal.citations))}</strong></p><p>대상 가설: ${esc(origin.proposal.audience)}<br>키워드 후보: ${esc(origin.proposal.keywords.join(', '))}<br>채널 후보: ${esc(channelNames[origin.proposal.channel])}</p>${list(origin.proposal.actions)}${origin.sources.map(sourceMarkup).join('')}<h5>추가 확인</h5>${list(origin.missing)}${list(origin.limitations)}</details>`:'';
  }
  form.addEventListener('input',event=>{
    if(root.contains(event.target))return;
    if(['region_name','region_level','evidence_start','evidence_end','focus','strategy_knowledge'].includes(event.target.name)){invalidate();message('조건이 바뀌었습니다. 전송 근거를 다시 확인해 주세요.');}
  });
  form.addEventListener('change',event=>{
    if(['region_level','strategy_knowledge'].includes(event.target.name)){invalidate();message('연결 근거가 바뀌었습니다. 다시 확인해 주세요.');}
  });
  $('strategy-ai-consent').addEventListener('change',controls);
  $('strategy-ai-preview').addEventListener('click',async()=>{
    if(busy)return;invalidate();const request=sequence;busy=true;controls();message('선택한 지역과 승인 자료를 다시 집계하고 있습니다.');
    try{
      const inputs=await readInputs();if(request!==sequence)return;
      const result=await api('/api/strategy-ai/preview',{inputs});if(request!==sequence)return;
      preview=result;$('strategy-ai-packet').hidden=false;$('strategy-ai-sources').innerHTML=result.sources.map(sourceMarkup).join('');$('strategy-ai-prompt').textContent=result.prompt;$('strategy-ai-limits').innerHTML=list(result.limitations);
      $('strategy-ai-summary').textContent=`확인 ${stamp(result.checked_at)} · 마지막 접수일 ${result.evidence.source_last_record} · ${result.source_age_days}일 경과. ${result.can_generate?'과거 관측 자료를 활용한 검증 전 전략입니다.':result.block_reason}`;
      message(result.can_generate?'전송 내용을 확인한 뒤 전략 후보를 작성하세요.':result.block_reason,!result.can_generate);
    }catch(e){if(request===sequence)message(e.message,true);}finally{busy=false;controls();}
  });
  $('strategy-ai-generate').addEventListener('click',async()=>{
    if(busy||!preview?.can_generate||!$('strategy-ai-consent').checked)return;
    const request=sequence,input={inputs:preview.inputs,digest:preview.digest,confirmed:true};busy=true;controls();generated=null;$('strategy-ai-results').hidden=true;message('Claude가 지역 근거를 바탕으로 검토할 전략 후보를 작성하고 있습니다.');
    try{
      const result=await api('/api/strategy-ai/generate',input);if(request!==sequence)return;
      generated=result;const target=$('strategy-ai-results');target.hidden=false;
      target.innerHTML=`<h4>검증 전 전략 후보</h4><p class="marketing-note">응답 모델 ${esc(result.model)} · 작성 ${esc(stamp(result.generated_at))}<br>저장할 후보를 고르세요. 위 집행기간·담당자·계획 예산으로 새 전략 초안을 만들며, 기존 전략을 덮어쓰지 않습니다.</p>${result.proposals.map((p,i)=>`<article class="strategy-ai-proposal"><h5>${i+1}. ${esc(p.title)}</h5><p><strong>대상 가설</strong> ${esc(p.audience)}</p><p><strong>키워드 후보</strong> ${esc(p.keywords.join(', '))}</p><p><strong>채널 검증 후보</strong> ${esc(channelNames[p.channel])}</p><p>${esc(p.hypothesis)}</p><p><strong>관측과 제안 근거</strong> ${esc(p.rationale)} <strong>${esc(citations(p.citations))}</strong></p><p><strong>검증할 지표</strong> ${esc(p.goal)}</p>${list(p.actions)}<button type="button" class="button secondary" data-ai-adopt="${i}">이 후보를 새 전략 초안으로 저장</button></article>`).join('')}<h5>추가 확인이 필요한 자료</h5>${result.missing.length?list(result.missing):'<p>모델의 추가 제시 없음. 위 자료 한계는 계속 적용됩니다.</p>'}`;
      message('후보의 근거와 가설을 검토해 주세요. 아직 전략 장부에는 저장하지 않았습니다.');
    }catch(e){if(request===sequence){invalidate();message(e.message,true);}}finally{busy=false;controls();}
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-ai-adopt]');if(!button||busy||!generated)return;
    const request=sequence,packet=generated;busy=true;controls();message('선택한 후보를 전략 초안으로 저장하고 있습니다.');
    try{
      await withEditingLocked(async()=>{
        const planning=readPlanning();
        const result=await api('/api/strategy-ai/adopt',{id:packet.id,index:Number(button.dataset.aiAdopt),planning,revision:packet.workspace_revision});
        if(request!==sequence)return;
        await onSaved(result);notice('AI 전략을 초안으로 저장했습니다. 내용을 검토하고 캠페인으로 연결할 수 있습니다.');
      });
    }catch(e){if(request===sequence)message(e.message+' 응답이 끊겼다면 같은 후보를 다시 눌러 저장 결과를 확인할 수 있습니다.',true);}finally{busy=false;controls();}
  });
  return {reset,controls};
}
