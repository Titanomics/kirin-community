'use client';

import { Bell, Search, LogOut, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDarkMode } from '@/contexts/DarkModeContext';

export default function Header() {
  const { user, profile, signOut } = useAuth();
  const { isDark, toggle } = useDarkMode();

  const displayName =
    profile?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    '사용자';
  const displayEmail = profile?.email || user?.email || '';

  return (
    <header className="fixed left-64 right-0 top-0 z-30 h-16 border-b border-gray-200 bg-white px-6">
      <div className="flex h-full items-center justify-between">
        {/* Search */}
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="검색..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          {/* 다크모드 토글 */}
          <button
            onClick={toggle}
            title={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          {/* 알림 (실제 알림 없으면 빨간 점 미표시) */}
          <button className="relative rounded-full p-2 hover:bg-gray-100">
            <Bell className="h-5 w-5 text-gray-600" />
          </button>

          <div className="text-sm">
            <p className="font-medium text-gray-900">{displayName}</p>
            <p className="text-gray-500">{displayEmail}</p>
          </div>
          <button
            onClick={signOut}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="로그아웃"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
