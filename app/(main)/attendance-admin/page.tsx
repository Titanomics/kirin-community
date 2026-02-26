'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Save, X } from 'lucide-react';

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
  if (!r?.check_in) return { label: '미출근', color: 'bg-gray-100 text-gray-500' };
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

export default function AttendanceAdminPage() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ check_in: '', check_out: '', note: '' });
  const [saving, setSaving] = useState(false);

  const isAdmin = myProfile?.role === 'admin';

  const fetchData = useCallback(async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

    const [profilesRes, monthRes, todayRes] = await Promise.all([
      supabase.from('profiles').select('id, display_name, email, team').is('resigned_at', null).order('display_name'),
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

  if (!isAdmin) {
    return <div className="flex h-64 items-center justify-center text-gray-400">관리자만 접근 가능합니다.</div>;
  }
  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  const today = format(new Date(), 'yyyy-MM-dd');
  const todayMap = Object.fromEntries(todayRecords.map((r) => [r.user_id, r]));
  const checkedIn = profiles.filter((p) => todayMap[p.id]?.check_in && !todayMap[p.id]?.check_out).length;
  const checkedOut = profiles.filter((p) => todayMap[p.id]?.check_out).length;
  const absent = profiles.filter((p) => !todayMap[p.id]?.check_in).length;

  const filteredRecords = records.filter((r) => selectedUserId === 'all' || r.user_id === selectedUserId);
  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">출석 관리</h1>
        <p className="mt-2 text-gray-600">전체 직원 출퇴근 현황을 확인하고 수정하세요</p>
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
            return (
              <div key={p.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold text-white">
                    {(p.display_name || p.email || '?').charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.display_name || p.email}</p>
                    <p className="text-xs text-gray-400">{p.team || '미지정'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-700 tabular-nums">
                  <span>{r?.check_in ? format(new Date(r.check_in), 'HH:mm') : '--:--'}</span>
                  <span className="text-gray-300">→</span>
                  <span>{r?.check_out ? format(new Date(r.check_out), 'HH:mm') : '--:--'}</span>
                  {mins !== null && <span className="text-xs text-gray-400">{formatMinutes(mins)}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 월간 기록 조회 + 수정 */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">월간 기록</h2>
          <div className="flex items-center gap-3">
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

        {filteredRecords.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">기록이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['날짜', '이름', '출근', '퇴근', '근무시간', '상태', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRecords.map((r) => {
                  const p = profileMap[r.user_id];
                  const badge = getStatusBadge(r);
                  const mins = calculateWorkMinutes(r.check_in, r.check_out);
                  const isEditing = editingId === r.id;

                  if (isEditing) {
                    return (
                      <tr key={r.id} className="bg-blue-50">
                        <td className="px-4 py-3 text-sm text-gray-700">{format(new Date(r.date), 'M/d (EEE)', { locale: ko })}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{p?.display_name || p?.email}</td>
                        <td className="px-4 py-3">
                          <input
                            type="time"
                            value={editForm.check_in}
                            onChange={(e) => {
                              const date = r.date;
                              setEditForm({ ...editForm, check_in: `${date}T${e.target.value}:00+09:00` });
                            }}
                            className="rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="time"
                            value={editForm.check_out ? format(new Date(editForm.check_out), 'HH:mm') : ''}
                            onChange={(e) => {
                              const date = r.date;
                              setEditForm({ ...editForm, check_out: e.target.value ? `${date}T${e.target.value}:00+09:00` : '' });
                            }}
                            className="rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500" colSpan={2}>
                          <input
                            type="text"
                            value={editForm.note}
                            onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                            placeholder="메모 (선택)"
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
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
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-700">{format(new Date(r.date), 'M/d (EEE)', { locale: ko })}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{p?.display_name || p?.email}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{r.check_in ? format(new Date(r.check_in), 'HH:mm') : '-'}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{r.check_out ? format(new Date(r.check_out), 'HH:mm') : '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatMinutes(mins)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.color}`}>{badge.label}</span>
                        {r.note && <span className="ml-1 text-xs text-gray-400">{r.note}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            setEditingId(r.id);
                            setEditForm({
                              check_in: r.check_in || '',
                              check_out: r.check_out || '',
                              note: r.note || '',
                            });
                          }}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
