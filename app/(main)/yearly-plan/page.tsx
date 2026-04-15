'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Plus, X, Trash2, Pencil, ChevronLeft, ChevronRight, Target, CheckCircle2, Circle } from 'lucide-react';

interface YearlyPlan {
  id: string;
  team: string;
  year: number;
  title: string;
  description: string | null;
  category: string | null;
  start_month: number;
  end_month: number;
  color: string;
  status: string;
  owner_id: string | null;
  sort_order: number;
}

interface MonthlyGoal {
  id: string;
  team: string;
  year: number;
  month: number;
  title: string;
  description: string | null;
  done: boolean;
  sort_order: number;
}

const COLOR_CLASSES: Record<string, { bar: string; bg: string; text: string; border: string }> = {
  blue: { bar: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  green: { bar: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  purple: { bar: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  orange: { bar: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  pink: { bar: 'bg-pink-500', bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
  gray: { bar: 'bg-gray-500', bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
};

const STATUS_COLOR: Record<string, string> = {
  '예정': 'bg-gray-100 text-gray-600',
  '진행중': 'bg-blue-100 text-blue-700',
  '완료': 'bg-green-100 text-green-700',
  '보류': 'bg-yellow-100 text-yellow-700',
};

const TEAMS = ['커머스팀', '콘텐츠팀'] as const;

export default function YearlyPlanPage() {
  const supabase = createClient();
  const { profile } = useAuth();

  const [year, setYear] = useState(new Date().getFullYear());
  const [team, setTeam] = useState<string>(profile?.team === '콘텐츠팀' ? '콘텐츠팀' : '커머스팀');
  const [plans, setPlans] = useState<YearlyPlan[]>([]);
  const [goals, setGoals] = useState<MonthlyGoal[]>([]);
  const [loading, setLoading] = useState(true);

  // 플랜 모달
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({
    title: '',
    description: '',
    category: '',
    start_month: 1,
    end_month: 3,
    color: 'blue',
    status: '진행중',
  });

  // 월별 목표 모달
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalMonth, setGoalMonth] = useState(1);
  const [goalForm, setGoalForm] = useState({ title: '', description: '' });

  const [saving, setSaving] = useState(false);
  const canEdit = !!profile;
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    fetchData();
  }, [year, team]);

  async function fetchData() {
    setLoading(true);
    const [plansRes, goalsRes] = await Promise.all([
      supabase.from('yearly_plans').select('*').eq('year', year).eq('team', team).order('start_month').order('sort_order'),
      supabase.from('monthly_goals').select('*').eq('year', year).eq('team', team).order('month').order('sort_order'),
    ]);
    setPlans(plansRes.data || []);
    setGoals(goalsRes.data || []);
    setLoading(false);
  }

  // ----- 플랜 CRUD -----
  function openPlanAdd() {
    setEditingPlanId(null);
    setPlanForm({ title: '', description: '', category: '', start_month: 1, end_month: 3, color: 'blue', status: '진행중' });
    setShowPlanModal(true);
  }
  function openPlanEdit(p: YearlyPlan) {
    setEditingPlanId(p.id);
    setPlanForm({
      title: p.title,
      description: p.description || '',
      category: p.category || '',
      start_month: p.start_month,
      end_month: p.end_month,
      color: p.color,
      status: p.status,
    });
    setShowPlanModal(true);
  }
  async function handlePlanSave() {
    setSaving(true);
    const payload = {
      team,
      year,
      title: planForm.title,
      description: planForm.description || null,
      category: planForm.category || null,
      start_month: planForm.start_month,
      end_month: Math.max(planForm.start_month, planForm.end_month),
      color: planForm.color,
      status: planForm.status,
    };
    let error;
    if (editingPlanId) {
      ({ error } = await supabase.from('yearly_plans').update(payload).eq('id', editingPlanId));
    } else {
      ({ error } = await supabase.from('yearly_plans').insert({ ...payload, owner_id: profile?.id }));
    }
    if (error) alert('저장 실패: ' + error.message);
    else { setShowPlanModal(false); await fetchData(); }
    setSaving(false);
  }
  async function handlePlanDelete(id: string) {
    if (!confirm('이 플랜을 삭제하시겠습니까?')) return;
    await supabase.from('yearly_plans').delete().eq('id', id);
    await fetchData();
  }

  // ----- 월별 목표 CRUD -----
  function openGoalAdd(month: number) {
    setEditingGoalId(null);
    setGoalMonth(month);
    setGoalForm({ title: '', description: '' });
    setShowGoalModal(true);
  }
  function openGoalEdit(g: MonthlyGoal) {
    setEditingGoalId(g.id);
    setGoalMonth(g.month);
    setGoalForm({ title: g.title, description: g.description || '' });
    setShowGoalModal(true);
  }
  async function handleGoalSave() {
    setSaving(true);
    const payload = {
      team,
      year,
      month: goalMonth,
      title: goalForm.title,
      description: goalForm.description || null,
    };
    let error;
    if (editingGoalId) {
      ({ error } = await supabase.from('monthly_goals').update(payload).eq('id', editingGoalId));
    } else {
      ({ error } = await supabase.from('monthly_goals').insert(payload));
    }
    if (error) alert('저장 실패: ' + error.message);
    else { setShowGoalModal(false); await fetchData(); }
    setSaving(false);
  }
  async function toggleGoalDone(g: MonthlyGoal) {
    await supabase.from('monthly_goals').update({ done: !g.done }).eq('id', g.id);
    await fetchData();
  }
  async function handleGoalDelete(id: string) {
    if (!confirm('이 목표를 삭제하시겠습니까?')) return;
    await supabase.from('monthly_goals').delete().eq('id', id);
    await fetchData();
  }

  // ----- 계산 -----
  const overview = useMemo(() => {
    const by: Record<string, number> = { '진행중': 0, '완료': 0, '예정': 0, '보류': 0 };
    plans.forEach((p) => { by[p.status] = (by[p.status] || 0) + 1; });
    return by;
  }, [plans]);

  const goalsByMonth = useMemo(() => {
    const map: Record<number, MonthlyGoal[]> = {};
    goals.forEach((g) => {
      if (!map[g.month]) map[g.month] = [];
      map[g.month].push(g);
    });
    return map;
  }, [goals]);

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">연간 플랜</h1>
          <p className="mt-1 text-sm text-gray-600">{team}의 연간 로드맵과 월별 목표를 관리하세요</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {isAdmin && (
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
              {TEAMS.map((t) => (
                <button key={t} onClick={() => setTeam(t)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${team === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 rounded-lg bg-white border border-gray-200 px-1.5 py-0.5">
            <button onClick={() => setYear(year - 1)} className="p-1 text-gray-400 hover:text-gray-700"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-2 text-sm font-semibold text-gray-900">{year}년</span>
            <button onClick={() => setYear(year + 1)} className="p-1 text-gray-400 hover:text-gray-700"><ChevronRight className="h-4 w-4" /></button>
          </div>
          {canEdit && (
            <button onClick={openPlanAdd} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> 플랜 추가
            </button>
          )}
        </div>
      </div>

      {/* 개요 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '진행중', value: overview['진행중'], color: 'text-blue-700 bg-blue-50 border-blue-200' },
          { label: '완료', value: overview['완료'], color: 'text-green-700 bg-green-50 border-green-200' },
          { label: '예정', value: overview['예정'], color: 'text-gray-700 bg-gray-50 border-gray-200' },
          { label: '보류', value: overview['보류'], color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
        ].map((s) => (
          <div key={s.label} className={`rounded-lg border p-4 ${s.color}`}>
            <p className="text-xs font-medium opacity-70">{s.label}</p>
            <p className="mt-1 text-2xl font-bold">{s.value || 0}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-gray-400">불러오는 중...</div>
      ) : (
        <>
          {/* 간트차트 */}
          <div className="rounded-lg bg-white shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" />
              <h2 className="text-lg font-semibold text-gray-900">간트차트</h2>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[800px] p-4">
                {/* 월 헤더 */}
                <div className="grid grid-cols-[200px_repeat(12,1fr)] gap-0 border-b border-gray-200 pb-2 mb-2">
                  <div className="text-xs font-semibold text-gray-500">플랜명</div>
                  {MONTHS.map((m) => (
                    <div key={m} className={`text-center text-xs font-semibold ${year === currentYear && m === currentMonth ? 'text-blue-600' : 'text-gray-500'}`}>
                      {m}월
                    </div>
                  ))}
                </div>

                {/* 오늘 라인 */}
                {year === currentYear && (
                  <div className="relative">
                    <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10 pointer-events-none"
                      style={{ left: `calc(200px + ${((currentMonth - 1) / 12) * 100}% - ${((currentMonth - 1) / 12) * 200}px + ${((new Date().getDate() - 1) / 30) * (100 / 12)}%)` }}
                    />
                  </div>
                )}

                {/* 플랜 바 */}
                {plans.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">등록된 플랜이 없습니다</p>
                ) : (
                  <div className="space-y-1.5">
                    {plans.map((p) => {
                      const cc = COLOR_CLASSES[p.color] || COLOR_CLASSES.blue;
                      return (
                        <div key={p.id} className="grid grid-cols-[200px_repeat(12,1fr)] gap-0 items-center group">
                          {/* 플랜명 */}
                          <div className="pr-3 truncate">
                            <p className="text-sm font-medium text-gray-900 truncate">{p.title}</p>
                            {p.category && <p className="text-xs text-gray-400 truncate">{p.category}</p>}
                          </div>
                          {/* 월 셀 + 바 */}
                          {MONTHS.map((m) => (
                            <div key={m} className="h-8 relative border-r border-gray-100 last:border-r-0">
                              {m >= p.start_month && m <= p.end_month && (
                                <div
                                  onClick={() => canEdit && openPlanEdit(p)}
                                  className={`absolute inset-y-1.5 ${cc.bar} ${p.status === '완료' ? 'opacity-60' : ''} ${canEdit ? 'cursor-pointer hover:opacity-80' : ''}
                                    ${m === p.start_month ? 'left-1 rounded-l-md' : 'left-0'}
                                    ${m === p.end_month ? 'right-1 rounded-r-md' : 'right-0'}
                                    flex items-center px-2`}
                                >
                                  {m === p.start_month && (
                                    <span className="text-[10px] font-semibold text-white truncate">
                                      {p.title}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 플랜 리스트 */}
            {plans.length > 0 && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {plans.map((p) => {
                  const cc = COLOR_CLASSES[p.color] || COLOR_CLASSES.blue;
                  return (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`inline-block h-3 w-3 rounded ${cc.bar} flex-shrink-0`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{p.title}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                            <span>{p.start_month}월 ~ {p.end_month}월</span>
                            <span className={`rounded-full px-2 py-0.5 ${STATUS_COLOR[p.status]}`}>{p.status}</span>
                            {p.category && <span className="text-gray-400">· {p.category}</span>}
                          </div>
                          {p.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{p.description}</p>}
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => openPlanEdit(p)} className="p-1.5 text-gray-400 hover:text-blue-600"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => handlePlanDelete(p.id)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 로드맵 (분기별) */}
          <div className="rounded-lg bg-white shadow">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">로드맵</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-0 divide-x divide-gray-100">
              {[1, 2, 3, 4].map((q) => {
                const quarterMonths = [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3];
                const quarterPlans = plans.filter((p) => quarterMonths.some((m) => m >= p.start_month && m <= p.end_month));
                const isCurrentQuarter = year === currentYear && Math.ceil(currentMonth / 3) === q;
                return (
                  <div key={q} className={`p-4 ${isCurrentQuarter ? 'bg-blue-50/40' : ''}`}>
                    <p className={`text-xs font-bold ${isCurrentQuarter ? 'text-blue-600' : 'text-gray-500'}`}>Q{q}</p>
                    <p className="text-sm font-semibold text-gray-700 mt-0.5">{quarterMonths[0]}월 ~ {quarterMonths[2]}월</p>
                    <div className="mt-3 space-y-1.5">
                      {quarterPlans.length === 0 ? (
                        <p className="text-xs text-gray-400">없음</p>
                      ) : (
                        quarterPlans.map((p) => {
                          const cc = COLOR_CLASSES[p.color] || COLOR_CLASSES.blue;
                          return (
                            <div key={p.id} className={`rounded px-2 py-1.5 text-xs ${cc.bg} ${cc.text} border ${cc.border}`}>
                              {p.title}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 월별 목표 */}
          <div className="rounded-lg bg-white shadow">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">월별 목표</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-0 divide-x divide-y divide-gray-100">
              {MONTHS.map((m) => {
                const monthGoals = goalsByMonth[m] || [];
                const isCurrent = year === currentYear && m === currentMonth;
                return (
                  <div key={m} className={`p-4 ${isCurrent ? 'bg-blue-50/40' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className={`text-sm font-semibold ${isCurrent ? 'text-blue-600' : 'text-gray-700'}`}>
                        {m}월
                        {monthGoals.length > 0 && (
                          <span className="ml-2 text-xs text-gray-400">
                            {monthGoals.filter((g) => g.done).length}/{monthGoals.length}
                          </span>
                        )}
                      </p>
                      {canEdit && (
                        <button onClick={() => openGoalAdd(m)} className="p-1 text-gray-400 hover:text-blue-600"><Plus className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                    {monthGoals.length === 0 ? (
                      <p className="text-xs text-gray-400 py-1">목표 없음</p>
                    ) : (
                      <div className="space-y-1">
                        {monthGoals.map((g) => (
                          <div key={g.id} className="group flex items-start gap-1.5 text-sm">
                            {canEdit ? (
                              <button onClick={() => toggleGoalDone(g)} className="mt-0.5 flex-shrink-0">
                                {g.done ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4 text-gray-300" />}
                              </button>
                            ) : (
                              <div className="mt-0.5 flex-shrink-0">
                                {g.done ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4 text-gray-300" />}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs ${g.done ? 'text-gray-400 line-through' : 'text-gray-700'} break-words`}>{g.title}</p>
                              {g.description && <p className="text-[11px] text-gray-400 mt-0.5 break-words">{g.description}</p>}
                            </div>
                            {canEdit && (
                              <div className="opacity-0 group-hover:opacity-100 flex items-center flex-shrink-0">
                                <button onClick={() => openGoalEdit(g)} className="p-0.5 text-gray-300 hover:text-blue-600"><Pencil className="h-3 w-3" /></button>
                                <button onClick={() => handleGoalDelete(g.id)} className="p-0.5 text-gray-300 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 플랜 모달 */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{editingPlanId ? '플랜 수정' : '플랜 추가'}</h3>
              <button onClick={() => setShowPlanModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                  placeholder="예: Q2 자사몰 리뉴얼"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리 (선택)</label>
                <input type="text" value={planForm.category} onChange={(e) => setPlanForm({ ...planForm, category: e.target.value })}
                  placeholder="예: 마케팅, 개발, 영업"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">시작 월</label>
                  <select value={planForm.start_month} onChange={(e) => setPlanForm({ ...planForm, start_month: Number(e.target.value) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종료 월</label>
                  <select value={planForm.end_month} onChange={(e) => setPlanForm({ ...planForm, end_month: Number(e.target.value) })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">색상</label>
                  <select value={planForm.color} onChange={(e) => setPlanForm({ ...planForm, color: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option value="blue">파랑</option>
                    <option value="green">초록</option>
                    <option value="purple">보라</option>
                    <option value="orange">주황</option>
                    <option value="pink">분홍</option>
                    <option value="gray">회색</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">상태</label>
                  <select value={planForm.status} onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option value="예정">예정</option>
                    <option value="진행중">진행중</option>
                    <option value="완료">완료</option>
                    <option value="보류">보류</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
                <textarea value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                  rows={2} placeholder="세부 설명"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowPlanModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handlePlanSave} disabled={saving || !planForm.title}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 월별 목표 모달 */}
      {showGoalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{goalMonth}월 목표 {editingGoalId ? '수정' : '추가'}</h3>
              <button onClick={() => setShowGoalModal(false)} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
                  placeholder="예: 월 매출 2000만원 달성"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
                <input type="text" value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowGoalModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button onClick={handleGoalSave} disabled={saving || !goalForm.title}
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
