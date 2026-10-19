(() => {
  const status=document.getElementById('selection');
  function select(code,index=null){
    document.querySelectorAll('[data-row]').forEach(row=>row.classList.toggle('selected',index!==null?row.dataset.row===index:!!code&&row.dataset.region===code));
    document.querySelectorAll('.region').forEach(region=>region.classList.toggle('selected',!!code&&region.dataset.region===code));
    const selected=[...document.querySelectorAll('[data-row].selected')];
    status.textContent=selected.length?selected.map(row=>row.querySelector('th').textContent).join(' · '):code?'이 지역은 제공된 단지 집계가 없습니다.':'지역이나 단지를 선택하면 해당 항목을 강조합니다.';
  }
  document.querySelectorAll('[data-pick]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.region,button.dataset.pick)));
  document.querySelectorAll('.region').forEach(region=>{
    region.addEventListener('click',()=>select(region.dataset.region));
    region.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(region.dataset.region);}});
  });
  document.getElementById('clear-selection').addEventListener('click',()=>select(''));
  document.getElementById('print').addEventListener('click',()=>window.print());
})();
