'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, CheckCircle, XCircle, X } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { ko } from 'date-fns/locale';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface CalendarLeave {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  profiles: { display_name: string | null; email: string | null } | null;
}

interface DayEvent {
  id: string;
  user_id: string;
  name: string;
  type: string;
  status: string;
  reason: string | null;
  start_date: string;
  end_date: string;
}

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
}

export default function CalendarPage() {
  const supabase = createClient();
  const { profile: myProfile } = useAuth();
  const isAdmin = myProfile?.role === 'admin';

  const [currentDate, setCurrentDate] = useState(new Date());
  const [leaves, setLeaves] = useState<CalendarLeave[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // 날짜 상세 모달
  const [selectedDayEvents, setSelectedDayEvents] = useState<DayEvent[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDateLabel, setSelectedDateLabel] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // 추가/수정 모달
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    user_id: '',
    leave_type: '연차',
    start_date: '',
    end_date: '',
    status: '승인',
    reason: '',
  });
  const [saving, setSaving] = useState(false);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    fetchLeaves();
  }, [currentDate]);

  useEffect(() => {
    if (isAdmin) fetchProfiles();
  }, [isAdmin]);

  async function fetchProfiles() {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .is('resigned_at', null)
      .order('display_name');
    setProfiles(data || []);
  }

  async function fetchLeaves() {
    const start = format(monthStart, 'yyyy-MM-dd');
    const end = format(monthEnd, 'yyyy-MM-dd');
    try {
      const { data } = await supabase
        .from('leave_requests')
        .select('*, profiles!leave_requests_user_id_fkey(display_name, email)')
        .in('status', ['승인', '대기'])
        .lte('start_date', end)
        .gte('end_date', start);
      setLeaves(data || []);
    } catch (err) {
      console.error('캘린더 데이터 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  function getEventsForDate(date: Date): DayEvent[] {
    const dateStr = format(date, 'yyyy-MM-dd');
    return leaves
      .filter((l) => dateStr >= l.start_date && dateStr <= l.end_date)
      .map((l) => ({
        id: l.id,
        user_id: l.user_id,
        name: l.profiles?.display_name || l.profiles?.email || '알 수 없음',
        type: l.leave_type,
        status: l.status,
        reason: l.reason,
        start_date: l.start_date,
        end_date: l.end_date,
      }));
  }

  function handleDayClick(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const events = getEventsForDate(date);
    setSelectedDayEvents(events);
    setSelectedDateLabel(format(date, 'yyyy년 M월 d일 (EEEE)', { locale: ko }));
    setSelectedDate(dateStr);
    setShowDetailModal(true);
  }

  function openAddModal(dateStr?: string) {
    setEditingId(null);
    setEditForm({
      user_id: profiles[0]?.id || '',
      leave_type: '연차',
      start_date: dateStr || format(new Date(), 'yyyy-MM-dd'),
      end_date: dateStr || format(new Date(), 'yyyy-MM-dd'),
      status: '승인',
      reason: '',
    });
    setShowDetailModal(false);
    setShowEditModal(true);
  }

  function openEditModal(event: DayEvent) {
    setEditingId(event.id);
    setEditForm({
      user_id: event.user_id,
      leave_type: event.type,
      start_date: event.start_date,
      end_date: event.end_date,
      status: event.status,
      reason: event.reason || '',
    });
    setShowDetailModal(false);
    setShowEditModal(true);
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      user_id: editForm.user_id,
      leave_type: editForm.leave_type,
      start_date: editForm.start_date,
      end_date: editForm.leave_type === '반차' ? editForm.start_date : editForm.end_date,
      status: editForm.status,
      reason: editForm.reason || null,
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from('leave_requests').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('leave_requests').insert(payload));
    }

    if (error) {
      alert('저장 실패: ' + error.message);
    } else {
      setShowEditModal(false);
      await fetchLeaves();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('이 휴가 기록을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('leave_requests').delete().eq('id', id);
    if (error) {
      alert('삭제 실패: ' + error.message);
    } else {
      setShowDetailModal(false);
      await fetchLeaves();
    }
  }

  async function handleStatusChange(id: string, status: '승인' | '반려') {
    const { error } = await supabase.from('leave_requests').update({ status }).eq('id', id);
    if (error) {
      alert('상태 변경 실패: ' + error.message);
    } else {
      setShowDetailModal(false);
      await fetchLeaves();
    }
  }

  const leaveTypeColor = (type: string, status: string) => {
    if (status === '대기') return 'bg-gray-100 text-gray-500 border border-dashed border-gray-300';
    switch (type) {
      case '연차': return 'bg-yellow-100 text-yellow-800';
      case '반차': return 'bg-orange-100 text-orange-800';
      case '월차': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const firstDayOfWeek = monthStart.getDay();
  const emptyCells = Array.from({ length: firstDayOfWeek }, (_, i) => i);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">캘린더</h1>
          <p className="mt-1 text-sm text-gray-600">휴가 일정을 확인하세요</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => openAddModal()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> 휴가 추가
          </button>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 md:p-6 shadow">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {format(currentDate, 'yyyy년 M월', { locale: ko })}
          </h2>
          <div className="flex gap-2">
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="rounded-lg p-2 hover:bg-gray-100">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-100">
              오늘
            </button>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="rounded-lg p-2 hover:bg-gray-100">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>
        ) : (
          <div className="grid grid-cols-7 gap-1 md:gap-2">
            {['일', '월', '화', '수', '목', '금', '토'].map((day, index) => (
              <div key={day} className={`py-2 text-center text-xs font-semibold sm:text-sm ${index === 0 ? 'text-red-600' : index === 6 ? 'text-blue-600' : 'text-gray-700'}`}>
                {day}
              </div>
            ))}

            {emptyCells.map((i) => (
              <div key={`empty-${i}`} className="min-h-16 md:min-h-24" />
            ))}

            {days.map((day) => {
              const events = getEventsForDate(day);
              const isToday = isSameDay(day, new Date());
              const dow = day.getDay();

              return (
                <div
                  key={day.toString()}
                  onClick={() => handleDayClick(day)}
                  className={`min-h-16 md:min-h-24 cursor-pointer rounded-lg border p-1.5 md:p-2 transition hover:bg-gray-50 ${isToday ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                >
                  <div className={`text-xs font-medium md:text-sm ${isToday ? 'text-blue-600' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'}`}>
                    {format(day, 'd')}
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {events.slice(0, 2).map((event) => (
                      <div key={event.id} className={`rounded px-1 py-0.5 text-xs truncate ${leaveTypeColor(event.type, event.status)}`}>
                        {event.name}
                      </div>
                    ))}
                    {events.length > 2 && (
                      <div className="text-xs text-gray-400">+{events.length - 2}명</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 rounded-lg bg-white p-4 shadow text-xs md:text-sm">
        {[
          { color: 'bg-yellow-100', label: '연차 (승인)' },
          { color: 'bg-orange-100', label: '반차 (승인)' },
          { color: 'bg-blue-100', label: '월차 (승인)' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`h-3.5 w-3.5 rounded ${color}`} />
            <span className="text-gray-700">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 rounded border border-dashed border-gray-300 bg-gray-100" />
          <span className="text-gray-500">대기 중</span>
        </div>
      </div>

      {/* 날짜 상세 모달 */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{selectedDateLabel}</h3>
              <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {selectedDayEvents.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">일정이 없습니다</p>
            ) : (
              <div className="space-y-2">
                {selectedDayEvents.map((event) => (
                  <div key={event.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${leaveTypeColor(event.type, event.status)}`}>
                        {event.type}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{event.name}</p>
                        {event.reason && <p className="text-xs text-gray-400">{event.reason}</p>}
                        <p className="text-xs text-gray-400">{event.status}</p>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        {event.status === '대기' && (
                          <>
                            <button onClick={() => handleStatusChange(event.id, '승인')} title="승인" className="rounded p-1 text-green-600 hover:bg-green-50">
                              <CheckCircle className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleStatusChange(event.id, '반려')} title="반려" className="rounded p-1 text-red-500 hover:bg-red-50">
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button onClick={() => openEditModal(event)} className="rounded p-1 text-blue-500 hover:bg-blue-50 text-xs">
                          수정
                        </button>
                        <button onClick={() => handleDelete(event.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-between">
              {isAdmin && (
                <button
                  onClick={() => openAddModal(selectedDate)}
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> 이 날 추가
                </button>
              )}
              <button
                onClick={() => setShowDetailModal(false)}
                className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 추가/수정 모달 */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{editingId ? '휴가 수정' : '휴가 추가'}</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">직원</label>
                <select
                  value={editForm.user_id}
                  onChange={(e) => setEditForm({ ...editForm, user_id: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">휴가 유형</label>
                  <select
                    value={editForm.leave_type}
                    onChange={(e) => setEditForm({ ...editForm, leave_type: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="연차">연차</option>
                    <option value="반차">반차</option>
                    <option value="월차">월차</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="승인">승인</option>
                    <option value="대기">대기</option>
                    <option value="반려">반려</option>
                  </select>
                </div>
              </div>
              <div className={editForm.leave_type === '반차' ? '' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {editForm.leave_type === '반차' ? '날짜' : '시작일'}
                  </label>
                  <input
                    type="date"
                    value={editForm.start_date}
                    onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                {editForm.leave_type !== '반차' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">종료일</label>
                    <input
                      type="date"
                      value={editForm.end_date}
                      min={editForm.start_date}
                      onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사유 (선택)</label>
                <input
                  type="text"
                  value={editForm.reason}
                  onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                  placeholder="사유 입력"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowEditModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editForm.user_id || !editForm.start_date}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
