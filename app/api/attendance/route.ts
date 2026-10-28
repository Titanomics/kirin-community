import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { isMobileHeaders, resolveIpPolicy } from '@/lib/attendance/policy';

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function evaluateRequest(request: NextRequest) {
  const ip = getClientIp(request);
  const ipPolicy = resolveIpPolicy(ip, process.env.ALLOWED_ATTENDANCE_IPS, process.env.VERCEL_ENV);
  const mobile = isMobileHeaders(request.headers);
  return { ip, ipPolicy, mobile };
}

// 로그인 사용자 세션(쿠키) 기반 클라이언트. 인증 확인과 조회에만 쓴다.
async function createUserClient() {
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

// 서버 전용 service_role 클라이언트. attendance 쓰기에만 쓴다. 사용자 세션을 섞지 않는다.
function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function kstToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
}

// GET: 현재 IP 허용 여부 + 모바일 여부 + 오늘 출퇴근 상태 조회
export async function GET(request: NextRequest) {
  const { ip, ipPolicy, mobile } = evaluateRequest(request);
  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ allowed: ipPolicy.allowed, mobile, ip, record: null });
  }

  const { data: record } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', kstToday())
    .maybeSingle();

  return NextResponse.json({ allowed: ipPolicy.allowed, mobile, ip, record: record ?? null });
}

// POST: 출근 / 퇴근 처리
export async function POST(request: NextRequest) {
  const { ip, ipPolicy, mobile } = evaluateRequest(request);

  if (!ipPolicy.configured && !ipPolicy.allowed) {
    return NextResponse.json({ error: '서버 설정 오류 (ALLOWED_ATTENDANCE_IPS 미설정)' }, { status: 503 });
  }
  if (!ipPolicy.allowed) {
    return NextResponse.json(
      { error: '허용된 네트워크에서만 출퇴근이 가능합니다.', detected_ip: ip },
      { status: 403 }
    );
  }
  if (mobile) {
    return NextResponse.json(
      { error: '모바일에서는 출퇴근이 불가합니다. 사무실 PC에서 진행해주세요.' },
      { status: 403 }
    );
  }

  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: '서버 설정 오류 (SUPABASE_SERVICE_ROLE_KEY 미설정)' }, { status: 500 });
  }

  const { action } = (await request.json()) as { action: 'check_in' | 'check_out' };
  const now = new Date();
  const today = kstToday(now);

  // 조회 오류를 "기록 없음"으로 보면 service_role upsert가 기존 출근 시각을 덮어쓸 수 있다. 오류면 중단.
  const { data: existing, error: existingError } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: '출퇴근 기록 조회에 실패했습니다.' }, { status: 500 });
  }

  if (action === 'check_in') {
    if (existing?.check_in) {
      return NextResponse.json({ message: '이미 출근 처리되었습니다.', record: existing });
    }
    const { data, error } = await admin
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
    const { data, error } = await admin
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
