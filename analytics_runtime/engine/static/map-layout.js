// Geometry-only label placement and visible tile selection. No patient inputs.
const EARTH=2*Math.PI*6378137;
export const project=([lon,lat])=>[lon*Math.PI/180*6378137,-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*6378137];
export const rings=geometry=>geometry.type==='Polygon'?geometry.coordinates:geometry.coordinates.flat();
const area=ring=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function labelPoint(rs){
  const ring=rs.reduce((a,b)=>area(a)>area(b)?a:b,rs[0]);let twice=0,cx=0,cy=0;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],cross=a[0]*b[1]-b[0]*a[1];twice+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross;}
  const c=twice?[cx/(3*twice),cy/(3*twice)]:ring[0];if(inside(c,ring))return c;
  const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),minx=Math.min(...xs),miny=Math.min(...ys),dx=Math.max(...xs)-minx,dy=Math.max(...ys)-miny;
  const grid=[];for(let x=1;x<8;x++)for(let y=1;y<8;y++){const p=[minx+dx*x/8,miny+dy*y/8];if(inside(p,ring))grid.push(p);}
  return grid.sort((a,b)=>Math.hypot(a[0]-c[0],a[1]-c[1])-Math.hypot(b[0]-c[0],b[1]-c[1]))[0]||ring[0];
}
export function layoutLabels(candidates,view,width,height,selected){
  if(!width||!height)return [];
  const scale=Math.min(width/view.w,height/view.h),ox=(width-view.w*scale)/2,oy=(height-view.h*scale)/2,placed=[];
  for(const c of [...candidates].sort((a,b)=>(b.code===selected)-(a.code===selected)||b.area-a.area)){
    const x=(c.point[0]-view.x)*scale+ox,y=(c.point[1]-view.y)*scale+oy,w=Math.max(34,c.name.length*10+12),h=21;
    if(x<0||y<0||x>width||y>height)continue;
    const box={left:x-w/2,top:y-h/2,right:x+w/2,bottom:y+h/2};
    if(placed.some(p=>box.left<p.box.right+3&&box.right>p.box.left-3&&box.top<p.box.bottom+3&&box.bottom>p.box.top-3))continue;
    placed.push({...c,box,labelWidth:w/scale,labelHeight:h/scale,fontSize:11/scale});
  }
  return placed;
}
export function visibleTiles(view,width,height){
  const scale=Math.min(width/view.w,height/view.h),z=Math.max(3,Math.min(18,Math.floor(Math.log2(EARTH*scale/256)))),n=2**z,size=EARTH/n;
  // SVG uses xMidYMid meet: include only the geographic rectangle the user can see.
  const result=[],left=view.x-(width/scale-view.w)/2,top=view.y-(height/scale-view.h)/2;
  const x0=Math.max(0,Math.floor((left+EARTH/2)/size)),y0=Math.max(0,Math.floor((top+EARTH/2)/size));
  const x1=Math.min(n-1,Math.floor((left+width/scale+EARTH/2)/size)),y1=Math.min(n-1,Math.floor((top+height/scale+EARTH/2)/size));
  for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)result.push({key:`${z}/${x}/${y}`,x:x*size-EARTH/2,y:y*size-EARTH/2,size});
  return result;
}
