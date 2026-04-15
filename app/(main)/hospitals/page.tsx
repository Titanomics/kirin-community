'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Plus, X, Trash2, Pencil, Building2, Calendar, AlertTriangle, Clock, CheckCircle2, Settings, GripVertical } from 'lucide-react';

interface Hospital {
  id: string;
  name: string;
  channels: Record<string, boolean>;
  assignee_id: string | null;
  notes: string | null;
}

interface HospitalTask {
  id: string;
  hospital_id: string;
  assignee_id: string | null;
  type: string;
  title: string;
  platform: string | null;
  start_date: string | null;
  due_date: string | null;
  status: string;
  remind_days: number;
  memo: string | null;
}

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  team: string | null;
}

interface HospitalSetting {
  id: string;
  category: 'channel' | 'type' | 'status';
  key: string;
  label: string;
  color: string;
  sort_order: number;
}

const COLOR_OPTIONS = [
  { key: 'gray', label: '회색', chip: 'bg-gray-100 text-gray-700' },
  { key: 'blue', label: '파랑', chip: 'bg-blue-100 text-blue-700' },
  { key: 'green', label: '초록', chip: 'bg-green-100 text-green-700' },
  { key: 'purple', label: '보라', chip: 'bg-purple-100 text-purple-700' },
  { key: 'orange', label: '주황', chip: 'bg-orange-100 text-orange-700' },
  { key: 'pink', label: '분홍', chip: 'bg-pink-100 text-pink-700' },
  { key: 'red', label: '빨강', chip: 'bg-red-100 text-red-700' },
  { key: 'yellow', label: '노랑', chip: 'bg-yellow-100 text-yellow-700' },
];

