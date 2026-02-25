'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: 'admin' | 'user' | 'leader';
  joined_at: string | null;
  leave_adjustment: number;
  resigned_at: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (!user) setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // CRITICAL: Do NOT call Supabase API methods (async) inside this callback.
      // Doing so causes a navigator.locks deadlock that hangs all subsequent API calls.
      // See: https://github.com/supabase/auth-js/issues/762
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile in a separate effect to avoid navigator.locks deadlock
  useEffect(() => {
    if (user) {
      fetchProfile(user.id);
    }
  }, [user?.id]);

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // 퇴사 처리된 계정은 즉시 로그아웃
      if (data?.resigned_at) {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        window.location.href = '/login?resigned=1';
        return;
      }

      setProfile(data);
    } catch (err) {
      console.error('프로필 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // signOut API 실패해도 로컬 세션은 정리
    }
    setUser(null);
    setProfile(null);
    window.location.href = '/login';
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
