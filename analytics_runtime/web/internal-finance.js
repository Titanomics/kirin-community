export function initInternalFinance(){
  const section=document.createElement('section');
  section.id='page-internalfinance';section.className='page-view panel';section.hidden=true;
  const message=document.createElement('p');
  message.textContent='내부 비용 기능은 준비 중입니다. 엑셀 분석과 병원 보고서는 사용할 수 있습니다.';
  section.append(message);document.querySelector('.main-footer').before(section);
  return {refresh(){}};
}
