'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Save, X, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  team: string | null;
}

interface AttendanceRecord {
  id: string;
  user_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: 'checked_in' | 'checked_out';
  note: string | null;
}

function calculateWorkMinutes(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(0, Math.floor(diff / 60000) - 60);
}

function formatMinutes(min: number | null): string {
  if (min === null) return '-';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function getStatusBadge(r: AttendanceRecord | undefined): { label: string; color: string } {
  if (!r?.check_in) return { label: '미출근', color: 'bg-gray-100 text-gray-400' };
  const t = new Date(r.check_in);
  const isLate = t.getHours() > 10 || (t.getHours() === 10 && t.getMinutes() > 0);
  if (!r.check_out) return { label: isLate ? '지각·근무중' : '근무중', color: isLate ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700' };
  const mins = calculateWorkMinutes(r.check_in, r.check_out);
  const isEarly = mins !== null && mins < 480;
  if (isEarly && isLate) return { label: '지각·조기퇴근', color: 'bg-red-100 text-red-600' };
  if (isEarly) return { label: '조기퇴근', color: 'bg-orange-100 text-orange-600' };
  if (isLate) return { label: '지각', color: 'bg-yellow-100 text-yellow-700' };
  return { label: '정상', color: 'bg-green-100 text-green-700' };
}

const NOTE_PRESETS = ['외근', '재택', '출장', '반차'];

export default function AttendanceAdminPage() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  // 수정
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ check_in: '', check_out: '', note: '' });
  const [saving, setSaving] = useState(false);

  // 추가 모달
  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ user_id: '', date: '', check_in: '', check_out: '', note: '' });
  const [addSaving, setAddSaving] = useState(false);

  const isAdmin = myProfile?.role === 'admin';
  const today = format(new Date(), 'yyyy-MM-dd');

  const fetchData = useCallback(async () => {
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

    const [profilesRes, monthRes, todayRes] = await Promise.all([
      supabase.from('profiles').select('id, display_name, email, team').is('resigned_at', null).neq('role', 'admin').order('display_name'),
      supabase.from('attendance').select('*').gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: false }),
      supabase.from('attendance').select('*').eq('date', today),
    ]);
    setProfiles(profilesRes.data || []);
    setRecords(monthRes.data || []);
    setTodayRecords(todayRes.data || []);
  }, [currentMonth]);

  useEffect(() => {
    if (isAdmin) fetchData().finally(() => setLoading(false));
    else setLoading(false);
  }, [isAdmin, fetchData]);

  async function handleSaveEdit(id: string) {
    setSaving(true);
    const { error } = await supabase
      .from('attendance')
      .update({
        check_in: editForm.check_in || null,
        check_out: editForm.check_out || null,
        note: editForm.note || null,
        status: editForm.check_out ? 'checked_out' : 'checked_in',
      })
      .eq('id', id);
    if (error) alert('저장 실패: ' + error.message);
    else { setEditingId(null); await fetchData(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('이 출퇴근 기록을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('attendance').delete().eq('id', id);
    if (error) alert('삭제 실패: ' + error.message);
    else await fetchData();
  }

  async function handleManualCheckIn(userId: string, note = '') {
    const now = new Date().toISOString();
    const { error } = await supabase.from('attendance').upsert(
      { user_id: userId, date: today, check_in: now, status: 'checked_in', note: note || null },
      { onConflict: 'user_id,date' }
    );
    if (error) alert('출근 처리 실패: ' + error.message);
    else await fetchData();
  }

  async function handleManualCheckOut(userId: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('attendance').update({ check_out: now, status: 'checked_out' })
      .eq('user_id', userId).eq('date', today);
    if (error) alert('퇴근 처리 실패: ' + error.message);
    else await fetchData();
  }

  async function handleAddRecord() {
    if (!addForm.user_id || !addForm.date) {
      alert('직원과 날짜를 선택해주세요.');
      return;
    }
    setAddSaving(true);
    const checkIn = addForm.check_in ? `${addForm.date}T${addForm.check_in}:00+09:00` : null;
    const checkOut = addForm.check_out ? `${addForm.date}T${addForm.check_out}:00+09:00` : null;
    const { error } = await supabase.from('attendance').upsert(
      {
        user_id: addForm.user_id,
        date: addForm.date,
        check_in: checkIn,
        check_out: checkOut,
        status: checkOut ? 'checked_out' : 'checked_in',
        note: addForm.note || null,
      },
      { onConflict: 'user_id,date' }
    );
    if (error) alert('추가 실패: ' + error.message);
    else {
      setAddModal(false);
      setAddForm({ user_id: '', date: today, check_in: '', check_out: '', note: '' });
      await fetchData();
    }
    setAddSaving(false);
  }

  function toggleCollapse(date: string) {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  if (!isAdmin) {
    return <div className="flex h-64 items-center justify-center text-gray-400">관리자만 접근 가능합니다.</div>;
  }
  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  const todayMap = Object.fromEntries(todayRecords.map((r) => [r.user_id, r]));
  const checkedIn = profiles.filter((p) => todayMap[p.id]?.check_in && !todayMap[p.id]?.check_out).length;
  const checkedOut = profiles.filter((p) => todayMap[p.id]?.check_out).length;
  const absent = profiles.filter((p) => !todayMap[p.id]?.check_in).length;

  // 일자별 record 맵: { date: { userId: record } }
  const recordMatrix: Record<string, Record<string, AttendanceRecord>> = {};
  for (const r of records) {
    if (!recordMatrix[r.date]) recordMatrix[r.date] = {};
    recordMatrix[r.date][r.user_id] = r;
  }

  // 이번 달 전체 날짜 (내림차순)
  const allDatesInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  })
    .reverse()
    .map((d) => format(d, 'yyyy-MM-dd'));

  // 기록이 있는 날짜만
  const datesWithRecords = allDatesInMonth.filter((d) => recordMatrix[d]);

  // 특정 직원 선택 시: 해당 직원 기록만 필터
  const singleUserRecords = records.filter((r) => selectedUserId !== 'all' && r.user_id === selectedUserId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">출석 관리</h1>
        <p className="mt-2 text-gray-600">전체 직원 출퇴근 현황을 확인하고 관리하세요</p>
      </div>

      {/* 오늘 현황 요약 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '근무중', value: checkedIn, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: '퇴근완료', value: checkedOut, color: 'text-green-600', bg: 'bg-green-50' },
          { label: '미출근', value: absent, color: 'text-red-500', bg: 'bg-red-50' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl ${s.bg} p-5 text-center`}>
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}명</p>
          </div>
        ))}
      </div>

      {/* 오늘 직원별 현황 */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            오늘 ({format(new Date(), 'M월 d일 (EEEE)', { locale: ko })}) 현황
          </h2>
        </div>
        <div className="divide-y divide-gray-50">
          {profiles.map((p) => {
            const r = todayMap[p.id];
            const badge = getStatusBadge(r);
            const mins = r ? calculateWorkMinutes(r.check_in, r.check_out) : null;
            const isAbsent = !r?.check_in;
            const isWorking = r?.check_in && !r?.check_out;

            return (
              <div key={p.id} className="flex items-center justify-between px-6 py-3 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold text-white">
                    {(p.display_name || p.email || '?').charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.display_name || p.email}</p>
                    <p className="text-xs text-gray-400">{p.team || '미지정'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-700 tabular-nums flex-wrap">
                  <span>{r?.check_in ? format(new Date(r.check_in), 'HH:mm') : '--:--'}</span>
                  <span className="text-gray-300">→</span>
                  <span>{r?.check_out ? format(new Date(r.check_out), 'HH:mm') : '--:--'}</span>
                  {mins !== null && <span className="text-xs text-gray-400">{formatMinutes(mins)}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
                  {r?.note && <span className="text-xs text-gray-400 hidden sm:inline">{r.note}</span>}
                  {isAbsent && <ManualCheckInButton onCheckIn={(note) => handleManualCheckIn(p.id, note)} />}
                  {isWorking && (
                    <button onClick={() => handleManualCheckOut(p.id)} className="text-xs px-2 py-1 rounded border border-orange-300 text-orange-600 hover:bg-orange-50">
                      퇴근 처리
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 월간 기록 - 일자별 */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-gray-900">월간 기록</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => {
                setAddForm({ user_id: profiles[0]?.id || '', date: today, check_in: '', check_out: '', note: '' });
                setAddModal(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              기록 추가
            </button>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">전체 직원 (일자별)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="rounded p-1 hover:bg-gray-100">
                <ChevronLeft className="h-4 w-4 text-gray-600" />
              </button>
              <span className="text-sm font-medium w-20 text-center">{format(currentMonth, 'yyyy. M')}</span>
              <button onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="rounded p-1 hover:bg-gray-100">
                <ChevronRight className="h-4 w-4 text-gray-600" />
              </button>
            </div>
          </div>
        </div>

        {/* 전체 직원: 일자별 그룹뷰 */}
        {selectedUserId === 'all' ? (
          datesWithRecords.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">기록이 없습니다.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {datesWithRecords.map((date) => {
                const dayRecords = recordMatrix[date] || {};
                const dateObj = new Date(date + 'T00:00:00');
                const weekend = isWeekend(dateObj);
                const presentCount = Object.values(dayRecords).filter((r) => r.check_in).length;
                const isCollapsed = collapsedDates.has(date);

                return (
                  <div key={date}>
                    {/* 날짜 헤더 */}
                    <button
                      onClick={() => toggleCollapse(date)}
                      className={`w-full flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition-colors ${weekend ? 'bg-gray-50' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-semibold ${weekend ? 'text-gray-400' : 'text-gray-800'}`}>
                          {format(dateObj, 'M월 d일 (EEEE)', { locale: ko })}
                        </span>
                        {weekend && <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">주말</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">
                          출근 <span className="font-semibold text-blue-600">{presentCount}</span> / {profiles.length}명
                        </span>
                        {profiles.length - presentCount > 0 && (
                          <span className="text-xs text-red-400">미출근 {profiles.length - presentCount}명</span>
                        )}
                        {isCollapsed ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronUp className="h-4 w-4 text-gray-400" />}
                      </div>
                    </button>

                    {/* 직원별 상세 */}
                    {!isCollapsed && (
                      <div className="divide-y divide-gray-50 bg-gray-50/30">
                        {profiles.map((p) => {
                          const r = dayRecords[p.id];
                          const badge = getStatusBadge(r);
                          const mins = r ? calculateWorkMinutes(r.check_in, r.check_out) : null;
                          const isEditing = editingId === r?.id;

                          return (
                            <div key={p.id} className="px-6 py-2.5 pl-10">
                              {isEditing && r ? (
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className="text-sm text-gray-700 w-20 shrink-0">{p.display_name || p.email}</span>
                                  <input
                                    type="time"
                                    value={editForm.check_in ? format(new Date(editForm.check_in), 'HH:mm') : ''}
                                    onChange={(e) => setEditForm({ ...editForm, check_in: e.target.value ? `${r.date}T${e.target.value}:00+09:00` : '' })}
                                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                                  />
                                  <span className="text-gray-300 text-xs">→</span>
                                  <input
                                    type="time"
                                    value={editForm.check_out ? format(new Date(editForm.check_out), 'HH:mm') : ''}
                                    onChange={(e) => setEditForm({ ...editForm, check_out: e.target.value ? `${r.date}T${e.target.value}:00+09:00` : '' })}
                                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                                  />
                                  <div className="flex gap-1 flex-wrap">
                                    {NOTE_PRESETS.map((n) => (
                                      <button key={n} onClick={() => setEditForm({ ...editForm, note: editForm.note === n ? '' : n })}
                                        className={`text-xs px-2 py-0.5 rounded-full border ${editForm.note === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-500'}`}>
                                        {n}
                                      </button>
                                    ))}
                                    <input type="text" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                                      placeholder="메모" className="rounded border border-gray-300 px-2 py-0.5 text-xs w-16" />
                                  </div>
                                  <button onClick={() => handleSaveEdit(r.id)} disabled={saving} className="rounded bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:opacity-50">
                                    <Save className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => setEditingId(null)} className="rounded bg-gray-200 p-1.5 text-gray-600 hover:bg-gray-300">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                                      {(p.display_name || p.email || '?').charAt(0)}
                                    </div>
                                    <span className="text-sm text-gray-700 w-16 sm:w-24 truncate">{p.display_name || p.email}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-sm tabular-nums">
                                    <span className={r?.check_in ? 'text-gray-700' : 'text-gray-300'}>
                                      {r?.check_in ? format(new Date(r.check_in), 'HH:mm') : '--:--'}
                                    </span>
                                    <span className="text-gray-300 text-xs">→</span>
                                    <span className={r?.check_out ? 'text-gray-700' : 'text-gray-300'}>
                                      {r?.check_out ? format(new Date(r.check_out), 'HH:mm') : '--:--'}
                                    </span>
                                    {mins !== null && <span className="text-xs text-gray-400 hidden sm:inline">{formatMinutes(mins)}</span>}
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
                                    {r?.note && <span className="text-xs text-gray-400 hidden sm:inline">{r.note}</span>}
                                    {r ? (
                                      <div className="flex items-center gap-2">
                                        <button onClick={() => { setEditingId(r.id); setEditForm({ check_in: r.check_in || '', check_out: r.check_out || '', note: r.note || '' }); }}
                                          className="text-xs text-blue-400 hover:text-blue-600">수정</button>
                                        <button onClick={() => handleDelete(r.id)} className="text-gray-300 hover:text-red-400">
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => { setAddForm({ user_id: p.id, date, check_in: '', check_out: '', note: '' }); setAddModal(true); }}
                                        className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-0.5"
                                      >
                                        <Plus className="h-3 w-3" />추가
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* 특정 직원 선택 시: 해당 직원 목록뷰 */
          singleUserRecords.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">기록이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {['날짜', '출근', '퇴근', '근무시간', '상태', '메모', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {singleUserRecords.map((r) => {
                    const badge = getStatusBadge(r);
                    const mins = calculateWorkMinutes(r.check_in, r.check_out);
                    const isEditing = editingId === r.id;
                    const dateObj = new Date(r.date + 'T00:00:00');
                    const weekend = isWeekend(dateObj);

                    if (isEditing) {
                      return (
                        <tr key={r.id} className="bg-blue-50">
                          <td className="px-4 py-3 text-sm text-gray-700">{format(dateObj, 'M/d (EEE)', { locale: ko })}</td>
                          <td className="px-4 py-3">
                            <input type="time" value={editForm.check_in ? format(new Date(editForm.check_in), 'HH:mm') : ''}
                              onChange={(e) => setEditForm({ ...editForm, check_in: e.target.value ? `${r.date}T${e.target.value}:00+09:00` : '' })}
                              className="rounded border border-gray-300 px-2 py-1 text-sm" />
                          </td>
                          <td className="px-4 py-3">
                            <input type="time" value={editForm.check_out ? format(new Date(editForm.check_out), 'HH:mm') : ''}
                              onChange={(e) => setEditForm({ ...editForm, check_out: e.target.value ? `${r.date}T${e.target.value}:00+09:00` : '' })}
                              className="rounded border border-gray-300 px-2 py-1 text-sm" />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">-</td>
                          <td className="px-4 py-3 text-sm text-gray-400">-</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1 flex-wrap">
                              {NOTE_PRESETS.map((n) => (
                                <button key={n} onClick={() => setEditForm({ ...editForm, note: editForm.note === n ? '' : n })}
                                  className={`text-xs px-2 py-0.5 rounded-full border ${editForm.note === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-500'}`}>
                                  {n}
                                </button>
                              ))}
                              <input type="text" value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                                placeholder="직접 입력" className="rounded border border-gray-300 px-2 py-0.5 text-xs w-20" />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <button onClick={() => handleSaveEdit(r.id)} disabled={saving} className="rounded bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:opacity-50">
                                <Save className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setEditingId(null)} className="rounded bg-gray-200 p-1.5 text-gray-600 hover:bg-gray-300">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={r.id} className={`hover:bg-gray-50 ${weekend ? 'bg-gray-50/60' : ''}`}>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {format(dateObj, 'M/d (EEE)', { locale: ko })}
                          {weekend && <span className="ml-1 text-xs text-gray-300">주말</span>}
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums">{r.check_in ? format(new Date(r.check_in), 'HH:mm') : '-'}</td>
                        <td className="px-4 py-3 text-sm tabular-nums">{r.check_out ? format(new Date(r.check_out), 'HH:mm') : '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{formatMinutes(mins)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">{r.note || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => { setEditingId(r.id); setEditForm({ check_in: r.check_in || '', check_out: r.check_out || '', note: r.note || '' }); }}
                              className="text-xs text-blue-500 hover:text-blue-700">수정</button>
                            <button onClick={() => handleDelete(r.id)} className="text-gray-300 hover:text-red-500">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* 기록 추가 모달 */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">출퇴근 기록 추가</h3>
              <button onClick={() => setAddModal(false)} className="rounded-full p-1 hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">직원</label>
                <select value={addForm.user_id} onChange={(e) => setAddForm({ ...addForm, user_id: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="">직원 선택</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
                <input type="date" value={addForm.date} onChange={(e) => setAddForm({ ...addForm, date: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">출근 시간</label>
                  <input type="time" value={addForm.check_in} onChange={(e) => setAddForm({ ...addForm, check_in: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">퇴근 시간</label>
                  <input type="time" value={addForm.check_out} onChange={(e) => setAddForm({ ...addForm, check_out: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">메모</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {NOTE_PRESETS.map((n) => (
                    <button key={n} onClick={() => setAddForm({ ...addForm, note: addForm.note === n ? '' : n })}
                      className={`text-sm px-3 py-1 rounded-full border transition-colors ${addForm.note === n ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
                      {n}
                    </button>
                  ))}
                </div>
                <input type="text" value={addForm.note} onChange={(e) => setAddForm({ ...addForm, note: e.target.value })}
                  placeholder="직접 입력 (선택)" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setAddModal(false)} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                취소
              </button>
              <button onClick={handleAddRecord} disabled={addSaving} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {addSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualCheckInButton({ onCheckIn }: { onCheckIn: (note: string) => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50">
        출근 처리
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button onClick={() => { onCheckIn(''); setOpen(false); }} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">일반</button>
      {NOTE_PRESETS.map((n) => (
        <button key={n} onClick={() => { onCheckIn(n); setOpen(false); }} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">{n}</button>
      ))}
      <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}
