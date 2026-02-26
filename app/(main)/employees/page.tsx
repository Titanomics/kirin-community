'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Edit, Search, Download, Save, X, UserX } from 'lucide-react';
import { format, differenceInMonths } from 'date-fns';

interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: 'admin' | 'user' | 'leader';
  team: '커머스팀' | '콘텐츠팀' | null;
  joined_at: string | null;
  birthday: string | null;
  created_at: string;
  leave_adjustment: number;
  resigned_at: string | null;
}

interface LeaveRequest {
  id: string;
  user_id: string;
  leave_type: '연차' | '반차' | '월차';
  status: '대기' | '승인' | '반려';
}

function calcLeaveBalance(joinedAt: string | null, approvedLeaves: LeaveRequest[], adjustment = 0) {
  if (!joinedAt) return null;
  const today = new Date();
  const totalMonths = differenceInMonths(today, new Date(joinedAt));
  const years = Math.floor(totalMonths / 12);

  if (years < 1) {
    const total = Math.min(totalMonths, 11);
    const used = approvedLeaves.reduce((sum, l) => {
      if (l.leave_type === '월차') return sum + 1;
      if (l.leave_type === '반차') return sum + 0.5;
      return sum;
    }, 0);
    const remaining = Math.max(0, total - used) + adjustment;
    return { kind: '월차' as const, total, used, remaining, adjustment };
  } else {
    const total = Math.min(15 + Math.max(0, Math.floor((years - 1) / 2)), 25);
    const used = approvedLeaves.reduce((sum, l) => {
      if (l.leave_type === '연차') return sum + 1;
      if (l.leave_type === '반차') return sum + 0.5;
      return sum;
    }, 0);
    const remaining = Math.max(0, total - used) + adjustment;
    return { kind: '연차' as const, total, used, remaining, adjustment };
  }
}

