'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Users, Clock, CheckCircle, XCircle, Gift, Award, Target, Building2, AlertTriangle, ChevronRight, CalendarDays, User } from 'lucide-react';
import Link from 'next/link';

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  team: string | null;
  joined_at: string | null;
  birthday: string | null;
}

interface LeaveRequest {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  created_at: string;
  profiles: { display_name: string | null; email: string | null } | null;
}

interface YearlyPlan {
  id: string;
  team: string;
  year: number;
  title: string;
  start_month: number;
  end_month: number;
  color: string;
  status: string;
}

interface MonthlyGoal {
  id: string;
  team: string;
  year: number;
  month: number;
  title: string;
  done: boolean;
}

interface HospitalTask {
  id: string;
  hospital_id: string;
  title: string;
  type: string;
  due_date: string | null;
  status: string;
  assignee_id: string | null;
}

interface Hospital {
  id: string;
  name: string;
}

interface Objective {
  id: string;
  user_id: string;
  team: string;
  title: string;
  status: string;
  okr_key_results: Array<{ status: string; type: string; target_value: number | null; current_value: number | null }>;
}

interface TeamObjective {
  id: string;
  team: string;
  title: string;
  status: string;
  period: string;
  team_key_results: Array<{ status: string; type: string; target_value: number | null; current_value: number | null }>;
}

interface RoadmapItem {
  id: string;
  team: string;
  title: string;
  start_date: string;
  end_date: string;
  color: string;
  status: string;
  assignee: { display_name: string | null; email: string | null } | null;
}

