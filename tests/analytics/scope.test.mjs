import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.location={pathname:'/api/hospital-analytics/runtime/11111111-1111-4111-8111-111111111111/index.html'};
const source=readFileSync(new URL('../../analytics_runtime/web/scope.js',import.meta.url),'utf8');
const scope=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('campaign and API navigation stay in the fixed clinic',()=>{
  const campaign=new URL(scope.scopedUrl('/?item=abc')+'#campaigns','https://erp.example');
  assert.equal(campaign.searchParams.get('item'),'abc');
  assert.equal(campaign.searchParams.get('clinic'),'11111111-1111-4111-8111-111111111111');
  assert.equal(campaign.hash,'#campaigns');
  assert.match(scope.scopedUrl('/api/dashboard'),/\/api\/dashboard\?clinic=11111111/);
  assert.throws(()=>scope.setClinicScope('22222222-2222-4222-8222-222222222222'));
  assert.throws(()=>scope.scopedUrl('https://unrelated.example/'));
});
