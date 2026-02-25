'use client';

import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { CalendarDays, Clock, CheckCircle, XCircle, Plus, X } from 'lucide-react';
import { differenceInMonths } from 'date-fns';

interface LeaveRequest {
  id: string;
  leave_type: '연차' | '반차' | '월차';
  start_date: string;
  end_date: string;
  reason: string | null;
  status: '대기' | '승인' | '반려';
  created_at: string;
}

function calcLeaveBalance(joinedAt: string | null, approvedLeaves: LeaveRequest[], adjustment = 0) {
  if (!joinedAt) return null;
  const today = new Date();
  const totalMonths = differenceInMonths(today, new Date(joinedAt));
  const years = Math.floor(totalMonths / 12);

  if (years < 1) {
    const total = Math.min(totalMonths, 11);
    const used = approvedLeaves.filter((l) => l.leave_type === '월차').length;
    const remaining = Math.max(0, total - used) + adjustment;
    return {
      kind: '월차' as const,
      total,
      used,
      remaining,
      adjustment,
      note: `입사 후 ${totalMonths}개월 경과 · 매월 1개 자동 부여 (최대 11개)`,
    };
  } else {
    const total = Math.min(15 + Math.max(0, Math.floor((years - 1) / 2)), 25);
    const used = approvedLeaves.reduce((sum, l) => {
      if (l.leave_type === '연차') return sum + 1;
      if (l.leave_type === '반차') return sum + 0.5;
      return sum;
    }, 0);
    const remaining = Math.max(0, total - used) + adjustment;
    return {
      kind: '연차' as const,
      total,
      used,
      remaining,
      adjustment,
      note: `근속 ${years}년 · 기본 15일 + 추가 ${total - 15}일`,
    };
  }
}

const statusConfig = {
  '대기': { color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  '승인': { color: 'bg-green-100 text-green-800', icon: CheckCircle },
  '반려': { color: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function MyLeavePage() {
  const { user, profile } = useAuth();
  const supabase = createClient();
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    leave_type: '연차' as '연차' | '반차' | '월차',
    start_date: '',
    end_date: '',
    reason: '',
  });

  useEffect(() => {
    if (user) fetchLeaves();
  }, [user]);

  async function fetchLeaves() {
    try {
      const { data } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      setLeaves(data || []);
    } catch (err) {
      console.error('연차 데이터 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    const { error } = await supabase.from('leave_requests').insert({
      user_id: user.id,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.leave_type === '반차' ? form.start_date : form.end_date,
      reason: form.reason || null,
    });

    if (error) {
      alert('신청 실패: ' + error.message);
    } else {
      alert('연차 신청이 완료되었습니다. 관리자 승인을 기다려주세요.');
      setShowForm(false);
      setForm({ leave_type: '연차', start_date: '', end_date: '', reason: '' });
      await fetchLeaves();
    }
    setSubmitting(false);
  }

  async function handleCancel(id: string) {
    if (!confirm('신청을 취소하시겠습니까?')) return;
    const { error } = await supabase.from('leave_requests').delete().eq('id', id);
    if (error) {
      alert('취소 실패: ' + error.message);
    } else {
      await fetchLeaves();
    }
  }

  const approvedLeaves = leaves.filter((l) => l.status === '승인');
  const pendingCount = leaves.filter((l) => l.status === '대기').length;
  const balance = calcLeaveBalance(profile?.joined_at ?? null, approvedLeaves, profile?.leave_adjustment ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">내 연차 보기</h1>
          <p className="mt-1 text-sm text-gray-500">나의 휴가 신청 내역을 확인하세요</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          연차 신청
        </button>
      </div>

      {/* Balance Card */}
      {balance ? (
        <div className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-blue-100">잔여 {balance.kind}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-5xl font-bold">{balance.remaining}</span>
                <span className="text-xl text-blue-200">/ {balance.total}개</span>
              </div>
              <p className="mt-2 text-sm text-blue-100">{balance.note}</p>
              {balance.adjustment !== 0 && (
                <p className="mt-0.5 text-xs text-blue-200">
                  관리자 조정: {balance.adjustment > 0 ? '+' : ''}{balance.adjustment}일 적용됨
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm text-blue-100">사용</p>
              <p className="text-2xl font-semibold">{balance.used}개</p>
            </div>
          </div>
          {balance.total > 0 && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-500/50">
                <div
                  className="h-full rounded-full bg-white transition-all"
                  style={{ width: `${Math.round((balance.remaining / balance.total) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-right text-xs text-blue-200">
                {Math.round((balance.remaining / balance.total) * 100)}% 남음
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
          입사일 정보가 없어 잔여 연차를 계산할 수 없습니다. 관리자에게 문의하세요.
        </div>
      )}

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
              <p className="mt-1 text-2xl font-bold text-green-600">{approvedLeaves.length}건</p>
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

      {/* Request Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">연차 신청</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">휴가 유형</label>
                <select
                  value={form.leave_type}
                  onChange={(e) => setForm({ ...form, leave_type: e.target.value as typeof form.leave_type })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="연차">연차</option>
                  <option value="반차">반차</option>
                  <option value="월차">월차</option>
                </select>
              </div>
              <div className={form.leave_type === '반차' ? '' : 'grid grid-cols-2 gap-3'}>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    {form.leave_type === '반차' ? '날짜' : '시작일'}
                  </label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                {form.leave_type !== '반차' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">종료일</label>
                    <input
                      type="date"
                      value={form.end_date}
                      onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                      required
                      min={form.start_date}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">사유 (선택)</label>
                <textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  rows={3}
                  placeholder="예: 개인 사유, 가족 행사 등"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? '신청 중...' : '신청하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                      <p className="text-xs text-gray-500">{leave.reason || '사유 없음'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {leave.status}
                    </span>
                    {leave.status === '대기' && (
                      <button
                        onClick={() => handleCancel(leave.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        취소
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
