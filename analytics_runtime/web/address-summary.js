(() => {
  const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
  const node=(tag,attrs={})=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const data=JSON.parse(atob($('map-container').dataset.map)),total=data.total;
  const rows=data.rows.map((r,id)=>({...r,id,point:r.location?project([r.location.longitude,r.location.latitude]):null}));
  const features=data.features.map(f=>{
    const rs=rings(f.geometry).map(r=>r.map(project));
    const bounds=rs.flat().reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
    return {f,rs,bounds,point:labelPoint(rs),area:(bounds[2]-bounds[0])*(bounds[3]-bounds[1]),code:f.properties.EMD_CD,name:f.properties.EMD_KOR_NM};
  });
  const totals=new Map();for(const r of rows)if(r.region_code)totals.set(r.region_code,(totals.get(r.region_code)||0)+r.records);
  const extent=items=>{const b=items.reduce((b,f)=>[Math.min(b[0],f.bounds[0]),Math.min(b[1],f.bounds[1]),Math.max(b[2],f.bounds[2]),Math.max(b[3],f.bounds[3])],[Infinity,Infinity,-Infinity,-Infinity]);const w=Math.max(700,b[2]-b[0]),h=Math.max(700,b[3]-b[1]);return {x:(b[0]+b[2]-w*1.6)/2,y:(b[1]+b[3]-h*1.6)/2,w:w*1.6,h:h*1.6};};
  const located=rows.filter(r=>r.point),pointExtent=items=>extent(items.map(r=>({bounds:[...r.point,...r.point]})));
  const matched=features.filter(f=>totals.has(f.code));
  const regionHome=features.length?extent(matched.length?matched:features):null,home=located.length?pointExtent(located):regionHome;
  let view=home?{...home}:null,selected=null,selectedApartment=null,unit=located.length?'apartment':'region',drag=null,moved=false,tileTimer;
  const svg=node('svg',{'aria-label':'지역명과 아파트명이 표시된 지역 분포 지도',role:'group'});
  const tiles=node('g',{class:'basemap-layer','aria-hidden':'true'}),areas=node('g'),labels=node('g',{class:'map-label-layer'}),apartments=node('g',{class:'apartment-layer'});
  svg.append(tiles,areas,labels,apartments);$('map-container').append(svg);
  const images=new Map(),maximum=Math.max(1,...totals.values()),maxApartment=Math.max(1,...rows.map(r=>r.records));
  const basemapAllowed=$('map-container').dataset.basemap==='true';
  const activate=(element,fn)=>{element.addEventListener('click',()=>{if(!moved)fn();});element.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}});};
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
      group.append(rect,text);activate(group,()=>{select(f.code);focus(f.code);});labels.append(group);
    }
  }
  function renderApartments(){
    apartments.replaceChildren();if(!view||unit!=='apartment')return;
    const box=svg.getBoundingClientRect(),scale=Math.min(box.width/view.w,box.height/view.h);if(!scale)return;
    const ox=(box.width-view.w*scale)/2,oy=(box.height-view.h*scale)/2,placed=[];
    const visible=located.filter(r=>!selected||r.region_code===selected).sort((a,b)=>(b.id===selectedApartment)-(a.id===selectedApartment)||b.records-a.records);
    for(const r of visible){
      const x=(r.point[0]-view.x)*scale+ox,y=(r.point[1]-view.y)*scale+oy;
      if(x<0||y<0||x>box.width||y>box.height)continue;
      const chosen=r.id===selectedApartment,radius=6+12*Math.sqrt(r.records/maxApartment);
      const group=node('g',{class:'apartment-marker'+(chosen?' chosen':''),'data-apartment':r.id,role:'button',tabindex:0,'aria-label':`${r.name} · ${r.records}건`});
      const title=node('title');title.textContent=`${r.name} · ${r.records}건 · ${r.address}`;
      const circle=node('circle',{cx:r.point[0],cy:r.point[1],r:radius/scale,fill:`hsl(251 62% ${70-Math.sqrt(r.records/maxApartment)*27}%)`});group.append(title,circle);
      if($('map-apartment-names').checked){
        const chunks=Math.ceil(r.name.length/16),length=Math.ceil(r.name.length/chunks),lines=Array.from({length:chunks},(_,i)=>r.name.slice(i*length,(i+1)*length));
        const w=Math.min(194,Math.max(110,...lines.map(s=>s.length*10+20))),h=lines.length*15+24,candidates=[];
        for(const gap of [radius+8,50,95,145,200])for(const [dx,dy] of [[gap,-h/2],[-w-gap,-h/2],[-w/2,-h-gap],[-w/2,gap],[gap,-h-gap],[-w-gap,gap]]){
          const left=Math.max(8,Math.min(box.width-w-8,x+dx)),top=Math.max(134,Math.min(box.height-h-70,y+dy)),b={left,top,right:left+w,bottom:top+h};
          if(!placed.some(p=>b.left<p.right+5&&b.right>p.left-5&&b.top<p.bottom+5&&b.bottom>p.top-5))candidates.push(b);
        }
        const b=candidates[0];
        if(b){
          placed.push(b);const px=(b.left-ox)/scale+view.x,py=(b.top-oy)/scale+view.y;
          const line=node('line',{x1:r.point[0],y1:r.point[1],x2:px+(x<b.left?0:x>b.right?w:w/2)/scale,y2:py+h/2/scale,class:'apartment-leader'});
          const label=node('g',{class:'apartment-name'});label.append(node('rect',{x:px,y:py,width:w/scale,height:h/scale,rx:4/scale}));
          const text=node('text',{x:px+10/scale,y:py+14/scale,'font-size':10/scale});
          for(let i=0;i<lines.length;i++){const span=node('tspan',{x:px+10/scale,dy:i?15/scale:0});span.textContent=lines[i];text.append(span);}
          const count=node('tspan',{x:px+10/scale,dy:17/scale,class:'apartment-count'});count.textContent=r.records.toLocaleString('ko-KR')+'건';text.append(count);label.append(text);group.append(line,label);
        }
      }
      activate(group,()=>pickApartment(r.id));apartments.append(group);
    }
  }
  function applyView(){
    if(!view)return;svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);renderLabels();renderApartments();
    clearTimeout(tileTimer);tileTimer=setTimeout(renderTiles,160);
  }
  function updateUnit(){
    svg.classList.toggle('apartment-view',unit==='apartment');
    $('unit-apartment').setAttribute('aria-pressed',String(unit==='apartment'));$('unit-region').setAttribute('aria-pressed',String(unit==='region'));
    $('map-legend-text').textContent=unit==='apartment'?'원 크기: 단지 기록 수 · 선 끝: 주소 대표 위치':'채움 없음: 자료 없음';
    $('map-location-status').textContent=`단지 위치 확인 ${located.length}/${rows.length}개 · 이름이 겹치면 확대하거나 목록에서 선택하세요.${located.length<rows.length?' · 위치 미확인 단지는 목록에서 확인':''}`;
  }
  function select(code,id=null){
    selected=code||null;selectedApartment=id;const apartment=rows.find(r=>r.id===id);
    document.querySelectorAll('[data-row]').forEach(row=>row.classList.toggle('selected',apartment?row.querySelector('th').textContent===apartment.name:!!code&&row.dataset.region===code));
    areas.querySelectorAll('.region').forEach(region=>region.classList.toggle('selected',!!code&&region.dataset.region===code));
    const f=features.find(f=>f.code===code),items=rows.filter(r=>!code||r.region_code===code).sort((a,b)=>b.records-a.records),amount=apartment?apartment.records:code?totals.get(code):total;
    $('selected-region').textContent=apartment?.name||f?.f.properties.FULL_NM||'전체 단지';
    $('detail-level').textContent=data.period+' · '+(apartment?'아파트':code?'법정동 내 단지':'전체 단지');
    $('region-records').textContent=amount===undefined?'—':amount.toLocaleString('ko-KR')+'건';
    $('region-share').textContent=amount===undefined?'—':(amount/total*100).toFixed(1)+'%';
    $('region-complexes').textContent=apartment?'1개 단지':amount===undefined?'—':items.length+'개 단지';
    $('within-region').hidden=!apartment;const regionTotal=apartment?totals.get(apartment.region_code):null;
    $('within-region-title').textContent=(f?.name||'해당 동')+' 제공 자료 내 비중';
    $('within-region-share').textContent=regionTotal?(apartment.records/regionTotal*100).toFixed(1)+'%':'—';
    $('selection').textContent=apartment?apartment.address:amount===undefined?'이 지역은 제공된 단지 집계가 없습니다.':`제공된 ${rows.length}개 단지 ${total.toLocaleString('ko-KR')}건 기준 · 단지 이름을 누르면 상세 위치로 이동합니다.`;
    $('location-source').hidden=!apartment?.location;
    if(apartment?.location){$('location-source').href=apartment.location.source_url;$('location-source').textContent=apartment.location.source_name+' ↗';}
    $('apartment-location-note').hidden=!apartment;
    $('apartment-location-note').textContent=apartment?.location?'도로명주소 대표 위치입니다. 실제 단지 경계나 개별 동·호수 분포를 뜻하지 않습니다.':'이 단지는 확인된 위치 좌표가 없어 지도에 점을 표시하지 않습니다.';
    $('region-apartments').replaceChildren(...items.map(r=>{
      const button=document.createElement('button');button.className='detail-row'+(r.id===id?' active':'');button.dataset.apartmentRow=r.id;
      const name=document.createElement('span'),value=document.createElement('strong');name.textContent=r.name;const denominator=code?totals.get(code):total;
      value.textContent=r.records.toLocaleString('ko-KR')+'건'+(denominator?' · '+(r.records/denominator*100).toFixed(1)+'%':'');
      button.append(name,value);button.addEventListener('click',()=>pickApartment(r.id));return button;
    }));$('apartment-list-title').textContent=code?'이 법정동의 단지 · 동 내 비중':'전체 단지 · 전체 비중';renderLabels();renderApartments();
  }
  function focus(code){
    const points=located.filter(r=>r.region_code===code),f=features.find(f=>f.code===code);
    if(unit==='apartment'&&points.length)view=pointExtent(points);else if(f)view=extent([f]);else return;applyView();
  }
  function pickApartment(id){
    const r=rows.find(r=>r.id===id);if(!r)return;unit='apartment';updateUnit();select(r.region_code,r.id);
    if(r.point){view=pointExtent([r]);applyView();}else focus(r.region_code);
  }
  for(const f of features){
    const amount=totals.get(f.code),fill=amount?`hsl(251 62% ${94-Math.sqrt(amount/maximum)*51}%)`:'none',caption=f.f.properties.FULL_NM+' · '+(amount===undefined?'자료 없음':amount.toLocaleString('ko-KR')+'건');
    const path=node('path',{d:f.rs.map(r=>'M'+r.map(p=>p.map(n=>n.toFixed(1)).join(',')).join('L')+'Z').join(''),fill,'fill-rule':'evenodd',class:'map-region region','data-region':f.code,tabindex:0,role:'button','aria-label':caption});
    const title=node('title');title.textContent=caption;path.append(title);activate(path,()=>{select(f.code);focus(f.code);});areas.append(path);$('map-search-list').append(new Option(f.f.properties.FULL_NM,f.f.properties.FULL_NM));
  }
  for(const r of rows)$('map-search-list').append(new Option(r.name,r.name));
  function search(){
    const text=$('map-search').value.trim(),r=rows.find(r=>r.name===text),f=features.find(f=>f.f.properties.FULL_NM===text)||features.find(f=>f.name===text);
    if(r){pickApartment(r.id);$('map-search-status').textContent='';}else if(f){select(f.code);focus(f.code);$('map-search-status').textContent='';}else $('map-search-status').textContent='보고서에 포함된 법정동이나 아파트명을 선택해 주세요.';
  }
  function zoom(factor){if(!view)return;const w=view.w/factor,h=view.h/factor;if(w<150||w>Math.max(home.w,regionHome?.w||0)*8)return;view={x:view.x+(view.w-w)/2,y:view.y+(view.h-h)/2,w,h};applyView();}
  $('unit-apartment').addEventListener('click',()=>{unit='apartment';updateUnit();if(selected)focus(selected);else if(home){view={...home};applyView();}});
  $('unit-region').addEventListener('click',()=>{unit='region';updateUnit();select(selected);if(selected)focus(selected);else if(regionHome){view={...regionHome};applyView();}});
  $('map-search-go').addEventListener('click',search);$('map-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search();}});
  $('zoom-in').addEventListener('click',()=>zoom(1.35));$('zoom-out').addEventListener('click',()=>zoom(1/1.35));
  $('map-reset').addEventListener('click',()=>{const target=unit==='apartment'?home:regionHome;if(target){select('');view={...target};applyView();}});
  $('map-names').addEventListener('change',renderLabels);$('map-apartment-names').addEventListener('change',renderApartments);$('map-basemap').addEventListener('change',()=>{$('map-tile-status').textContent='';renderTiles();});
  window.addEventListener('offline',renderTiles);window.addEventListener('online',renderTiles);
  svg.addEventListener('pointerdown',e=>{if(e.button!==0||!view)return;drag={x:e.clientX,y:e.clientY,view:{...view}};moved=false;});
  svg.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)moved=true;if(moved){const box=svg.getBoundingClientRect(),scale=Math.min(box.width/drag.view.w,box.height/drag.view.h);view={...drag.view,x:drag.view.x-dx/scale,y:drag.view.y-dy/scale};applyView();}});
  window.addEventListener('pointerup',()=>{drag=null;});svg.addEventListener('pointerleave',()=>{drag=null;});
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2);},{passive:false});svg.addEventListener('dblclick',e=>{e.preventDefault();zoom(1.7);});
  document.querySelectorAll('[data-pick]').forEach(button=>button.addEventListener('click',()=>{const name=button.querySelector('.bar-name').textContent;pickApartment(rows.find(r=>r.name===name).id);}));
  $('clear-selection').addEventListener('click',()=>{select('');if(home){view={...(unit==='apartment'?home:regionHome||home)};applyView();}});$('print').addEventListener('click',()=>window.print());
  new ResizeObserver(applyView).observe($('map-container'));updateUnit();
  if(view){select([...totals].sort((a,b)=>b[1]-a[1])[0]?.[0]||'');if(located.length)focus(selected);applyView();}else $('map-tile-status').textContent='확인된 지도 경계와 단지 위치가 없습니다. 주소별 목록을 확인해 주세요.';
})();
