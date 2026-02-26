import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isAllowedIp(ip: string): boolean {
  const allowed = process.env.ALLOWED_ATTENDANCE_IPS || '';
  if (!allowed) return true; // 환경변수 미설정 시 개발 모드로 허용
  return allowed.split(',').map((s) => s.trim()).some((entry) => {
    // 끝이 '.'이면 대역(prefix) 매칭: '192.168.0.' → 192.168.0.* 전체 허용
    if (entry.endsWith('.')) return ip.startsWith(entry);
    return ip === entry;
  });
}

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

async function getAuthUser(request: NextRequest) {
  const cookieStore = await cookies();
  const anonClient = createServerClient(
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
  const { data: { user } } = await anonClient.auth.getUser();
  return user;
}

// GET: 현재 IP 허용 여부 + 오늘 출퇴근 상태 조회
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const allowed = isAllowedIp(ip);

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ allowed, ip, record: null });
  }

  const supabase = await createClient();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD

  const { data: record } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .single();

  return NextResponse.json({ allowed, ip, record: record || null });
}

// POST: 출근 / 퇴근 처리
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const allowed = isAllowedIp(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: '허용된 네트워크에서만 출퇴근이 가능합니다.', detected_ip: ip },
      { status: 403 }
    );
  }

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { action } = await request.json() as { action: 'check_in' | 'check_out' };
  const supabase = await createClient();
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  const { data: existing } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .single();

  if (action === 'check_in') {
    if (existing?.check_in) {
      return NextResponse.json({ message: '이미 출근 처리되었습니다.', record: existing });
    }
    const { data, error } = await supabase
      .from('attendance')
      .upsert(
        { user_id: user.id, date: today, check_in: now.toISOString(), check_in_ip: ip, status: 'checked_in' },
        { onConflict: 'user_id,date' }
      )
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ record: data });
  }

  if (action === 'check_out') {
    if (!existing?.check_in) {
      return NextResponse.json({ error: '출근 기록이 없습니다.' }, { status: 400 });
    }
    if (existing?.check_out) {
      return NextResponse.json({ message: '이미 퇴근 처리되었습니다.', record: existing });
    }
    const { data, error } = await supabase
      .from('attendance')
      .update({ check_out: now.toISOString(), check_out_ip: ip, status: 'checked_out' })
      .eq('user_id', user.id)
      .eq('date', today)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ record: data });
  }

  return NextResponse.json({ error: '잘못된 action입니다.' }, { status: 400 });
}
