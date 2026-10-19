import {esc,empty} from './charts.js';
import {apiFetch} from './scope.js';
const $=id=>document.getElementById(id);
const kinds={knowledge:'병원 자료',contents:'콘텐츠 기획 · 검수',reviews:'리뷰 대응 기록'};
const statuses={draft:'초안',review:'검토 요청',approved:'검토 완료',published:'게시 확인',archived:'보관',needs_review:'근거 재검토 필요',detected:'발견',in_progress:'대응 중',submitted:'플랫폼 접수',resolved:'처리 확인',closed:'종료'};
const categories={treatment:'진료 · 시술',equipment:'장비',hours:'진료시간',location:'위치 · 주차',doctor:'의료진',philosophy:'진료 철학',difference:'차별점',tone:'표현 · 말투',faq:'자주 묻는 질문',other:'기타'};
const formats={blog:'블로그',place:'플레이스',meta:'META',image:'이미지',video:'영상',community:'지역 커뮤니티',other:'기타'};
const opts=items=>Object.entries(items).map(([v,t])=>`<option value="${v}">${esc(t)}</option>`).join('');
const field=(name,label,type='text',attrs='')=>`<label>${label}<input name="${name}" type="${type}" ${attrs}></label>`;
const area=(name,label,max=8000)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}"></textarea></label>`;
const select=(name,label,items)=>`<label>${label}<select name="${name}">${opts(items)}</select></label>`;
const dateToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const localTime=value=>{if(!value)return '';const d=new Date(value),pad=v=>String(v).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const recordSignature=item=>{if(!item)return 'null';const {eligible,effective_status,stale_sources,...record}=item;return JSON.stringify(record);};

export function initKnowledge(){
  let workspace=null,sequence=0,busy=false,searchSequence=0,initialItemOpened=false;
  const bases=new Map(),forms={},sections={};
  const common=`<input name="id" type="hidden">${field('title','제목','text','required maxlength="150"')}${field('owner','담당자','text','maxlength="100"')}`;
  const reviewFields=()=>`${select('status','검토 상태',{draft:statuses.draft,review:statuses.review,approved:statuses.approved,archived:statuses.archived})}${field('reviewer','검토자 기록','text','maxlength="100"')}`;
  const bodies={
    knowledge:`${common}${select('category','분류',categories)}${select('source_type','출처 유형',{website:'홈페이지 · 공개 웹',document:'내부 문서',interview:'인터뷰 · 담당자 확인',manual:'직접 확인 기록'})}${area('body','확인된 병원 정보',12000)}${field('source_label','출처 이름','text','required maxlength="300"')}${field('source_url','출처 링크','url','maxlength="1500"')}${field('source_date','출처 확인일','date','required')}${field('valid_from','유효 시작일','date')}${field('valid_until','유효 종료일','date')}${reviewFields()}${area('notes','확인할 사항',4000)}<p class="full marketing-note">환자 이름·연락처·차트·개별 진료내용은 입력하지 않습니다. 병원 소개와 운영 정보를 확인한 출처와 함께 기록하세요. 검토 완료 후 내용이 바뀌면 초안으로 돌아갑니다.</p>`,
    contents:`${common}${select('format','콘텐츠 형식',formats)}<label>연결 캠페인<select name="campaign_id"><option value="">연결하지 않음</option></select></label>${field('due_date','제작 예정일','date')}${field('reference_url','레퍼런스 링크','url','maxlength="1500"')}${area('reference_structure','레퍼런스 구조 · 우리 병원에 치환할 구성')}<div class="full"><h4>근거로 사용할 병원 자료</h4><div id="content-facts" class="knowledge-choices"></div><p class="marketing-note">검토를 마친 유효한 자료만 연결합니다. 자료가 바뀌거나 만료되면 재검토 대상으로 표시합니다.</p></div><div id="content-source-warning" class="full marketing-message" hidden></div>${area('generation_brief','생성으로 받을 것 · 이미지·영상 자체')}${area('editing_brief','편집으로 처리할 것 · 글자·근거·타이밍')}${area('draft','검토할 문안',16000)}${select('status','업무 상태',{draft:statuses.draft,review:statuses.review,approved:statuses.approved,published:statuses.published,archived:statuses.archived})}${field('reviewer','검토자 기록','text','maxlength="100"')}${field('published_url','게시 확인 링크','url','maxlength="1500"')}${field('published_at','게시 확인일','date')}${area('notes','검수 메모',4000)}<p class="full marketing-note">레퍼런스 구조와 승인 자료를 연결해 기획합니다. 게시 확인은 담당자가 실제 게시 사실을 기록하는 기능입니다. 생성·게시 요청은 실행하지 않습니다.</p>`,
    reviews:`${common}${select('platform','발견 채널',{naver_place:'네이버 플레이스',google:'구글',community:'지역 커뮤니티',other:'기타'})}${field('source_url','리뷰 원문 링크','url','required maxlength="1500"')}${area('summary','쟁점 요약 · 개인 식별정보 제외',4000)}${field('found_at','발견 시각','datetime-local','required')}${field('started_at','대응 시작 시각','datetime-local')}${field('submitted_at','플랫폼 접수 시각','datetime-local')}${field('resolved_at','처리 확인 시각','datetime-local')}${select('status','업무 상태',{detected:statuses.detected,in_progress:statuses.in_progress,submitted:statuses.submitted,resolved:statuses.resolved,closed:statuses.closed})}${select('outcome','현재 표시 상태',{'':'확인 전',still_visible:'계속 표시됨',removed:'표시되지 않음',restored:'다시 표시됨',unconfirmed:'확인 불가'})}${area('reply_draft','응답 검토안')}${area('resolution_note','처리 결과 · 확인한 근거',4000)}${area('notes','담당자 메모',4000)}<p class="full marketing-note">리뷰 발견·접수·결과는 담당자가 기록합니다. 시간은 입력된 시각 간 차이입니다. 자동 감시·답글 전송·삭제 요청을 실행하거나 삭제를 보장하지 않습니다.</p>`
  };
  for(const [kind,title] of Object.entries(kinds)){
    const section=document.createElement('section');section.id='page-'+kind;section.className='page-view marketing-page knowledge-page';section.hidden=true;
    section.innerHTML=`<div class="marketing-topline"><div><h2>${title}</h2><p data-knowledge-checked>자료를 새로 확인합니다.</p></div><button class="button secondary" data-knowledge-refresh>새로 확인</button></div><div class="marketing-message" data-knowledge-message role="status" hidden></div>${kind==='knowledge'?`<article class="panel knowledge-search"><h3>승인 자료 검색</h3><form id="knowledge-search-form" class="marketing-toolbar"><label>병원 자료에서 찾을 내용<input name="query" type="search" maxlength="200" placeholder="예: 진료시간" required></label><button class="button secondary" type="submit">검색</button></form><p class="marketing-note">검토 완료·유효기간 내의 자료에서 입력한 단어를 찾습니다. 검색 결과에 출처를 함께 표시합니다.</p><div id="knowledge-search-results"></div></article>`:''}<div class="marketing-grid"><article class="panel"><div class="panel-heading"><h3>${title} 목록</h3><button class="marketing-small-button" data-knowledge-new="${kind}">새로 작성</button></div><div id="${kind}-list" class="marketing-list"></div></article><article class="panel"><form id="${kind}-form" class="marketing-form">${bodies[kind]}<div class="full marketing-actions"><button class="button primary" type="submit">${title} 저장</button>${kind==='contents'?'<button class="button secondary" type="button" id="content-export">기획서 내려받기</button>':''}</div></form></article></div>`;
    document.querySelector('.main-footer').before(section);sections[kind]=section;forms[kind]=$(kind+'-form');forms[kind].inert=true;
  }
  function note(message,error=false){for(const section of Object.values(sections)){const el=section.querySelector('[data-knowledge-message]');el.textContent=message;el.hidden=!message;el.classList.toggle('error',error);}}
  async function api(path,data){const response=await apiFetch(path,{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'dday'},body:JSON.stringify(data)}:{})});const body=await response.json();if(!response.ok)throw Error(body.error||'자료 확인에 실패했습니다.');return body;}
  function selectedFacts(){return [...$('content-facts').querySelectorAll('input:checked')].map(x=>x.value);}
  function choices(ids=selectedFacts()){
    const form=forms.contents,campaign=form.elements.campaign_id.value;
    form.elements.campaign_id.innerHTML='<option value="">연결하지 않음</option>'+workspace.campaigns.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('');form.elements.campaign_id.value=campaign;
    const facts=workspace.knowledge.filter(f=>f.eligible||ids.includes(f.id));
    $('content-facts').innerHTML=facts.map(f=>`<label><input name="knowledge_ids" type="checkbox" value="${f.id}" ${ids.includes(f.id)?'checked':''}><span>${esc(f.title)} <small>v${f.version} · ${f.eligible?'사용 가능':'자료 검토 필요'} · ${esc(f.source_label)}</small></span></label>`).join('')||empty('먼저 병원 자료를 등록하고 검토해 주세요.');
  }
  function warnings(){const item=workspace.contents.find(x=>x.id===forms.contents.elements.id.value),target=$('content-source-warning');target.textContent=item?.stale_sources?.length?'연결한 자료가 바뀌거나 유효기간이 지났습니다: '+item.stale_sources.join(', '):'';target.hidden=!target.textContent;}
  function render(){
    for(const kind of Object.keys(kinds)){
      $(kind+'-list').innerHTML=workspace[kind].slice().reverse().map(item=>`<button class="marketing-card" data-knowledge-open="${item.id}" data-kind="${kind}"><span class="tag">${esc(statuses[item.effective_status||item.status])}${kind==='knowledge'&&item.status==='approved'&&!item.eligible?' · 유효기간 밖':''}</span><strong>${esc(item.title)}</strong><small>${esc(item.owner||'담당자 미정')}${kind==='knowledge'?' · '+esc(item.source_label)+' · v'+item.version:''}${kind==='reviews'?'<br>첫 대응 '+(item.response_minutes===null?'미기록':esc(item.response_minutes)+'분')+' · 처리 확인 '+(item.resolution_minutes===null?'미기록':esc(item.resolution_minutes)+'분'):''}</small></button>`).join('')||empty('등록된 기록이 없습니다.');
      sections[kind].querySelector('[data-knowledge-checked]').textContent='확인 '+new Date(workspace.checked_at).toLocaleString('ko-KR',{hour12:false});
    }
    choices();warnings();
  }
  async function load(){
    const request=++sequence,next=await api('/api/workspace');if(request!==sequence)return false;
    for(const [kind,base] of bases){const current=next[kind].find(x=>x.id===base.entity?.id)||null;if(recordSignature(current)===recordSignature(base.entity))base.revision=next.revision;}
    workspace=next;render();++searchSequence;
    if($('knowledge-search-results').hasChildNodes())$('knowledge-search-results').textContent='병원 자료를 새로 확인했습니다. 현재 승인 자료를 다시 검색해 주세요.';
    for(const kind of Object.keys(kinds))if(!bases.has(kind))edit(kind);
    return true;
  }
  function edit(kind,item=null,revision=workspace.revision){
    const form=forms[kind];form.reset();form.elements.id.value=item?.id||'';
    for(const input of form.elements){if(!input.name||input.type==='checkbox')continue;const value=item?.[input.name];if(value!=null)input.value=input.type==='datetime-local'?localTime(value):value;}
    if(kind==='knowledge'&&!item)form.elements.source_date.value=dateToday();
    if(kind==='reviews'&&!item)form.elements.found_at.value=localTime(new Date().toISOString());
    if(kind==='contents'){choices(item?.knowledge_ids||[]);form.elements.campaign_id.value=item?.campaign_id||'';}
    bases.set(kind,{revision,entity:item?structuredClone(item):null});form.inert=false;warnings();
  }
  async function run(task){if(busy)return;busy=true;Object.values(sections).forEach(s=>s.inert=true);try{await task();}catch(e){note(e.message,true);}finally{busy=false;Object.values(sections).forEach(s=>s.inert=false);}}
  for(const kind of Object.keys(kinds))forms[kind].addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    const form=forms[kind],data=Object.fromEntries(new FormData(form));if(kind==='contents')data.knowledge_ids=selectedFacts();
    if(kind==='reviews')for(const key of ['found_at','started_at','submitted_at','resolved_at'])data[key]=data[key]?new Date(data[key]).toISOString():'';
    const result=await api('/api/workspace/save',{kind,data,revision:bases.get(kind)?.revision??workspace.revision});
    await load();const current=workspace.revision>=result.revision?workspace[kind].find(x=>x.id===result.entity.id):null;
    edit(kind,current||result.entity,current?workspace.revision:result.revision);note(result.entity.status==='draft'&&data.status!=='draft'?'변경된 내용을 초안으로 저장했습니다. 다시 검토해 주세요.':'저장했습니다.');
  });});
  for(const section of Object.values(sections))section.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    if(button.hasAttribute('data-knowledge-refresh'))run(async()=>{await load();note('자료를 다시 확인했습니다. 작성 중인 입력은 유지합니다.');});
    else if(button.dataset.knowledgeNew)edit(button.dataset.knowledgeNew);
    else if(button.dataset.knowledgeOpen){const kind=button.dataset.kind;edit(kind,workspace[kind].find(x=>x.id===button.dataset.knowledgeOpen));}
  });
  $('knowledge-search-form').addEventListener('submit',async event=>{event.preventDefault();const request=++searchSequence,query=event.target.elements.query.value;
    try{const result=await api('/api/knowledge/search?q='+encodeURIComponent(query));if(request!==searchSequence)return;
      $('knowledge-search-results').innerHTML=`<p class="marketing-note">확인 ${esc(new Date(result.checked_at).toLocaleString('ko-KR'))} · ${result.total}개${result.total>50?' 중 50개 표시':''}</p>`+(result.matches.map(f=>`<article class="knowledge-result"><strong>${esc(f.title)}</strong><p>${esc(f.excerpt)}</p><small>출처 ${esc(f.source_label)} · 확인일 ${esc(f.source_date)} · v${f.version}</small>${f.source_url?`<p><a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer">출처 열기</a></p>`:''}</article>`).join('')||empty('일치하는 승인 자료가 없습니다.'));
    }catch(e){if(request===searchSequence)$('knowledge-search-results').textContent=e.message;}
  });
  $('content-export').addEventListener('click',()=>run(async()=>{
    const id=forms.contents.elements.id.value;if(!id)throw Error('기획을 먼저 저장해 주세요.');
    const response=await apiFetch(`/api/workspace/contents/${id}/html`,{cache:'no-store'});if(!response.ok)throw Error('기획서를 읽지 못했습니다.');
    const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='콘텐츠_기획서.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);note('저장된 기획서와 연결 근거를 내려받았습니다.');
  }));
  async function activate(){const kind=location.hash.slice(1);if(!Object.hasOwn(kinds,kind))return;try{if(!await load())return;if(!initialItemOpened){initialItemOpened=true;const id=new URLSearchParams(location.search).get('item'),item=workspace[kind].find(x=>x.id===id);if(item)edit(kind,item);}}catch(e){note(e.message,true);}}
  window.addEventListener('hashchange',activate);window.addEventListener('pageshow',event=>{if(event.persisted)activate();});activate();
  return {refresh:activate,hasPage:page=>Object.hasOwn(kinds,page)};
}
