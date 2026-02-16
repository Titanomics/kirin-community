import { mockEmployees, mockPosts, mockSchedules } from '@/lib/mockData';
import { Users, FileText, Calendar, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { calculateLeave } from '@/lib/leaveCalculator';

export default function Home() {
  const activeEmployees = mockEmployees.filter(e => e.status === 'active').length;
  const onVacation = mockEmployees.filter(e => e.status === 'vacation').length;
  const todaySchedules = mockSchedules.length;

  // 전체 인원의 연차/월차 통계 계산
  const leaveStats = mockEmployees.map(emp => calculateLeave(emp.joinDate, emp.usedLeave));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">대시보드</h1>
        <p className="mt-2 text-gray-600">사내 커뮤니티 현황을 확인하세요</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">전체 인원</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{mockEmployees.length}</p>
            </div>
            <div className="rounded-full bg-blue-100 p-3">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">출근 인원</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{activeEmployees}</p>
            </div>
            <div className="rounded-full bg-green-100 p-3">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">연차/휴가</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{onVacation}</p>
            </div>
            <div className="rounded-full bg-yellow-100 p-3">
              <Calendar className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">게시글</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{mockPosts.length}</p>
            </div>
            <div className="rounded-full bg-purple-100 p-3">
              <FileText className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 연차/월차 현황 및 Recent Posts & Today's Schedule */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* 연차/월차 현황 */}
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">연차/월차 현황</h2>
            <Link href="/employees" className="text-sm text-blue-600 hover:text-blue-700">
              전체보기
            </Link>
          </div>
          <div className="space-y-3">
            {mockEmployees.map((emp) => {
              const leaveInfo = calculateLeave(emp.joinDate, emp.usedLeave);
              return (
                <div key={emp.id} className="flex items-center justify-between border-b border-gray-200 pb-3 last:border-0">
                  <div>
                    <p className="font-medium text-gray-900">{emp.name}</p>
                    <p className="text-xs text-gray-500">
                      {leaveInfo.leaveType === 'monthly' ? '월차' : '연차'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {leaveInfo.remainingLeave} / {leaveInfo.totalLeave}
                    </p>
                    <p className="text-xs text-gray-500">남음 / 전체</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Posts */}
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">최근 게시글</h2>
            <Link href="/board" className="text-sm text-blue-600 hover:text-blue-700">
              전체보기
            </Link>
          </div>
          <div className="space-y-4">
            {mockPosts.slice(0, 3).map((post) => (
              <div key={post.id} className="border-b border-gray-200 pb-4 last:border-0">
                <h3 className="font-medium text-gray-900">{post.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{post.authorName}</p>
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                  <span>👍 {post.likes}</span>
                  <span>💬 {post.commentCount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Today's Schedule */}
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">오늘의 일정</h2>
            <Link href="/calendar" className="text-sm text-blue-600 hover:text-blue-700">
              캘린더
            </Link>
          </div>
          <div className="space-y-4">
            {mockSchedules.map((schedule) => (
              <div key={schedule.id} className="flex items-center gap-4">
                <div className={`h-3 w-3 rounded-full ${
                  schedule.type === 'vacation' ? 'bg-yellow-500' :
                  schedule.type === 'dayoff' ? 'bg-gray-400' : 'bg-green-500'
                }`}></div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{schedule.employeeName}</p>
                  <p className="text-sm text-gray-600">
                    {schedule.type === 'vacation' ? '연차' :
                     schedule.type === 'dayoff' ? '휴무' : '근무'}
                    {schedule.note && ` - ${schedule.note}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
