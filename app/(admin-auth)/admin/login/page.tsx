'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Mail, Lock, Eye, EyeOff, Shield } from 'lucide-react';

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Check if user has admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (profile?.role !== 'admin') {
      await supabase.auth.signOut();
      setError('관리자 권한이 없습니다.');
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="w-full max-w-md px-4">
      <div className="rounded-2xl bg-gray-800 p-8 shadow-2xl border border-gray-700">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-600">
            <Shield className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">관리자 로그인</h1>
          <p className="mt-2 text-gray-400">
            관리자 계정으로 로그인하세요
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-300">
              이메일
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                required
                className="w-full rounded-lg border border-gray-600 bg-gray-700 py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-300">
              비밀번호
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full rounded-lg border border-gray-600 bg-gray-700 py-2.5 pl-10 pr-10 text-sm text-white placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? '확인 중...' : '관리자 로그인'}
          </button>
        </form>

        {/* Back to user login */}
        <p className="mt-6 text-center text-sm text-gray-500">
          일반 사용자이신가요?{' '}
          <a href="/login" className="font-medium text-gray-400 hover:text-gray-300">
            일반 로그인
          </a>
        </p>
      </div>
    </div>
  );
}
