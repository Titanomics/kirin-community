'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend, isToday, addDays, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, Plus, Trash2, Save } from 'lucide-react';
import Holidays from 'date-holidays';

function getKoreanHolidays(year: number): Record<string, string> {
  const hd = new Holidays('KR');
  const map: Record<string, string> = {};
  for (const h of hd.getHolidays(year)) {
    if (h.type !== 'public') continue;
    const dateStr = h.date.substring(0, 10);
    map[dateStr] = h.name;
    // 설날/추석 연휴: 전날·다음날도 추가
    if (h.name === '설날' || h.name === '추석') {
      const d = new Date(dateStr + 'T00:00:00');
      map[format(subDays(d, 1), 'yyyy-MM-dd')] = h.name + ' 연휴';
      map[format(addDays(d, 1), 'yyyy-MM-dd')] = h.name + ' 연휴';
    }
  }
  return map;
}

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
const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

export default function AttendanceAdminPage() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const holidayMap = useMemo(() => getKoreanHolidays(currentMonth.getFullYear()), [currentMonth.getFullYear()]);

  // 날짜 상세 모달
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 추가/수정 모달
  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ user_id: '', date: '', check_in: '', check_out: '', note: '' });
  const [addSaving, setAddSaving] = useState(false);

  // 오늘 수동 출퇴근
  const [manualTarget, setManualTarget] = useState<string | null>(null);

  const isAdmin = myProfile?.role === 'admin';
  const today = format(new Date(), 'yyyy-MM-dd');

  const fetchData = useCallback(async () => {
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
    const [profilesRes, monthRes, todayRes] = await Promise.all([
      supabase.from('profiles').select('id, display_name, email, team').is('resigned_at', null).neq('role', 'admin').order('display_name'),
      supabase.from('attendance').select('*').gte('date', monthStart).lte('date', monthEnd),
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
    else { setManualTarget(null); await fetchData(); }
  }

  async function handleManualCheckOut(userId: string) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('attendance').update({ check_out: now, status: 'checked_out' })
      .eq('user_id', userId).eq('date', today);
    if (error) alert('퇴근 처리 실패: ' + error.message);
    else await fetchData();
  }

  async function handleAddRecord() {
    if (!addForm.user_id || !addForm.date) { alert('직원과 날짜를 선택해주세요.'); return; }
    setAddSaving(true);
    const checkIn = addForm.check_in ? `${addForm.date}T${addForm.check_in}:00+09:00` : null;
    const checkOut = addForm.check_out ? `${addForm.date}T${addForm.check_out}:00+09:00` : null;
    const { error } = await supabase.from('attendance').upsert(
      { user_id: addForm.user_id, date: addForm.date, check_in: checkIn, check_out: checkOut, status: checkOut ? 'checked_out' : 'checked_in', note: addForm.note || null },
      { onConflict: 'user_id,date' }
    );
    if (error) alert('저장 실패: ' + error.message);
    else { setAddModal(false); setAddForm({ user_id: '', date: today, check_in: '', check_out: '', note: '' }); await fetchData(); }
    setAddSaving(false);
  }

  if (!isAdmin) return <div className="flex h-64 items-center justify-center text-gray-400">관리자만 접근 가능합니다.</div>;
  if (loading) return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;

  // 데이터 맵
  const todayMap = Object.fromEntries(todayRecords.map((r) => [r.user_id, r]));
  const checkedIn = profiles.filter((p) => todayMap[p.id]?.check_in && !todayMap[p.id]?.check_out).length;
  const checkedOut = profiles.filter((p) => todayMap[p.id]?.check_out).length;
  const absent = profiles.filter((p) => !todayMap[p.id]?.check_in).length;

  // 월 전체 record matrix
  const recordMatrix: Record<string, Record<string, AttendanceRecord>> = {};
  for (const r of records) {
    if (!recordMatrix[r.date]) recordMatrix[r.date] = {};
    recordMatrix[r.date][r.user_id] = r;
  }

  // 달력 주 배열 만들기 (월요일 시작)
  const firstDay = startOfMonth(currentMonth);
  const lastDay = endOfMonth(currentMonth);
  const allDays = eachDayOfInterval({ start: firstDay, end: lastDay });
  const startPad = (firstDay.getDay() + 6) % 7; // 0=Mon
  const calendarDays: (Date | null)[] = [...Array(startPad).fill(null), ...allDays];
  while (calendarDays.length % 7 !== 0) calendarDays.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) weeks.push(calendarDays.slice(i, i + 7));

  // 날짜 상세 모달 데이터
  const selectedDayRecords = selectedDate ? (recordMatrix[selectedDate] || {}) : {};
  const selectedProfile = profiles.find((p) => p.id === selectedUserId);

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
            const isManual = manualTarget === p.id;

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
                  {isAbsent && !isManual && (
                    <button onClick={() => setManualTarget(p.id)} className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50">출근 처리</button>
                  )}
                  {isAbsent && isManual && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <button onClick={() => handleManualCheckIn(p.id, '')} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">일반</button>
                      {NOTE_PRESETS.map((n) => (
                        <button key={n} onClick={() => handleManualCheckIn(p.id, n)} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">{n}</button>
                      ))}
                      <button onClick={() => setManualTarget(null)} className="text-gray-400"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                  {isWorking && (
                    <button onClick={() => handleManualCheckOut(p.id)} className="text-xs px-2 py-1 rounded border border-orange-300 text-orange-600 hover:bg-orange-50">퇴근 처리</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 월간 달력 */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-gray-900">월간 기록</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => { setAddForm({ user_id: profiles[0]?.id || '', date: today, check_in: '', check_out: '', note: '' }); setAddModal(true); }}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />기록 추가
            </button>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">전체 직원</option>
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

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={`py-2 text-center text-xs font-semibold ${i === 5 ? 'text-blue-400' : i === 6 ? 'text-red-400' : 'text-gray-500'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* 달력 그리드 */}
        <div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-b-0">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="min-h-[80px] bg-gray-50/40" />;

                const dateStr = format(day, 'yyyy-MM-dd');
                const dayRecords = recordMatrix[dateStr] || {};
                const weekend = isWeekend(day);
                const todayFlag = isToday(day);
                const isFuture = day > new Date();
                const isSat = di === 5;
                const isSun = di === 6;
                const holidayName = holidayMap[dateStr];
                const isHoliday = !!holidayName;

                // 전체 직원 뷰: 출근 현황 요약
                const presentCount = profiles.filter((p) => dayRecords[p.id]?.check_in).length;
                const totalCount = profiles.length;
                const hasAny = presentCount > 0;

                // 단일 직원 뷰: 해당 직원 기록
                const singleRecord = selectedUserId !== 'all' ? dayRecords[selectedUserId] : undefined;
                const singleBadge = getStatusBadge(singleRecord);

                return (
                  <div
                    key={di}
                    onClick={() => !isFuture && setSelectedDate(dateStr)}
                    className={`min-h-[80px] p-2 border-r border-gray-50 last:border-r-0 flex flex-col gap-1 transition-colors
                      ${isFuture ? 'bg-gray-50/30 cursor-default' : 'cursor-pointer hover:bg-blue-50/40'}
                      ${todayFlag ? 'bg-blue-50/60' : ''}
                      ${(weekend || isHoliday) && !todayFlag ? 'bg-red-50/30' : ''}
                      ${selectedDate === dateStr ? 'ring-2 ring-inset ring-blue-400' : ''}
                    `}
                  >
                    {/* 날짜 숫자 */}
                    <div className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full
                      ${todayFlag ? 'bg-blue-600 text-white' : (isSun || isHoliday) ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-gray-700'}
                    `}>
                      {format(day, 'd')}
                    </div>

                    {/* 공휴일 이름 */}
                    {holidayName && (
                      <span className="text-xs text-red-400 font-medium leading-tight truncate">{holidayName}</span>
                    )}

                    {/* 전체 직원 뷰 */}
                    {selectedUserId === 'all' && !isFuture && (
                      <>
                        {hasAny ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium
                            ${presentCount === totalCount ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}
                          `}>
                            출근 {presentCount}/{totalCount}
                          </span>
                        ) : (
                          !(weekend || isHoliday) && <span className="text-xs text-gray-300">-</span>
                        )}
                        {/* 미출근 인원 */}
                        {hasAny && presentCount < totalCount && (
                          <span className="text-xs text-red-400">미출근 {totalCount - presentCount}명</span>
                        )}
                      </>
                    )}

                    {/* 단일 직원 뷰 */}
                    {selectedUserId !== 'all' && !isFuture && (
                      <>
                        {singleRecord?.check_in ? (
                          <>
                            <span className="text-xs text-gray-600 tabular-nums">{format(new Date(singleRecord.check_in), 'HH:mm')}</span>
                            {singleRecord.check_out && (
                              <span className="text-xs text-gray-400 tabular-nums">{format(new Date(singleRecord.check_out), 'HH:mm')}</span>
                            )}
                            <span className={`text-xs px-1 py-0.5 rounded font-medium ${singleBadge.color}`}>{singleBadge.label}</span>
                            {singleRecord.note && <span className="text-xs text-gray-400">{singleRecord.note}</span>}
                          </>
                        ) : (
                          !(weekend || isHoliday) && <span className="text-xs text-gray-300">미출근</span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 날짜 상세 모달 */}
      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {format(new Date(selectedDate + 'T00:00:00'), 'M월 d일 (EEEE)', { locale: ko })}
                </h3>
                {selectedUserId !== 'all' && selectedProfile && (
                  <p className="text-sm text-gray-500">{selectedProfile.display_name || selectedProfile.email}</p>
                )}
              </div>
              <button onClick={() => setSelectedDate(null)} className="rounded-full p-1 hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
              {(selectedUserId === 'all' ? profiles : profiles.filter((p) => p.id === selectedUserId)).map((p) => {
                const r = selectedDayRecords[p.id];
                const badge = getStatusBadge(r);
                const mins = r ? calculateWorkMinutes(r.check_in, r.check_out) : null;

                return (
                  <DayDetailRow
                    key={p.id}
                    profile={p}
                    record={r}
                    badge={badge}
                    mins={mins}
                    onEdit={() => {
                      setAddForm({
                        user_id: p.id,
                        date: selectedDate,
                        check_in: r?.check_in ? format(new Date(r.check_in), 'HH:mm') : '',
                        check_out: r?.check_out ? format(new Date(r.check_out), 'HH:mm') : '',
                        note: r?.note || '',
                      });
                      setSelectedDate(null);
                      setAddModal(true);
                    }}
                    onAdd={() => {
                      setAddForm({ user_id: p.id, date: selectedDate, check_in: '', check_out: '', note: '' });
                      setSelectedDate(null);
                      setAddModal(true);
                    }}
                    onDelete={() => r && handleDelete(r.id)}
                  />
                );
              })}
            </div>

            <div className="px-6 py-4 border-t border-gray-100">
              <button onClick={() => setSelectedDate(null)} className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 기록 추가/수정 모달 */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">출퇴근 기록 {addForm.check_in ? '수정' : '추가'}</h3>
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
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.email}</option>)}
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
              <button onClick={() => setAddModal(false)} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">취소</button>
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

function DayDetailRow({
  profile, record, badge, mins, onEdit, onAdd, onDelete,
}: {
  profile: Profile;
  record: AttendanceRecord | undefined;
  badge: { label: string; color: string };
  mins: number | null;
  onEdit: () => void;
  onAdd: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold text-white shrink-0">
          {(profile.display_name || profile.email || '?').charAt(0)}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{profile.display_name || profile.email}</p>
          <p className="text-xs text-gray-400">{profile.team || '미지정'}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-sm tabular-nums">
        {record?.check_in ? (
          <>
            <span className="text-gray-700">{format(new Date(record.check_in), 'HH:mm')}</span>
            <span className="text-gray-300 text-xs">→</span>
            <span className={record.check_out ? 'text-gray-700' : 'text-gray-300'}>
              {record.check_out ? format(new Date(record.check_out), 'HH:mm') : '--:--'}
            </span>
            {mins !== null && <span className="text-xs text-gray-400 hidden sm:inline">{formatMinutes(mins)}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
            {record.note && <span className="text-xs text-gray-400">{record.note}</span>}
            <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-600 flex items-center gap-0.5">
              <Save className="h-3 w-3" />수정
            </button>
            <button onClick={onDelete} className="text-gray-300 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
            <button onClick={onAdd} className="text-xs text-blue-400 hover:text-blue-600 flex items-center gap-0.5">
              <Plus className="h-3 w-3" />출근 처리
            </button>
          </>
        )}
      </div>
    </div>
  );
}
