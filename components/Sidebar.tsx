'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Calendar, Users, LayoutDashboard, CalendarDays, BarChart3, Shield, Clock, UserCheck, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMobileMenu } from '@/contexts/MobileMenuContext';
import { useMemo } from 'react';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const { open, close } = useMobileMenu();

  const isAdmin = profile?.role === 'admin';
  const isLeader = profile?.role === 'leader';

  const menuItems = useMemo(() => {
    const items = [
      { name: '대시보드', href: '/', icon: LayoutDashboard },
      { name: '게시판', href: '/board', icon: MessageSquare },
      { name: '캘린더', href: '/calendar', icon: Calendar },
    ];

    items.push({ name: 'KPI', href: '/kpi', icon: BarChart3 });
    items.push({ name: '출퇴근', href: '/attendance', icon: Clock });

    if (isAdmin) {
      items.push({ name: '인원 관리', href: '/employees', icon: Users });
      items.push({ name: '출석 관리', href: '/attendance-admin', icon: UserCheck });
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
    <>
      {/* 모바일 백드롭 오버레이 */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={close}
        />
      )}

      {/* 사이드바 */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 bg-gray-900 text-white transition-transform duration-300
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0`}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between border-b border-gray-800 px-6">
            <h1 className="text-xl font-bold">사내 커뮤니티</h1>
            <button
              onClick={close}
              className="md:hidden rounded p-1 text-gray-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
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
                  onClick={close}
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

          {/* User Info */}
          <div className="border-t border-gray-800 p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold">{initial}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="text-xs text-gray-400">{roleLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
