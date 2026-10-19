export const palette=['#8975cd','#a893dd','#beb0e6','#76c5b2','#a9dace','#d8d0ee','#e8e5f0','#bdc6d6','#e4e8ef'];
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num=value=>value==null?'—':Number(value).toLocaleString('ko-KR',{maximumFractionDigits:1});
export const won=value=>value==null?'—':num(value)+'원';
export function compactMoney(value){if(value==null)return '—';const a=Math.abs(value);return a>=1e8?num(value/1e8)+'억':a>=1e4?num(value/1e4)+'만':num(value);}
export function empty(message='조회 기간에 기록이 없습니다.'){return `<div class="empty-state">${esc(message)}</div>`;}

export function bars(items,{key='patients',limit=7,money=false}={}){
  if(!items.length)return empty();
  const sorted=items.slice(0,limit),max=Math.max(1,...sorted.map(x=>Number(x[key])||0));
  return `<div class="bars">${sorted.map(x=>`<div class="bar-row"><span class="bar-label" title="${esc(x.label)}">${esc(x.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Number(x[key])||0)/max*100}%"></div></div><strong class="bar-value">${money?compactMoney(x[key]):num(x[key])}</strong></div>`).join('')}</div>`;
}

export function lineChart(items,series=[{key:'patients',color:'#8975cd'},{key:'new_patients',color:'#76c5b2'}]){
  if(!items.length)return empty();
  const w=670,h=252,p={l:38,r:15,t:16,b:36};
  const values=items.flatMap(x=>series.map(s=>Number(x[s.key])||0));
  const max=Math.max(10,Math.ceil(Math.max(...values)*1.14/50)*50);
  const x=i=>p.l+(items.length===1?.5:i/(items.length-1))*(w-p.l-p.r);
  const y=v=>h-p.b-(Number(v)||0)/max*(h-p.t-p.b);
  let content='';
  for(let i=0;i<=4;i++){const v=max*i/4;content+=`<line class="grid-line" x1="${p.l}" x2="${w-p.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${p.l-10}" y="${y(v)+3}" text-anchor="end">${num(v)}</text>`;}
  const step=Math.max(1,Math.ceil(items.length/12));
  items.forEach((d,i)=>{if(i%step===0||i===items.length-1)content+=`<text class="month-label" x="${x(i)}" y="${h-9}" text-anchor="middle">${esc((d.month||d.label).replace(/^20\d{2}-/,''))}${d.month?'월':''}</text>`;});
  series.forEach((s,j)=>{
    const points=items.map((d,i)=>[x(i),y(d[s.key])]);
    const path=points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');
    if(j===0)content+=`<path d="${path} L${x(items.length-1)},${h-p.b} L${x(0)},${h-p.b}Z" fill="${s.color}" opacity=".055"/>`;
    content+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    points.forEach((p,i)=>{content+=`<circle class="chart-point" cx="${p[0]}" cy="${p[1]}" r="3" fill="white" stroke="${s.color}" stroke-width="1.7"><title>${esc(items[i].month||items[i].label)}: ${num(items[i][s.key])}</title></circle>`;});
  });
  return `<svg role="img" aria-label="월별 추이 차트" viewBox="0 0 ${w} ${h}">${content}</svg>`;
}

export function columnChart(items,key='value',color='#a18cd7',{money=false,width=610}={}){
  if(!items.length)return empty();
  const w=Math.min(width,Math.max(300,(globalThis.innerWidth||668)-58)),h=235,p={l:18,r:10,t:25,b:42},max=Math.max(1,...items.map(x=>x[key]||0))*1.1;
  const slot=(w-p.l-p.r)/items.length,bw=Math.min(36,slot*.5),baseline=h-p.b;
  let content='';
  for(let i=0;i<4;i++){let y=p.t+(baseline-p.t)*i/3;content+=`<line class="grid-line" x1="${p.l}" x2="${w-p.r}" y1="${y}" y2="${y}"/>`;}
  content+=items.map((d,i)=>{const x=p.l+slot*i+slot/2,bh=(Number(d[key])||0)/max*(baseline-p.t),label=w<400?String(d.label).replace('세 이상','+'):d.label;return `<rect x="${x-bw/2}" y="${baseline-bh}" width="${bw}" height="${Math.max(0,bh)}" rx="4" fill="${color}"><title>${esc(d.label)}: ${num(d[key])}</title></rect><text class="chart-value" x="${x}" y="${baseline-bh-7}" text-anchor="middle">${money?compactMoney(d[key]):num(d[key])}</text><text class="month-label" x="${x}" y="${h-10}" text-anchor="middle">${esc(label)}</text>`;}).join('');
  return `<svg role="img" aria-label="항목별 막대 차트" viewBox="0 0 ${w} ${h}">${content}</svg>`;
}

export function donut(items,totalLabel='고유환자'){
  const valid=items.filter(x=>x.value>0);if(!valid.length)return empty();
  const total=valid.reduce((s,x)=>s+x.value,0),r=58,c=2*Math.PI*r;let offset=0;
  let circles=valid.map((x,i)=>{const length=x.value/total*c;const out=`<circle cx="75" cy="75" r="${r}" fill="none" stroke="${palette[i%palette.length]}" stroke-width="19" stroke-dasharray="${Math.max(0,length-2)} ${c}" stroke-dashoffset="${-offset}"><title>${esc(x.label)} ${num(x.value)}</title></circle>`;offset+=length;return out;}).join('');
  return `<div class="donut-wrap"><div class="donut-visual"><svg viewBox="0 0 150 150" role="img" aria-label="${esc(totalLabel)} 분포">${circles}</svg><div class="donut-center">${num(total)}<span>${esc(totalLabel)}</span></div></div><div class="donut-legend">${valid.map((x,i)=>`<div><i class="dot" style="background:${palette[i%palette.length]}"></i><span>${esc(x.label)}</span><b>${Math.round(x.value/total*100)}%</b></div>`).join('')}</div></div>`;
}

export function table(rows,columns){
  if(!rows.length)return empty('표시할 보고서가 없습니다.');
  return `<table><thead><tr>${columns.map(c=>`<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${c.render?c.render(r[c.key],r):c.number?num(r[c.key]):esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
