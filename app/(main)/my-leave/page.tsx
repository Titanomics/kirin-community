'use client';

import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { CalendarDays, Clock, CheckCircle, XCircle } from 'lucide-react';

interface LeaveRequest {
  id: string;
  leave_type: '연차' | '반차' | '월차';
  start_date: string;
  end_date: string;
  reason: string | null;
  status: '대기' | '승인' | '반려';
  created_at: string;
}

const statusConfig = {
  '대기': { color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  '승인': { color: 'bg-green-100 text-green-800', icon: CheckCircle },
  '반려': { color: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function MyLeavePage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function fetchLeaves() {
      const { data } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      setLeaves(data || []);
      setLoading(false);
    }

    fetchLeaves();
  }, [user]);

  const usedCount = leaves.filter((l) => l.status === '승인').length;
  const pendingCount = leaves.filter((l) => l.status === '대기').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">내 연차 보기</h1>
        <p className="mt-1 text-sm text-gray-500">나의 휴가 신청 내역을 확인하세요</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">총 신청</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{leaves.length}건</p>
            </div>
            <CalendarDays className="h-8 w-8 text-blue-500" />
          </div>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">승인됨</p>
              <p className="mt-1 text-2xl font-bold text-green-600">{usedCount}건</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">대기 중</p>
              <p className="mt-1 text-2xl font-bold text-yellow-600">{pendingCount}건</p>
            </div>
            <Clock className="h-8 w-8 text-yellow-500" />
          </div>
        </div>
      </div>

      {/* Leave List */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">신청 내역</h2>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-400">불러오는 중...</div>
        ) : leaves.length === 0 ? (
          <div className="p-12 text-center">
            <CalendarDays className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">신청한 휴가가 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {leaves.map((leave) => {
              const config = statusConfig[leave.status];
              const StatusIcon = config.icon;
              return (
                <div key={leave.id} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                      <CalendarDays className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {leave.leave_type} &middot; {leave.start_date}
                        {leave.start_date !== leave.end_date && ` ~ ${leave.end_date}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {leave.reason || '사유 없음'}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {leave.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