export default function EmployeesPage() {
  const { profile: myProfile } = useAuth();
  const supabase = createClient();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [leavesByUser, setLeavesByUser] = useState<Record<string, LeaveRequest[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ joined_at: '', birthday: '', team: '', role: '', leave_remaining: '' });
  const [saving, setSaving] = useState(false);
  const [showResigned, setShowResigned] = useState(false);

  const isAdmin = myProfile?.role === 'admin';

  useEffect(() => {
    fetchProfiles();
  }, []);

  async function fetchProfiles() {
    try {
      const [{ data: profilesData }, { data: leavesData }] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: true }),
        supabase.from('leave_requests').select('id, user_id, leave_type, status').eq('status', '승인'),
      ]);
      setProfiles(profilesData || []);

      const grouped: Record<string, LeaveRequest[]> = {};
      for (const leave of (leavesData || [])) {
        if (!grouped[leave.user_id]) grouped[leave.user_id] = [];
        grouped[leave.user_id].push(leave);
      }
      setLeavesByUser(grouped);
    } catch (err) {
      console.error('인원 데이터 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  const activeProfiles = profiles.filter((p) => !p.resigned_at);
  const resignedProfiles = profiles.filter((p) => !!p.resigned_at);
  const displayProfiles = showResigned ? profiles : activeProfiles;

  const filteredProfiles = displayProfiles.filter(
    (p) =>
      (p.display_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.team || '').includes(searchTerm)
  );

  const calculateTenure = (joinDate: string | null) => {
    if (!joinDate) return '-';
    const months = differenceInMonths(new Date(), new Date(joinDate));
    const years = Math.floor(months / 12);
    const rem = months % 12;
    if (years === 0) return `${rem}개월`;
    if (rem === 0) return `${years}년`;
    return `${years}년 ${rem}개월`;
  };

  const roleLabel = (role: string) => {
    const map: Record<string, string> = { admin: '관리자', leader: '팀장', user: '사용자' };
    return map[role] || role;
  };

  const roleBadgeColor = (role: string) => {
    const map: Record<string, string> = {
      admin: 'bg-red-100 text-red-800',
      leader: 'bg-purple-100 text-purple-800',
      user: 'bg-gray-100 text-gray-800',
    };
    return map[role] || 'bg-gray-100 text-gray-800';
  };

  function startEdit(p: Profile) {
    setEditingId(p.id);
    const currentBalance = calcLeaveBalance(p.joined_at, leavesByUser[p.id] || [], p.leave_adjustment ?? 0);
    setEditForm({
      joined_at: p.joined_at || '',
      birthday: p.birthday || '',
      team: p.team || '',
      role: p.role,
      leave_remaining: currentBalance ? String(currentBalance.remaining) : '',
    });
  }

  async function handleResign(p: Profile) {
    if (p.id === myProfile?.id) {
      alert('본인 계정은 퇴사 처리할 수 없습니다.');
      return;
    }
    const confirmed = confirm(
      `${p.display_name || p.email}님을 퇴사 처리하시겠습니까?\n\n확인 시 해당 직원은 즉시 커뮤니티 접근이 차단됩니다.`
    );
    if (!confirmed) return;

    const { error } = await supabase
      .from('profiles')
      .update({ resigned_at: new Date().toISOString() })
      .eq('id', p.id);

    if (error) {
      alert('퇴사 처리 실패: ' + error.message);
    } else {
      await fetchProfiles();
    }
  }

  async function handleSave(id: string) {
    setSaving(true);
    const baseBalance = calcLeaveBalance(editForm.joined_at, leavesByUser[id] || [], 0);
    const baseRemaining = baseBalance?.remaining ?? 0;
    const targetRemaining = parseFloat(editForm.leave_remaining);
    const newAdjustment = isNaN(targetRemaining) ? 0 : targetRemaining - baseRemaining;

    const updateData: Record<string, string | number | null> = {
      joined_at: editForm.joined_at || null,
      birthday: editForm.birthday || null,
      team: editForm.team || null,
      role: editForm.role,
      leave_adjustment: newAdjustment,
    };

    const { error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', id);

    if (error) {
      alert('저장 실패: ' + error.message);
    } else {
      await fetchProfiles();
      setEditingId(null);
    }
    setSaving(false);
  }

  const exportCSV = () => {
    const headers = ['이름', '이메일', '역할', '팀', '입사일', '근속기간', '생일', '잔여연차/월차'];
    const data = profiles.map((p) => {
      const balance = calcLeaveBalance(p.joined_at, leavesByUser[p.id] || [], p.leave_adjustment ?? 0);
      const balanceStr = balance ? `${balance.kind} ${balance.remaining}/${balance.total}` : '-';
      return [
        p.display_name || '-',
        p.email || '-',
        roleLabel(p.role),
        p.team || '-',
        p.joined_at || '-',
        calculateTenure(p.joined_at),
        p.birthday || '-',
        balanceStr,
      ];
    });
    const csvContent =
      '\uFEFF' + [headers.join(','), ...data.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `인원관리_${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">인원 관리</h1>
          <p className="mt-2 text-gray-600">
            재직 {activeProfiles.length}명
            {resignedProfiles.length > 0 && (
              <span className="ml-2 text-gray-400">· 퇴사 {resignedProfiles.length}명</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && resignedProfiles.length > 0 && (
            <button
              onClick={() => setShowResigned((v) => !v)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                showResigned
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {showResigned ? '퇴사자 숨기기' : `퇴사자 보기 (${resignedProfiles.length})`}
            </button>
          )}
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-5 w-5" />
            CSV 내보내기
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="이름, 이메일, 팀으로 검색..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">이름</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">이메일</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">역할</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">팀</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">입사일</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">근속기간</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">생일</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">잔여 연차/월차</th>
                {isAdmin && (
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-700">관리</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredProfiles.map((p) => {
                const balance = calcLeaveBalance(p.joined_at, leavesByUser[p.id] || [], p.leave_adjustment ?? 0);
                const balanceColor =
                  !balance
                    ? 'text-gray-400'
                    : balance.remaining === 0
                    ? 'text-red-600'
                    : balance.remaining <= balance.total * 0.3
                    ? 'text-yellow-600'
                    : 'text-green-600';
                return (
                  <tr key={p.id} className={p.resigned_at ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white font-semibold">
                          {(p.display_name || p.email || '?').charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900">{p.display_name || '-'}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">{p.email || '-'}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {editingId === p.id ? (
                        <select
                          value={editForm.role}
                          onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="user">사용자</option>
                          <option value="leader">팀장</option>
                          <option value="admin">관리자</option>
                        </select>
                      ) : (
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${roleBadgeColor(p.role)}`}>
                          {roleLabel(p.role)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {editingId === p.id ? (
                        <select
                          value={editForm.team}
                          onChange={(e) => setEditForm({ ...editForm, team: e.target.value })}
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="">미지정</option>
                          <option value="커머스팀">커머스팀</option>
                          <option value="콘텐츠팀">콘텐츠팀</option>
                        </select>
                      ) : (
                        <span className="text-gray-700">{p.team || '-'}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {editingId === p.id ? (
                        <input
                          type="date"
                          value={editForm.joined_at}
                          onChange={(e) => setEditForm({ ...editForm, joined_at: e.target.value })}
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="text-gray-700">
                          {p.joined_at ? format(new Date(p.joined_at), 'yyyy.MM.dd') : '-'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {calculateTenure(p.joined_at)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {editingId === p.id ? (
                        <input
                          type="date"
                          value={editForm.birthday}
                          onChange={(e) => setEditForm({ ...editForm, birthday: e.target.value })}
                          className="rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      ) : (
                        <span className="text-gray-700">
                          {p.birthday ? format(new Date(p.birthday), 'MM.dd') : '-'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {editingId === p.id ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-gray-500">
                            자동계산: {(() => {
                              const base = calcLeaveBalance(editForm.joined_at, leavesByUser[p.id] || [], 0);
                              return base ? `${base.remaining}개 (${base.kind})` : '-';
                            })()}
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-500">잔여</span>
                            <input
                              type="number"
                              value={editForm.leave_remaining}
                              onChange={(e) => setEditForm({ ...editForm, leave_remaining: e.target.value })}
                              className="w-16 rounded border border-gray-300 px-2 py-1 text-sm text-center"
                              step="0.5"
                              min="0"
                              placeholder="0"
                            />
                            <span className="text-xs text-gray-400">개</span>
                          </div>
                        </div>
                      ) : balance ? (
                        <div>
                          <span className={`font-semibold ${balanceColor}`}>
                            {balance.remaining}
                          </span>
                          <span className="text-gray-400"> / {balance.total}</span>
                          <span className="ml-1 text-xs text-gray-500">{balance.kind}</span>
                          {balance.adjustment !== 0 && (
                            <span className={`ml-1 text-xs ${balance.adjustment > 0 ? 'text-blue-500' : 'text-red-400'}`}>
                              ({balance.adjustment > 0 ? '+' : ''}{balance.adjustment})
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        {editingId === p.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleSave(p.id)}
                              disabled={saving}
                              className="rounded bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
                              title="저장"
                            >
                              <Save className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded bg-gray-200 p-1.5 text-gray-600 hover:bg-gray-300"
                              title="취소"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : p.resigned_at ? (
                          <span className="text-xs text-gray-400">
                            퇴사 {format(new Date(p.resigned_at), 'yy.MM.dd')}
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => startEdit(p)}
                              className="text-blue-600 hover:text-blue-900"
                              title="정보 수정"
                            >
                              <Edit className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => handleResign(p)}
                              className="text-red-400 hover:text-red-600"
                              title="퇴사 처리"
                            >
                              <UserX className="h-5 w-5" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredProfiles.length === 0 && (
          <div className="py-12 text-center text-gray-500">검색 결과가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