function colorChip(color: string): string {
  return COLOR_OPTIONS.find((c) => c.key === color)?.chip || COLOR_OPTIONS[0].chip;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function ddayLabel(d: number | null): { text: string; color: string } | null {
  if (d === null) return null;
  if (d < 0) return { text: `D+${-d} (지남)`, color: 'text-red-600 bg-red-50 border-red-200' };
  if (d === 0) return { text: 'D-DAY', color: 'text-red-600 bg-red-50 border-red-200' };
  if (d <= 3) return { text: `D-${d}`, color: 'text-red-600 bg-red-50 border-red-200' };
  if (d <= 7) return { text: `D-${d}`, color: 'text-yellow-600 bg-yellow-50 border-yellow-200' };
  return { text: `D-${d}`, color: 'text-gray-500 bg-gray-50 border-gray-200' };
}

export default function HospitalsPage() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [tasks, setTasks] = useState<HospitalTask[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<HospitalSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState('active'); // active / all / done
  const [filterMine, setFilterMine] = useState(false);

  // 병원 모달
  const [showHospitalModal, setShowHospitalModal] = useState(false);
  const [editingHospitalId, setEditingHospitalId] = useState<string | null>(null);
  const [hospitalForm, setHospitalForm] = useState({
    name: '',
    channels: {} as Record<string, boolean>,
    assignee_id: '',
    notes: '',
  });

  // 일정 모달
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({
    hospital_id: '',
    assignee_id: '',
    type: '기타',
    title: '',
    platform: '',
    start_date: '',
    due_date: '',
    status: '대기',
    remind_days: 3,
    memo: '',
  });

  const [saving, setSaving] = useState(false);
  const canEdit = !!profile;
  const isAdmin = profile?.role === 'admin';
  const hasAccess = isAdmin || profile?.team === '콘텐츠팀';

  useEffect(() => {
    if (!hasAccess) return;
    fetchData();
  }, [hasAccess]);

  async function fetchData() {
    setLoading(true);
    const [hospitalsRes, tasksRes, profilesRes, settingsRes] = await Promise.all([
      supabase.from('hospitals').select('*').order('name'),
      supabase.from('hospital_tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('profiles').select('id, display_name, email, team').is('resigned_at', null).order('display_name'),
      supabase.from('hospital_settings').select('*').order('sort_order'),
    ]);
    setHospitals(hospitalsRes.data || []);
    setTasks(tasksRes.data || []);
    setProfiles(profilesRes.data || []);
    setSettings((settingsRes.data as HospitalSetting[]) || []);
    setLoading(false);
  }

  // 카테고리별 설정 헬퍼
  const channels = useMemo(() => settings.filter((s) => s.category === 'channel'), [settings]);
  const types = useMemo(() => settings.filter((s) => s.category === 'type'), [settings]);
  const statuses = useMemo(() => settings.filter((s) => s.category === 'status'), [settings]);
  function typeColor(type: string): string {
    return colorChip(types.find((t) => t.key === type)?.color || 'gray');
  }
  function statusColor(status: string): string {
    return colorChip(statuses.find((s) => s.key === status)?.color || 'gray');
  }

  // ----- 병원 CRUD -----
  function openHospitalAdd() {
    setEditingHospitalId(null);
    setHospitalForm({ name: '', channels: {}, assignee_id: '', notes: '' });
    setShowHospitalModal(true);
  }
  function openHospitalEdit(h: Hospital) {
    setEditingHospitalId(h.id);
    setHospitalForm({
      name: h.name,
      channels: h.channels || {},
      assignee_id: h.assignee_id || '',
      notes: h.notes || '',
    });
    setShowHospitalModal(true);
  }
  async function handleHospitalSave() {
    setSaving(true);
    const payload = {
      name: hospitalForm.name,
      channels: hospitalForm.channels,
      assignee_id: hospitalForm.assignee_id || null,
      notes: hospitalForm.notes || null,
    };
    let error;
    if (editingHospitalId) {
      ({ error } = await supabase.from('hospitals').update(payload).eq('id', editingHospitalId));
    } else {
      ({ error } = await supabase.from('hospitals').insert(payload));
    }
    if (error) alert('저장 실패: ' + error.message);
    else { setShowHospitalModal(false); await fetchData(); }
    setSaving(false);
  }
  async function handleHospitalDelete(id: string) {
    if (!confirm('이 병원과 연관된 모든 일정을 삭제하시겠습니까?')) return;
    await supabase.from('hospitals').delete().eq('id', id);
    await fetchData();
  }

  // ----- 일정 CRUD -----
  function openTaskAdd(hospitalId?: string) {
    setEditingTaskId(null);
    setTaskForm({
      hospital_id: hospitalId || selectedHospitalId !== 'all' ? (hospitalId || String(selectedHospitalId)) : (hospitals[0]?.id || ''),
      assignee_id: profile?.id || '',
      type: '기타',
      title: '',
      platform: '',
      start_date: '',
      due_date: '',
      status: '대기',
      remind_days: 3,
      memo: '',
    });
    setShowTaskModal(true);
  }
  function openTaskEdit(t: HospitalTask) {
    setEditingTaskId(t.id);
    setTaskForm({
      hospital_id: t.hospital_id,
      assignee_id: t.assignee_id || '',
      type: t.type,
      title: t.title,
      platform: t.platform || '',
      start_date: t.start_date || '',
      due_date: t.due_date || '',
      status: t.status,
      remind_days: t.remind_days,
      memo: t.memo || '',
    });
    setShowTaskModal(true);
  }
  async function handleTaskSave() {
    setSaving(true);
    const payload = {
      hospital_id: taskForm.hospital_id,
      assignee_id: taskForm.assignee_id || null,
      type: taskForm.type,
      title: taskForm.title,
      platform: taskForm.platform || null,
      start_date: taskForm.start_date || null,
      due_date: taskForm.due_date || null,
      status: taskForm.status,
      remind_days: taskForm.remind_days,
      memo: taskForm.memo || null,
    };
    let error;
    if (editingTaskId) {
      ({ error } = await supabase.from('hospital_tasks').update(payload).eq('id', editingTaskId));
    } else {
      ({ error } = await supabase.from('hospital_tasks').insert(payload));
    }
    if (error) alert('저장 실패: ' + error.message);
    else { setShowTaskModal(false); await fetchData(); }
    setSaving(false);
  }
  async function handleTaskDelete(id: string) {
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    await supabase.from('hospital_tasks').delete().eq('id', id);
    await fetchData();
  }
  async function toggleTaskDone(t: HospitalTask) {
    const newStatus = t.status === '완료' ? '대기' : '완료';
    await supabase.from('hospital_tasks').update({ status: newStatus }).eq('id', t.id);
    await fetchData();
  }

  // ----- 설정 CRUD -----
  async function addSetting(category: 'channel' | 'type' | 'status', label: string, color: string) {
    if (!label.trim()) return;
    const key = label.trim();
    const existing = settings.find((s) => s.category === category && s.key === key);
    if (existing) { alert('이미 동일한 항목이 있습니다'); return; }
    const maxOrder = Math.max(0, ...settings.filter((s) => s.category === category).map((s) => s.sort_order));
    const { error } = await supabase.from('hospital_settings').insert({
      category, key, label, color, sort_order: maxOrder + 1,
    });
    if (error) alert('추가 실패: ' + error.message);
    else await fetchData();
  }
  async function updateSetting(id: string, patch: Partial<Pick<HospitalSetting, 'label' | 'color'>>) {
    const { error } = await supabase.from('hospital_settings').update(patch).eq('id', id);
    if (error) alert('수정 실패: ' + error.message);
    else await fetchData();
  }
  async function deleteSetting(s: HospitalSetting) {
    // 사용 여부 확인
    let inUse = 0;
    if (s.category === 'channel') {
      inUse = hospitals.filter((h) => h.channels?.[s.key]).length;
    } else if (s.category === 'type') {
      inUse = tasks.filter((t) => t.type === s.key).length;
    } else {
      inUse = tasks.filter((t) => t.status === s.key).length;
    }
    const warn = inUse > 0 ? `\n\n⚠️ ${inUse}개 항목에서 사용 중입니다. 삭제해도 기존 기록은 남지만, 선택 목록에서는 제거됩니다.` : '';
    if (!confirm(`'${s.label}' 을(를) 삭제하시겠습니까?${warn}`)) return;
    const { error } = await supabase.from('hospital_settings').delete().eq('id', s.id);
    if (error) alert('삭제 실패: ' + error.message);
    else await fetchData();
  }

  // ----- 필터링 -----
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (selectedHospitalId !== 'all' && t.hospital_id !== selectedHospitalId) return false;
      if (filterStatus === 'active' && t.status === '완료') return false;
      if (filterStatus === 'done' && t.status !== '완료') return false;
      if (filterMine && t.assignee_id !== profile?.id) return false;
      return true;
    });
  }, [tasks, selectedHospitalId, filterStatus, filterMine, profile?.id]);

  // 임박 요약
  const urgentCount = tasks.filter((t) => {
    if (t.status === '완료') return false;
    const d = daysUntil(t.due_date);
    return d !== null && d >= 0 && d <= 3;
  }).length;
  const overdueCount = tasks.filter((t) => {
    if (t.status === '완료') return false;
    const d = daysUntil(t.due_date);
    return d !== null && d < 0;
  }).length;

  if (profile && !hasAccess) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-gray-500">
        <p className="text-lg font-semibold">접근 권한이 없습니다</p>
        <p className="text-sm">병원 관리는 콘텐츠팀 전용 페이지입니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">병원 관리</h1>
          <p className="mt-1 text-sm text-gray-600">담당 병원의 채널과 일정/배너 마감을 관리하세요</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => setShowSettingsModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 text-gray-600 px-3 py-2 text-sm font-medium hover:bg-gray-50"
              title="채널/유형/상태 관리">
              <Settings className="h-4 w-4" /> 설정
            </button>
            <button onClick={openHospitalAdd} className="flex items-center gap-1.5 rounded-lg border border-blue-600 text-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-50">
              <Plus className="h-4 w-4" /> 병원
            </button>
            <button onClick={() => openTaskAdd()} disabled={hospitals.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              <Plus className="h-4 w-4" /> 일정
            </button>
          </div>
        )}
      </div>

      {/* 임박 요약 */}
      {(urgentCount > 0 || overdueCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {overdueCount > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-800">
                마감 초과 <strong>{overdueCount}건</strong>이 있습니다
              </p>
            </div>
          )}
          {urgentCount > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
              <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0" />
              <p className="text-sm text-yellow-800">
                3일 내 마감 <strong>{urgentCount}건</strong>
              </p>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center text-gray-400">불러오는 중...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* 병원 리스트 */}
          <div className="rounded-lg bg-white shadow">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">병원 ({hospitals.length})</h2>
            </div>
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              <button
                onClick={() => setSelectedHospitalId('all')}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selectedHospitalId === 'all' ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
              >
                <p className="text-sm font-medium text-gray-900">전체 일정</p>
                <p className="text-xs text-gray-500">{tasks.filter((t) => t.status !== '완료').length}건 진행 중</p>
              </button>
              {hospitals.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">
                  등록된 병원이 없습니다
                </div>
              ) : (
                hospitals.map((h) => {
                  const hTasks = tasks.filter((t) => t.hospital_id === h.id && t.status !== '완료');
                  const assignee = profiles.find((p) => p.id === h.assignee_id);
                  const hUrgent = hTasks.some((t) => {
                    const d = daysUntil(t.due_date);
                    return d !== null && d <= 3;
                  });
                  return (
                    <button key={h.id}
                      onClick={() => setSelectedHospitalId(h.id)}
                      className={`group w-full text-left px-4 py-3 hover:bg-gray-50 ${selectedHospitalId === h.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-gray-900 truncate">{h.name}</p>
                            {hUrgent && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">
                            {assignee?.display_name || '담당 미지정'} · {hTasks.length}건
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {channels.filter((c) => h.channels?.[c.key]).slice(0, 4).map((c) => (
                              <span key={c.key} className="text-[10px] rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{c.label}</span>
                            ))}
                            {channels.filter((c) => h.channels?.[c.key]).length > 4 && (
                              <span className="text-[10px] text-gray-400">+{channels.filter((c) => h.channels?.[c.key]).length - 4}</span>
                            )}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="opacity-0 group-hover:opacity-100 flex flex-col gap-0.5 flex-shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); openHospitalEdit(h); }} className="p-1 text-gray-400 hover:text-blue-600">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleHospitalDelete(h.id); }} className="p-1 text-gray-400 hover:text-red-600">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 일정 리스트 */}
          <div className="rounded-lg bg-white shadow">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900">
                  {selectedHospitalId === 'all' ? '전체 일정' : hospitals.find((h) => h.id === selectedHospitalId)?.name}
                  <span className="ml-2 text-xs font-normal text-gray-400">({filteredTasks.length}건)</span>
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-xs">
                  <option value="active">진행중만</option>
                  <option value="done">완료만</option>
                  <option value="all">전체</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={filterMine} onChange={(e) => setFilterMine(e.target.checked)} />
                  내 일정
                </label>
              </div>
            </div>

            {/* 병원 상세 정보 (선택된 병원) */}
            {selectedHospitalId !== 'all' && (() => {
              const h = hospitals.find((h) => h.id === selectedHospitalId);
              if (!h) return null;
              const assignee = profiles.find((p) => p.id === h.assignee_id);
              return (
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-medium text-gray-500 mb-1">담당자</p>
                      <p className="text-gray-900">{assignee?.display_name || '미지정'}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500 mb-1">비고</p>
                      <p className="text-gray-900">{h.notes || '-'}</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 mb-1.5">운영 채널</p>
                    <div className="flex flex-wrap gap-1.5">
                      {channels.map((c) => (
                        <span key={c.key}
                          className={`text-xs rounded px-2 py-0.5 border ${
                            h.channels?.[c.key]
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-gray-50 text-gray-400 border-gray-200 line-through'
                          }`}>
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 일정 리스트 */}
            {filteredTasks.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">
                해당 조건의 일정이 없습니다
              </div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[700px] overflow-y-auto">
                {filteredTasks.map((t) => {
                  const hospital = hospitals.find((h) => h.id === t.hospital_id);
                  const assignee = profiles.find((p) => p.id === t.assignee_id);
                  const dd = daysUntil(t.due_date);
                  const dlabel = ddayLabel(dd);
                  const done = t.status === '완료';
                  return (
                    <div key={t.id} className={`group px-4 py-3 hover:bg-gray-50 ${done ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-3">
                        {canEdit && (
                          <button onClick={() => toggleTaskDone(t)} className="mt-0.5 flex-shrink-0">
                            {done ? <CheckCircle2 className="h-5 w-5 text-green-500" /> :
                              <div className="h-5 w-5 rounded-full border-2 border-gray-300 hover:border-blue-400" />}
                          </button>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${typeColor(t.type)}`}>
                              {types.find((x) => x.key === t.type)?.label || t.type}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor(t.status)}`}>
                              {statuses.find((x) => x.key === t.status)?.label || t.status}
                            </span>
                            {dlabel && (
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${dlabel.color}`}>
                                {dlabel.text}
                              </span>
                            )}
                          </div>
                          <p className={`mt-1 text-sm font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-900'} break-words`}>
                            {t.title}
                          </p>
                          <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                            {selectedHospitalId === 'all' && hospital && <span className="font-medium">{hospital.name}</span>}
                            {t.platform && <span>📢 {t.platform}</span>}
                            {t.due_date && <span>마감 {t.due_date}</span>}
                            {t.start_date && t.start_date !== t.due_date && <span>시작 {t.start_date}</span>}
                            {assignee && <span>👤 {assignee.display_name}</span>}
                          </div>
                          {t.memo && <p className="mt-1 text-xs text-gray-400 break-words">{t.memo}</p>}
                        </div>
                        {canEdit && (
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0">
                            <button onClick={() => openTaskEdit(t)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                            <button onClick={() => handleTaskDelete(t.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 병원 모달 */}
      {showHospitalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{editingHospitalId ? '병원 수정' : '병원 추가'}</h3>
              <button onClick={() => setShowHospitalModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">병원명</label>
                <input type="text" value={hospitalForm.name} onChange={(e) => setHospitalForm({ ...hospitalForm, name: e.target.value })}
                  placeholder="예: OO정형외과"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
                <select value={hospitalForm.assignee_id} onChange={(e) => setHospitalForm({ ...hospitalForm, assignee_id: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">미지정</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">운영 채널</label>
                  <button type="button" onClick={() => setShowSettingsModal(true)}
                    className="text-xs text-blue-600 hover:text-blue-700">+ 채널 관리</button>
                </div>
                {channels.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">등록된 채널이 없습니다. "채널 관리"에서 추가하세요.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {channels.map((c) => (
                      <label key={c.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                        hospitalForm.channels[c.key] ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                      }`}>
                        <input type="checkbox" checked={hospitalForm.channels[c.key] || false}
                          onChange={(e) => setHospitalForm({ ...hospitalForm, channels: { ...hospitalForm.channels, [c.key]: e.target.checked } })}
                          className="hidden" />
                        <span className="text-sm">{c.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비고 (집중 포인트 등)</label>
                <textarea value={hospitalForm.notes} onChange={(e) => setHospitalForm({ ...hospitalForm, notes: e.target.value })}
                  rows={2} placeholder="예: 매월 이미지 교체, 숏폼 위주"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowHospitalModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleHospitalSave} disabled={saving || !hospitalForm.name}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일정 모달 */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{editingTaskId ? '일정 수정' : '일정 추가'}</h3>
              <button onClick={() => setShowTaskModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">병원</label>
                <select value={taskForm.hospital_id} onChange={(e) => setTaskForm({ ...taskForm, hospital_id: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">유형</label>
                    <button type="button" onClick={() => setShowSettingsModal(true)} className="text-[11px] text-blue-600 hover:text-blue-700">+ 관리</button>
                  </div>
                  <select value={taskForm.type} onChange={(e) => setTaskForm({ ...taskForm, type: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    {types.map((t) => <option key={t.id} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">상태</label>
                    <button type="button" onClick={() => setShowSettingsModal(true)} className="text-[11px] text-blue-600 hover:text-blue-700">+ 관리</button>
                  </div>
                  <select value={taskForm.status} onChange={(e) => setTaskForm({ ...taskForm, status: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    {statuses.map((s) => <option key={s.id} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  placeholder="예: 원장님 인터뷰 촬영 / 설 연휴 배너 삭제"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">플랫폼 (선택)</label>
                <input type="text" value={taskForm.platform} onChange={(e) => setTaskForm({ ...taskForm, platform: e.target.value })}
                  placeholder="예: 네이버 플레이스, 홈페이지, 블로그"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">시작일</label>
                  <input type="date" value={taskForm.start_date} onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">마감일</label>
                  <input type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당자</label>
                <select value={taskForm.assignee_id} onChange={(e) => setTaskForm({ ...taskForm, assignee_id: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">미지정</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">메모 (선택)</label>
                <input type="text" value={taskForm.memo} onChange={(e) => setTaskForm({ ...taskForm, memo: e.target.value })}
                  placeholder="예: 조명 장비 지참"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowTaskModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleTaskSave} disabled={saving || !taskForm.title || !taskForm.hospital_id}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 설정 모달 (채널/유형/상태 관리) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">항목 관리</h3>
                <p className="text-xs text-gray-500 mt-0.5">운영 채널, 일정 유형, 상태를 직접 추가/수정/삭제할 수 있습니다</p>
              </div>
              <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-6 space-y-6">
              <SettingsSection
                title="운영 채널"
                description="병원별로 체크할 수 있는 마케팅 채널 목록"
                items={channels}
                onAdd={(label, color) => addSetting('channel', label, color)}
                onUpdate={updateSetting}
                onDelete={deleteSetting}
              />
              <SettingsSection
                title="일정 유형"
                description="일정의 분류 (촬영/업로드/배너 등)"
                items={types}
                onAdd={(label, color) => addSetting('type', label, color)}
                onUpdate={updateSetting}
                onDelete={deleteSetting}
              />
              <SettingsSection
                title="일정 상태"
                description="일정의 진행 단계 (대기/진행중/완료 등)"
                items={statuses}
                onAdd={(label, color) => addSetting('status', label, color)}
                onUpdate={updateSetting}
                onDelete={deleteSetting}
              />
            </div>
            <div className="flex justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={() => setShowSettingsModal(false)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----- 설정 섹션 서브 컴포넌트 -----
function SettingsSection({
  title,
  description,
  items,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  description: string;
  items: HospitalSetting[];
  onAdd: (label: string, color: string) => void | Promise<void>;
  onUpdate: (id: string, patch: Partial<Pick<HospitalSetting, 'label' | 'color'>>) => void | Promise<void>;
  onDelete: (s: HospitalSetting) => void | Promise<void>;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('gray');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('gray');

  function startEdit(s: HospitalSetting) {
    setEditingId(s.id);
    setEditLabel(s.label);
    setEditColor(s.color);
  }
  async function saveEdit() {
    if (!editingId) return;
    await onUpdate(editingId, { label: editLabel, color: editColor });
    setEditingId(null);
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
      <p className="text-xs text-gray-500 mt-0.5 mb-2">{description}</p>
      <div className="space-y-1.5">
        {items.length === 0 && (
          <p className="text-xs text-gray-400 py-2">등록된 항목이 없습니다</p>
        )}
        {items.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-2 py-1.5">
            <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
            {editingId === s.id ? (
              <>
                <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                  autoFocus
                  className="flex-1 rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none" />
                <select value={editColor} onChange={(e) => setEditColor(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs">
                  {COLOR_OPTIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <button onClick={saveEdit} className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700">저장</button>
                <button onClick={() => setEditingId(null)} className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300">취소</button>
              </>
            ) : (
              <>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorChip(s.color)}`}>{s.label}</span>
                <span className="flex-1 text-xs text-gray-400">key: {s.key}</span>
                <button onClick={() => startEdit(s)} className="p-1 text-gray-400 hover:text-blue-600">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onDelete(s)} className="p-1 text-gray-400 hover:text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
        {/* 추가 입력 행 */}
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-2 py-1.5">
          <Plus className="h-4 w-4 text-gray-300 flex-shrink-0" />
          <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newLabel) { onAdd(newLabel, newColor); setNewLabel(''); } }}
            placeholder="새 항목 추가 (Enter)"
            className="flex-1 bg-transparent px-2 py-1 text-sm placeholder-gray-400 focus:outline-none" />
          <select value={newColor} onChange={(e) => setNewColor(e.target.value)}
            className="rounded border border-gray-200 px-2 py-1 text-xs">
            {COLOR_OPTIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button onClick={() => { if (newLabel) { onAdd(newLabel, newColor); setNewLabel(''); } }}
            disabled={!newLabel}
            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-40">
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
