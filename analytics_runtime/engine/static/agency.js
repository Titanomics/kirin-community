import {esc,num,won,empty,table} from './charts.js';
import {configureScope,setClinicScope,setOperatorScope,apiFetch} from './scope.js';
const $=id=>document.getElementById(id);
const roles={admin:'관리자',editor:'편집 담당자',viewer:'조회 담당자'};
const field=(name,label,type='text',attrs='')=>`<label>${label}<input name="${name}" type="${type}" ${attrs}></label>`;
const identityFields=()=>`${field('username','아이디','text','required pattern="[a-zA-Z0-9_.-]{3,64}" autocomplete="username"')}${field('name','담당자 이름','text','required maxlength="100"')}${field('password','비밀번호 · 12자 이상','password','required minlength="12" maxlength="256" autocomplete="new-password"')}`;

export function initAgency(){
  let agency=null,auth=null,users=[],busy=false,ready=null,refreshSequence=0,tasks=[];
  const section=document.createElement('section');section.id='page-agency';section.className='page-view marketing-page agency-page';section.hidden=true;
  section.innerHTML=`<div class="marketing-topline"><div><h2>담당 병원 현황</h2><p id="agency-checked">현재 자료를 확인합니다.</p></div><button class="button secondary" id="agency-refresh">전체 병원 새로 확인</button></div><p class="agency-role-note" id="agency-access-note"></p><div id="agency-message" class="marketing-message" role="status" hidden></div><div id="agency-cards" class="agency-cards"></div><div class="agency-layout"><article class="panel" id="agency-create-panel"><h3>병원 작업공간 추가</h3><p class="marketing-note">새 공간은 엑셀·캠페인·보고서를 별도로 보관합니다. 접수수납목록을 먼저 업로드해 분석을 시작하세요.</p><form id="agency-create" class="marketing-form">${field('name','병원명','text','required maxlength="120"')}<label>사용 EMR<select name="emr"><option value="dentweb">덴트웹</option><option value="ysarang">의사랑</option><option value="other">기타·미정</option></select></label>${field('owner','담당자','text','maxlength="100"')}<div class="full"><button type="submit" class="button primary">병원 공간 만들기</button></div></form></article><article class="panel" id="access-setup-panel"><h3>담당자별 접근권한 설정</h3><p class="marketing-note">현재는 이 PC 단독 모드입니다. 관리자를 설정하면 이후에는 로그인해야 하며 병원별로 편집·조회 권한을 지정할 수 있습니다.</p><form id="access-setup" class="marketing-form">${identityFields()}<div class="full"><button type="submit" class="button primary">관리자 설정하고 로그인</button></div></form></article><article class="panel" id="access-users-panel" hidden><div class="panel-heading"><h3>담당자 · 권한</h3><button id="access-user-new" class="marketing-small-button">새 담당자</button></div><div id="access-user-list" class="table-scroll"></div><form id="access-user-form" class="marketing-form"><input name="id" type="hidden"><input name="version" type="hidden">${identityFields()}<label>역할<select name="role"><option value="editor">편집 담당자</option><option value="viewer">조회 담당자</option><option value="admin">관리자</option></select></label><label>계정 상태<select name="active"><option value="true">사용</option><option value="false">비활성</option></select></label><div class="full"><h4>접근할 병원</h4><div id="access-grants" class="agency-grants"></div></div><p class="marketing-note full">관리자는 모든 병원을 관리합니다. 기존 계정의 비밀번호를 비우면 유지합니다. 권한·계정 변경 시 해당 계정의 기존 로그인은 종료됩니다.</p><div class="full"><button class="button primary" type="submit">담당자 저장</button></div></form></article><article class="panel" id="access-password-panel" hidden><h3>내 비밀번호 변경</h3><form id="access-password" class="marketing-form">${field('current','현재 비밀번호','password','required autocomplete="current-password"')}${field('password','새 비밀번호 · 12자 이상','password','required minlength="12" maxlength="256" autocomplete="new-password"')}<div class="full"><button class="button secondary" type="submit">변경 후 다시 로그인</button></div></form></article></div>`;
  document.querySelector('.main-footer').before(section);
  const queue=document.createElement('article');queue.className='panel marketing-section';queue.id='agency-work-queue';
  queue.innerHTML='<div class="panel-heading"><div><h3>검토 · 일정 확인</h3><p class="marketing-note" id="agency-task-summary"></p></div><label class="agency-task-filter">담당자 <select id="agency-task-owner"><option value="">전체</option></select></label></div><div id="agency-task-list" class="table-scroll"></div>';$('agency-cards').after(queue);
  document.querySelector('.clinic-switch').innerHTML='<label>현재 병원<select id="clinic-select" aria-label="병원 선택"><option>확인 중</option></select></label><small>병원별 자료를 따로 보관합니다.</small>';
  const status=document.createElement('span');status.id='access-state';status.className='access-state';document.querySelector('.top-right').prepend(status);
  const dialog=document.createElement('dialog');dialog.className='access-dialog';dialog.id='access-dialog';dialog.innerHTML=`<h2>담당자 로그인</h2><p>지정된 병원의 분석과 마케팅 작업공간을 엽니다.</p><form id="access-login" class="marketing-form">${field('username','아이디','text','required autocomplete="username" maxlength="64"')}${field('password','비밀번호','password','required autocomplete="current-password" maxlength="256"')}<p id="access-login-message" role="alert"></p><button type="submit" class="button primary">로그인</button></form>`;document.body.append(dialog);dialog.addEventListener('cancel',event=>event.preventDefault());
  function note(message,error=false){$('agency-message').textContent=message;$('agency-message').hidden=!message;$('agency-message').classList.toggle('error',error);}
  async function raw(path,data){const response=await fetch(path,{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'dday'},body:JSON.stringify(data)}:{})});const body=await response.json();if(!response.ok)throw Error(body.error||'접근 상태를 확인하지 못했습니다.');return body;}
  async function api(path,data){const response=await apiFetch(path,{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'dday'},body:JSON.stringify(data)}:{})});const body=await response.json();if(!response.ok)throw Error(body.error||'병원 자료를 확인하지 못했습니다.');return body;}
  function loginRequired(){if(!dialog.open){$('access-login').reset();$('access-login-message').textContent='로그인 후 계속할 수 있습니다.';dialog.showModal();}}
  document.addEventListener('session-required',loginRequired);
  document.addEventListener('identity-changed',()=>location.reload());
  function clinicLink(id,hash='overview'){return '/?clinic='+encodeURIComponent(id)+'#'+hash;}
  function taskLink(task){const params=new URLSearchParams({clinic:task.clinic_id});if(task.entity_id)params.set('item',task.entity_id);if(task.month)params.set('month',task.month);return '/?'+params+'#'+task.kind;}
  function renderTasks(){
    const owner=$('agency-task-owner').value,selected=tasks.filter(t=>!owner||(owner==='__unassigned__'?!t.owner:t.owner===owner));
    $('agency-task-list').innerHTML=selected.length?table(selected,[{key:'clinic_name',label:'병원'},{key:'title',label:'확인할 기록'},{key:'reason',label:'확인 사유'},{key:'owner',label:'담당자',render:v=>esc(v||'미정')},{key:'due',label:'기준일',render:v=>esc(v||'—')},{key:'entity_id',label:'열기',render:(_,row)=>`<a class="marketing-small-button" href="${esc(taskLink(row))}">기록 열기</a>`}]):empty('현재 필터에서 확인할 검토·일정 항목이 없습니다.');
  }
  $('agency-task-owner').addEventListener('change',renderTasks);
  function renderAccess(){
    const admin=!auth.enabled||auth.user?.role==='admin';document.body.dataset.access=auth.enabled?auth.user?.role||'locked':'local';
    status.textContent=auth.enabled?`${auth.user.name} · ${roles[auth.user.role]}`:'이 PC 단독 모드';
    if(auth.enabled){const logout=document.createElement('button');logout.className='marketing-small-button';logout.textContent='로그아웃';logout.addEventListener('click',async()=>{try{await raw('/api/auth/logout',{});location.reload();}catch(e){note(e.message,true);}});status.append(logout);}
    $('agency-access-note').textContent=auth.enabled?`${auth.user.name} · ${roles[auth.user.role]} · 허용된 병원 ${agency.clinics.length}곳`:'이 PC 단독 모드 · 담당자별 접근권한 미설정';
    $('agency-create-panel').hidden=!admin;$('access-setup-panel').hidden=auth.enabled;$('access-users-panel').hidden=!auth.enabled||!admin;$('access-password-panel').hidden=!auth.enabled;
    const select=$('clinic-select');select.innerHTML=agency.clinics.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')||'<option value="">허용된 병원 없음</option>';
    const requested=new URLSearchParams(location.search).get('clinic');const id=requested===null?agency.default_id:requested;
    setClinicScope(id);select.value=id||'';
    const clinic=agency.clinics.find(c=>c.id===id);const name=clinic?.name||'병원 선택 필요';
    $('active-clinic-name').textContent=name;document.title=name+' · 병원 데이터 분석';
    document.querySelectorAll('[data-clinic-label]').forEach(el=>el.textContent=name);
  }
  async function bootstrap(){
    const current=await raw('/api/auth/status');
    if(current.enabled&&!current.authenticated){loginRequired();throw Error('담당자 로그인이 필요합니다.');}
    if(auth&&(auth.user?.id!==current.user?.id||auth.user?.version!==current.user?.version||auth.enabled!==current.enabled)){location.reload();throw Error('로그인 계정이 변경됐습니다.');}
    const next=await raw('/api/agency');
    if(next.user?.id!==current.user?.id||next.user?.version!==current.user?.version)throw Error('계정 확인 중 상태가 바뀌었습니다. 다시 확인해 주세요.');
    auth=current;agency=next;setOperatorScope(auth.user);renderAccess();return agency;
  }
  function ensureReady(){if(!ready)ready=bootstrap().catch(e=>{ready=null;throw e;});return ready;}
  configureScope(ensureReady);const initialReady=ensureReady();
  $('clinic-select').addEventListener('change',event=>location.assign(clinicLink(event.target.value)));
  async function refresh(){
    if(location.hash!=='#agency')return;
    const request=++refreshSequence;
    $('agency-task-list').innerHTML=empty('검토와 일정을 새로 확인합니다.');$('agency-task-summary').textContent='';
    $('agency-cards').innerHTML=empty('병원별 원본과 장부를 새로 확인하고 있습니다.');$('agency-checked').textContent='확인 중…';
    try{
      await ensureReady();const overview=await api('/api/agency/overview');
      if(request!==refreshSequence)return;
      agency=await api('/api/agency');if(request!==refreshSequence)return;renderAccess();
      $('agency-checked').textContent='확인 '+new Date(overview.checked_at).toLocaleString('ko-KR',{hour12:false});
      $('agency-cards').innerHTML=overview.clinics.map(c=>`<a class="agency-card" href="${clinicLink(c.id)}"><h3>${esc(c.name)}</h3><p>${esc(agency.emrs[c.emr])} · ${esc(c.owner||'담당자 미정')}</p><p>자료 마지막 접수일 <strong>${esc(c.last_record||'자료 확인 필요')}</strong></p>${c.source_state!=='ready'?`<p>${esc(c.source_message)}</p>`:''}${c.operations_state==='ready'?`<div class="agency-amount">순집행비 ${won(c.operations.net_spend)}</div><p>진행 캠페인 ${num(c.operations.running)} · 확인할 검토·일정 ${num(c.tasks_count)}</p>`:`<p>장부 확인 실패 · ${esc(c.operations_message)}</p>`}<p>원본 확인 ${esc(new Date(c.source_checked_at).toLocaleString('ko-KR'))}<br>장부 확인 ${esc(new Date(c.operations_checked_at).toLocaleString('ko-KR'))}</p></a>`).join('')||empty('접근할 병원이 없습니다. 관리자에게 병원 권한을 요청해 주세요.');
      tasks=overview.tasks;const filter=$('agency-task-owner'),selected=filter.value;
      filter.innerHTML='<option value="">전체</option><option value="__unassigned__">담당자 미정</option>'+[...new Set(tasks.map(t=>t.owner).filter(Boolean))].sort().map(owner=>`<option value="${esc(owner)}">${esc(owner)}</option>`).join('');filter.value=[...filter.options].some(x=>x.value===selected)?selected:'';
      $('agency-task-summary').textContent=`확인된 항목 ${num(tasks.length)}건 · 7일 내 예정 포함${overview.unavailable_ledgers?' · 장부 확인 실패 '+num(overview.unavailable_ledgers)+'곳 제외':''} · 확인 ${new Date(overview.checked_at).toLocaleString('ko-KR')}`;renderTasks();
      if(auth.enabled&&auth.user.role==='admin'){const found=await api('/api/agency/users');if(request!==refreshSequence)return;users=found.users;renderUsers();}
    }catch(e){if(request!==refreshSequence)return;tasks=[];$('agency-task-list').innerHTML=empty('최신 검토·일정을 확인하지 못했습니다.');$('agency-task-summary').textContent='';$('agency-cards').innerHTML=empty('이번 확인에 실패했습니다.');$('agency-checked').textContent='최신 상태 확인 실패';note(e.message,true);}
  }
  async function submit(form,task){if(busy)return;busy=true;form.inert=true;note('처리 중입니다.');try{await task();}catch(e){note(e.message,true);}finally{busy=false;form.inert=false;}}
  function userForm(user=null){const form=$('access-user-form');form.reset();form.elements.id.value=user?.id||'';form.elements.version.value=user?.version??'';form.elements.password.required=!user;
    for(const key of ['username','name','role'])if(user)form.elements.namedItem(key).value=user[key];form.elements.active.value=user?.active===false?'false':'true';
    $('access-grants').innerHTML=agency.clinics.map(c=>`<label><input type="checkbox" name="clinic_ids" value="${c.id}" ${user?.clinic_ids.includes(c.id)?'checked':''}>${esc(c.name)}</label>`).join('');
  }
  function renderUsers(){const form=$('access-user-form'),selected=form.elements.id.value;
    $('access-user-list').innerHTML=table(users,[{key:'name',label:'담당자'},{key:'username',label:'아이디'},{key:'role',label:'역할',render:v=>roles[v]},{key:'active',label:'상태',render:v=>v?'사용':'비활성'},{key:'id',label:'관리',render:id=>`<button class="marketing-small-button" data-edit-user="${id}">수정</button>`}]);
    if(!form.dataset.initialized){userForm();form.dataset.initialized='true';}
    // Keep unsaved account edits and their version; an external update must conflict on save.
    if(selected&&!users.some(u=>u.id===selected))note('선택한 계정 정보를 다시 확인해 주세요.',true);
  }
  $('agency-create').addEventListener('submit',event=>{event.preventDefault();const form=event.target;submit(form,async()=>{const clinic=await api('/api/agency/clinics',Object.fromEntries(new FormData(form)));form.reset();await refresh();note(`${clinic.name} 작업공간을 만들었습니다. 위 목록에서 선택해 엑셀을 올릴 수 있습니다.`);});});
  $('access-setup').addEventListener('submit',event=>{event.preventDefault();const form=event.target;submit(form,async()=>{await raw('/api/auth/setup',Object.fromEntries(new FormData(form)));form.reset();location.reload();});});
  $('access-login').addEventListener('submit',async event=>{event.preventDefault();const form=event.target;form.inert=true;try{await raw('/api/auth/login',Object.fromEntries(new FormData(form)));form.reset();if(!auth){location.reload();return;}ready=null;await ensureReady();dialog.close();note('다시 로그인했습니다. 작성 중인 내용을 확인하고 저장해 주세요.');document.dispatchEvent(new Event('session-restored'));}catch(e){$('access-login-message').textContent=e.message;form.elements.password.value='';}finally{form.inert=false;}});
  $('access-user-form').addEventListener('submit',event=>{event.preventDefault();const form=event.target;submit(form,async()=>{const data=Object.fromEntries(new FormData(form));data.clinic_ids=[...form.querySelectorAll('[name=clinic_ids]:checked')].map(x=>x.value);data.active=data.active==='true';if(data.id)data.version=Number(data.version);else{delete data.id;delete data.version;}const saved=await api('/api/agency/users',data);form.elements.password.value='';if(saved.id===auth.user.id){location.reload();return;}await refresh();userForm(saved);note('담당자 권한을 저장했습니다. 기존 로그인은 종료됩니다.');});});
  $('access-user-new').addEventListener('click',()=>{if(!busy)userForm();});
  $('access-user-list').addEventListener('click',event=>{if(busy)return;const id=event.target.closest('[data-edit-user]')?.dataset.editUser;if(id)userForm(users.find(x=>x.id===id));});
  $('access-password').addEventListener('submit',event=>{event.preventDefault();const form=event.target;submit(form,async()=>{await api('/api/auth/password',Object.fromEntries(new FormData(form)));form.reset();location.reload();});});
  $('agency-refresh').addEventListener('click',refresh);window.addEventListener('hashchange',refresh);window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
  initialReady.then(refresh).catch(e=>note(e.message,true));
  return {refresh};
}
