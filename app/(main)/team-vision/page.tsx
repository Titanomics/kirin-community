'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type Team = '커머스팀' | '콘텐츠팀';

export default function TeamVisionPage() {
  const { profile, loading } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [viewTeam, setViewTeam] = useState<Team>('커머스팀');

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  // 관리자는 토글로 선택, 일반 직원은 본인 팀 고정
  const effectiveTeam: Team | null = isAdmin ? viewTeam : (profile?.team ?? null);

  if (!effectiveTeam) {
    return (
      <div className="rounded-lg bg-white p-8 text-center text-gray-500 shadow">
        아직 팀이 지정되지 않았습니다. 관리자에게 팀 지정을 요청해주세요.
      </div>
    );
  }

  const src = effectiveTeam === '커머스팀' ? '/team-vision/commerce.html' : '/team-vision/content.html';

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow">
          <h1 className="text-2xl font-bold text-gray-900">팀 비전</h1>
          <div className="flex gap-2">
            {(['커머스팀', '콘텐츠팀'] as Team[]).map((t) => (
              <button
                key={t}
                onClick={() => setViewTeam(t)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  viewTeam === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <iframe
        key={src}
        src={src}
        title={`${effectiveTeam} 비전`}
        className="w-full rounded-lg bg-white shadow"
        style={{ height: 'calc(100vh - 140px)', border: 0 }}
      />
    </div>
  );
}
