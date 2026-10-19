// The clinic is fixed by the authenticated ERP route, never a shared browser preference.
const match=location.pathname.match(/^\/api\/hospital-analytics\/runtime\/([0-9a-f-]{36})\//);
const clinicId=match?.[1]||'';
const prefix='/api/hospital-analytics/runtime/'+clinicId;
let ready=Promise.resolve(),identity='',ensureReady=null;
export function configureScope(value){if(typeof value==='function')ensureReady=value;else{ready=value;ready.catch(()=>{});}}
export function setOperatorScope(user){identity=user?`${user.id}:${user.version}`:'';}
export function setClinicScope(id){if(id!==clinicId)throw Error('병원 선택이 일치하지 않습니다. ERP에서 다시 열어 주세요.');}
export function scopedUrl(path){
  if(path==='/'||path.startsWith('/?'))path='/index.html'+path.slice(1);
  else if(!path.startsWith('/api/'))throw Error('지원하지 않는 경로입니다.');
  return prefix+path+(path.includes('?')?'&':'?')+'clinic='+encodeURIComponent(clinicId);
}
async function upload(data){
  const decoded=atob(data);if(decoded.length>25*1024*1024)throw Error('25MB 이하 파일을 선택해 주세요.');
  const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  const ticketResponse=await fetch('/api/hospital-analytics/upload-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clinicId,size:bytes.length}),cache:'no-store'});
  const ticket=await ticketResponse.json();if(!ticketResponse.ok)throw Error(ticket.error||'업로드 주소를 준비하지 못했습니다.');
  const response=await fetch(ticket.url,{method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','x-upsert':'false','Authorization':'Bearer '+ticket.accessToken,'apikey':ticket.publicKey},body:bytes});
  if(!response.ok)throw Error('파일 업로드에 실패했습니다. 다시 시도해 주세요.');
  return ticket.path;
}
export async function apiFetch(path,init={}){
  await (ensureReady?ensureReady():ready);
  const headers=new Headers(init.headers||{});headers.set('X-Clinic-Id',clinicId);if(identity)headers.set('X-Operator-Identity',identity);
  let body=init.body;
  if(init.method==='POST'&&typeof body==='string'){
    const payload=JSON.parse(body);
    if(typeof payload.data==='string'&&path.match(/^\/api\/(imports|conversions|ad-reports)\//)){
      payload.upload_path=await upload(payload.data);delete payload.data;body=JSON.stringify(payload);
    }
  }
  const response=await fetch(scopedUrl(path),{...init,body,headers,cache:'no-store'});
  if(response.status===401)document.dispatchEvent(new Event('session-required'));
  if(response.status===412)document.dispatchEvent(new Event('identity-changed'));
  return response;
}
