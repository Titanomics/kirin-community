'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Target, Building2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { ko } from 'date-fns/locale';
import Link from 'next/link';

interface TeamRoadmap {
  id: string;
  team: '커머스팀' | '콘텐츠팀';
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

interface HospitalTaskLite {
  id: string;
  hospital_id: string;
  title: string;
  type: string;
  start_date: string | null;
  due_date: string | null;
  status: string;
  assignee_id: string | null;
}

interface Hospital {
  id: string;
  name: string;
}

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
}

interface DayItem {
  id: string;
  kind: 'roadmap' | 'hospital';
  title: string;
  start_date: string;
  end_date: string;
  color?: string;
  team?: string;
  type?: string;
  hospitalName?: string;
  assigneeName?: string | null;
  status: string;
  description?: string | null;
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

function hospitalChip(type: string): string {
  switch (type) {
    case '배너': return 'bg-orange-100 text-orange-800';
    case '촬영': return 'bg-purple-100 text-purple-800';
    case '업로드': return 'bg-blue-100 text-blue-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

export default function TeamCalendarPage() {
  const supabase = createClient();
  const { profile: myProfile } = useAuth();
  const isAdmin = myProfile?.role === 'admin';
  const userTeam = myProfile?.team as '커머스팀' | '콘텐츠팀' | null;

  const [viewTeam, setViewTeam] = useState<'커머스팀' | '콘텐츠팀'>(
    userTeam === '콘텐츠팀' ? '콘텐츠팀' : '커머스팀'
  );
  const effectiveTeam: '커머스팀' | '콘텐츠팀' = isAdmin ? viewTeam : (userTeam || viewTeam);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [roadmaps, setRoadmaps] = useState<TeamRoadmap[]>([]);
  const [hospitalTasks, setHospitalTasks] = useState<HospitalTaskLite[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // 날짜 상세 모달
  const [selectedDayItems, setSelectedDayItems] = useState<DayItem[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDateLabel, setSelectedDateLabel] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // 로드맵 모달
  const [showRoadmapModal, setShowRoadmapModal] = useState(false);
  const [editingRoadmapId, setEditingRoadmapId] = useState<string | null>(null);
  const [roadmapForm, setRoadmapForm] = useState({
    team: effectiveTeam,
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    color: 'blue',
    status: '진행중' as '예정' | '진행중' | '완료' | '보류',
    assignee_id: '',
    single_day: false,
  });
  const [saving, setSaving] = useState(false);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchRoadmaps(), fetchHospitalTasks(), fetchHospitals(), fetchProfiles()]);
      setLoading(false);
    }
    load();
  }, [currentDate, effectiveTeam]);

  async function fetchRoadmaps() {
    const start = format(monthStart, 'yyyy-MM-dd');
    const end = format(monthEnd, 'yyyy-MM-dd');
    const { data } = await supabase
      .from('team_roadmap')
      .select('*, assignee:profiles!team_roadmap_assignee_id_fkey(display_name, email)')
      .eq('team', effectiveTeam)
      .lte('start_date', end)
      .gte('end_date', start);
    setRoadmaps(data || []);
  }

  async function fetchHospitalTasks() {
    if (effectiveTeam !== '콘텐츠팀') {
      setHospitalTasks([]);
      return;
    }
    const start = format(monthStart, 'yyyy-MM-dd');
    const end = format(monthEnd, 'yyyy-MM-dd');
    const { data } = await supabase
      .from('hospital_tasks')
      .select('id, hospital_id, title, type, start_date, due_date, status, assignee_id')
      .neq('status', '완료')
      .or(
        `and(due_date.gte.${start},due_date.lte.${end}),and(start_date.gte.${start},start_date.lte.${end})`
      );
    setHospitalTasks(data || []);
  }

  async function fetchHospitals() {
    const { data } = await supabase.from('hospitals').select('id, name');
    setHospitals(data || []);
  }

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('id, display_name, email').is('resigned_at', null).order('display_name');
    setProfiles(data || []);
  }

  function getItemsForDate(date: Date): DayItem[] {
    const dateStr = format(date, 'yyyy-MM-dd');
    const roadmapItems: DayItem[] = roadmaps
      .filter((r) => dateStr >= r.start_date && dateStr <= r.end_date)
      .map((r) => ({
        id: r.id,
        kind: 'roadmap' as const,
        title: r.title,
        start_date: r.start_date,
        end_date: r.end_date,
        color: r.color,
        team: r.team,
        assigneeName: r.assignee?.display_name || r.assignee?.email || null,
        status: r.status,
        description: r.description,
      }));
    const hospitalItems: DayItem[] = hospitalTasks
      .filter((t) => {
        const s = t.start_date || t.due_date;
        const e = t.due_date || t.start_date;
        return s && e && dateStr >= s && dateStr <= e;
      })
      .map((t) => {
        const s = t.start_date || t.due_date!;
        const e = t.due_date || t.start_date!;
        const hospital = hospitals.find((h) => h.id === t.hospital_id);
        return {
          id: t.id,
          kind: 'hospital' as const,
          title: t.title,
          start_date: s,
          end_date: e,
          type: t.type,
          hospitalName: hospital?.name,
          status: t.status,
        };
      });
    return [...roadmapItems, ...hospitalItems];
  }

  function handleDayClick(date: Date) {
    const items = getItemsForDate(date);
    setSelectedDayItems(items);
    setSelectedDateLabel(format(date, 'yyyy년 M월 d일 (EEEE)', { locale: ko }));
    setSelectedDate(format(date, 'yyyy-MM-dd'));
    setShowDetailModal(true);
  }

  function openRoadmapAddModal(dateStr?: string) {
    setEditingRoadmapId(null);
    setRoadmapForm({
      team: effectiveTeam,
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

  function openRoadmapEditModal(item: DayItem) {
    const r = roadmaps.find((x) => x.id === item.id);
    if (!r) return;
    setEditingRoadmapId(r.id);
    setRoadmapForm({
      team: r.team,
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
    setSaving(true);
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
      ({ error } = await supabase.from('team_roadmap').insert({ ...payload, created_by: myProfile.id }));
    }
    if (error) alert('저장 실패: ' + error.message);
    else { setShowRoadmapModal(false); await fetchRoadmaps(); }
    setSaving(false);
  }

  async function handleRoadmapDelete(id: string) {
    if (!confirm('이 로드맵을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('team_roadmap').delete().eq('id', id);
    if (error) alert('삭제 실패: ' + error.message);
    else { setShowDetailModal(false); await fetchRoadmaps(); }
  }

  function canEditRoadmap(): boolean {
    if (!myProfile) return false;
    if (isAdmin) return true;
    return myProfile.team === effectiveTeam;
  }

  const firstDayOfWeek = monthStart.getDay();
  const emptyCells = Array.from({ length: firstDayOfWeek }, (_, i) => i);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">팀 캘린더</h1>
          <p className="mt-1 text-sm text-gray-600">
            팀 업무 로드맵{effectiveTeam === '콘텐츠팀' && ' + 병원 일정'} · 휴가/일정은 <Link href="/calendar" className="underline hover:text-blue-600">캘린더</Link>에서
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
              {(['커머스팀', '콘텐츠팀'] as const).map((t) => (
                <button key={t} onClick={() => setViewTeam(t)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${viewTeam === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {canEditRoadmap() && (
            <button onClick={() => openRoadmapAddModal()}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              <Target className="h-4 w-4" /> 로드맵 추가
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white p-4 md:p-6 shadow">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {format(currentDate, 'yyyy년 M월', { locale: ko })} · {effectiveTeam}
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
            {emptyCells.map((i) => (<div key={`empty-${i}`} className="min-h-16 md:min-h-24" />))}
            {days.map((day) => {
              const items = getItemsForDate(day);
              const isToday = isSameDay(day, new Date());
              const dow = day.getDay();
              return (
                <div key={day.toString()} onClick={() => handleDayClick(day)}
                  className={`group relative min-h-16 md:min-h-24 cursor-pointer rounded-lg border p-1.5 md:p-2 transition hover:bg-gray-50 ${isToday ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className={`text-xs font-medium md:text-sm ${isToday ? 'text-indigo-600' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'}`}>
                      {format(day, 'd')}
                    </div>
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {items.slice(0, 3).map((it) => {
                      const isSingle = it.start_date === it.end_date;
                      const chipClass = it.kind === 'roadmap' ? roadmapChip(it.color || 'blue') : hospitalChip(it.type || '');
                      return (
                        <div key={`${it.kind}-${it.id}`} className={`rounded px-1 py-0.5 text-xs truncate flex items-center gap-0.5 ${chipClass}`}>
                          <span className="text-[10px] opacity-60 flex-shrink-0">
                            {it.kind === 'hospital' ? '🏥' : isSingle ? '●' : '▬'}
                          </span>
                          <span className="truncate">{it.title}</span>
                        </div>
                      );
                    })}
                    {items.length > 3 && (<div className="text-xs text-gray-400">+{items.length - 3}건</div>)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg bg-white p-4 shadow text-xs md:text-sm">
        <div className="flex items-center gap-1.5"><div className="h-3.5 w-3.5 rounded bg-indigo-100" /><span className="text-gray-700">팀 로드맵</span></div>
        {effectiveTeam === '콘텐츠팀' && (
          <>
            <div className="flex items-center gap-1.5"><div className="h-3.5 w-3.5 rounded bg-orange-100" /><span className="text-gray-700">병원 · 배너</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3.5 w-3.5 rounded bg-purple-100" /><span className="text-gray-700">병원 · 촬영</span></div>
            <div className="flex items-center gap-1.5"><div className="h-3.5 w-3.5 rounded bg-blue-100" /><span className="text-gray-700">병원 · 업로드</span></div>
          </>
        )}
        <div className="ml-auto text-[11px] text-gray-500">● 당일 · ▬ 기간 · 🏥 병원</div>
      </div>

      {/* 날짜 상세 모달 */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{selectedDateLabel}</h3>
              <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            {selectedDayItems.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">일정이 없습니다</p>
            ) : (
              <div className="space-y-2">
                {selectedDayItems.map((it) => (
                  <div key={`${it.kind}-${it.id}`} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${it.kind === 'roadmap' ? roadmapChip(it.color || 'blue') : hospitalChip(it.type || '')}`}>
                        {it.kind === 'roadmap' ? it.team : it.type}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{it.title}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {it.start_date === it.end_date ? `당일 · ${it.start_date}` : `${it.start_date} ~ ${it.end_date}`}
                          {it.kind === 'roadmap' && it.assigneeName && ` · ${it.assigneeName}`}
                          {it.kind === 'hospital' && it.hospitalName && ` · ${it.hospitalName}`}
                        </p>
                        {it.description && <p className="text-xs text-gray-400 truncate">{it.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      {it.kind === 'roadmap' && canEditRoadmap() && (
                        <>
                          <button onClick={() => openRoadmapEditModal(it)} className="rounded p-1 text-blue-500 hover:bg-blue-50 text-xs">수정</button>
                          <button onClick={() => handleRoadmapDelete(it.id)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><Trash2 className="h-4 w-4" /></button>
                        </>
                      )}
                      {it.kind === 'hospital' && (
                        <Link href="/hospitals" className="rounded p-1 text-blue-500 hover:bg-blue-50 text-xs flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" /> 관리
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-between">
              {canEditRoadmap() ? (
                <button onClick={() => openRoadmapAddModal(selectedDate)}
                  className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                  <Plus className="h-4 w-4" /> 로드맵 추가
                </button>
              ) : <span />}
              <button onClick={() => setShowDetailModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 로드맵 추가/수정 모달 */}
      {showRoadmapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{editingRoadmapId ? '로드맵 수정' : '팀 로드맵 추가'}</h3>
              <button onClick={() => setShowRoadmapModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">팀</label>
                <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
                  {(['커머스팀', '콘텐츠팀'] as const).map((t) => {
                    const disabled = !isAdmin && myProfile?.team !== t;
                    return (
                      <button key={t} type="button" disabled={disabled}
                        onClick={() => setRoadmapForm({ ...roadmapForm, team: t })}
                        className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
                          roadmapForm.team === t ? 'bg-indigo-600 text-white' : disabled ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-50'
                        }`}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" value={roadmapForm.title} onChange={(e) => setRoadmapForm({ ...roadmapForm, title: e.target.value })}
                  placeholder="예: 자사몰 리뉴얼 1차 스프린트" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={roadmapForm.single_day}
                  onChange={(e) => setRoadmapForm({ ...roadmapForm, single_day: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                당일 일정
              </label>
              <div className={roadmapForm.single_day ? '' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{roadmapForm.single_day ? '날짜' : '시작일'}</label>
                  <input type="date" value={roadmapForm.start_date} onChange={(e) => setRoadmapForm({ ...roadmapForm, start_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
                </div>
                {!roadmapForm.single_day && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">종료일</label>
                    <input type="date" value={roadmapForm.end_date} min={roadmapForm.start_date}
                      onChange={(e) => setRoadmapForm({ ...roadmapForm, end_date: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                  <select value={roadmapForm.status}
                    onChange={(e) => setRoadmapForm({ ...roadmapForm, status: e.target.value as typeof roadmapForm.status })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
                    <option value="예정">예정</option>
                    <option value="진행중">진행중</option>
                    <option value="완료">완료</option>
                    <option value="보류">보류</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
                  <select value={roadmapForm.assignee_id}
                    onChange={(e) => setRoadmapForm({ ...roadmapForm, assignee_id: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
                    <option value="">미지정</option>
                    {profiles.map((p) => (<option key={p.id} value={p.id}>{p.display_name || p.email}</option>))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">색상</label>
                <div className="flex flex-wrap gap-2">
                  {ROADMAP_COLORS.map((c) => (
                    <button key={c.key} type="button" onClick={() => setRoadmapForm({ ...roadmapForm, color: c.key })}
                      className={`h-8 w-8 rounded-full ${c.bar} ${roadmapForm.color === c.key ? 'ring-2 ring-offset-2 ring-indigo-500' : ''}`}
                      title={c.key} />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
                <textarea value={roadmapForm.description}
                  onChange={(e) => setRoadmapForm({ ...roadmapForm, description: e.target.value })}
                  rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowRoadmapModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleRoadmapSave} disabled={saving || !roadmapForm.title || !roadmapForm.start_date}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
