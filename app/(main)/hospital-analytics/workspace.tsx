'use client';

import { useState } from 'react';
import type { Clinic, MemberRole } from '@/lib/hospital-analytics/access';

type Access = { clinics: Clinic[]; isAdmin: boolean; roles: Record<string, MemberRole>; checkedAt: string; user: { id: string; name: string } };
type Person = { id: string; display_name: string | null; email: string; role: string };
type Membership = { clinic_id: string; user_id: string; role: MemberRole };
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
const buttonClass = 'rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50';

async function request(path: string, value?: Record<string, unknown>) {
  const response = await fetch('/api/hospital-analytics/' + path, { cache: 'no-store', ...(value ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || '요청에 실패했습니다.'); return result;
}

export default function HospitalAnalytics({ initial }: { initial: Access }) {
  const [access, setAccess] = useState(initial);
  const [selected, setSelected] = useState('');
  const [managing, setManaging] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [generation, setGeneration] = useState(0);
  const clinic = access.clinics.find(item => item.id === selected);
  const checkedLabel = new Date(new Date(access.checkedAt).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' KST';

  async function refresh() {
    const latest: Access = await request('access'); setAccess(latest);
    if (!latest.clinics.some(item => item.id === selected)) setSelected('');
    if (latest.isAdmin && managing) await loadPeople();
    setGeneration(value => value + 1);
  }
  async function loadPeople() { const result = await request('admin'); setPeople(result.people); setMemberships(result.memberships); }
  async function run(task: () => Promise<void>) {
    if (busy) return; setBusy(true); setMessage('');
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : '요청에 실패했습니다.'); }
    finally { setBusy(false); }
  }
  const viewUrl = clinic ? `/api/hospital-analytics/runtime/${clinic.id}/index.html` : '';
  return <div className="space-y-5 p-4 md:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">병원 분석</h1><p className="mt-1 text-sm text-gray-500">엑셀 업로드 · 환자 수 지역 지도 · 마케팅 분석 · 발표 보고서</p></div>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => run(refresh)}>새로 확인</button>
        {access.isAdmin && <button className={buttonClass} disabled={busy} onClick={() => run(async () => { if (!managing) await loadPeople(); setManaging(!managing); })}>병원 · 담당자 관리</button>}</div>
    </header>
    <p className="text-xs text-gray-500">권한 확인: {checkedLabel} · {access.isAdmin ? '관리자 · 모든 병원' : '지정된 병원만 표시'}</p>
    {message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">{message}</p>}
    {managing && access.isAdmin && <section className="grid gap-5 rounded-xl border p-5 lg:grid-cols-2" aria-label="병원과 담당자 관리">
      <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); run(async () => { const created = await request('admin', { ...values, action: 'create-clinic' }); const latest = await request('access'); setAccess(latest); setSelected(created.id); form.reset(); setMessage('병원을 등록했습니다. 접수수납목록 엑셀부터 올려 주세요.'); }); }}>
        <h2 className="font-bold">병원 등록</h2><label className="mt-3 block text-sm">병원명<input className={inputClass} name="name" required maxLength={120} /></label>
        <label className="mt-3 block text-sm">사용 EMR<select name="emr" className={inputClass}><option value="dentweb">덴트웹</option><option value="ysarang">의사랑</option><option value="other">기타</option></select></label>
        <label className="mt-3 block text-sm">담당자 메모<input className={inputClass} name="owner" maxLength={100} /></label><button className={buttonClass + ' mt-4'} disabled={busy}>병원 등록</button>
      </form>
      <form onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); run(async () => { await request('admin', { ...values, action: 'set-member' }); await loadPeople(); setMessage('담당자 권한을 저장했습니다. 다음 요청부터 적용됩니다.'); }); }}>
        <h2 className="font-bold">직원 접근 권한</h2><p className="mt-1 text-sm text-gray-500">admin 계정은 모든 병원에 접근합니다. 다른 직원은 여기서 지정합니다.</p>
        <label className="mt-3 block text-sm">병원<select name="clinicId" className={inputClass} required defaultValue={selected}><option value="">병원 선택</option>{access.clinics.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="mt-3 block text-sm">직원<select name="userId" className={inputClass} required><option value="">직원 선택</option>{people.filter(person => person.role !== 'admin').map(person => <option key={person.id} value={person.id}>{person.display_name || person.email}</option>)}</select></label>
        <label className="mt-3 block text-sm">권한<select name="role" className={inputClass}><option value="editor">편집 · 엑셀 업로드와 보고서 생성</option><option value="viewer">조회 · 분석과 저장된 보고서 보기</option><option value="revoke">접근 해제</option></select></label>
        <button className={buttonClass + ' mt-4'} disabled={busy}>권한 저장</button>
      </form>
      <div className="overflow-auto lg:col-span-2"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-semibold">지정된 직원</caption><thead><tr><th className="p-2">병원</th><th className="p-2">직원</th><th className="p-2">권한</th></tr></thead><tbody>{memberships.map(item => <tr key={item.clinic_id + item.user_id} className="border-t"><td className="p-2">{access.clinics.find(value => value.id === item.clinic_id)?.name || '병원'}</td><td className="p-2">{people.find(value => value.id === item.user_id)?.display_name || people.find(value => value.id === item.user_id)?.email || '계정 확인 필요'}</td><td className="p-2">{item.role === 'editor' ? '편집' : '조회'}</td></tr>)}</tbody></table>{!memberships.length && <p className="p-2 text-gray-500">지정된 직원이 없습니다.</p>}</div>
    </section>}
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-64 text-sm font-medium">분석할 병원<select aria-label="분석할 병원" value={selected} onChange={event => setSelected(event.target.value)} className={inputClass}><option value="">병원을 선택하세요</option>{access.clinics.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {clinic && <a className={buttonClass} href={viewUrl} target="_blank" rel="noopener">큰 화면으로 열기</a>}
    </div>
    {clinic ? <iframe key={clinic.id + ':' + generation} src={viewUrl} title={`${clinic.name} 분석 작업공간`} className="h-[82vh] min-h-[650px] w-full rounded-xl border bg-white" /> : <div className="rounded-xl border border-dashed p-12 text-center text-gray-500">{access.clinics.length ? '병원을 선택하면 엑셀 업로드부터 보고서까지 작업할 수 있습니다.' : '병원을 등록하면 분석을 시작할 수 있습니다.'}</div>}
  </div>;
}
