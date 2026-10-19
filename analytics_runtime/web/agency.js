import {configureScope,setClinicScope,setOperatorScope} from './scope.js';

export function initAgency(){
  const clinicId=location.pathname.match(/^\/api\/hospital-analytics\/runtime\/([0-9a-f-]{36})\//)?.[1];
  const section=document.createElement('section');section.id='page-agency';section.className='page-view marketing-page';section.hidden=true;
  const title=document.createElement('h2');title.textContent='병원과 담당자 관리';
  const link=document.createElement('a');link.href='/hospital-analytics';link.target='_top';link.className='button primary';link.textContent='ERP 병원 목록으로 돌아가기';
  section.append(title,link);document.querySelector('.main-footer').before(section);
  const status=document.createElement('span');status.className='access-state';document.querySelector('.top-right').prepend(status);
  const refresh=async()=>{
    const response=await fetch('/api/hospital-analytics/access',{cache:'no-store'});const access=await response.json();
    if(!response.ok)throw Error(access.error||'ERP 권한을 확인하지 못했습니다.');
    const clinic=access.clinics.find(c=>c.id===clinicId);if(!clinic)throw Error('이 병원에 대한 접근 권한이 없습니다.');
    setClinicScope(clinic.id);setOperatorScope(access.user);
    const role=access.isAdmin?'admin':access.roles[clinic.id];document.body.dataset.access=role;
    document.title=clinic.name+' · 병원 분석';document.getElementById('active-clinic-name').textContent=clinic.name;
    document.querySelectorAll('[data-clinic-label]').forEach(el=>el.textContent=clinic.name);
    const box=document.querySelector('.clinic-switch');box.replaceChildren();
    const name=document.createElement('strong');name.textContent=clinic.name;
    const back=link.cloneNode(true);back.textContent='병원 변경 · 권한 관리';box.append(name,back);
    status.textContent=access.user.name+' · '+({admin:'관리자',editor:'편집 담당자',viewer:'조회 담당자'}[role]);
    return access;
  };
  const ready=refresh();configureScope(ready);
  document.addEventListener('session-required',()=>{status.textContent='ERP 로그인이 만료됐습니다. ERP에서 다시 로그인해 주세요.';});
  document.addEventListener('identity-changed',()=>location.reload());
  ready.catch(error=>{status.textContent=error.message;});
  return {refresh:()=>refresh().catch(error=>{status.textContent=error.message;})};
}
