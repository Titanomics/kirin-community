(() => {
  const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
  const node=(tag,attrs={})=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const data=JSON.parse(atob($('map-container').dataset.map)),total=data.total;
  const features=data.features.map(f=>{
    const rs=rings(f.geometry).map(r=>r.map(project));
    const bounds=rs.flat().reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
    return {f,rs,bounds,point:labelPoint(rs),area:(bounds[2]-bounds[0])*(bounds[3]-bounds[1]),code:f.properties.EMD_CD,name:f.properties.EMD_KOR_NM};
  });
  const totals=new Map();for(const r of data.rows)if(r.region_code)totals.set(r.region_code,(totals.get(r.region_code)||0)+r.records);
  const extent=items=>{const b=items.reduce((b,f)=>[Math.min(b[0],f.bounds[0]),Math.min(b[1],f.bounds[1]),Math.max(b[2],f.bounds[2]),Math.max(b[3],f.bounds[3])],[Infinity,Infinity,-Infinity,-Infinity]);const w=Math.max(500,b[2]-b[0]),h=Math.max(500,b[3]-b[1]);return {x:b[0]-w*.18,y:b[1]-h*.18,w:w*1.36,h:h*1.36};};
  const matched=features.filter(f=>totals.has(f.code));
  const home=features.length?extent(matched.length?matched:features):null;
  let view=home?{...home}:null,selected=null,drag=null,moved=false,tileTimer;
  const svg=node('svg',{'aria-label':'지역명이 표시된 실제 경계 히트맵',role:'group'});
  const tiles=node('g',{class:'basemap-layer','aria-hidden':'true'}),areas=node('g'),labels=node('g',{class:'map-label-layer'});
  svg.append(tiles,areas,labels);$('map-container').append(svg);
  const images=new Map(),maximum=Math.max(1,...totals.values());
  const basemapAllowed=$('map-container').dataset.basemap==='true';
  function renderTiles(){
    if(!view)return;
    const enabled=basemapAllowed&&$('map-basemap').checked&&navigator.onLine;
    $('osm-credit').hidden=!enabled;svg.classList.toggle('with-basemap',enabled);
    if(!enabled){tiles.replaceChildren();images.clear();return;}
    const box=svg.getBoundingClientRect();if(!box.width||!box.height)return;
    const visible=visibleTiles(view,box.width,box.height),keys=new Set(visible.map(t=>t.key));
    for(const [key,img] of images)if(!keys.has(key)){img.remove();images.delete(key);}
    for(const t of visible)if(!images.has(t.key)){
      const img=node('image',{x:t.x,y:t.y,width:t.size,height:t.size,href:`https://tile.openstreetmap.org/${t.key}.png`,referrerpolicy:'origin'});
      img.addEventListener('error',()=>{$('map-tile-status').textContent='배경 연결 실패 · 지역 경계와 집계는 표시됩니다.';},{once:true});
      tiles.append(img);images.set(t.key,img);
    }
  }
  function renderLabels(){
    labels.replaceChildren();if(!view||!$('map-names').checked)return;
    const box=svg.getBoundingClientRect();
    for(const f of layoutLabels(features,view,box.width,box.height,selected)){
      const group=node('g',{class:'region-name'+(f.code===selected?' chosen':''),role:'button',tabindex:0,'aria-label':f.f.properties.FULL_NM,'data-code':f.code});
      const rect=node('rect',{x:f.point[0]-f.labelWidth/2,y:f.point[1]-f.labelHeight/2,width:f.labelWidth,height:f.labelHeight,rx:f.labelHeight/2});
      const text=node('text',{x:f.point[0],y:f.point[1],'text-anchor':'middle','dominant-baseline':'central','font-size':f.fontSize});text.textContent=f.name;
      group.append(rect,text);group.addEventListener('click',()=>{if(!moved)select(f.code);});
      group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(f.code);}});labels.append(group);
    }
  }
  function applyView(){
    if(!view)return;svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);renderLabels();
    clearTimeout(tileTimer);tileTimer=setTimeout(renderTiles,160);
  }
  function select(code,index=null){
    selected=code;
    document.querySelectorAll('[data-row]').forEach(row=>row.classList.toggle('selected',index!==null?row.dataset.row===index:!!code&&row.dataset.region===code));
    areas.querySelectorAll('.region').forEach(region=>region.classList.toggle('selected',!!code&&region.dataset.region===code));
    const f=features.find(f=>f.code===code),rows=data.rows.filter(r=>r.region_code===code),amount=totals.get(code);
    $('selected-region').textContent=f?.f.properties.FULL_NM||'지역을 선택해 주세요.';
    $('region-records').textContent=amount===undefined?'—':amount.toLocaleString('ko-KR')+'건';
    $('region-share').textContent=amount===undefined?'—':(amount/total*100).toFixed(1)+'%';
    $('region-complexes').textContent=amount===undefined?'—':rows.length+'개 단지';
    $('selection').textContent=f?(amount===undefined?'이 지역은 제공된 단지 집계가 없습니다.':`제공된 ${data.rows.length}개 단지 ${total.toLocaleString('ko-KR')}건 중 이 지역에 연결된 기록입니다.`):'지역이나 단지를 선택하면 해당 항목을 강조합니다.';
    $('region-apartments').replaceChildren(...rows.sort((a,b)=>b.records-a.records).map(r=>{
      const row=document.createElement('div');row.className='detail-row';const name=document.createElement('span'),value=document.createElement('strong');
      name.textContent=r.name;value.textContent=r.records.toLocaleString('ko-KR')+'건';row.append(name,value);return row;
    }));renderLabels();
  }
  for(const f of features){
    const amount=totals.get(f.code),fill=amount?`hsl(251 62% ${94-Math.sqrt(amount/maximum)*51}%)`:'none';
    const caption=f.f.properties.FULL_NM+' · '+(amount===undefined?'자료 없음':amount.toLocaleString('ko-KR')+'건');
    const path=node('path',{d:f.rs.map(r=>'M'+r.map(p=>p.map(n=>n.toFixed(1)).join(',')).join('L')+'Z').join(''),fill,'fill-rule':'evenodd',class:'map-region region','data-region':f.code,tabindex:0,role:'button','aria-label':caption});
    const title=node('title');title.textContent=caption;path.append(title);
    path.addEventListener('click',()=>{if(!moved)select(f.code);});path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(f.code);}});areas.append(path);
    $('map-search-list').append(new Option(f.f.properties.FULL_NM,f.f.properties.FULL_NM));
  }
  function focus(code){const f=features.find(f=>f.code===code);if(f){view=extent([f]);applyView();}return !!f;}
  function search(){const text=$('map-search').value.trim(),f=features.find(f=>f.f.properties.FULL_NM===text)||features.find(f=>f.name===text);if(f){select(f.code);focus(f.code);$('map-search-status').textContent='';}else $('map-search-status').textContent='보고서에 포함된 지역명을 입력해 주세요.';}
  function zoom(factor){if(!view)return;const w=view.w/factor,h=view.h/factor;if(w<150||w>home.w*8)return;view={x:view.x+(view.w-w)/2,y:view.y+(view.h-h)/2,w,h};applyView();}
  $('map-search-go').addEventListener('click',search);$('map-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search();}});
  $('zoom-in').addEventListener('click',()=>zoom(1.35));$('zoom-out').addEventListener('click',()=>zoom(1/1.35));
  $('map-reset').addEventListener('click',()=>{if(home){view={...home};applyView();}});
  $('map-names').addEventListener('change',renderLabels);$('map-basemap').addEventListener('change',()=>{$('map-tile-status').textContent='';renderTiles();});
  window.addEventListener('offline',renderTiles);window.addEventListener('online',renderTiles);
  svg.addEventListener('pointerdown',e=>{if(e.button!==0||!view)return;drag={x:e.clientX,y:e.clientY,view:{...view}};moved=false;});
  svg.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;if(moved){const box=svg.getBoundingClientRect(),scale=Math.min(box.width/drag.view.w,box.height/drag.view.h);view={...drag.view,x:drag.view.x-dx/scale,y:drag.view.y-dy/scale};applyView();}});
  window.addEventListener('pointerup',()=>{drag=null;});svg.addEventListener('pointerleave',()=>{drag=null;});
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2);},{passive:false});svg.addEventListener('dblclick',e=>{e.preventDefault();zoom(1.7);});
  document.querySelectorAll('[data-pick]').forEach(button=>button.addEventListener('click',()=>{select(button.dataset.region,button.dataset.pick);focus(button.dataset.region);}));
  $('clear-selection').addEventListener('click',()=>select(''));$('print').addEventListener('click',()=>window.print());
  new ResizeObserver(applyView).observe($('map-container'));
  if(view){applyView();select([...totals].sort((a,b)=>b[1]-a[1])[0]?.[0]||'');}
  else $('map-tile-status').textContent='확인된 지도 경계가 없습니다. 주소별 표를 확인해 주세요.';
})();