const COLOR_BAR: Record<string, string> = {
  blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500',
  orange: 'bg-orange-500', pink: 'bg-pink-500', gray: 'bg-gray-500',
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Home() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveRequest[]>([]);
  const [yearlyPlans, setYearlyPlans] = useState<YearlyPlan[]>([]);
  const [monthlyGoals, setMonthlyGoals] = useState<MonthlyGoal[]>([]);
  const [hospitalTasks, setHospitalTasks] = useState<HospitalTask[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [teamObjectivesData, setTeamObjectivesData] = useState<TeamObjective[]>([]);
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = myProfile?.role === 'admin';
  const userTeam = myProfile?.team;

  // admin: 팀 토글, 일반: 자기 팀
  const [viewTeam, setViewTeam] = useState<'커머스팀' | '콘텐츠팀'>(
    userTeam === '콘텐츠팀' ? '콘텐츠팀' : '커머스팀'
  );
  const effectiveTeam: '커머스팀' | '콘텐츠팀' = isAdmin ? viewTeam : (userTeam as '커머스팀' | '콘텐츠팀') || viewTeam;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  useEffect(() => {
    fetchData();
  }, [myProfile]);

  async function fetchData() {
    try {
      const today = new Date();
      // 미니 캘린더용: 이번 달 전체
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const windowStart = monthStart;
      const windowEnd = monthEnd;
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const [profilesRes, pendingRes, plansRes, goalsRes, tasksRes, hospitalsRes, objRes, teamObjRes, roadmapRes] = await Promise.all([
        supabase.from('profiles').select('*').is('resigned_at', null),
        supabase
          .from('leave_requests')
          .select('*, profiles!leave_requests_user_id_fkey(display_name, email)')
          .eq('status', '대기')
          .order('created_at', { ascending: false }),
        supabase.from('yearly_plans').select('*').eq('year', year),
        supabase.from('monthly_goals').select('*').eq('year', year).eq('month', month),
        supabase.from('hospital_tasks').select('*').neq('status', '완료').order('due_date', { ascending: true, nullsFirst: false }).limit(20),
        supabase.from('hospitals').select('id, name'),
        supabase.from('okr_objectives').select('*, okr_key_results(status, type, target_value, current_value)').eq('status', '진행중'),
        supabase.from('team_objectives').select('*, team_key_results(status, type, target_value, current_value)').eq('status', '진행중'),
        supabase
          .from('team_roadmap')
          .select('*, assignee:profiles!team_roadmap_assignee_id_fkey(display_name, email)')
          .lte('start_date', fmt(windowEnd))
          .gte('end_date', fmt(windowStart))
          .neq('status', '완료')
          .order('start_date'),
      ]);
      setProfiles((profilesRes.data as Profile[]) || []);
      setPendingLeaves((pendingRes.data as LeaveRequest[]) || []);
      setYearlyPlans((plansRes.data as YearlyPlan[]) || []);
      setMonthlyGoals((goalsRes.data as MonthlyGoal[]) || []);
      setHospitalTasks((tasksRes.data as HospitalTask[]) || []);
      setHospitals((hospitalsRes.data as Hospital[]) || []);
      setObjectives((objRes.data as Objective[]) || []);
      setTeamObjectivesData((teamObjRes.data as TeamObjective[]) || []);
      setRoadmapItems((roadmapRes.data as RoadmapItem[]) || []);
    } catch (err) {
      console.error('대시보드 데이터 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleLeaveAction(id: string, status: '승인' | '반려') {
    const { error } = await supabase
      .from('leave_requests')
      .update({ status, reviewed_by: myProfile?.id, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) alert('처리 실패: ' + error.message);
    else await fetchData();
  }

  // ----- 계산 -----
  const anniversaryEmployees = useMemo(() => {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return profiles.filter((p) => {
      if (!p.joined_at) return false;
      const joinDate = new Date(p.joined_at);
      const yearsWorked = now.getFullYear() - joinDate.getFullYear();
      if (yearsWorked < 1) return false;
      const anniversary = new Date(now.getFullYear(), joinDate.getMonth(), joinDate.getDate());
      return anniversary >= weekStart && anniversary <= weekEnd;
    }).map((p) => ({ ...p, years: now.getFullYear() - new Date(p.joined_at!).getFullYear() }));
  }, [profiles]);

  const birthdayEmployees = useMemo(() => {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return profiles.filter((p) => {
      if (!p.birthday) return false;
      const bday = new Date(p.birthday);
      const thisYearBirthday = new Date(now.getFullYear(), bday.getMonth(), bday.getDate());
      return thisYearBirthday >= weekStart && thisYearBirthday <= weekEnd;
    });
  }, [profiles]);

  // 팀별 필터
  const teamPlans = yearlyPlans.filter((p) => p.team === effectiveTeam);
  const teamGoals = monthlyGoals.filter((g) => g.team === effectiveTeam);

  // 개인 OKR: RLS에 의해 본인+admin/leader만 보임. admin/leader가 전체 볼 때는 effectiveTeam으로 필터.
  const myObjectives = useMemo(
    () => objectives.filter((o) => o.user_id === myProfile?.id),
    [objectives, myProfile?.id]
  );
  const teamObjectives = useMemo(
    () => teamObjectivesData.filter((o) => o.team === effectiveTeam),
    [teamObjectivesData, effectiveTeam]
  );

  const teamRoadmaps = useMemo(
    () => roadmapItems.filter((r) => r.team === effectiveTeam),
    [roadmapItems, effectiveTeam]
  );

  function krProgress(krs: Array<{ status: string; type: string; target_value: number | null; current_value: number | null }>): number {
    if (krs.length === 0) return 0;
    let sum = 0;
    for (const kr of krs) {
      if (kr.status === '완료') { sum += 100; continue; }
      if (kr.type === 'numeric' && kr.target_value && kr.target_value > 0) {
        sum += Math.min(((kr.current_value || 0) / kr.target_value) * 100, 100);
      }
    }
    return sum / krs.length;
  }

  // 팀 OKR 평균 진행률 (팀 OKR 전용 테이블 기반)
  const teamOkrAvg = useMemo(() => {
    if (teamObjectives.length === 0) return 0;
    const total = teamObjectives.reduce((acc, obj) => acc + krProgress(obj.team_key_results || []), 0);
    return total / teamObjectives.length;
  }, [teamObjectives]);

  // 내 OKR 평균 진행률
  const myOkrAvg = useMemo(() => {
    if (myObjectives.length === 0) return 0;
    const total = myObjectives.reduce((acc, obj) => acc + krProgress(obj.okr_key_results || []), 0);
    return total / myObjectives.length;
  }, [myObjectives]);

  // 병원 임박 일정
  const urgentHospitalTasks = useMemo(() => {
    return hospitalTasks
      .filter((t) => t.due_date !== null)
      .slice(0, 8);
  }, [hospitalTasks]);

  const overdueCount = hospitalTasks.filter((t) => {
    const d = daysUntil(t.due_date);
    return d !== null && d < 0;
  }).length;

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">대시보드</h1>
          <p className="mt-1 text-sm text-gray-600">
            {myProfile?.display_name || '사용자'}님 · {effectiveTeam}
          </p>
        </div>
        {isAdmin && (
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            {(['커머스팀', '콘텐츠팀'] as const).map((t) => (
              <button key={t} onClick={() => setViewTeam(t)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition ${viewTeam === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Admin 전용: 기념일/생일 알림 */}
      {isAdmin && (anniversaryEmployees.length > 0 || birthdayEmployees.length > 0) && (
        <div className="space-y-2">
          {anniversaryEmployees.map((emp) => (
            <div key={`ann-${emp.id}`} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <Award className="h-5 w-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">{emp.display_name || emp.email}</span>님이 이번 주{' '}
                <span className="font-semibold">입사 {emp.years}주년</span>!
              </p>
            </div>
          ))}
          {birthdayEmployees.map((emp) => (
            <div key={`bday-${emp.id}`} className="flex items-center gap-3 rounded-lg border border-pink-200 bg-pink-50 px-4 py-3">
              <Gift className="h-5 w-5 text-pink-600 flex-shrink-0" />
              <p className="text-sm text-pink-800">
                <span className="font-semibold">{emp.display_name || emp.email}</span>님의 생일이 이번 주입니다!
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Admin 전용: 인원/대기 휴가 통계 */}
      {isAdmin && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">전체 인원</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{profiles.length}<span className="text-sm font-normal text-gray-400 ml-1">명</span></p>
              </div>
              <div className="rounded-full bg-blue-50 p-2.5"><Users className="h-5 w-5 text-blue-600" /></div>
            </div>
          </div>
          <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">대기 중 휴가 신청</p>
                <p className="mt-1 text-2xl font-bold text-yellow-600">{pendingLeaves.length}<span className="text-sm font-normal text-gray-400 ml-1">건</span></p>
              </div>
              <div className="rounded-full bg-yellow-50 p-2.5"><Clock className="h-5 w-5 text-yellow-600" /></div>
            </div>
          </div>
          <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">{effectiveTeam} OKR 진행률</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{teamOkrAvg.toFixed(0)}<span className="text-sm font-normal text-gray-400 ml-1">%</span></p>
              </div>
              <div className="rounded-full bg-green-50 p-2.5"><Target className="h-5 w-5 text-green-600" /></div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Admin 전용: 대기 중 휴가 승인 */}
        {isAdmin && pendingLeaves.length > 0 && (
          <div className="rounded-lg bg-white shadow-sm border border-gray-100 lg:col-span-2">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                휴가 승인 대기
                <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">{pendingLeaves.length}</span>
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {pendingLeaves.map((leave) => (
                <div key={leave.id} className="flex items-center justify-between p-4 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-100 flex-shrink-0">
                      <Clock className="h-4 w-4 text-yellow-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {leave.profiles?.display_name || leave.profiles?.email || '알 수 없음'}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {leave.leave_type} · {leave.start_date}
                        {leave.start_date !== leave.end_date && ` ~ ${leave.end_date}`}
                        {leave.reason && ` · ${leave.reason}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => handleLeaveAction(leave.id, '승인')}
                      className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
                      <CheckCircle className="h-3.5 w-3.5" /> 승인
                    </button>
                    <button onClick={() => handleLeaveAction(leave.id, '반려')}
                      className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                      <XCircle className="h-3.5 w-3.5" /> 반려
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 내 OKR */}
        <div className="rounded-lg bg-white shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <User className="h-5 w-5 text-emerald-500" /> 내 OKR
            </h2>
            <Link href="/kpi" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              전체 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="p-6">
            {myObjectives.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">진행 중인 내 OKR이 없습니다</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${myOkrAvg >= 70 ? 'text-green-600' : myOkrAvg >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {myOkrAvg.toFixed(0)}%
                  </span>
                  <span className="text-sm text-gray-500">평균 달성률</span>
                </div>
                <div className="space-y-1.5">
                  {myObjectives.slice(0, 3).map((obj) => {
                    const progress = krProgress(obj.okr_key_results || []);
                    return (
                      <div key={obj.id} className="flex items-center gap-3 text-sm">
                        <p className="flex-1 min-w-0 truncate text-gray-700">{obj.title}</p>
                        <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${progress >= 70 ? 'bg-green-500' : progress >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(progress, 100)}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-500 w-10 text-right">{progress.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 팀 OKR */}
        <div className="rounded-lg bg-white shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" /> {effectiveTeam} OKR
            </h2>
            <Link href="/kpi" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              전체 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="p-6">
            {teamObjectives.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">진행 중인 팀 OKR이 없습니다</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${teamOkrAvg >= 70 ? 'text-green-600' : teamOkrAvg >= 40 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {teamOkrAvg.toFixed(0)}%
                  </span>
                  <span className="text-sm text-gray-500">팀 평균 달성률</span>
                </div>
                <div className="space-y-1.5">
                  {teamObjectives.slice(0, 3).map((obj) => {
                    const progress = krProgress(obj.team_key_results || []);
                    return (
                      <div key={obj.id} className="flex items-center gap-3 text-sm">
                        <p className="flex-1 min-w-0 truncate text-gray-700">{obj.title}</p>
                        <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${progress >= 70 ? 'bg-green-500' : progress >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(progress, 100)}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-500 w-10 text-right">{progress.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 이번 달 목표 */}
        <div className="rounded-lg bg-white shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{month}월 목표</h2>
            <Link href="/yearly-plan" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              연간 플랜 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="p-6">
            {teamGoals.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">이번 달 목표가 없습니다</p>
            ) : (
              <div className="space-y-2">
                {teamGoals.slice(0, 5).map((g) => (
                  <div key={g.id} className="flex items-center gap-2 text-sm">
                    {g.done ? <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" /> : <div className="h-4 w-4 rounded-full border-2 border-gray-300 flex-shrink-0" />}
                    <p className={`flex-1 min-w-0 truncate ${g.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{g.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 팀별 전용 위젯 */}
        {effectiveTeam === '커머스팀' && (
          <div className="rounded-lg bg-white shadow-sm border border-gray-100 lg:col-span-2">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{year}년 연간 로드맵</h2>
              <Link href="/yearly-plan" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
                상세 <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="p-4 overflow-x-auto">
              {teamPlans.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">등록된 연간 플랜이 없습니다</p>
              ) : (
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[140px_repeat(12,1fr)] gap-0 pb-2 mb-2 border-b border-gray-100">
                    <div className="text-xs font-semibold text-gray-500">플랜</div>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <div key={m} className={`text-center text-[11px] font-semibold ${m === month ? 'text-blue-600' : 'text-gray-400'}`}>{m}</div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {teamPlans.slice(0, 5).map((p) => (
                      <div key={p.id} className="grid grid-cols-[140px_repeat(12,1fr)] gap-0 items-center">
                        <div className="pr-2 truncate text-xs text-gray-700">{p.title}</div>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                          <div key={m} className="h-5 relative">
                            {m >= p.start_month && m <= p.end_month && (
                              <div className={`absolute inset-y-1 ${COLOR_BAR[p.color] || 'bg-blue-500'} ${p.status === '완료' ? 'opacity-50' : ''}
                                ${m === p.start_month ? 'left-0.5 rounded-l' : 'left-0'}
                                ${m === p.end_month ? 'right-0.5 rounded-r' : 'right-0'}`} />
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {teamPlans.length > 5 && (
                    <p className="mt-2 text-xs text-gray-400 text-center">+ {teamPlans.length - 5}개 더보기</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {effectiveTeam === '콘텐츠팀' && (
          <div className="rounded-lg bg-white shadow-sm border border-gray-100 lg:col-span-2">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-500" /> 병원 임박 일정
                {overdueCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                    <AlertTriangle className="h-3 w-3" /> 마감 초과 {overdueCount}건
                  </span>
                )}
              </h2>
              <Link href="/hospitals" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
                전체 <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {urgentHospitalTasks.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">예정된 병원 일정이 없습니다</p>
              ) : (
                urgentHospitalTasks.map((t) => {
                  const hospital = hospitals.find((h) => h.id === t.hospital_id);
                  const d = daysUntil(t.due_date);
                  const isUrgent = d !== null && d <= 3;
                  return (
                    <div key={t.id} className="flex items-center justify-between px-6 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0
                          ${t.type === '배너' ? 'bg-orange-100 text-orange-700' :
                            t.type === '촬영' ? 'bg-purple-100 text-purple-700' :
                            t.type === '업로드' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                          {t.type}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {hospital?.name} {t.due_date && `· 마감 ${t.due_date}`}
                          </p>
                        </div>
                      </div>
                      {d !== null && (
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium flex-shrink-0 ${
                          d < 0 ? 'text-red-700 bg-red-50 border-red-200' :
                          isUrgent ? 'text-red-700 bg-red-50 border-red-200' :
                          'text-yellow-700 bg-yellow-50 border-yellow-200'
                        }`}>
                          {d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 팀 로드맵 미니 캘린더 (팀 전용 위젯 아래) */}
        <div className="rounded-lg bg-white shadow-sm border border-gray-100 lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-indigo-500" /> {effectiveTeam} 캘린더
              <span className="text-xs font-normal text-gray-400">· {month}월</span>
            </h2>
            <Link href="/calendar" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              전체 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="p-4">
            <MiniCalendar roadmaps={teamRoadmaps} year={year} month={month} />
          </div>
        </div>

        {/* 팀 로드맵 임박·진행 리스트 */}
        <div className="rounded-lg bg-white shadow-sm border border-gray-100 lg:col-span-2">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-indigo-500" /> 임박·진행 로드맵
              <span className="text-xs font-normal text-gray-400">· 상세 리스트</span>
            </h2>
          </div>
          <div className="p-6">
            {teamRoadmaps.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">진행 중인 로드맵이 없습니다</p>
            ) : (
              <div className="space-y-2">
                {teamRoadmaps.slice(0, 6).map((r) => {
                  const isSingleDay = r.start_date === r.end_date;
                  const d = daysUntil(r.end_date);
                  return (
                    <div key={r.id} className="flex items-center gap-3 text-sm">
                      <div className={`h-2 w-2 rounded-full flex-shrink-0 ${COLOR_BAR[r.color] || 'bg-blue-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{r.title}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {isSingleDay ? `당일 · ${r.start_date}` : `${r.start_date} ~ ${r.end_date}`}
                          {r.assignee && ` · ${r.assignee.display_name || r.assignee.email}`}
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium flex-shrink-0 ${
                        isSingleDay ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-50 text-gray-600'
                      }`}>
                        {isSingleDay ? '당일' : '기간'}
                      </span>
                      {d !== null && d <= 7 && (
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium flex-shrink-0 ${
                          d < 0 ? 'text-red-700 bg-red-50 border-red-200'
                            : d <= 3 ? 'text-red-700 bg-red-50 border-red-200'
                            : 'text-yellow-700 bg-yellow-50 border-yellow-200'
                        }`}>
                          {d < 0 ? `D+${-d}` : d === 0 ? 'D-DAY' : `D-${d}`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniCalendar({ roadmaps, year, month }: { roadmaps: RoadmapItem[]; year: number; month: number }) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const firstDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDate = today.getDate();

  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - firstDow + 1;
    return dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null;
  });

  function roadmapsForDay(dayNum: number): RoadmapItem[] {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    return roadmaps.filter((r) => dateStr >= r.start_date && dateStr <= r.end_date);
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={`text-center text-[11px] font-semibold py-1 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((dayNum, i) => {
          if (dayNum === null) {
            return <div key={i} className="min-h-12 rounded" />;
          }
          const items = roadmapsForDay(dayNum);
          const isToday = isCurrentMonth && dayNum === todayDate;
          const dow = i % 7;
          return (
            <div
              key={i}
              className={`min-h-12 rounded border p-1 overflow-hidden ${
                isToday ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-gray-50/40'
              }`}
            >
              <div className={`text-[10px] font-medium ${
                isToday ? 'text-blue-600' : dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-600'
              }`}>
                {dayNum}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {items.slice(0, 2).map((r) => {
                  const isSingle = r.start_date === r.end_date;
                  return (
                    <div
                      key={r.id}
                      title={r.title}
                      className={`h-1 rounded-full ${COLOR_BAR[r.color] || 'bg-blue-500'} ${isSingle ? 'w-1.5' : ''}`}
                    />
                  );
                })}
                {items.length > 2 && (
                  <div className="text-[9px] text-gray-400 leading-none">+{items.length - 2}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-500">
        <span>━ 기간</span>
        <span>● 당일</span>
        <span className="ml-auto">로드맵만 표시 · 전체는 캘린더 페이지에서</span>
      </div>
    </div>
  );
}
