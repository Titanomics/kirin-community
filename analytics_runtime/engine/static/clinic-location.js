import {esc,table,empty} from './charts.js';
import {apiFetch} from './scope.js';
import {project} from './map-layout.js';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const node=(tag,attrs={})=>{const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;};
const field=(name,label,type='text',attrs='')=>`<label>${label}<input name="${name}" type="${type}" ${attrs}></label>`;

export function initClinicLocation(map){
  let mapSequence=0,formSequence=0,mapData=null,layer=null,selected=false,pendingFocus=false,formRevision=null,current=null,dirty=false,busy=false,clearRevision=null;
  const focusButton=document.createElement('button');focusButton.id='map-clinic-focus';focusButton.className='button secondary';focusButton.textContent='병원 위치로 이동';focusButton.disabled=true;document.querySelector('.map-toolbar').append(focusButton);
  const status=document.createElement('p');status.id='map-clinic-status';status.className='clinic-location-status';status.setAttribute('role','status');document.querySelector('.map-toolbar').after(status);
  const panel=document.createElement('article');panel.id='clinic-location-settings';panel.className='panel marketing-page';panel.innerHTML=`<div class="panel-heading"><h2>병원 지도 위치</h2><button id="clinic-location-reload" class="button secondary">저장값 다시 불러오기</button></div><p>병원의 공개 장소 좌표를 표시합니다. 환자 주소나 광고 집행 위치와 별도입니다.</p><div id="clinic-location-message" role="status" class="marketing-message" hidden></div><div id="clinic-location-current"></div><form id="clinic-location-form" class="marketing-form clinic-location-admin" inert>${field('name','병원 표시명','text','required maxlength="120"')}${field('address','공개 주소','text','required maxlength="500"')}${field('latitude','위도','number','required min="-85" max="85" step="any"')}${field('longitude','경도','number','required min="-180" max="180" step="any"')}${field('source_url','공개 위치 출처 링크','url','required maxlength="1500"')}${field('checked_on','출처 확인일','date','required')}<label class="full">좌표·주소 확인 근거<textarea name="source_note" maxlength="1000" required></textarea></label><p class="marketing-note full">공개 장소의 참고 좌표입니다. 출입구 위치나 환자의 실제 위치를 확인한 것으로 해석하지 않습니다.</p><button class="button primary">병원 위치 저장</button></form><form id="clinic-location-clear" class="marketing-form clinic-location-admin" inert hidden><label class="full">지도 표시 해제 사유<input name="reason" maxlength="500" required></label><label class="clinic-location-check full"><input name="confirmed" type="checkbox" required>현재 병원 위치 표시를 해제하고 이력을 남깁니다.</label><button class="button secondary">위치 표시 해제</button></form><details><summary>최근 위치 변경 이력 · 최대 50건</summary><div id="clinic-location-history" class="table-scroll"></div></details>`;
  panel.classList.add('page-view');panel.dataset.relatedPage='page-settings';panel.hidden=true;document.querySelector('.main-footer').before(panel);const form=$('clinic-location-form'),clearForm=$('clinic-location-clear');
  const message=(value,error=false)=>{const el=$('clinic-location-message');el.hidden=!value;el.textContent=value;el.classList.toggle('error',error);};
  async function api(path='/api/clinic-location',data){const r=await apiFetch(path,{cache:'no-store',...(data!==undefined?{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'dday'},body:JSON.stringify(data)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error||'병원 위치를 확인하지 못했습니다.');return value;}
  function locationText(record,checkedAt){return record?`<h3>${esc(record.name)}</h3><p>${esc(record.address)}</p><p>위도 ${record.latitude.toFixed(7)} · 경도 ${record.longitude.toFixed(7)}</p><p>${esc(record.source_note)}</p><p><a href="${esc(record.source_url)}" target="_blank" rel="noopener noreferrer">공개 위치 출처 열기</a> · 출처 확인 ${esc(record.checked_on)}<br>저장소 확인 ${esc(new Date(checkedAt).toLocaleString('ko-KR',{hour12:false}))}</p>`:empty('병원의 공개 지도 위치가 아직 등록되지 않았습니다.');}
  async function loadForm(force=false){
    const request=++formSequence;form.inert=true;clearForm.inert=true;
    try{
      const value=await api();if(request!==formSequence)return false;
      if(current?.revision!==value.revision){clearRevision=null;clearForm.elements.confirmed.checked=false;}current=value;
      $('clinic-location-current').innerHTML=locationText(value.location,value.checked_at);
      $('clinic-location-history').innerHTML=table(value.history,[{key:'at',label:'변경 시각',render:v=>esc(new Date(v).toLocaleString('ko-KR'))},{key:'location',label:'기록',render:v=>esc(v?v.name+' · '+v.address:'표시 해제')},{key:'reason',label:'해제 사유'},{key:'actor',label:'계정',render:v=>esc(v?.name||'이 PC 단독 모드')}]);
      if(!dirty||force){form.reset();for(const [key,val]of Object.entries(value.location||{}))if(form.elements.namedItem(key))form.elements.namedItem(key).value=val;formRevision=value.revision;dirty=false;message('');}
      else if(formRevision!==value.revision)message('저장된 위치가 변경됐습니다. 입력은 보관했습니다. 저장값을 다시 불러온 뒤 수정해 주세요.',true);
      form.inert=false;clearForm.inert=false;clearForm.hidden=!value.location;return true;
    }catch(e){if(request!==formSequence)return false;current=null;clearRevision=null;clearForm.elements.confirmed.checked=false;clearForm.hidden=true;$('clinic-location-current').replaceChildren();$('clinic-location-history').replaceChildren();message(e.message,true);return false;}
  }
  form.addEventListener('input',()=>dirty=true);
  async function run(task){if(busy)return;busy=true;panel.inert=true;try{await task();}catch(e){message(e.message,true);}finally{busy=false;panel.inert=false;}}
  form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{if(!current||formRevision===null)throw Error('저장값을 먼저 확인해 주세요.');const data=Object.fromEntries(new FormData(form));data.latitude=Number(data.latitude);data.longitude=Number(data.longitude);await api('/api/clinic-location/save',{data,revision:formRevision});dirty=false;if(await loadForm())message('병원 위치를 저장했습니다. 지도에서 출처와 함께 확인할 수 있습니다.');locationChanged();});});
  clearForm.elements.confirmed.addEventListener('change',e=>clearRevision=e.target.checked?current?.revision:null);
  clearForm.addEventListener('submit',e=>{e.preventDefault();run(async()=>{if(clearRevision==null||clearRevision!==current?.revision)throw Error('최신 위치와 해제 확인란을 다시 확인해 주세요.');await api('/api/clinic-location/clear',{revision:clearRevision,reason:clearForm.elements.reason.value,confirmed:clearForm.elements.confirmed.checked});dirty=false;clearForm.reset();if(await loadForm())message('지도 위치 표시를 해제했습니다. 이전 위치와 사유는 이력에 남습니다.');locationChanged();});});
  $('clinic-location-reload').addEventListener('click',()=>run(()=>loadForm(true)));
  function locationChanged(){if(location.hash==='#map'&&map.svg?.isConnected)refresh();else invalidate();}
  function clearSelection(){selected=false;}
  function invalidate(){++mapSequence;mapData=null;selected=false;layer?.replaceChildren();focusButton.disabled=true;if($('map-detail').querySelector('.clinic-location-card'))$('map-detail').innerHTML=empty('병원 위치를 새로 확인합니다.');status.textContent='병원 위치를 확인하고 있습니다.';}
  function fail(error){invalidate();pendingFocus=false;status.textContent='병원 위치 확인 실패 · '+error;}
  async function refresh(){
    invalidate();const request=mapSequence;
    try{
      const value=await api();if(request!==mapSequence)return;mapData=value;focusButton.disabled=!value.location;
      status.textContent=value.location?`${value.location.name} · 공개 장소 참고 위치 · 출처 확인 ${value.location.checked_on} · 저장소 확인 ${new Date(value.checked_at).toLocaleString('ko-KR',{hour12:false})}`:'병원 위치 미등록 · 설정에서 공개 주소·좌표·출처를 입력할 수 있습니다.';
      render();if(pendingFocus&&value.location){pendingFocus=false;focusView();}
    }catch(e){if(request!==mapSequence)return;fail(e.message);}
  }
  function open(){if(!mapData?.location)return;selected=true;map.campaigns?.clearSelection();map.detail();render();}
  function render(){
    if(!map.svg||!map.view)return;if(!layer||layer.parentNode!==map.svg){layer=node('g',{class:'clinic-location-layer'});map.svg.append(layer);}layer.replaceChildren();const record=mapData?.location;if(!record)return;
    const box=map.svg.getBoundingClientRect(),scale=Math.min(box.width/map.view.w,box.height/map.view.h);if(!scale)return;const [x,y]=project([record.longitude,record.latitude]);
    if(x<map.view.x||x>map.view.x+map.view.w||y<map.view.y||y>map.view.y+map.view.h)return;
    const g=node('g',{class:'clinic-location-pin',role:'button',tabindex:0,'aria-label':record.name+' · 병원 공개 위치',transform:`translate(${x} ${y})`});
    g.append(node('path',{d:`M0 0 L${-5/scale} ${-18/scale} L${5/scale} ${-18/scale} Z`,fill:'#c86034'}));g.append(node('circle',{cx:0,cy:-31/scale,r:14/scale,fill:selected?'#9b3e18':'#da6b3c',stroke:'#fff','stroke-width':2/scale}));g.append(node('path',{d:`M${-7/scale} ${-31/scale} H${7/scale} M0 ${-38/scale} V${-24/scale}`,stroke:'#fff','stroke-width':3/scale}));
    const label=record.name.length>18?record.name.slice(0,18)+'…':record.name;g.append(node('rect',{x:18/scale,y:-43/scale,width:(label.length*12+14)/scale,height:24/scale,rx:5/scale,fill:'#fff',stroke:'#d8b19e','stroke-width':1/scale}));const name=node('text',{x:25/scale,y:-31/scale,'dominant-baseline':'central','font-size':12/scale,fill:'#8b421f'});name.textContent=label;g.append(name);const title=node('title');title.textContent=record.name+' · '+record.address;g.append(title);
    g.addEventListener('click',()=>{if(!map.dragMoved)open();});g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});layer.append(g);
  }
  function detail(){
    if(!selected||!mapData?.location)return false;
    $('map-detail').innerHTML=`<article class="clinic-location-card"><button class="button secondary" data-clinic-close>지역 상세로 돌아가기</button><p class="detail-period">병원 공개 위치</p>${locationText(mapData.location,mapData.checked_at)}<p class="detail-note">병원의 공개 장소를 표시한 참고 좌표입니다. 출입구·환자 위치·광고 효과를 나타내지 않습니다. 지도 색상은 선택한 환자·금액 지표를 유지합니다.</p><a href="#settings" class="button secondary">병원 위치 설정</a></article>`;$('map-detail').querySelector('[data-clinic-close]').addEventListener('click',()=>{clearSelection();map.detail();render();});return true;
  }
  function focusView(){const record=mapData?.location;if(!record||!map.base)return;const [x,y]=project([record.longitude,record.latitude]);map.zoom=Math.min(60,Math.max(1,Math.min(map.base.w/6000,map.base.h/6000)));map.offset=[x-(map.base.x+map.base.w/2),y-(map.base.y+map.base.h/2)];map.applyViewBox();open();}
  focusButton.addEventListener('click',async()=>{const r=mapData?.location;if(!r||!map.base)return;const [x,y]=project([r.longitude,r.latitude]);if(map.area!=='all'&&(x<map.base.x||x>map.base.x+map.base.w||y<map.base.y||y>map.base.y+map.base.h)){pendingFocus=true;map.area='all';$('map-area').value='all';try{await map.update(map.data,true);}catch(e){fail(e.message);}}else focusView();});
  const activate=()=>{if(location.hash==='#settings'&&!busy)loadForm();};window.addEventListener('hashchange',activate);window.addEventListener('pageshow',e=>{if(e.persisted)activate();});activate();
  return {refresh,render,invalidate,detail,clearSelection,fail,refreshSettings:activate};
}
