// This file is bundled into the exported HTML. It performs no network requests.
(()=>{
  'use strict';
  const data=JSON.parse(document.getElementById('presentation-data').textContent),p=data.presentation;
  const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
  const number=v=>v===null||v===undefined?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
  const make=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
  const svgNode=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
  const metricNames={patients:'고유환자',new_patients:'신규 환자군',visits:'내원 횟수',treatment_total:'총진료비 · 대사 전',collection_recorded:'기록된 수납액 · 대사 전'};
  function bar(label,value,max,onClick){
    const row=make(onClick?'button':'div',undefined,'bar-row');if(onClick){row.type='button';row.addEventListener('click',onClick);}
    row.append(make('span',label,'bar-label'));const track=make('span',undefined,'bar-track'),fill=make('span',undefined,'bar-fill');
    fill.style.width=`${value===null?0:Math.min(100,Math.abs(value)/(max||1)*100)}%`;track.append(fill);row.append(track,make('strong',number(value)));return row;
  }
  function chart(){const key=$('chart-metric').value,values=[data.previous[key],data.metrics[key]],max=Math.max(...values.map(v=>Math.abs(v||0)));$('comparison-chart').replaceChildren(...values.map((v,i)=>bar((i?data.month:data.comparison_month)+' · '+metricNames[key],v,max)));}
  $('chart-metric').addEventListener('change',chart);chart();
  const channels=data.channels,maxChannel=Math.max(1,...channels.map(r=>r.patients||0));
  $('channel-chart').replaceChildren(...channels.map(r=>bar(r.label,r.patients,maxChannel,()=>{$('channel-detail').textContent=`${r.label} · 고유환자 ${number(r.patients)}명 · 내원 ${number(r.visits)}회`;})));
  if(!channels.length)$('channel-chart').append(make('p','해당 보고월의 경로 집계가 없습니다. 미관측을 0으로 표시하지 않습니다.'));
  $('print-report').addEventListener('click',()=>window.print());
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='브라우저 전체 화면(F11)';}});
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'전체 화면 종료':'전체 화면';});
  let printDetails=[];
  window.addEventListener('beforeprint',()=>{printDetails=[...document.querySelectorAll('details')].map(e=>[e,e.open]);for(const [e] of printDetails)e.open=true;});
  window.addEventListener('afterprint',()=>{for(const [e,open] of printDetails)e.open=open;printDetails=[];});
  if(!p){$('map-tools').hidden=true;$('map-empty').hidden=false;$('map-empty').textContent='저장된 지도 집계 없음';return;}
  let level='emd',features=[],rows=new Map(),view,home,focusView,selected=null,drag=null,skipClick=false;
  const svg=$('region-map');
  const extent=fs=>{let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;for(const f of fs)for(const ring of f.rs)for(const [x,y] of ring){minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);}const w=maxx-minx,h=maxy-miny;return {x:minx-w*.07,y:miny-h*.07,w:Math.max(w*1.14,100),h:Math.max(h*1.14,100)};};
  function detail(code){
    selected=code;$('region-select').value=code;const f=features.find(f=>f.code===code),r=rows.get(code),box=$('region-detail');box.replaceChildren(make('h3',f?.name||r?.name||'지역 선택'));
    if(!data.has_data){box.append(make('p','보고월 내원이 관측되지 않았습니다.'));return;}
    if(r?.suppressed){box.append(make('p','소수 지역 비공개 · 환자 수와 금액을 표시하지 않습니다.'));return;}
    const fields=[['고유환자','patients','명'],['신규 환자군','new_patients','명'],['내원 횟수','visits','회'],['평균 내원 횟수','average_visits','회'],['총진료비 · 대사 전','treatment_total','원'],['기록된 수납액 · 대사 전','collection_recorded','원']];
    for(const [label,key,unit] of fields){const v=r?r[key]:['patients','new_patients','visits'].includes(key)?0:null,entry=make('div',undefined,'detail-row');entry.append(make('span',label),make('strong',number(v)+(v===null||v===undefined?'':unit)));box.append(entry);}
    if(!r||r.patients===0)box.append(make('p','이 지역에 연결된 보고월 내원 기록이 없습니다.','muted'));
  }
  function render(){
    if(!view)return;svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);svg.replaceChildren();
    const max=Math.max(1,...[...rows.values()].map(r=>r.patients||0));
    for(const f of features){const r=rows.get(f.code),value=r?.patients,fill=r?.suppressed?'#e2e2e2':!value?'none':`hsl(251 62% ${94-Math.sqrt(value/max)*51}%)`;
      const path=svgNode('path',{d:f.path,fill,stroke:f.code===selected?'#23154f':'#aaa4be','stroke-width':f.code===selected?2.5:.8,'vector-effect':'non-scaling-stroke','fill-rule':'evenodd',tabindex:0,role:'button','aria-label':`${f.name} · ${!data.has_data?'미관측':r?.suppressed?'소수 지역 비공개':number(value||0)+'명'}`,'data-code':f.code});
      const title=svgNode('title',{});title.textContent=path.getAttribute('aria-label');path.append(title);
      path.addEventListener('click',()=>{if(!skipClick){detail(f.code);highlight();}});path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();detail(f.code);highlight();}});svg.append(path);
    }
    const labels=layoutLabels(features.map(f=>({code:f.code,name:f.label,point:f.point,area:f.area})),view,svg.clientWidth||800,svg.clientHeight||500,selected);
    for(const c of labels){const g=svgNode('g',{'pointer-events':'none','aria-hidden':'true'}),rect=svgNode('rect',{x:c.point[0]-c.labelWidth/2,y:c.point[1]-c.labelHeight/2,width:c.labelWidth,height:c.labelHeight,rx:c.labelHeight/2,fill:'white','fill-opacity':.88}),text=svgNode('text',{x:c.point[0],y:c.point[1],'text-anchor':'middle','dominant-baseline':'central','font-size':c.fontSize,fill:'#3b3650'});text.textContent=c.name;g.append(rect,text);svg.append(g);}
  }
  function highlight(){for(const node of svg.querySelectorAll('path')){const active=node.dataset.code===selected;node.setAttribute('stroke',active?'#23154f':'#aaa4be');node.setAttribute('stroke-width',active?'2.5':'.8');}}
  function load(){
    level=$('region-level').value;selected=null;rows=new Map(p.regions[level].map(r=>[r.code,r]));
    features=p.geometry[level].features.map(f=>{const rs=rings(f.geometry).map(r=>r.map(project)),xs=rs.flat().map(p=>p[0]),ys=rs.flat().map(p=>p[1]);let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;for(let i=0;i<xs.length;i++){minx=Math.min(minx,xs[i]);miny=Math.min(miny,ys[i]);maxx=Math.max(maxx,xs[i]);maxy=Math.max(maxy,ys[i]);}return {...f.properties,rs,point:labelPoint(rs),area:(maxx-minx)*(maxy-miny),path:rs.map(r=>'M'+r.map(p=>p.join(',')).join('L')+'Z').join('')};});
    const sorted=[...features].sort((a,b)=>(rows.get(b.code)?.patients||0)-(rows.get(a.code)?.patients||0)||a.name.localeCompare(b.name,'ko'));
    $('region-select').replaceChildren(new Option('지역을 선택하세요',''),...sorted.map(f=>new Option(f.name,f.code)));
    const c=p.coverage[level];$('map-coverage').textContent=data.has_data?`${level==='emd'?'법정동':'시군구'} 주소 연결 ${number(c.patients)}명 · ${number(c.percent)}% · 최신 기록 주소 기준`:'보고월 내원 미관측 · 주소 연결률을 계산하지 않습니다.';
    $('map-empty').hidden=features.length>0&&data.has_data;
    $('map-empty').textContent=!data.has_data?'보고월 내원 미관측': '지도에 연결할 지역 자료가 없습니다.';
    if(!features.length){view=null;svg.replaceChildren();$('region-detail').replaceChildren(make('h3','지역 집계 없음'));return;}
    const matched=features.filter(f=>rows.has(f.code)),visible=features.filter(f=>(rows.get(f.code)?.patients||0)>=5);
    home=extent(matched.length?matched:features);focusView=visible.length?extent(visible):home;view={...focusView};
    if(sorted.length)detail(sorted[0].code);render();
  }
  function zoom(factor){if(!view)return;const w=view.w*factor,h=view.h*factor;if(w<150||w>home.w*8)return;view={x:view.x+(view.w-w)/2,y:view.y+(view.h-h)/2,w,h};render();}
  $('region-level').addEventListener('change',load);$('zoom-in').addEventListener('click',()=>zoom(.7));$('zoom-out').addEventListener('click',()=>zoom(1/.7));
  $('map-reset').addEventListener('click',()=>{if(home){view={...home};render();}});
  $('map-focus').addEventListener('click',()=>{if(focusView){view={...focusView};render();}});
  $('region-select').addEventListener('change',()=>{const code=$('region-select').value,f=features.find(f=>f.code===code);if(!f)return;detail(code);view=extent([f]);render();});
  svg.addEventListener('pointerdown',e=>{if(!view)return;drag={x:e.clientX,y:e.clientY,view:{...view}};skipClick=false;});
  svg.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!skipClick&&Math.hypot(dx,dy)<5)return;skipClick=true;const scale=Math.min(svg.clientWidth/drag.view.w,svg.clientHeight/drag.view.h);view={...drag.view,x:drag.view.x-dx/scale,y:drag.view.y-dy/scale};render();});
  window.addEventListener('pointerup',()=>{drag=null;setTimeout(()=>{skipClick=false;},0);});svg.addEventListener('pointerleave',()=>{drag=null;});
  new ResizeObserver(()=>render()).observe(svg);
  let printState=null;window.addEventListener('beforeprint',()=>{printState={view,level,selected};$('region-level').value='emd';load();});
  window.addEventListener('afterprint',()=>{if(!printState)return;$('region-level').value=printState.level;load();view=printState.view;if(printState.selected)detail(printState.selected);render();printState=null;});
  load();
})();
