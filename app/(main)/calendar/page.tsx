'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, CheckCircle, XCircle, X, Pencil, Target } from 'lucide-react';
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

interface CalendarSchedule {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  date: string;
  created_at: string;
  profiles: { display_name: string | null; email: string | null } | null;
}

interface TeamRoadmap {
  id: string;
  team: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string;
  color: string;
  assignee_id: string | null;
  status: string;
  created_by: string | null;
  assignee: { display_name: string | null; email: string | null } | null;
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
  eventKind: 'leave' | 'schedule' | 'roadmap';
  title?: string;
  description?: string | null;
  team?: string;
  color?: string;
  assigneeName?: string | null;
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
  const [schedules, setSchedules] = useState<CalendarSchedule[]>([]);
  const [roadmaps, setRoadmaps] = useState<TeamRoadmap[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState<'all' | '커머스팀' | '콘텐츠팀'>('all');

  // 날짜 상세 모달
  const [selectedDayEvents, setSelectedDayEvents] = useState<DayEvent[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDateLabel, setSelectedDateLabel] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // 휴가 추가/수정 모달
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

  // 일정 추가/수정 모달
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ title: '', description: '', date: '' });
  const [savingSchedule, setSavingSchedule] = useState(false);

  // 팀 로드맵 추가/수정 모달
  const [showRoadmapModal, setShowRoadmapModal] = useState(false);
  const [editingRoadmapId, setEditingRoadmapId] = useState<string | null>(null);
  const [roadmapForm, setRoadmapForm] = useState({
    team: (myProfile?.team as '커머스팀' | '콘텐츠팀') || '커머스팀',
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    color: 'blue',
    status: '진행중' as '예정' | '진행중' | '완료' | '보류',
    assignee_id: '' as string,
    single_day: false,
  });
  const [savingRoadmap, setSavingRoadmap] = useState(false);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchLeaves(), fetchSchedules(), fetchRoadmaps()]);
      setLoading(false);
    }
    load();
  }, [currentDate]);

  useEffect(() => {
    fetchProfiles();
  }, []);

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
    }
  }

  async function fetchSchedules() {
    const start = format(monthStart, 'yyyy-MM-dd');
    const end = format(monthEnd, 'yyyy-MM-dd');
    try {
      const { data } = await supabase
        .from('schedules')
        .select('*, profiles(display_name, email)')
        .gte('date', start)
        .lte('date', end);
      setSchedules(data || []);
    } catch (err) {
      console.error('일정 데이터 로딩 실패:', err);
    }
  }

  async function fetchRoadmaps() {
    const start = format(monthStart, 'yyyy-MM-dd');
    const end = format(monthEnd, 'yyyy-MM-dd');
    try {
      const { data } = await supabase
        .from('team_roadmap')
        .select('*, assignee:profiles!team_roadmap_assignee_id_fkey(display_name, email)')
        .lte('start_date', end)
        .gte('end_date', start);
      setRoadmaps(data || []);
    } catch (err) {
      console.error('로드맵 데이터 로딩 실패:', err);
    }
  }

  function getEventsForDate(date: Date): DayEvent[] {
    const dateStr = format(date, 'yyyy-MM-dd');
    const leaveEvents: DayEvent[] = leaves
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
        eventKind: 'leave' as const,
      }));
    const scheduleEvents: DayEvent[] = schedules
      .filter((s) => s.date === dateStr)
      .map((s) => ({
        id: s.id,
        user_id: s.user_id,
        name: s.profiles?.display_name || s.profiles?.email || '알 수 없음',
        type: '일정',
        status: '',
        reason: s.description,
        start_date: s.date,
        end_date: s.date,
        eventKind: 'schedule' as const,
        title: s.title,
        description: s.description,
      }));
    const roadmapEvents: DayEvent[] = roadmaps
      .filter((r) => dateStr >= r.start_date && dateStr <= r.end_date)
      .filter((r) => teamFilter === 'all' || r.team === teamFilter)
      .map((r) => ({
        id: r.id,
        user_id: r.created_by || '',
        name: r.assignee?.display_name || r.assignee?.email || r.team,
        type: r.team,
        status: r.status,
        reason: r.description,
        start_date: r.start_date,
        end_date: r.end_date,
        eventKind: 'roadmap' as const,
        title: r.title,
        description: r.description,
        team: r.team,
        color: r.color,
        assigneeName: r.assignee?.display_name || r.assignee?.email || null,
      }));
    return [...roadmapEvents, ...leaveEvents, ...scheduleEvents];
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

  // 일정 CRUD
  function openScheduleAddModal(dateStr: string) {
    setEditingScheduleId(null);
    setScheduleForm({ title: '', description: '', date: dateStr });
    setShowDetailModal(false);
    setShowScheduleModal(true);
  }

  function openScheduleEditModal(event: DayEvent) {
    setEditingScheduleId(event.id);
    setScheduleForm({
      title: event.title || '',
      description: event.description || '',
      date: event.start_date,
    });
    setShowDetailModal(false);
    setShowScheduleModal(true);
  }

  async function handleScheduleSave() {
    if (!myProfile) return;
    setSavingSchedule(true);
    const payload = {
      user_id: myProfile.id,
      title: scheduleForm.title,
      description: scheduleForm.description || null,
      date: scheduleForm.date,
    };

    let error;
    if (editingScheduleId) {
      ({ error } = await supabase
        .from('schedules')
        .update({ title: payload.title, description: payload.description, date: payload.date })
        .eq('id', editingScheduleId));
    } else {
      ({ error } = await supabase.from('schedules').insert(payload));
    }

    if (error) {
      alert('저장 실패: ' + error.message);
    } else {
      setShowScheduleModal(false);
      await fetchSchedules();
    }
    setSavingSchedule(false);
  }

  async function handleScheduleDelete(id: string) {
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('schedules').delete().eq('id', id);
    if (error) {
      alert('삭제 실패: ' + error.message);
    } else {
      setShowDetailModal(false);
      await fetchSchedules();
    }
  }

  // 팀 로드맵 CRUD
  function openRoadmapAddModal(dateStr?: string) {
    const defaultTeam: '커머스팀' | '콘텐츠팀' =
      myProfile?.team === '콘텐츠팀' ? '콘텐츠팀' : '커머스팀';
    setEditingRoadmapId(null);
    setRoadmapForm({
      team: defaultTeam,
      title: '',
      description: '',
      start_date: dateStr || format(new Date(), 'yyyy-MM-dd'),
      end_date: dateStr || format(new Date(), 'yyyy-MM-dd'),
      color: 'blue',
      status: '진행중',
      assignee_id: myProfile?.id || '',
      single_day: true,
    });
    setShowDetailModal(false);
    setShowRoadmapModal(true);
  }

  function openRoadmapEditModal(event: DayEvent) {
    const r = roadmaps.find((x) => x.id === event.id);
    if (!r) return;
    setEditingRoadmapId(r.id);
    setRoadmapForm({
      team: r.team as '커머스팀' | '콘텐츠팀',
      title: r.title,
      description: r.description || '',
      start_date: r.start_date,
      end_date: r.end_date,
      color: r.color,
      status: r.status as '예정' | '진행중' | '완료' | '보류',
      assignee_id: r.assignee_id || '',
      single_day: r.start_date === r.end_date,
    });
    setShowDetailModal(false);
    setShowRoadmapModal(true);
  }

  async function handleRoadmapSave() {
    if (!myProfile) return;
    setSavingRoadmap(true);
    const endDate = roadmapForm.single_day ? roadmapForm.start_date : roadmapForm.end_date;
    const payload = {
      team: roadmapForm.team,
      title: roadmapForm.title,
      description: roadmapForm.description || null,
      start_date: roadmapForm.start_date,
      end_date: endDate,
      color: roadmapForm.color,
      status: roadmapForm.status,
      assignee_id: roadmapForm.assignee_id || null,
    };

    let error;
    if (editingRoadmapId) {
      ({ error } = await supabase.from('team_roadmap').update(payload).eq('id', editingRoadmapId));
    } else {
      ({ error } = await supabase
        .from('team_roadmap')
        .insert({ ...payload, created_by: myProfile.id }));
    }

    if (error) {
      alert('저장 실패: ' + error.message);
    } else {
      setShowRoadmapModal(false);
      await fetchRoadmaps();
    }
    setSavingRoadmap(false);
  }

  async function handleRoadmapDelete(id: string) {
    if (!confirm('이 로드맵을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('team_roadmap').delete().eq('id', id);
    if (error) {
      alert('삭제 실패: ' + error.message);
    } else {
      setShowDetailModal(false);
      await fetchRoadmaps();
    }
  }

  const ROADMAP_COLORS = [
    { key: 'blue', chip: 'bg-blue-100 text-blue-800', bar: 'bg-blue-500' },
    { key: 'green', chip: 'bg-green-100 text-green-800', bar: 'bg-green-500' },
    { key: 'purple', chip: 'bg-purple-100 text-purple-800', bar: 'bg-purple-500' },
    { key: 'orange', chip: 'bg-orange-100 text-orange-800', bar: 'bg-orange-500' },
    { key: 'pink', chip: 'bg-pink-100 text-pink-800', bar: 'bg-pink-500' },
    { key: 'gray', chip: 'bg-gray-100 text-gray-800', bar: 'bg-gray-500' },
  ];

  function roadmapChip(color: string): string {
    return ROADMAP_COLORS.find((c) => c.key === color)?.chip || ROADMAP_COLORS[0].chip;
  }

  function canEditRoadmap(event: DayEvent): boolean {
    if (!myProfile) return false;
    if (isAdmin) return true;
    return myProfile.team === event.team;
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
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">캘린더</h1>
          <p className="mt-1 text-sm text-gray-600">휴가 · 일정 · 팀 로드맵</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            {(['all', '커머스팀', '콘텐츠팀'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTeamFilter(t)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  teamFilter === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t === 'all' ? '전체 팀' : t}
              </button>
            ))}
          </div>
          <button
            onClick={() => openRoadmapAddModal()}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Target className="h-4 w-4" /> 로드맵 추가
          </button>
          {isAdmin && (
            <button
              onClick={() => openAddModal()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" /> 휴가 추가
            </button>
          )}
        </div>
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
              const dateStr = format(day, 'yyyy-MM-dd');

              return (
                <div
                  key={day.toString()}
                  onClick={() => handleDayClick(day)}
                  className={`group relative min-h-16 md:min-h-24 cursor-pointer rounded-lg border p-1.5 md:p-2 transition hover:bg-gray-50 ${isToday ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`text-xs font-medium md:text-sm ${isToday ? 'text-blue-600' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'}`}>
                      {format(day, 'd')}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); openScheduleAddModal(dateStr); }}
                      className="hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                      title="일정 추가"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {events.slice(0, 3).map((event) => {
                      const isSingleDay = event.start_date === event.end_date;
                      const chipClass =
                        event.eventKind === 'roadmap'
                          ? roadmapChip(event.color || 'blue')
                          : event.eventKind === 'schedule'
                            ? 'bg-green-100 text-green-800'
                            : leaveTypeColor(event.type, event.status);
                      return (
                        <div
                          key={`${event.eventKind}-${event.id}`}
                          className={`rounded px-1 py-0.5 text-xs truncate flex items-center gap-0.5 ${chipClass}`}
                        >
                          {event.eventKind === 'roadmap' && (
                            <span className="text-[10px] opacity-60 flex-shrink-0">
                              {isSingleDay ? '●' : '▬'}
                            </span>
                          )}
                          <span className="truncate">
                            {event.eventKind === 'schedule'
                              ? event.title
                              : event.eventKind === 'roadmap'
                                ? event.title
                                : event.name}
                          </span>
                        </div>
                      );
                    })}
                    {events.length > 3 && (
                      <div className="text-xs text-gray-400">+{events.length - 3}건</div>
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
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 rounded bg-green-100" />
          <span className="text-gray-700">일정</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 rounded bg-indigo-100" />
          <span className="text-gray-700">팀 로드맵</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 ml-auto">
          <span>●=당일</span>
          <span>▬=기간</span>
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
                  <div key={`${event.eventKind}-${event.id}`} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${
                        event.eventKind === 'roadmap'
                          ? roadmapChip(event.color || 'blue')
                          : event.eventKind === 'schedule'
                            ? 'bg-green-100 text-green-800'
                            : leaveTypeColor(event.type, event.status)
                      }`}>
                        {event.eventKind === 'roadmap' ? event.team : event.eventKind === 'schedule' ? '일정' : event.type}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {event.eventKind === 'leave' ? event.name : event.title}
                        </p>
                        {event.eventKind === 'roadmap' && (
                          <p className="text-xs text-gray-500">
                            {event.start_date === event.end_date
                              ? `당일 · ${event.start_date}`
                              : `${event.start_date} ~ ${event.end_date}`}
                            {event.assigneeName && ` · ${event.assigneeName}`}
                          </p>
                        )}
                        {event.eventKind === 'schedule' && (
                          <p className="text-xs text-gray-500">{event.name}</p>
                        )}
                        {event.reason && <p className="text-xs text-gray-400 truncate">{event.reason}</p>}
                        {event.eventKind === 'leave' && (
                          <p className="text-xs text-gray-400">{event.status}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      {/* 로드맵 액션 - 같은 팀 또는 admin */}
                      {event.eventKind === 'roadmap' && canEditRoadmap(event) && (
                        <>
                          <button onClick={() => openRoadmapEditModal(event)} className="rounded p-1 text-blue-500 hover:bg-blue-50 text-xs">
                            수정
                          </button>
                          <button onClick={() => handleRoadmapDelete(event.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {/* 휴가 액션 - admin만 */}
                      {event.eventKind === 'leave' && isAdmin && (
                        <>
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
                        </>
                      )}
                      {/* 일정 액션 - 본인 또는 admin */}
                      {event.eventKind === 'schedule' && (myProfile?.id === event.user_id || isAdmin) && (
                        <>
                          <button onClick={() => openScheduleEditModal(event)} className="rounded p-1 text-blue-500 hover:bg-blue-50 text-xs">
                            수정
                          </button>
                          <button onClick={() => handleScheduleDelete(event.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-between">
              <div className="flex gap-2">
                {isAdmin && (
                  <button
                    onClick={() => openAddModal(selectedDate)}
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4" /> 휴가 추가
                  </button>
                )}
                <button
                  onClick={() => openScheduleAddModal(selectedDate)}
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  <Pencil className="h-4 w-4" /> 일정 추가
                </button>
                <button
                  onClick={() => openRoadmapAddModal(selectedDate)}
                  className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  <Target className="h-4 w-4" /> 로드맵
                </button>
              </div>
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
      {/* 일정 추가/수정 모달 */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingScheduleId ? '일정 수정' : '일정 추가'}
              </h3>
              <button onClick={() => setShowScheduleModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input
                  type="text"
                  value={scheduleForm.title}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                  placeholder="일정 제목을 입력하세요"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
                <input
                  type="date"
                  value={scheduleForm.date}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
                <input
                  type="text"
                  value={scheduleForm.description}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, description: e.target.value })}
                  placeholder="설명 입력"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowScheduleModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                취소
              </button>
              <button
                onClick={handleScheduleSave}
                disabled={savingSchedule || !scheduleForm.title || !scheduleForm.date}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {savingSchedule ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 팀 로드맵 추가/수정 모달 */}
      {showRoadmapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingRoadmapId ? '로드맵 수정' : '팀 로드맵 추가'}
              </h3>
              <button onClick={() => setShowRoadmapModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">팀</label>
                <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
                  {(['커머스팀', '콘텐츠팀'] as const).map((t) => {
                    const disabled = !isAdmin && myProfile?.team !== t;
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={disabled}
                        onClick={() => setRoadmapForm({ ...roadmapForm, team: t })}
                        className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
                          roadmapForm.team === t
                            ? 'bg-indigo-600 text-white'
                            : disabled
                              ? 'text-gray-300 cursor-not-allowed'
                              : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input
                  type="text"
                  value={roadmapForm.title}
                  onChange={(e) => setRoadmapForm({ ...roadmapForm, title: e.target.value })}
                  placeholder="예: 자사몰 리뉴얼 1차 스프린트"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={roadmapForm.single_day}
                  onChange={(e) => setRoadmapForm({ ...roadmapForm, single_day: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                당일 일정
              </label>
              <div className={roadmapForm.single_day ? '' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {roadmapForm.single_day ? '날짜' : '시작일'}
                  </label>
                  <input
                    type="date"
                    value={roadmapForm.start_date}
                    onChange={(e) => setRoadmapForm({ ...roadmapForm, start_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                {!roadmapForm.single_day && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">종료일</label>
                    <input
                      type="date"
                      value={roadmapForm.end_date}
                      min={roadmapForm.start_date}
                      onChange={(e) => setRoadmapForm({ ...roadmapForm, end_date: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                  <select
                    value={roadmapForm.status}
                    onChange={(e) => setRoadmapForm({ ...roadmapForm, status: e.target.value as typeof roadmapForm.status })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="예정">예정</option>
                    <option value="진행중">진행중</option>
                    <option value="완료">완료</option>
                    <option value="보류">보류</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자 (선택)</label>
                  <select
                    value={roadmapForm.assignee_id}
                    onChange={(e) => setRoadmapForm({ ...roadmapForm, assignee_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">미지정</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">색상</label>
                <div className="flex flex-wrap gap-2">
                  {ROADMAP_COLORS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setRoadmapForm({ ...roadmapForm, color: c.key })}
                      className={`h-8 w-8 rounded-full ${c.bar} ${
                        roadmapForm.color === c.key ? 'ring-2 ring-offset-2 ring-indigo-500' : ''
                      }`}
                      title={c.key}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
                <textarea
                  value={roadmapForm.description}
                  onChange={(e) => setRoadmapForm({ ...roadmapForm, description: e.target.value })}
                  rows={2}
                  placeholder="세부 내용"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowRoadmapModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                취소
              </button>
              <button
                onClick={handleRoadmapSave}
                disabled={savingRoadmap || !roadmapForm.title || !roadmapForm.start_date}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingRoadmap ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
