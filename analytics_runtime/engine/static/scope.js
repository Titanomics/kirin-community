let clinicId='',ready=Promise.resolve(),ensureReady=null,identity='';
export function configureScope(value){if(typeof value==='function'){ensureReady=value;return;}ready=value;ready.catch(()=>{});}
export function setOperatorScope(user){identity=user?`${user.id}:${user.version}`:'local';}
export function setClinicScope(id){clinicId=id||'';}
export function scopedUrl(path){return clinicId?path+(path.includes('?')?'&':'?')+'clinic='+encodeURIComponent(clinicId):path;}
export async function apiFetch(path,init={}){
  await (ensureReady?ensureReady():ready);
  const headers=new Headers(init.headers||{});
  if(clinicId)headers.set('X-Clinic-Id',clinicId);
  if(identity)headers.set('X-Operator-Identity',identity);
  const response=await fetch(path,{...init,headers});
  if(response.status===401&&globalThis.document)document.dispatchEvent(new Event('session-required'));
  if(response.status===412&&globalThis.document)document.dispatchEvent(new Event('identity-changed'));
  return response;
}
