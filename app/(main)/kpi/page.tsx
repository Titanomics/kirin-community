'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Plus, X, Save, Edit, Trash2, BarChart3 } from 'lucide-react';

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  team: string | null;
  role: string;
}

interface KpiMetric {
  id: string;
  user_id: string;
  team: string;
  metric_name: string;
  target_value: number;
  current_value: number;
  achievement_rate: number;
  period: string;
  profiles?: { display_name: string | null; email: string | null } | null;
}

export default function KpiPage() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();
  const [metrics, setMetrics] = useState<KpiMetric[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    user_id: '',
    team: '커머스팀' as string,
    metric_name: '',
    target_value: '',
    current_value: '',
    period: new Date().toISOString().slice(0, 7), // YYYY-MM
  });

  const isAdmin = myProfile?.role === 'admin';
  const isLeader = myProfile?.role === 'leader';
  const canEdit = isAdmin || isLeader;

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [metricsRes, profilesRes] = await Promise.all([
      supabase
        .from('kpi_metrics')
        .select('*, profiles(display_name, email)')
        .order('period', { ascending: false }),
      supabase.from('profiles').select('*'),
    ]);

    setMetrics(metricsRes.data || []);
    setProfiles(profilesRes.data || []);
    setLoading(false);
  }

  // 팀장은 자기 팀원만 편집 가능
  function getEditableProfiles() {
    if (isAdmin) return profiles;
    if (isLeader && myProfile) {
      const myTeam = profiles.find((p) => p.id === myProfile.id)?.team;
      return profiles.filter((p) => p.team === myTeam);
    }
    return [];
  }

  function canEditMetric(metric: KpiMetric) {
    if (isAdmin) return true;
    if (isLeader && myProfile) {
      const myTeam = profiles.find((p) => p.id === myProfile.id)?.team;
      return metric.team === myTeam;
    }
    return false;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const data = {
      user_id: form.user_id,
      team: form.team,
      metric_name: form.metric_name,
      target_value: Number(form.target_value),
      current_value: Number(form.current_value),
      period: form.period,
    };

    if (editingId) {
      const { error } = await supabase.from('kpi_metrics').update(data).eq('id', editingId);
      if (error) alert('수정 실패: ' + error.message);
    } else {
      const { error } = await supabase.from('kpi_metrics').insert(data);
      if (error) alert('등록 실패: ' + error.message);
    }

    setShowForm(false);
    setEditingId(null);
    resetForm();
    await fetchData();
    setSaving(false);
  }

  function resetForm() {
    setForm({
      user_id: '',
      team: '커머스팀',
      metric_name: '',
      target_value: '',
      current_value: '',
      period: new Date().toISOString().slice(0, 7),
    });
  }

  function startEdit(metric: KpiMetric) {
    setForm({
      user_id: metric.user_id,
      team: metric.team,
      metric_name: metric.metric_name,
      target_value: String(metric.target_value),
      current_value: String(metric.current_value),
      period: metric.period,
    });
    setEditingId(metric.id);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('KPI 항목을 삭제하시겠습니까?')) return;
    await supabase.from('kpi_metrics').delete().eq('id', id);
    await fetchData();
  }

  // 필터링
  const filteredMetrics = metrics.filter((m) => {
    if (filterTeam !== 'all' && m.team !== filterTeam) return false;
    if (filterPeriod && m.period !== filterPeriod) return false;
    // 팀장은 자기 팀만 볼 수 있음
    if (isLeader && !isAdmin && myProfile) {
      const myTeam = profiles.find((p) => p.id === myProfile.id)?.team;
      if (m.team !== myTeam) return false;
    }
    return true;
  });

  // 팀별 그룹핑
  const groupedByUser: Record<string, KpiMetric[]> = {};
  for (const m of filteredMetrics) {
    const key = m.user_id;
    if (!groupedByUser[key]) groupedByUser[key] = [];
    groupedByUser[key].push(m);
  }

  function getProgressColor(rate: number) {
    if (rate >= 100) return 'bg-green-500';
    if (rate >= 70) return 'bg-blue-500';
    if (rate >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  }

  function getProgressBgColor(rate: number) {
    if (rate >= 100) return 'bg-green-100';
    if (rate >= 70) return 'bg-blue-100';
    if (rate >= 40) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  // 유저 ID로 선택시 팀 자동 설정
  function handleUserSelect(userId: string) {
    const p = profiles.find((pr) => pr.id === userId);
    setForm({
      ...form,
      user_id: userId,
      team: p?.team || '커머스팀',
    });
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  const editableProfiles = getEditableProfiles();
  const periods = [...new Set(metrics.map((m) => m.period))].sort().reverse();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">KPI 대시보드</h1>
          <p className="mt-2 text-gray-600">팀원별 KPI 성과를 확인하세요</p>
        </div>
        {canEdit && (
          <button
            onClick={() => { resetForm(); setEditingId(null); setShowForm(true); }}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            KPI 등록
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 rounded-lg bg-white p-4 shadow">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">팀</label>
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="all">전체</option>
            <option value="커머스팀">커머스팀</option>
            <option value="콘텐츠팀">콘텐츠팀</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">기간</label>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">전체</option>
            {periods.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards by User */}
      {Object.keys(groupedByUser).length === 0 ? (
        <div className="rounded-lg bg-white p-12 text-center shadow">
          <BarChart3 className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-gray-500">등록된 KPI가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByUser).map(([userId, userMetrics]) => {
            const userProfile = profiles.find((p) => p.id === userId);
            const userName = userProfile?.display_name || userProfile?.email || '알 수 없음';
            const userTeam = userProfile?.team || '미지정';
            const avgRate = userMetrics.reduce((sum, m) => sum + Number(m.achievement_rate || 0), 0) / userMetrics.length;

            return (
              <div key={userId} className="rounded-lg bg-white shadow">
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                      {userName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{userName}</p>
                      <p className="text-xs text-gray-500">{userTeam}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">평균 달성률</p>
                    <p className={`text-xl font-bold ${avgRate >= 100 ? 'text-green-600' : avgRate >= 70 ? 'text-blue-600' : avgRate >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {avgRate.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-gray-50 p-6">
                  {userMetrics.map((metric) => {
                    const rate = Number(metric.achievement_rate || 0);
                    return (
                      <div key={metric.id} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="text-sm font-medium text-gray-900">{metric.metric_name}</span>
                            <span className="ml-2 text-xs text-gray-400">{metric.period}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-600">
                              {metric.current_value} / {metric.target_value}
                            </span>
                            <span className={`text-sm font-bold ${rate >= 100 ? 'text-green-600' : rate >= 70 ? 'text-blue-600' : 'text-red-600'}`}>
                              {rate.toFixed(1)}%
                            </span>
                            {canEdit && canEditMetric(metric) && (
                              <div className="flex items-center gap-1">
                                <button onClick={() => startEdit(metric)} className="p-1 text-gray-400 hover:text-blue-600">
                                  <Edit className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => handleDelete(metric.id)} className="p-1 text-gray-400 hover:text-red-600">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className={`h-3 w-full rounded-full ${getProgressBgColor(rate)}`}>
                          <div
                            className={`h-3 rounded-full transition-all duration-500 ${getProgressColor(rate)}`}
                            style={{ width: `${Math.min(rate, 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? 'KPI 수정' : 'KPI 등록'}
              </h2>
              <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">대상 팀원</label>
                <select
                  value={form.user_id}
                  onChange={(e) => handleUserSelect(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">선택하세요</option>
                  {editableProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name || p.email} ({p.team || '미지정'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">KPI 항목명</label>
                <input
                  type="text"
                  value={form.metric_name}
                  onChange={(e) => setForm({ ...form, metric_name: e.target.value })}
                  required
                  placeholder="예: 월 매출액, 콘텐츠 제작 수"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">목표 수치</label>
                  <input
                    type="number"
                    value={form.target_value}
                    onChange={(e) => setForm({ ...form, target_value: e.target.value })}
                    required
                    min="1"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">현재 수치</label>
                  <input
                    type="number"
                    value={form.current_value}
                    onChange={(e) => setForm({ ...form, current_value: e.target.value })}
                    required
                    min="0"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">기간</label>
                <input
                  type="month"
                  value={form.period}
                  onChange={(e) => setForm({ ...form, period: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingId(null); }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : editingId ? '수정' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
