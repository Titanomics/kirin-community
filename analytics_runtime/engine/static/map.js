import {esc,num,compactMoney,empty,columnChart} from './charts.js';
import {seriesChart} from './reference-charts.js';
import {project,rings,labelPoint,layoutLabels,visibleTiles} from './map-layout.js';
import {addressDiagnostics,competitorContext,marketContext} from './regional-research.js';
import {apiFetch as fetch} from './scope.js';
const NS='http://www.w3.org/2000/svg';
const $=id=>document.getElementById(id);
const metricNames={patients:'내원 환자수',visits:'내원 횟수',new_patients:'신규 환자수',existing_patients:'재방문 환자수',treatment_total:'총진료비',collection_recorded:'기록된 수납액',change:'환자수 증감률'};
const node=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const moneyMetric=key=>['treatment_total','collection_recorded'].includes(key);

export class HeatMap{
  constructor(){this.level='emd';this.metric='patients';this.area='seoul';this.cache={};this.geometry={};this.selected=null;this.zoom=1;this.offset=[0,0];this.base=null;this.loadingId=0;this.tab='all';this.names=true;this.basemap=true;this.money='treatment';this.tiles=new Map();}
  async update(data,reset=false){
    this.campaigns?.invalidate();
    this.clinic?.invalidate();
    this.data=data;const id=++this.loadingId,level=this.level;
    if(!this.cache[level]){
      $('map-container').innerHTML=empty('지도 경계를 불러오고 있습니다.');
      try{
        const response=await fetch('/api/geo/'+level,{cache:'no-store'});
        if(!response.ok)throw Error('지도 경계를 읽지 못했습니다.');
        this.cache[level]=await response.json();
      }catch(error){if(id===this.loadingId){this.campaigns?.fail(error.message);this.clinic?.fail(error.message);}throw error;}
    }
    if(id!==this.loadingId)return;
    if(reset){this.zoom=1;this.offset=[0,0];this.selected=null;}
    this.draw();
    this.campaigns?.refresh();
    this.clinic?.refresh();
  }
  codeFor(f){return this.level==='sig'?f.properties.SIG_CD:f.properties.EMD_CD;}
  draw(){
    const items=this.data.regions[this.level];this.byCode=new Map(items.map(x=>[x.code,x]));
    if(!this.geometry[this.level])this.geometry[this.level]=this.cache[this.level].features.map(f=>{
      const rs=rings(f.geometry).map(r=>r.map(project));
      const bounds=rs.flat().reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
      return {f,rs,bounds,point:labelPoint(rs),area:(bounds[2]-bounds[0])*(bounds[3]-bounds[1])};
    });
    this.features=this.geometry[this.level].filter(({f})=>this.area==='all'||(this.area==='seoul'?f.properties.CTPRVN_CD==='11':['11','28','41'].includes(f.properties.CTPRVN_CD)));
    const bounds=this.features.reduce((b,x)=>[Math.min(b[0],x.bounds[0]),Math.min(b[1],x.bounds[1]),Math.max(b[2],x.bounds[2]),Math.max(b[3],x.bounds[3])],[Infinity,Infinity,-Infinity,-Infinity]);
    const dx=bounds[2]-bounds[0],dy=bounds[3]-bounds[1];
    this.base={x:bounds[0]-dx*.04,y:bounds[1]-dy*.04,w:dx*1.08,h:dy*1.08};
    const max=Math.max(1,...items.filter(x=>!x.suppressed&&x[this.metric]!=null).map(x=>Math.abs(x[this.metric])));
    const svg=node('svg',{'aria-label':'지역명이 표시된 실제 경계 히트맵','role':'group'});
    this.tileLayer=node('g',{'class':'basemap-layer','aria-hidden':'true'});svg.append(this.tileLayer);this.tiles=new Map();
    const g=node('g');svg.append(g);
    this.features.forEach(({f,rs})=>{
      const code=this.codeFor(f),item=this.byCode.get(code),value=item?.[this.metric];
      const path=node('path',{d:rs.map(r=>r.map((p,i)=>(i?'L':'M')+p.map(v=>v.toFixed(1)).join(',')).join(' ')+'Z').join(' '),fill:this.color(value,max,item?.suppressed),'fill-rule':'evenodd',class:'map-region'+(code===this.selected?' selected':''),'data-code':code,tabindex:'0',role:'button'});
      const caption=`${f.properties.FULL_NM} · ${item?.suppressed?'소수 집계 비공개':value==null?'기록 없음':metricNames[this.metric]+' '+num(value)}`;
      path.setAttribute('aria-label',caption);const title=node('title');title.textContent=caption;path.append(title);
      path.addEventListener('click',()=>{if(!this.dragMoved)this.select(code);});path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.select(code);}});g.append(path);
    });
    this.labelLayer=node('g',{'class':'map-label-layer'});svg.append(this.labelLayer);
    $('map-container').replaceChildren(svg);this.svg=svg;this.bindDrag(svg);
    const visibleCodes=new Set(this.features.map(x=>this.codeFor(x.f)));
    const ranked=items.filter(x=>!x.suppressed&&x.patients>0&&visibleCodes.has(x.code)).sort((a,b)=>(b[this.metric]??-Infinity)-(a[this.metric]??-Infinity)).slice(0,8);
    if(!visibleCodes.has(this.selected))this.selected=ranked[0]?.code||null;
    this.applyViewBox();this.select(this.selected);
    const coverage=this.data.region_coverage[this.level];$('map-coverage').textContent=`주소 연결 ${num(coverage.percent)}% · ${num(coverage.unmatched_patients)}명 미연결`;
    $('map-high').textContent=moneyMetric(this.metric)?compactMoney(max)+'원':this.metric==='change'?num(max)+'%':num(max);
    $('map-low').textContent=this.metric==='change'?'-'+num(max)+'%':'적음';
    document.querySelector('.gradient-bar').style.background=this.metric==='change'?'linear-gradient(90deg,#e7a6b5,#f3effc,hsl(251 62% 43%))':'';
    $('region-ranking').innerHTML=ranked.map((x,i)=>`<button class="ranking-row" data-code="${esc(x.code)}"><span class="ranking-number">${i+1}</span><span class="ranking-name">${esc(x.name)}</span><span class="ranking-value">${moneyMetric(this.metric)?compactMoney(x[this.metric])+'원':num(x[this.metric])}</span></button>`).join('')||empty();
    document.querySelectorAll('.ranking-row').forEach(b=>b.addEventListener('click',()=>this.focus(b.dataset.code)));
    $('map-explanation').innerHTML=`<p><strong>색상 기준</strong>기본은 선택 기간의 고유환자 수입니다. 내원 기록이 없는 지역은 채우지 않고, 환자 수가 적으면 연한 보라색, 많으면 진한 보라색으로 표시합니다. 같은 환자의 여러 내원은 한 명으로 셉니다. 지역을 누르면 금액도 확인할 수 있습니다.</p><p><strong>지도 집계 범위</strong>${num(coverage.patients)}명의 주소를 ${this.level==='sig'?'시군구':'법정동'} 경계와 연결했습니다. 행정동·소구역·반경 500m 분석은 해당 경계와 좌표 확보 전입니다.</p><p><strong>금액 기준</strong>총진료비와 수납액을 구분합니다. 원장 대사 전이며 매출 확정값이 아닙니다.</p><p><strong>배경지도</strong>공개 OpenStreetMap 타일만 요청합니다. 환자 주소·환자수·금액은 전송하지 않습니다. 배경을 끄면 외부 지도 요청 없이 경계와 지역명을 볼 수 있습니다.</p>`;
    $('map-search-list').innerHTML=this.features.map(({f})=>`<option value="${esc(f.properties.FULL_NM)}"></option>`).join('');
    $('map-explanation').insertAdjacentHTML('beforeend',addressDiagnostics(this.data));
    this.resizeObserver?.disconnect();this.resizeObserver=new ResizeObserver(()=>this.applyViewBox());this.resizeObserver.observe($('map-container'));
  }
  color(value,max,suppressed){if(suppressed)return '#e2e2e2';if(value==null||value===0)return 'none';const t=Math.min(1,Math.sqrt(Math.abs(value)/max));return value<0?`hsl(345 48% ${93-t*34}%)`:`hsl(251 62% ${94-t*51}%)`;}
  select(code){
    this.campaigns?.clearSelection();
    this.clinic?.clearSelection();
    this.selected=code;const feature=this.features?.find(x=>this.codeFor(x.f)===code);
    const item=this.byCode?.get(code)||(feature?{code,name:feature.f.properties.FULL_NM,patients:0,visits:0,new_patients:0,existing_patients:0,trend:[],changes:{}}:null);
    this.item=item;this.svg?.querySelectorAll('.selected').forEach(p=>p.classList.remove('selected'));this.svg?.querySelector(`.map-region[data-code="${code}"]`)?.classList.add('selected');
    this.detail();this.renderLabels();
  }
  detail(){
    if(this.clinic?.detail())return;
    if(this.campaigns?.detail())return;
    const el=$('map-detail'),item=this.item;
    if(!item){el.innerHTML=empty('지도의 지역을 선택해 주세요.');return;}
    const tabs=`<div class="detail-tabs" role="tablist" aria-label="지역 상세 보기">${[['region','지역'],['sales','매출'],['all','전체']].map(([key,name])=>`<button role="tab" aria-selected="${key===this.tab}" data-detail-tab="${key}" class="${key===this.tab?'active':''}">${name}</button>`).join('')}</div>`;
    el.innerHTML=tabs+`<h2 class="selected-region">${esc(item.name)}</h2><p class="detail-period">${this.data.period.start} ~ ${this.data.period.end} · ${this.level==='sig'?'시군구':'법정동'}</p>`;
    const totalKey=this.money==='treatment'?'treatment_total':'collection_recorded',moneyName=this.money==='treatment'?'총진료비':'수납액';
    const card=(label,key,format=num,note='')=>{const delta=item.changes?.[key];return `<div class="reference-stat ${delta<0?'negative':''}"><span>${label}</span>${delta!=null?`<small class="stat-delta">${delta>=0?'↗':'↘'} ${num(Math.abs(delta))}%</small>`:''}<strong>${item.suppressed?'—':format(item[key])}</strong>${note?`<em>${note}</em>`:''}</div>`;};
    const publicData=this.data.regional_context,local=publicData?.regions?.[this.level]?.[item.code];
    const missingReason=publicData?.connected?'현재 공개자료 범위에서 코드·명칭·집계 단위를 확인하지 못했습니다. 0명으로 표시하지 않습니다.':'지역 인구 자료 미연결';
    const populationTitle=this.level==='sig'?'공개 법정읍면동 인구 합산':local?.aggregation==='published_ri_sum'?'공개 리 인구 합계':'주민등록 인구';
    const populationNote=!local?missingReason:this.level==='sig'?`${local.included_dongs}/${local.boundary_dongs}개 경계 지역 연결 · ${local.complete?'공개자료 연결 범위 확인':'자료 범위 불완전'}${local.ri_aggregated_dongs?' · 리 합계 '+local.ri_aggregated_dongs+'지역 포함':''}`:local.aggregation==='published_ri_sum'?`공개 리 ${local.included_ris}개 합계 · 전체 리 포함 여부 미확인`:'명 · 내원 환자와 별도 통계';
    const publicCard=(label,value,note)=>`<div class="reference-stat ${value==null?'unavailable':''}"><span>${esc(label)}</span><strong>${value==null?'—':num(value)}</strong><em>${esc(note)}</em></div>`;
    const region=`<div class="detail-column region-data"><h3>지역 데이터</h3>${local?`<p class="detail-period">인구 기준 ${esc(publicData.as_of)} · 행정안전부<br>경계 배포본 ${esc(publicData.boundary_version)} · 코드·명칭 일치 확인<br>시점 사이 경계 변경 여부는 미검증</p>`:''}<div class="reference-stat-grid">${publicCard('평균 연령 · 근사',local?.average_age,local?(local.complete===false?'공개된 부분집합 평균 · 110세 이상은 110세로 계산':'세 · 110세 이상은 110세로 계산'):missingReason)}${publicCard(populationTitle,local?.population,populationNote)}</div><h4>성별 주민등록 인구</h4>${local?`<div class="detail-chart">${columnChart([{label:'남성',value:local.male},{label:'여성',value:local.female}],'value','#85b4eb',{width:350})}</div><h4>성별 평균 연령 · 근사</h4><div class="reference-stat-grid">${publicCard('남성',local.male_average_age,'세')}${publicCard('여성',local.female_average_age,'세')}</div><h4>지역 연령 분포</h4><div class="detail-chart">${columnChart(local.age_bands,'value','#a59ae0',{width:350})}</div><p class="detail-note">환자 조회 ${esc(this.data.period.start)} ~ ${esc(this.data.period.end)} / 인구 ${esc(publicData.as_of)}. 자료 시점과 포함 범위를 확인하기 전에는 내원 비율을 계산하지 않습니다. ${this.level==='sig'?esc(publicData.district_note):local.aggregation==='published_ri_sum'?esc(publicData.ri_note):''}</p><p class="detail-note">${esc(publicData.scope)}<br><a href="https://www.data.go.kr/data/15099158/fileData.do" target="_blank" rel="noopener noreferrer">행정안전부 공개자료 출처</a> · 파일 확인 ${esc(new Date(publicData.checked_at).toLocaleString('ko-KR'))}</p>`:`<div class="missing-chart">${esc(missingReason)}</div>`}</div>`;
    const sales=`<div class="detail-column sales-data"><h3>매출 데이터 <small>${moneyName} 기준 · 대사 전</small></h3>${item.suppressed?'<div class="empty-state">고유환자 5명 미만 지역입니다.<br>환자수와 금액을 표시하지 않습니다.</div>':`<div class="reference-stat-grid">${card('내원 횟수','visits')}${card('누적 '+moneyName,totalKey,v=>compactMoney(v)+'원')}${card('내원당 평균 '+moneyName,this.money+'_per_visit',v=>compactMoney(v)+'원')}${card('1인당 평균 '+moneyName,this.money+'_per_patient',v=>compactMoney(v)+'원')}${card('재방문 환자수','existing_patients',num,'선택기간 신규군 제외')}${card('신규 환자수','new_patients')}${card('지역 총진료비 순위','rank',num,'공개 집계 지역 기준')}${card('유입률','inflow_rate',v=>v==null?'—':num(v)+'%','같은 기준일·포함 범위 확인 필요')}</div><h4>${moneyName} 변화 추이</h4><div class="detail-chart">${seriesChart(item.trend||[],[{key:totalKey,label:moneyName,color:'#4499e5'}],{money:true,height:210,width:350})}</div><h4>연령대별 환자 분포</h4><div class="detail-chart">${columnChart(item.demographics?.age||[],'value','#85b4eb',{width:350})}</div>`}</div>`;
    el.innerHTML+=`<div class="region-visit-summary"><span>내원 환자수 <strong>${item.suppressed?'—':num(item.patients)}명</strong></span><span>평균 내원 <strong>${item.suppressed?'—':num(item.average_visits)}회</strong></span></div><div class="detail-columns ${this.tab==='all'?'both':'single'}">${this.tab!=='sales'?region:''}${this.tab!=='region'?sales:''}</div><p class="detail-note">— : 미확인·자료 미연결·소수 집계 비공개. 결측 금액이 있으면 평균 금액은 표시하지 않습니다. 유입률은 해당 지역 환자수 ÷ 지역 전체 인구입니다. 소수 월·연령이 포함된 경우 해당 분포는 비공개입니다. ${esc(this.data.definitions.cohorts)}</p>`;
    el.querySelector('.region-data > .reference-stat-grid')?.insertAdjacentHTML('afterend',marketContext(this.data.market_context,this.level,item.code)+competitorContext(this.data.competitors,this.level,item.code));
    el.querySelectorAll('[data-detail-tab]').forEach(b=>b.addEventListener('click',()=>{this.tab=b.dataset.detailTab;this.detail();}));
    el.querySelector('.detail-period').insertAdjacentHTML('afterend',`<button class="button secondary marketing-map-action" data-strategy-region="${esc(item.code)}" data-strategy-level="${this.level}">이 지역으로 전략 작성</button>`);
  }
  applyViewBox(){
    if(!this.svg||!this.base)return;const b=this.base,w=b.w/this.zoom,h=b.h/this.zoom;
    this.view={x:b.x+(b.w-w)/2+this.offset[0],y:b.y+(b.h-h)/2+this.offset[1],w,h};
    this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${w} ${h}`);this.renderLabels();
    clearTimeout(this.tileTimer);this.tileTimer=setTimeout(()=>this.renderTiles(),160);
    this.svg.classList.toggle('with-basemap',this.basemap);
    this.campaigns?.render();
    this.clinic?.render();
  }
  renderLabels(){
    if(!this.labelLayer||!this.view)return;this.labelLayer.replaceChildren();if(!this.names)return;
    const box=this.svg.getBoundingClientRect();
    const candidates=this.features.map(x=>({...x,code:this.codeFor(x.f),name:this.level==='sig'?x.f.properties.SIG_KOR_NM:x.f.properties.EMD_KOR_NM}));
    const placed=layoutLabels(candidates,this.view,box.width,box.height,this.selected);
    for(const x of placed){
      const group=node('g',{class:'region-name'+(x.code===this.selected?' chosen':''),'data-code':x.code,role:'button',tabindex:0,'aria-label':x.f.properties.FULL_NM});
      const rect=node('rect',{x:x.point[0]-x.labelWidth/2,y:x.point[1]-x.labelHeight/2,width:x.labelWidth,height:x.labelHeight,rx:x.labelHeight/2});
      const text=node('text',{x:x.point[0],y:x.point[1],'text-anchor':'middle','dominant-baseline':'central','font-size':x.fontSize});text.textContent=x.name;
      group.append(rect,text);group.addEventListener('click',()=>{if(!this.dragMoved)this.select(x.code);});group.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.select(x.code);}});this.labelLayer.append(group);
    }
  }
  renderTiles(){
    if(!this.tileLayer||!this.view)return;$('osm-credit').hidden=!this.basemap;
    if(!this.basemap){this.tileLayer.replaceChildren();this.tiles.clear();return;}
    const box=this.svg.getBoundingClientRect();if(!box.width||!box.height)return;
    const tiles=visibleTiles(this.view,box.width,box.height),keys=new Set(tiles.map(t=>t.key));
    for(const[key,img]of this.tiles)if(!keys.has(key)){img.remove();this.tiles.delete(key);}
    for(const t of tiles)if(!this.tiles.has(t.key)){
      const img=node('image',{x:t.x,y:t.y,width:t.size,height:t.size,href:`https://tile.openstreetmap.org/${t.key}.png`});
      img.addEventListener('error',()=>{$('map-tile-status').textContent='배경 연결 실패 · 지역 경계와 집계는 표시됩니다.';},{once:true});
      this.tileLayer.append(img);this.tiles.set(t.key,img);
    }
  }
  focus(code){
    const x=this.features?.find(x=>this.codeFor(x.f)===code);if(!x)return;
    const [left,top,right,bottom]=x.bounds,cx=(left+right)/2,cy=(top+bottom)/2;
    this.zoom=Math.min(40,Math.max(1,Math.min(this.base.w/Math.max(500,(right-left)*2.8),this.base.h/Math.max(500,(bottom-top)*2.8))));
    this.offset=[cx-(this.base.x+this.base.w/2),cy-(this.base.y+this.base.h/2)];this.select(code);this.applyViewBox();
  }
  search(text){const match=this.features?.find(({f})=>f.properties.FULL_NM===text)||this.features?.find(({f})=>f.properties.FULL_NM.endsWith(' '+text));if(match){this.focus(this.codeFor(match.f));return true;}return false;}
  zoomBy(factor){this.zoom=Math.max(1,Math.min(60,this.zoom*factor));this.applyViewBox();}
  reset(){this.zoom=1;this.offset=[0,0];this.applyViewBox();}
  bindDrag(svg){
    let drag=null;this.dragMoved=false;
    svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,ox:this.offset[0],oy:this.offset[1]};this.dragMoved=false;});
    svg.addEventListener('pointermove',e=>{if(!drag)return;const box=svg.getBoundingClientRect(),scale=Math.min(box.width/this.view.w,box.height/this.view.h),dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)this.dragMoved=true;if(this.dragMoved){this.offset=[drag.ox-dx/scale,drag.oy-dy/scale];this.applyViewBox();}});
    svg.addEventListener('pointerup',()=>{drag=null;});svg.addEventListener('pointerleave',()=>{drag=null;});
    svg.addEventListener('wheel',e=>{e.preventDefault();this.zoomBy(e.deltaY<0?1.2:1/1.2);},{passive:false});
    svg.addEventListener('dblclick',e=>{e.preventDefault();this.zoomBy(1.7);});
  }
}
