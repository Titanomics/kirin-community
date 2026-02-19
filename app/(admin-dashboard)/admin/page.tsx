'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import {
  CalendarDays,
  BarChart3,
  Gift,
  Award,
  Clock,
  CheckCircle,
  XCircle,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

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
  status: string;
  created_at: string;
  profiles: { display_name: string | null; email: string | null } | null;
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
}

export default function AdminDashboardPage() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [monthLeaves, setMonthLeaves] = useState<LeaveRequest[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveRequest[]>([]);
  const [kpiMetrics, setKpiMetrics] = useState<KpiMetric[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const currentMonth = format(now, 'yyyy-MM');
  const monthStart = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
  const monthEnd = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd');

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      const [profilesRes, monthLeavesRes, pendingRes, kpiRes] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase
          .from('leave_requests')
          .select('*, profiles!leave_requests_user_id_fkey(display_name, email)')
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd + 'T23:59:59'),
        supabase
          .from('leave_requests')
          .select('*, profiles!leave_requests_user_id_fkey(display_name, email)')
          .eq('status', '대기')
          .order('created_at', { ascending: false }),
        supabase
          .from('kpi_metrics')
          .select('*')
          .eq('period', currentMonth),
      ]);

      setProfiles(profilesRes.data || []);
      setMonthLeaves(monthLeavesRes.data || []);
      setPendingLeaves(pendingRes.data || []);
      setKpiMetrics(kpiRes.data || []);
    } catch (err) {
      console.error('관리자 데이터 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  // 오늘 생일인 사원
  function getTodayBirthdays() {
    const todayMD = format(now, 'MM-dd');
    return profiles.filter((p) => {
      if (!p.birthday) return false;
      const bMD = p.birthday.slice(5); // MM-dd
      return bMD === todayMD;
    });
  }

  // 오늘 입사 기념일인 사원
  function getTodayAnniversaries() {
    const todayMD = format(now, 'MM-dd');
    return profiles
      .filter((p) => {
        if (!p.joined_at) return false;
        const jMD = p.joined_at.slice(5);
        const years = now.getFullYear() - new Date(p.joined_at).getFullYear();
        return jMD === todayMD && years >= 1;
      })
      .map((p) => ({
        ...p,
        years: now.getFullYear() - new Date(p.joined_at!).getFullYear(),
      }));
  }

  // 팀별 평균 KPI 달성률
  function getTeamKpiAvg() {
    const teams: Record<string, { total: number; count: number }> = {};
    for (const m of kpiMetrics) {
      if (!teams[m.team]) teams[m.team] = { total: 0, count: 0 };
      teams[m.team].total += Number(m.achievement_rate || 0);
      teams[m.team].count += 1;
    }
    return Object.entries(teams).map(([team, v]) => ({
      team,
      avg: v.count > 0 ? v.total / v.count : 0,
      count: v.count,
    }));
  }

  // 이번 달 휴가 통계
  const totalMonthLeaves = monthLeaves.length;
  const approvedMonthLeaves = monthLeaves.filter((l) => l.status === '승인').length;
  const rejectedMonthLeaves = monthLeaves.filter((l) => l.status === '반려').length;
  const pendingMonthLeaves = monthLeaves.filter((l) => l.status === '대기').length;

  const todayBirthdays = getTodayBirthdays();
  const todayAnniversaries = getTodayAnniversaries();
  const teamKpi = getTeamKpiAvg();

  function getKpiColor(rate: number) {
    if (rate >= 100) return 'text-green-600';
    if (rate >= 70) return 'text-blue-600';
    if (rate >= 40) return 'text-yellow-600';
    return 'text-red-600';
  }

  function getKpiBg(rate: number) {
    if (rate >= 100) return 'bg-green-500';
    if (rate >= 70) return 'bg-blue-500';
    if (rate >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  }

  function getKpiBgLight(rate: number) {
    if (rate >= 100) return 'bg-green-100';
    if (rate >= 70) return 'bg-blue-100';
    if (rate >= 40) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  async function handleLeaveAction(id: string, status: '승인' | '반려') {
    await supabase
      .from('leave_requests')
      .update({
        status,
        reviewed_by: myProfile?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);
    await fetchAll();
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">관리자 대시보드</h1>
        <p className="mt-2 text-gray-600">
          {format(now, 'yyyy년 M월 d일 (EEEE)', { locale: ko })} 현황
        </p>
      </div>

      {/* 오늘의 생일 / 기념일 배너 */}
      {(todayBirthdays.length > 0 || todayAnniversaries.length > 0) && (
        <div className="space-y-3">
          {todayAnniversaries.map((emp) => (
            <div
              key={`ann-${emp.id}`}
              className="flex items-center gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50 px-5 py-4 shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <Award className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {emp.display_name || emp.email}님 — 입사 {emp.years}주년
                </p>
                <p className="text-xs text-amber-600">오늘이 입사 기념일입니다!</p>
              </div>
            </div>
          ))}
          {todayBirthdays.map((emp) => (
            <div
              key={`bday-${emp.id}`}
              className="flex items-center gap-3 rounded-xl border border-pink-200 bg-gradient-to-r from-pink-50 to-rose-50 px-5 py-4 shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-100">
                <Gift className="h-5 w-5 text-pink-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-pink-900">
                  {emp.display_name || emp.email}님 — 생일
                </p>
                <p className="text-xs text-pink-600">오늘이 생일입니다!</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 상단 통계 카드 4개 */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* 이번 달 총 휴가 신청 */}
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">이번 달 휴가 신청</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{totalMonthLeaves}<span className="text-lg font-normal text-gray-400">건</span></p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100">
              <CalendarDays className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle className="h-3 w-3" /> 승인 {approvedMonthLeaves}
            </span>
            <span className="flex items-center gap-1 text-yellow-600">
              <Clock className="h-3 w-3" /> 대기 {pendingMonthLeaves}
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <XCircle className="h-3 w-3" /> 반려 {rejectedMonthLeaves}
            </span>
          </div>
        </div>

        {/* 전체 인원 */}
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">전체 인원</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{profiles.length}<span className="text-lg font-normal text-gray-400">명</span></p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {profiles.filter((p) => p.team === '커머스팀').length}명 커머스팀 · {profiles.filter((p) => p.team === '콘텐츠팀').length}명 콘텐츠팀
          </div>
        </div>

        {/* 대기 중 신청 */}
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">승인 대기</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{pendingLeaves.length}<span className="text-lg font-normal text-gray-400">건</span></p>
            </div>
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${pendingLeaves.length > 0 ? 'bg-red-100' : 'bg-gray-100'}`}>
              <Clock className={`h-6 w-6 ${pendingLeaves.length > 0 ? 'text-red-600' : 'text-gray-400'}`} />
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            {pendingLeaves.length > 0 ? '처리가 필요합니다' : '모두 처리 완료'}
          </div>
        </div>

        {/* 오늘의 이벤트 */}
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">오늘의 이벤트</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {todayBirthdays.length + todayAnniversaries.length}
                <span className="text-lg font-normal text-gray-400">건</span>
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pink-100">
              <Gift className="h-6 w-6 text-pink-600" />
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            생일 {todayBirthdays.length}명 · 기념일 {todayAnniversaries.length}명
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 팀별 KPI 달성률 */}
        <div className="rounded-xl bg-white shadow-sm border border-gray-100">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">팀별 KPI 달성률</h2>
            <Link href="/kpi" className="text-sm text-blue-600 hover:text-blue-700">
              상세보기
            </Link>
          </div>
          <div className="p-6">
            {teamKpi.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-gray-400">
                <BarChart3 className="h-10 w-10 mb-2" />
                <p className="text-sm">{currentMonth} 기간 KPI 데이터가 없습니다</p>
              </div>
            ) : (
              <div className="space-y-5">
                {teamKpi.map(({ team, avg, count }) => (
                  <div key={team}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-sm font-medium text-gray-900">{team}</span>
                        <span className="ml-2 text-xs text-gray-400">{count}개 항목</span>
                      </div>
                      <span className={`text-lg font-bold ${getKpiColor(avg)}`}>
                        {avg.toFixed(1)}%
                      </span>
                    </div>
                    <div className={`h-3 w-full rounded-full ${getKpiBgLight(avg)}`}>
                      <div
                        className={`h-3 rounded-full transition-all duration-700 ${getKpiBg(avg)}`}
                        style={{ width: `${Math.min(avg, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}

                {/* 전체 평균 */}
                {teamKpi.length > 1 && (
                  <div className="border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">전체 평균</span>
                      <span className={`text-lg font-bold ${getKpiColor(
                        teamKpi.reduce((s, t) => s + t.avg, 0) / teamKpi.length
                      )}`}>
                        {(teamKpi.reduce((s, t) => s + t.avg, 0) / teamKpi.length).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 승인 대기 목록 */}
        <div className="rounded-xl bg-white shadow-sm border border-gray-100">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              승인 대기
              {pendingLeaves.length > 0 && (
                <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                  {pendingLeaves.length}
                </span>
              )}
            </h2>
            <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">
              전체보기
            </Link>
          </div>
          <div className="p-6">
            {pendingLeaves.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-gray-400">
                <CheckCircle className="h-10 w-10 mb-2" />
                <p className="text-sm">대기 중인 신청이 없습니다</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingLeaves.slice(0, 5).map((leave) => (
                  <div
                    key={leave.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-100">
                        <Clock className="h-4 w-4 text-yellow-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {leave.profiles?.display_name || leave.profiles?.email || '알 수 없음'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {leave.leave_type} · {leave.start_date}
                          {leave.start_date !== leave.end_date && ` ~ ${leave.end_date}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleLeaveAction(leave.id, '승인')}
                        className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
                      >
                        승인
                      </button>
                      <button
                        onClick={() => handleLeaveAction(leave.id, '반려')}
                        className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                      >
                        반려
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 오늘의 생일 & 기념일 상세 카드 */}
      {(todayBirthdays.length > 0 || todayAnniversaries.length > 0) && (
        <div className="rounded-xl bg-white shadow-sm border border-gray-100">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">오늘의 생일 & 기념일</h2>
          </div>
          <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
            {todayAnniversaries.map((emp) => (
              <div
                key={`ann-detail-${emp.id}`}
                className="flex items-center gap-4 rounded-xl border border-amber-100 bg-amber-50/50 p-4"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-200 text-lg font-bold text-amber-800">
                  {(emp.display_name || emp.email || '?').charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{emp.display_name || emp.email}</p>
                  <p className="text-xs text-amber-700">{emp.team || '미지정'}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <Award className="h-3 w-3 text-amber-500" />
                    <span className="text-xs font-medium text-amber-600">입사 {emp.years}주년</span>
                  </div>
                </div>
              </div>
            ))}
            {todayBirthdays.map((emp) => (
              <div
                key={`bday-detail-${emp.id}`}
                className="flex items-center gap-4 rounded-xl border border-pink-100 bg-pink-50/50 p-4"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-200 text-lg font-bold text-pink-800">
                  {(emp.display_name || emp.email || '?').charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{emp.display_name || emp.email}</p>
                  <p className="text-xs text-pink-700">{emp.team || '미지정'}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <Gift className="h-3 w-3 text-pink-500" />
                    <span className="text-xs font-medium text-pink-600">생일 축하합니다!</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
