'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Users, FileText, Calendar, Clock, CheckCircle, XCircle, Gift, Award } from 'lucide-react';
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

export default function Home() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveRequest[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = myProfile?.role === 'admin';

  useEffect(() => {
    fetchData();
  }, [myProfile]);

  async function fetchData() {
    try {
      const [profilesRes, pendingRes, approvedRes] = await Promise.all([
        supabase.from('profiles').select('*').is('resigned_at', null),
        supabase
          .from('leave_requests')
          .select('*, profiles!leave_requests_user_id_fkey(display_name, email)')
          .eq('status', '대기')
          .order('created_at', { ascending: false }),
        supabase
          .from('leave_requests')
          .select('*, profiles!leave_requests_user_id_fkey(display_name, email)')
          .eq('status', '승인')
          .order('start_date', { ascending: false })
          .limit(5),
      ]);
      setProfiles(profilesRes.data || []);
      setPendingLeaves(pendingRes.data || []);
      setApprovedLeaves(approvedRes.data || []);
    } catch (err) {
      console.error('데이터 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleLeaveAction(id: string, status: '승인' | '반려') {
    const { error } = await supabase
      .from('leave_requests')
      .update({
        status,
        reviewed_by: myProfile?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      alert('처리 실패: ' + error.message);
    } else {
      await fetchData();
    }
  }

  // 입사 1주년 계산 (이번 주 내 기념일)
  function getAnniversaryEmployees() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    return profiles.filter((p) => {
      if (!p.joined_at) return false;
      const joinDate = new Date(p.joined_at);
      const yearsWorked = now.getFullYear() - joinDate.getFullYear();
      if (yearsWorked < 1) return false;
      // 올해 기념일
      const anniversary = new Date(now.getFullYear(), joinDate.getMonth(), joinDate.getDate());
      return anniversary >= weekStart && anniversary <= weekEnd;
    }).map((p) => {
      const joinDate = new Date(p.joined_at!);
      const years = now.getFullYear() - joinDate.getFullYear();
      return { ...p, years };
    });
  }

  // 이번 주 생일
  function getBirthdayEmployees() {
    const now = new Date();
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
  }

  const anniversaryEmployees = getAnniversaryEmployees();
  const birthdayEmployees = getBirthdayEmployees();
  const hasNotifications = anniversaryEmployees.length > 0 || birthdayEmployees.length > 0;

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">대시보드</h1>
        <p className="mt-2 text-gray-600">사내 커뮤니티 현황을 확인하세요</p>
      </div>

      {/* Auto Notifications - Anniversary & Birthday (Admin only) */}
      {isAdmin && hasNotifications && (
        <div className="space-y-3">
          {anniversaryEmployees.map((emp) => (
            <div key={`ann-${emp.id}`} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <Award className="h-5 w-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">{emp.display_name || emp.email}</span>님이 이번 주에{' '}
                <span className="font-semibold">입사 {emp.years}주년</span>을 맞이합니다!
              </p>
            </div>
          ))}
          {birthdayEmployees.map((emp) => (
            <div key={`bday-${emp.id}`} className="flex items-center gap-3 rounded-lg border border-pink-200 bg-pink-50 px-4 py-3">
              <Gift className="h-5 w-5 text-pink-600 flex-shrink-0" />
              <p className="text-sm text-pink-800">
                <span className="font-semibold">{emp.display_name || emp.email}</span>님의{' '}
                <span className="font-semibold">생일</span>이 이번 주입니다!
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">전체 인원</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{profiles.length}</p>
            </div>
            <div className="rounded-full bg-blue-100 p-3">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">승인된 휴가</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{approvedLeaves.length}</p>
            </div>
            <div className="rounded-full bg-green-100 p-3">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">대기 중 신청</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{pendingLeaves.length}</p>
            </div>
            <div className="rounded-full bg-yellow-100 p-3">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">게시글</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">-</p>
            </div>
            <div className="rounded-full bg-purple-100 p-3">
              <FileText className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Leave Requests - Admin Approval */}
        {isAdmin && (
          <div className="rounded-lg bg-white p-6 shadow lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">
                연차 신청 대기
                {pendingLeaves.length > 0 && (
                  <span className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                    {pendingLeaves.length}
                  </span>
                )}
              </h2>
            </div>
            {pendingLeaves.length === 0 ? (
              <p className="text-sm text-gray-400">대기 중인 신청이 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {pendingLeaves.map((leave) => (
                  <div key={leave.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
                        <Clock className="h-5 w-5 text-yellow-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {leave.profiles?.display_name || leave.profiles?.email || '알 수 없음'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {leave.leave_type} &middot; {leave.start_date}
                          {leave.start_date !== leave.end_date && ` ~ ${leave.end_date}`}
                          {leave.reason && ` &middot; ${leave.reason}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleLeaveAction(leave.id, '승인')}
                        className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        승인
                      </button>
                      <button
                        onClick={() => handleLeaveAction(leave.id, '반려')}
                        className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        반려
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Approved Leaves */}
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">최근 승인된 휴가</h2>
            <Link href="/calendar" className="text-sm text-blue-600 hover:text-blue-700">
              캘린더
            </Link>
          </div>
          {approvedLeaves.length === 0 ? (
            <p className="text-sm text-gray-400">승인된 휴가가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {approvedLeaves.map((leave) => (
                <div key={leave.id} className="flex items-center gap-4 border-b border-gray-100 pb-3 last:border-0">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {leave.profiles?.display_name || leave.profiles?.email || '알 수 없음'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {leave.leave_type} &middot; {leave.start_date}
                      {leave.start_date !== leave.end_date && ` ~ ${leave.end_date}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Employee Directory */}
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">인원 현황</h2>
            {isAdmin && (
              <Link href="/employees" className="text-sm text-blue-600 hover:text-blue-700">
                전체보기
              </Link>
            )}
          </div>
          <div className="space-y-3">
            {profiles.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs text-white font-semibold">
                    {(p.display_name || p.email || '?').charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.display_name || p.email}</p>
                    <p className="text-xs text-gray-500">{p.team || '미지정'}</p>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  p.role === 'admin' ? 'bg-red-100 text-red-800' :
                  p.role === 'leader' ? 'bg-purple-100 text-purple-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {p.role === 'admin' ? '관리자' : p.role === 'leader' ? '팀장' : '사용자'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
