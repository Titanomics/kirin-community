import {esc,num,compactMoney,empty} from './charts.js';
export function seriesChart(items,series,{money=false,height=300,width=1000}={}){
  if(!items.length)return empty();
  const mobile=(globalThis.innerWidth||1200)<=640,w=mobile?Math.max(300,globalThis.innerWidth-58):width,h=mobile?240:height,p={l:62,r:26,t:22,b:38},values=items.flatMap(x=>series.map(s=>x[s.key])).filter(v=>v!=null&&Number.isFinite(v));
  if(!values.length)return empty('집계 가능한 값이 없습니다.');
  let lo=Math.min(0,...values),hi=Math.max(1,...values);const pad=(hi-lo)*.1;hi+=pad;if(lo<0)lo-=pad;
  const x=i=>p.l+(items.length===1?.5:i/(items.length-1))*(w-p.l-p.r),y=v=>h-p.b-(v-lo)/(hi-lo)*(h-p.t-p.b);
  let svg='';for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4;svg+=`<line x1="${p.l}" x2="${w-p.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eef1f4"/><text x="${p.l-8}" y="${y(v)+4}" text-anchor="end" class="axis-label">${money?compactMoney(v):num(v)}</text>`;}
  const ticks=mobile||width<500?4:13,indices=new Set(Array.from({length:Math.min(ticks,items.length)},(_,i)=>Math.round(i*(items.length-1)/Math.max(1,Math.min(ticks,items.length)-1))));items.forEach((d,i)=>{if(indices.has(i))svg+=`<text x="${x(i)}" y="${h-9}" text-anchor="middle" class="axis-label">${esc((d.month||d.label||'').replace(/^20/,''))}</text>`;});
  for(const s of series){let path='',active=false;for(let i=0;i<items.length;i++){const value=items[i][s.key];if(value==null){active=false;continue;}path+=(active?'L':'M')+x(i)+','+y(value)+' ';active=true;svg+=`<circle cx="${x(i)}" cy="${y(value)}" r="${items.length>90?1:2.4}" fill="${s.color}"><title>${esc(items[i].month||items[i].label)} ${esc(s.label)}: ${num(value)}${money?'원':''}</title></circle>`;}svg+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="1.7" stroke-linejoin="round"/>`;}
  return `<svg role="img" aria-label="${esc(series.map(x=>x.label).join(' / '))} 추이" viewBox="0 0 ${w} ${h}">${svg}</svg>`;
}
export function groupedColumns(items,series){
  if(!items.length)return empty();
  const w=Math.min(680,Math.max(300,(globalThis.innerWidth||738)-58)),h=255,p={l:35,r:12,t:24,b:38},max=Math.max(1,...items.flatMap(x=>series.map(s=>x[s.key]||0)))*1.12,slot=(w-p.l-p.r)/items.length,bw=Math.min(24,slot/(series.length+1));
  let out='';for(let i=0;i<4;i++){const y=p.t+(h-p.b-p.t)*i/3;out+=`<line x1="${p.l}" x2="${w-p.r}" y1="${y}" y2="${y}" stroke="#eef1f4"/>`;}
  items.forEach((d,i)=>{series.forEach((s,j)=>{const v=d[s.key],bh=(v||0)/max*(h-p.t-p.b),x=p.l+slot*(i+.5)+(j-series.length/2)*bw;out+=`<rect x="${x}" y="${h-p.b-bh}" width="${bw-3}" height="${Math.max(0,bh)}" fill="${s.color}"><title>${esc(d.label)} ${esc(s.label)} ${num(v)}</title></rect>`;});out+=`<text x="${p.l+slot*(i+.5)}" y="${h-12}" class="axis-label" text-anchor="middle">${esc(d.label)}</text>`;});
  return `<svg role="img" aria-label="${esc(series.map(x=>x.label).join(' / '))} 요일별 비교" viewBox="0 0 ${w} ${h}">${out}</svg>`;
}
