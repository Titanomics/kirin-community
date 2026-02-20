'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Calendar, Users, LayoutDashboard, CalendarDays, BarChart3, Shield, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDarkMode } from '@/contexts/DarkModeContext';
import { useMemo } from 'react';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const { isDark, toggle } = useDarkMode();

  const isAdmin = profile?.role === 'admin';
  const isLeader = profile?.role === 'leader';

  const menuItems = useMemo(() => {
    const items = [
      { name: '대시보드', href: '/', icon: LayoutDashboard },
      { name: '게시판', href: '/board', icon: MessageSquare },
      { name: '캘린더', href: '/calendar', icon: Calendar },
    ];

    items.push({ name: 'KPI', href: '/kpi', icon: BarChart3 });

    if (isAdmin) {
      items.push({ name: '인원 관리', href: '/employees', icon: Users });
      items.push({ name: '관리자 대시보드', href: '/admin', icon: Shield });
    } else {
      items.push({ name: '내 연차 보기', href: '/my-leave', icon: CalendarDays });
    }

    return items;
  }, [isAdmin, isLeader]);

  const displayName =
    profile?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    '사용자';
  const roleLabel = isAdmin ? '관리자' : profile?.role === 'leader' ? '팀장' : '사용자';
  const initial = displayName.charAt(0);

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-gray-900 text-white">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-center border-b border-gray-800">
          <h1 className="text-2xl font-bold">사내 커뮤니티</h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User Info + Dark Mode Toggle */}
        <div className="border-t border-gray-800 p-4">
          <div className="flex items-center gap-2">
            {/* 다크모드 토글 — 닉네임 왼쪽 */}
            <button
              onClick={toggle}
              title={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-800 hover:text-yellow-300"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* 아바타 */}
            <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-semibold">{initial}</span>
            </div>

            {/* 닉네임 + 역할 */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="text-xs text-gray-400">{roleLabel}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
