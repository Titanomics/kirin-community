import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}

// 계기판 데이터 읽기 (로그인한 직원 누구나)
export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get('team');
  if (!team) return NextResponse.json({ error: 'team required' }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('team_gauge')
    .select('payload')
    .eq('team', team)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payload: data?.payload ?? {} });
}

// 계기판 데이터 저장 (관리자만)
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 저장할 수 있습니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.team) return NextResponse.json({ error: 'team required' }, { status: 400 });

  const { error } = await supabase
    .from('team_gauge')
    .upsert({ team: body.team, payload: body.payload ?? {}, updated_at: new Date().toISOString() });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
