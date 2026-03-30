'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Plus, X, Trash2, Target, ChevronDown, ChevronRight, CheckCircle2, Circle, Pencil } from 'lucide-react';

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  team: string | null;
  role: string;
}

interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  type: 'numeric' | 'text';
  target_value: number | null;
  current_value: number | null;
  status: string;
  due_date: string | null;
  memo: string | null;
  sort_order: number;
}

interface Objective {
  id: string;
  user_id: string;
  team: string;
  title: string;
  period: string;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
  profiles?: { display_name: string | null; email: string | null } | null;
  okr_key_results?: KeyResult[];
}

export default function OkrPage() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Objective 모달
  const [showObjModal, setShowObjModal] = useState(false);
  const [editingObjId, setEditingObjId] = useState<string | null>(null);
  const [objForm, setObjForm] = useState({
    user_id: '',
    team: '커머스팀',
    title: '',
    period: '',
    start_date: '',
    end_date: '',
    status: '진행중',
  });

  // Key Result 모달
  const [showKrModal, setShowKrModal] = useState(false);
  const [editingKrId, setEditingKrId] = useState<string | null>(null);
  const [krParentId, setKrParentId] = useState('');
  const [krForm, setKrForm] = useState({
    title: '',
    type: 'text' as 'numeric' | 'text',
    target_value: '',
    current_value: '',
    status: '진행중',
    due_date: '',
    memo: '',
  });

  const [saving, setSaving] = useState(false);
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const isAdmin = myProfile?.role === 'admin';
  const isLeader = myProfile?.role === 'leader';
  const canEdit = isAdmin || isLeader;

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [objRes, profRes] = await Promise.all([
      supabase
        .from('okr_objectives')
        .select('*, profiles(display_name, email), okr_key_results(*)')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').is('resigned_at', null),
    ]);
    setObjectives(objRes.data || []);
    setProfiles(profRes.data || []);
    setLoading(false);
  }

  function getEditableProfiles() {
    if (isAdmin) return profiles;
    if (isLeader && myProfile) {
      const myTeam = profiles.find((p) => p.id === myProfile.id)?.team;
      return profiles.filter((p) => p.team === myTeam);
    }
    return [];
  }

  function canEditObjective(obj: Objective) {
    if (isAdmin) return true;
    if (isLeader && myProfile) {
      const myTeam = profiles.find((p) => p.id === myProfile.id)?.team;
      return obj.team === myTeam;
    }
    return false;
  }

  // --- Objective CRUD ---
  function openObjAdd() {
    setEditingObjId(null);
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    setObjForm({
      user_id: '',
      team: '커머스팀',
      title: '',
      period: `${now.getFullYear()}-Q${q}`,
      start_date: now.toISOString().slice(0, 10),
      end_date: '',
      status: '진행중',
    });
    setShowObjModal(true);
  }

  function openObjEdit(obj: Objective) {
    setEditingObjId(obj.id);
    setObjForm({
      user_id: obj.user_id,
      team: obj.team,
      title: obj.title,
      period: obj.period,
      start_date: obj.start_date,
      end_date: obj.end_date,
      status: obj.status,
    });
    setShowObjModal(true);
  }

  async function handleObjSave() {
    setSaving(true);
    const payload = { ...objForm };
    let error;
    if (editingObjId) {
      ({ error } = await supabase.from('okr_objectives').update(payload).eq('id', editingObjId));
    } else {
      ({ error } = await supabase.from('okr_objectives').insert(payload));
    }
    if (error) alert('저장 실패: ' + error.message);
    else { setShowObjModal(false); await fetchData(); }
    setSaving(false);
  }

  async function handleObjDelete(id: string) {
    if (!confirm('이 목표와 하위 Key Results를 모두 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('okr_objectives').delete().eq('id', id);
    if (error) alert('삭제 실패: ' + error.message);
    else await fetchData();
  }

  // --- Key Result CRUD ---
  function openKrAdd(objectiveId: string) {
    setEditingKrId(null);
    setKrParentId(objectiveId);
    setKrForm({ title: '', type: 'text', target_value: '', current_value: '', status: '진행중', due_date: '', memo: '' });
    setShowKrModal(true);
  }

  function openKrEdit(kr: KeyResult) {
    setEditingKrId(kr.id);
    setKrParentId(kr.objective_id);
    setKrForm({
      title: kr.title,
      type: kr.type,
      target_value: kr.target_value != null ? String(kr.target_value) : '',
      current_value: kr.current_value != null ? String(kr.current_value) : '',
      status: kr.status,
      due_date: kr.due_date || '',
      memo: kr.memo || '',
    });
    setShowKrModal(true);
  }

  async function handleKrSave() {
    setSaving(true);
    const payload: Record<string, unknown> = {
      objective_id: krParentId,
      title: krForm.title,
      type: krForm.type,
      status: krForm.status,
      due_date: krForm.due_date || null,
      memo: krForm.memo || null,
    };
    if (krForm.type === 'numeric') {
      payload.target_value = Number(krForm.target_value) || 0;
      payload.current_value = Number(krForm.current_value) || 0;
    } else {
      payload.target_value = null;
      payload.current_value = null;
    }
    let error;
    if (editingKrId) {
      const { objective_id: _, ...updatePayload } = payload;
      ({ error } = await supabase.from('okr_key_results').update(updatePayload).eq('id', editingKrId));
    } else {
      ({ error } = await supabase.from('okr_key_results').insert(payload));
    }
    if (error) alert('저장 실패: ' + error.message);
    else { setShowKrModal(false); await fetchData(); }
    setSaving(false);
  }

  async function handleKrDelete(id: string) {
    if (!confirm('이 Key Result를 삭제하시겠습니까?')) return;
    await supabase.from('okr_key_results').delete().eq('id', id);
    await fetchData();
  }

  async function toggleKrStatus(kr: KeyResult) {
    const newStatus = kr.status === '완료' ? '진행중' : '완료';
    await supabase.from('okr_key_results').update({ status: newStatus }).eq('id', kr.id);
    await fetchData();
  }

  // --- 계산 ---
  function calcObjectiveProgress(obj: Objective): number {
    const krs = obj.okr_key_results || [];
    if (krs.length === 0) return 0;
    let total = 0;
    for (const kr of krs) {
      if (kr.status === '완료') { total += 100; continue; }
      if (kr.type === 'numeric' && kr.target_value && kr.target_value > 0) {
        total += Math.min(((kr.current_value || 0) / kr.target_value) * 100, 100);
      }
    }
    return total / krs.length;
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleUserSelect(userId: string) {
    const p = profiles.find((pr) => pr.id === userId);
    setObjForm({ ...objForm, user_id: userId, team: p?.team || '커머스팀' });
  }

  // --- 필터링 ---
  const filtered = objectives.filter((o) => {
    if (!canEdit && myProfile) return o.user_id === myProfile.id;
    if (filterTeam !== 'all' && o.team !== filterTeam) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    if (isLeader && myProfile) {
      const myTeam = profiles.find((p) => p.id === myProfile.id)?.team;
      if (o.team !== myTeam) return false;
    }
    return true;
  });

  // 유저별 그룹핑
  const groupedByUser: Record<string, Objective[]> = {};
  for (const o of filtered) {
    if (!groupedByUser[o.user_id]) groupedByUser[o.user_id] = [];
    groupedByUser[o.user_id].push(o);
  }

  function progressColor(rate: number) {
    if (rate >= 100) return 'bg-green-500';
    if (rate >= 70) return 'bg-blue-500';
    if (rate >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  }

  function progressBg(rate: number) {
    if (rate >= 100) return 'bg-green-100';
    if (rate >= 70) return 'bg-blue-100';
    if (rate >= 40) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  function statusBadge(status: string) {
    switch (status) {
      case '완료': return 'bg-green-100 text-green-700';
      case '보류': return 'bg-gray-100 text-gray-500';
      default: return 'bg-blue-100 text-blue-700';
    }
  }

  function formatDate(d: string | null) {
    if (!d) return '';
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function isDueSoon(d: string | null) {
    if (!d) return false;
    const diff = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  }

  function isOverdue(d: string | null) {
    if (!d) return false;
    return new Date(d).getTime() < Date.now();
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  const editableProfiles = getEditableProfiles();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">OKR</h1>
          <p className="mt-1 text-sm text-gray-600">목표(Objective)와 핵심 결과(Key Result)를 관리하세요</p>
        </div>
        {canEdit && (
          <button onClick={openObjAdd} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> 목표 추가
          </button>
        )}
      </div>

      {/* 필터 */}
      {canEdit && (
        <div className="flex flex-wrap gap-4 rounded-lg bg-white p-4 shadow">
          {isAdmin && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">팀</label>
              <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                <option value="all">전체</option>
                <option value="커머스팀">커머스팀</option>
                <option value="콘텐츠팀">콘텐츠팀</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">상태</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
              <option value="all">전체</option>
              <option value="진행중">진행중</option>
              <option value="완료">완료</option>
              <option value="보류">보류</option>
            </select>
          </div>
        </div>
      )}

      {/* OKR 카드 */}
      {Object.keys(groupedByUser).length === 0 ? (
        <div className="rounded-lg bg-white p-12 text-center shadow">
          <Target className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-gray-500">등록된 OKR이 없습니다</p>
          {canEdit && <p className="mt-1 text-sm text-gray-400">목표 추가 버튼으로 시작하세요</p>}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByUser).map(([userId, userObjs]) => {
            const userProfile = profiles.find((p) => p.id === userId);
            const userName = userProfile?.display_name || userProfile?.email || '알 수 없음';
            const userTeam = userProfile?.team || '미지정';

            return (
              <div key={userId} className="rounded-lg bg-white shadow">
                {/* 유저 헤더 */}
                <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white flex-shrink-0">
                    {userName.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{userName}</p>
                    <p className="text-xs text-gray-500">{userTeam}</p>
                  </div>
                </div>

                {/* Objectives */}
                <div className="divide-y divide-gray-100">
                  {userObjs.map((obj) => {
                    const progress = calcObjectiveProgress(obj);
                    const krs = obj.okr_key_results || [];
                    const isExpanded = expandedIds.has(obj.id);

                    return (
                      <div key={obj.id} className="px-6 py-4">
                        {/* Objective 헤더 */}
                        <div className="flex items-center gap-3">
                          <button onClick={() => toggleExpand(obj.id)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                            {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                          </button>
                          <Target className="h-5 w-5 text-blue-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{obj.title}</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(obj.status)}`}>{obj.status}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                              <span>{obj.period}</span>
                              <span>{obj.start_date} ~ {obj.end_date}</span>
                              <span>KR {krs.length}개</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right hidden sm:block">
                              <span className={`text-lg font-bold ${progress >= 100 ? 'text-green-600' : progress >= 70 ? 'text-blue-600' : progress >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {progress.toFixed(0)}%
                              </span>
                            </div>
                            {canEdit && canEditObjective(obj) && (
                              <div className="flex items-center gap-1">
                                <button onClick={() => openObjEdit(obj)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="h-4 w-4" /></button>
                                <button onClick={() => handleObjDelete(obj.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 프로그레스바 */}
                        <div className={`mt-2 ml-8 h-2 w-full rounded-full ${progressBg(progress)}`}>
                          <div className={`h-2 rounded-full transition-all duration-500 ${progressColor(progress)}`} style={{ width: `${Math.min(progress, 100)}%` }} />
                        </div>

                        {/* Key Results (펼침) */}
                        {isExpanded && (
                          <div className="mt-3 ml-8 space-y-2">
                            {krs.length === 0 && (
                              <p className="text-sm text-gray-400 py-2">Key Result가 없습니다</p>
                            )}
                            {krs.sort((a, b) => a.sort_order - b.sort_order).map((kr) => {
                              const krRate = kr.type === 'numeric' && kr.target_value && kr.target_value > 0
                                ? Math.min(((kr.current_value || 0) / kr.target_value) * 100, 100)
                                : kr.status === '완료' ? 100 : 0;
                              const done = kr.status === '완료';

                              return (
                                <div key={kr.id} className={`flex items-start gap-3 rounded-lg border p-3 ${done ? 'border-green-200 bg-green-50/50' : 'border-gray-100'}`}>
                                  {/* 체크 토글 */}
                                  {canEdit ? (
                                    <button onClick={() => toggleKrStatus(kr)} className="mt-0.5 flex-shrink-0">
                                      {done
                                        ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                                        : <Circle className="h-5 w-5 text-gray-300 hover:text-blue-400" />}
                                    </button>
                                  ) : (
                                    <div className="mt-0.5 flex-shrink-0">
                                      {done
                                        ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                                        : <Circle className="h-5 w-5 text-gray-300" />}
                                    </div>
                                  )}

                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{kr.title}</p>

                                    {/* 숫자형: 프로그레스 */}
                                    {kr.type === 'numeric' && !done && (
                                      <div className="mt-1.5 flex items-center gap-2">
                                        <div className={`h-1.5 flex-1 rounded-full ${progressBg(krRate)}`}>
                                          <div className={`h-1.5 rounded-full ${progressColor(krRate)}`} style={{ width: `${krRate}%` }} />
                                        </div>
                                        <span className="text-xs text-gray-500 flex-shrink-0">{kr.current_value}/{kr.target_value}</span>
                                        <span className={`text-xs font-semibold flex-shrink-0 ${krRate >= 100 ? 'text-green-600' : krRate >= 70 ? 'text-blue-600' : 'text-red-600'}`}>{krRate.toFixed(0)}%</span>
                                      </div>
                                    )}

                                    {/* 메모 */}
                                    {kr.memo && (
                                      <p className="mt-1 text-xs text-gray-400">{kr.memo}</p>
                                    )}
                                  </div>

                                  {/* 마감일 + 액션 */}
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {kr.due_date && (
                                      <span className={`text-xs ${isOverdue(kr.due_date) && !done ? 'text-red-500 font-semibold' : isDueSoon(kr.due_date) && !done ? 'text-yellow-600' : 'text-gray-400'}`}>
                                        ~{formatDate(kr.due_date)}
                                      </span>
                                    )}
                                    {canEdit && canEditObjective(obj) && (
                                      <div className="flex items-center gap-0.5">
                                        <button onClick={() => openKrEdit(kr)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                                        <button onClick={() => handleKrDelete(kr.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {/* KR 추가 버튼 */}
                            {canEdit && canEditObjective(obj) && (
                              <button onClick={() => openKrAdd(obj.id)}
                                className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 w-full justify-center">
                                <Plus className="h-4 w-4" /> Key Result 추가
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Objective 모달 */}
      {showObjModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{editingObjId ? '목표 수정' : '목표 추가'}</h3>
              <button onClick={() => setShowObjModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">대상 팀원</label>
                <select value={objForm.user_id} onChange={(e) => handleUserSelect(e.target.value)} required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">선택하세요</option>
                  {editableProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name || p.email} ({p.team || '미지정'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">목표 (Objective)</label>
                <input type="text" value={objForm.title} onChange={(e) => setObjForm({ ...objForm, title: e.target.value })}
                  placeholder="예: Q2 커머스 매출 성장" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">기간 라벨</label>
                  <input type="text" value={objForm.period} onChange={(e) => setObjForm({ ...objForm, period: e.target.value })}
                    placeholder="2026-Q2" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">시작일</label>
                  <input type="date" value={objForm.start_date} onChange={(e) => setObjForm({ ...objForm, start_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종료일</label>
                  <input type="date" value={objForm.end_date} onChange={(e) => setObjForm({ ...objForm, end_date: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                <select value={objForm.status} onChange={(e) => setObjForm({ ...objForm, status: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="진행중">진행중</option>
                  <option value="완료">완료</option>
                  <option value="보류">보류</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowObjModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleObjSave} disabled={saving || !objForm.user_id || !objForm.title || !objForm.start_date || !objForm.end_date}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Key Result 모달 */}
      {showKrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{editingKrId ? 'Key Result 수정' : 'Key Result 추가'}</h3>
              <button onClick={() => setShowKrModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" value={krForm.title} onChange={(e) => setKrForm({ ...krForm, title: e.target.value })}
                  placeholder="예: 스마트스토어 월매출 2000만원 달성" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
                <div className="flex gap-3">
                  <label className={`flex-1 cursor-pointer rounded-lg border p-3 text-center text-sm ${krForm.type === 'text' ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-500'}`}>
                    <input type="radio" className="hidden" checked={krForm.type === 'text'} onChange={() => setKrForm({ ...krForm, type: 'text' })} />
                    텍스트 (완료/미완료)
                  </label>
                  <label className={`flex-1 cursor-pointer rounded-lg border p-3 text-center text-sm ${krForm.type === 'numeric' ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-500'}`}>
                    <input type="radio" className="hidden" checked={krForm.type === 'numeric'} onChange={() => setKrForm({ ...krForm, type: 'numeric' })} />
                    수치 (목표/현재)
                  </label>
                </div>
              </div>
              {krForm.type === 'numeric' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">목표 수치</label>
                    <input type="number" value={krForm.target_value} onChange={(e) => setKrForm({ ...krForm, target_value: e.target.value })}
                      min="1" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">현재 수치</label>
                    <input type="number" value={krForm.current_value} onChange={(e) => setKrForm({ ...krForm, current_value: e.target.value })}
                      min="0" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">마감일 (선택)</label>
                <input type="date" value={krForm.due_date} onChange={(e) => setKrForm({ ...krForm, due_date: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">메모 (선택)</label>
                <input type="text" value={krForm.memo} onChange={(e) => setKrForm({ ...krForm, memo: e.target.value })}
                  placeholder="진행 상황이나 참고사항" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowKrModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleKrSave} disabled={saving || !krForm.title}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
