import {esc,num,won,empty} from './charts.js';
import {project} from './map-layout.js';
import {apiFetch,scopedUrl} from './scope.js';
const NS='http://www.w3.org/2000/svg';
const statuses={planned:'기획',approved:'검토 완료',running:'진행 중',paused:'보류',completed:'종료',cancelled:'취소'};
const node=(tag,attrs={})=>{const el=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);return el;};
const hasPoint=c=>Number.isFinite(c.latitude)&&Number.isFinite(c.longitude);

export function initCampaignMap(map){
  let enabled=false,sequence=0,workspace=null,records=[],selected=null,layer=null;
  const toggle=document.createElement('label');toggle.className='map-toggle';toggle.innerHTML='<input id="map-campaigns" type="checkbox">집행 위치';
  document.getElementById('map-basemap').closest('label').after(toggle);
  const status=document.createElement('div');status.id='map-campaign-status';status.className='campaign-map-status';status.setAttribute('role','status');status.hidden=true;
  document.querySelector('.map-toolbar').after(status);
  function clearSelection(){selected=null;}
  function invalidate(){++sequence;workspace=null;records=[];clearSelection();layer?.replaceChildren();const detail=document.getElementById('map-detail');if(detail.querySelector('.campaign-map-card'))detail.innerHTML=empty('집행 위치를 새로 확인합니다.');if(enabled){status.hidden=false;status.textContent='집행 위치를 새로 확인합니다.';}}
  function fail(message){invalidate();if(enabled)status.textContent='집행 위치 확인 실패 · '+message;}
  async function refresh(){
    invalidate();if(!enabled||!map.data)return;
    const request=sequence,period={...map.data.period};
    try{
      const response=await apiFetch('/api/workspace',{cache:'no-store'});const state=await response.json();
      if(!response.ok)throw Error(state.error||'집행 장부를 확인하지 못했습니다.');
      if(request!==sequence||!enabled)return;
      workspace=state;records=state.campaigns.filter(c=>c.status!=='cancelled'&&c.start<=period.end&&c.end>=period.start);
      const located=records.filter(hasPoint).length;
      status.textContent=`집행 위치 ${num(located)}건 · 좌표 미입력 ${num(records.length-located)}건 · ${period.start} ~ ${period.end}와 겹치는 집행 · 장부 확인 ${new Date(state.checked_at).toLocaleString('ko-KR')} · 지도 색상은 선택한 환자·금액 지표 기준입니다.`;
      render();
    }catch(error){if(request!==sequence)return;workspace=null;records=[];layer?.replaceChildren();status.textContent='집행 위치 확인 실패 · '+error.message;}
  }
  function open(id){map.clinic?.clearSelection();selected=id;map.detail();render();}
  function render(){
    if(!map.svg||!map.view)return;
    if(!layer||layer.parentNode!==map.svg){layer=node('g',{class:'campaign-map-layer'});map.svg.append(layer);}
    layer.replaceChildren();if(!enabled||!workspace)return;
    const box=map.svg.getBoundingClientRect(),scale=Math.min(box.width/map.view.w,box.height/map.view.h);if(!scale)return;
    const groups=new Map();
    for(const c of records.filter(hasPoint)){const key=c.latitude+','+c.longitude;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
    for(const group of groups.values()){
      const point=project([group[0].longitude,group[0].latitude]),r=13/scale;
      if(point[0]<map.view.x-r||point[0]>map.view.x+map.view.w+r||point[1]<map.view.y-r||point[1]>map.view.y+map.view.h+r)continue;
      const chosen=group.some(c=>c.id===selected),g=node('g',{class:'campaign-pin'+(chosen?' chosen':''),role:'button',tabindex:0,'data-campaign-id':group[0].id,'aria-label':group.map(c=>c.title).join(', ')});
      g.append(node('circle',{cx:point[0],cy:point[1],r,fill:chosen?'#35256e':'#6556c8',stroke:'#fff','stroke-width':2/scale}));
      const text=node('text',{x:point[0],y:point[1],'text-anchor':'middle','dominant-baseline':'central','font-size':12/scale,fill:'#fff'});text.textContent=group.length>1?group.length:'광';g.append(text);
      const title=node('title');title.textContent=group.map(c=>c.location_name+' · '+c.title).join('\n');g.append(title);
      const click=()=>{if(!map.dragMoved)open(group[0].id);};g.addEventListener('click',click);g.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(group[0].id);}});layer.append(g);
    }
  }
  function recordLink(c){return scopedUrl('/?item='+encodeURIComponent(c.id))+'#campaigns';}
  function detail(){
    if(!enabled||!workspace||!selected)return false;
    const c=records.find(x=>x.id===selected);if(!c){clearSelection();return false;}
    const parent=workspace.campaigns.find(x=>x.id===c.parent_id),children=workspace.campaigns.filter(x=>x.parent_id===c.id),same=records.filter(x=>hasPoint(x)&&x.latitude===c.latitude&&x.longitude===c.longitude&&x.id!==c.id),cost=workspace.campaign_totals[c.id];
    const childRows=children.map(x=>`<li><span>${esc(x.title)} · ${statuses[x.status]}<small>${esc(x.start)} ~ ${esc(x.end)} · 순집행 ${won(workspace.campaign_totals[x.id].net_spend)}</small></span><a href="${esc(recordLink(x))}">기록 열기</a></li>`).join('');
    const el=document.getElementById('map-detail');el.innerHTML=`<article class="campaign-map-card"><button class="button secondary" data-close-campaign-map>지역 상세로 돌아가기</button><p class="detail-period">집행 위치 · ${statuses[c.status]}${parent?' · 하위 집행':''}</p><h2>${esc(c.title)}</h2><h3>${esc(c.location_name)}</h3><p>${esc(c.location_address||'주소 미기록')}</p><p class="detail-period">위도 ${c.latitude.toFixed(6)} · 경도 ${c.longitude.toFixed(6)}<br>위치 확인 근거: ${esc(c.location_source)}</p><dl>${[['매체·외주사',c.vendor||'미기록'],['집행 기간',c.start+' ~ '+c.end],['계획 예산',c.budget==null?'미기록':won(c.budget)],['기록된 순집행비'+(parent?'':' · 하위 포함'),won(cost.net_spend)],['담당자',c.owner||'미정'],['계약 식별·근거',c.contract_reference||'미기록'],['갱신 확인일',c.renewal_on||'미기록']].map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="detail-note">금액은 이 캠페인의 전체 기간 장부입니다. 조회기간 비용이나 광고 기여 매출을 뜻하지 않습니다.</p>${parent?`<p>상위 캠페인 <a href="${esc(recordLink(parent))}">${esc(parent.title)}</a></p>`:''}<a class="button primary" href="${esc(recordLink(c))}">캠페인 기록 열기</a>${c.evidence_url?`<a class="button secondary" href="${esc(c.evidence_url)}" target="_blank" rel="noopener noreferrer">집행 증빙 열기</a>`:''}${children.length?`<h3>하위 집행 ${num(children.length)}건</h3><ul class="campaign-map-children">${childRows}</ul>`:''}${same.length?`<h3>같은 좌표의 집행</h3><div class="campaign-same-location">${same.map(x=>`<button class="button secondary" data-select-campaign="${x.id}">${esc(x.title)}</button>`).join('')}</div>`:''}<p class="detail-note">장부 확인 ${esc(new Date(workspace.checked_at).toLocaleString('ko-KR'))}. 등록한 집행 좌표만 표시하며 반경별 광고 효과나 환자 주소를 추정하지 않습니다.</p></article>`;
    el.querySelector('[data-close-campaign-map]').addEventListener('click',()=>{clearSelection();map.detail();render();});
    el.querySelectorAll('[data-select-campaign]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.selectCampaign)));return true;
  }
  toggle.querySelector('input').addEventListener('change',event=>{enabled=event.target.checked;invalidate();status.hidden=!enabled;map.detail();if(enabled)refresh();});
  return {refresh,render,invalidate,detail,clearSelection,fail};
}
