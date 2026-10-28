# 출퇴근 PC 전용화 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출퇴근 API가 모바일 요청을 거부하고, 일반 직원의 attendance 직접 쓰기를 RLS로 막고, 신뢰 불가한 프레임 타이밍 원격 감지와 IP 허용목록 fail-open을 제거한다.

**Architecture:** 판정 로직(모바일 헤더, IP 허용목록, iPad 데스크톱 모드)을 순수 함수 모듈 `lib/attendance/policy.ts`로 분리해 `node:test`로 검증한다. `app/api/attendance/route.ts`는 이 모듈을 쓰고, 쓰기만 service_role 클라이언트로 수행한다. 출석 페이지는 서버가 준 `mobile` 플래그로 버튼을 잠근다. DB는 일반 사용자 INSERT/UPDATE 정책 2개만 삭제한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@supabase/ssr`, `@supabase/supabase-js`, Node 24 `node:test` (`.ts` 네이티브 import), Supabase MCP `apply_migration`.

**설계 문서:** `docs/superpowers/specs/2026-10-28-attendance-pc-only-design.md`

---

## 파일 구조

- `lib/attendance/policy.ts` (신규) — 순수 판정 함수 3개. 브라우저·서버 양쪽에서 import 가능 (DOM/Node API 사용 안 함).
- `tests/attendance/policy.test.mjs` (신규) — `node:test`로 위 함수 검증. 기존 `tests/analytics/scope.test.mjs` 패턴을 따른다.
- `package.json` (수정) — `"test": "node --test"` 스크립트 추가.
- `app/api/attendance/route.ts` (수정) — 프레임 감지 제거, policy 모듈 사용, admin 클라이언트 쓰기, `maybeSingle` 오류 처리.
- `app/(main)/attendance/page.tsx` (수정) — 원격 감지 제거, `mobile` 상태로 버튼 잠금 + 안내.
- `supabase/migrations/20261028000000_attendance_drop_user_write_policies.sql` (신규) — 정책 2개 삭제.

검증 명령: `npm test` (순수 함수), `npm run build` (타입·빌드), 배포 후 수동 확인(설계 문서 7절).

---

### Task 1: 판정 순수 함수 + 테스트

**Files:**
- Create: `lib/attendance/policy.ts`
- Create: `tests/attendance/policy.test.mjs`
- Modify: `package.json` (scripts)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/attendance/policy.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileHeaders, resolveIpPolicy, isIpadDesktopMode } from '../../lib/attendance/policy.ts';

function headers(map) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

const PC_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

test('isMobileHeaders: sec-ch-ua-mobile ?1 이면 모바일', () => {
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-mobile': '?1', 'user-agent': PC_CHROME_UA })), true);
});

test('isMobileHeaders: sec-ch-ua-platform Android/iOS 이면 모바일', () => {
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Android"', 'user-agent': PC_CHROME_UA })), true);
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-platform': '"iOS"' })), true);
});

test('isMobileHeaders: Client Hints 없으면 UA로 폴백', () => {
  assert.equal(isMobileHeaders(headers({ 'user-agent': ANDROID_UA })), true);
  assert.equal(isMobileHeaders(headers({ 'user-agent': IPHONE_UA })), true);
});

test('isMobileHeaders: PC 크롬은 모바일 아님', () => {
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'user-agent': PC_CHROME_UA })), false);
});

test('isMobileHeaders: 헤더가 전혀 없으면 모바일 아님 (소프트 가드)', () => {
  assert.equal(isMobileHeaders(headers({})), false);
});

test('resolveIpPolicy: 정확히 일치하는 IP 허용', () => {
  assert.deepEqual(resolveIpPolicy('1.2.3.4', '1.2.3.4, 5.6.7.8', 'production'), { allowed: true, configured: true });
  assert.deepEqual(resolveIpPolicy('9.9.9.9', '1.2.3.4, 5.6.7.8', 'production'), { allowed: false, configured: true });
});

test('resolveIpPolicy: 끝이 점이면 대역 prefix 매칭', () => {
  assert.equal(resolveIpPolicy('192.168.0.77', '192.168.0.', 'production').allowed, true);
  assert.equal(resolveIpPolicy('192.168.1.77', '192.168.0.', 'production').allowed, false);
});

test('resolveIpPolicy: 운영에서 허용목록 비어 있으면 거부 + configured false', () => {
  assert.deepEqual(resolveIpPolicy('1.2.3.4', undefined, 'production'), { allowed: false, configured: false });
  assert.deepEqual(resolveIpPolicy('1.2.3.4', '  ', 'production'), { allowed: false, configured: false });
});

test('resolveIpPolicy: 운영이 아니면 허용목록 비어 있어도 허용', () => {
  assert.deepEqual(resolveIpPolicy('1.2.3.4', undefined, undefined), { allowed: true, configured: false });
  assert.deepEqual(resolveIpPolicy('1.2.3.4', '', 'preview'), { allowed: true, configured: false });
});

test('isIpadDesktopMode: Mac UA + 터치포인트 있으면 iPad 데스크톱 모드', () => {
  assert.equal(isIpadDesktopMode(MAC_UA, 5), true);
  assert.equal(isIpadDesktopMode(MAC_UA, 0), false);
  assert.equal(isIpadDesktopMode(PC_CHROME_UA, 10), false);
});
```

- [ ] **Step 2: 테스트 스크립트 추가**

`package.json`의 `scripts`에 추가:
```json
"test": "node --test"
```
결과:
```json
"scripts": {
  "predev": "node scripts/analytics-version.mjs",
  "dev": "next dev",
  "prebuild": "node scripts/analytics-version.mjs",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "node --test"
}
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `npm test`
Expected: `tests/attendance/policy.test.mjs` 가 `Cannot find module ... policy.ts` 로 FAIL. 기존 `tests/analytics/scope.test.mjs`는 PASS.

- [ ] **Step 4: 구현**

`lib/attendance/policy.ts`:
```ts
// 출퇴근 요청 판정 순수 함수. 브라우저·서버 양쪽에서 import 가능 (DOM/Node API 사용 금지).

export interface HeaderReader {
  get(name: string): string | null;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i;
const MOBILE_PLATFORMS = new Set(['"Android"', '"iOS"']);

// Chromium 계열은 저엔트로피 Client Hints를 HTTPS 요청에 기본 제공한다 (생략될 수 있음).
// Safari·Firefox는 보내지 않으므로 UA로 폴백한다. 헤더 부재는 PC라는 증거가 아니다 (소프트 가드).
export function isMobileHeaders(headers: HeaderReader): boolean {
  if (headers.get('sec-ch-ua-mobile') === '?1') return true;
  const platform = headers.get('sec-ch-ua-platform');
  if (platform && MOBILE_PLATFORMS.has(platform.trim())) return true;
  return MOBILE_UA.test(headers.get('user-agent') || '');
}

export interface IpPolicy {
  allowed: boolean;
  configured: boolean; // 허용목록 환경변수가 설정되어 있는지
}

// allowedEnv: ALLOWED_ATTENDANCE_IPS ("1.2.3.4, 192.168.0." 형식. 끝이 '.'이면 prefix 매칭)
// vercelEnv: VERCEL_ENV. 'production'에서 허용목록이 비어 있으면 거부(fail-closed). 그 외는 개발 편의로 허용.
export function resolveIpPolicy(ip: string, allowedEnv: string | undefined, vercelEnv: string | undefined): IpPolicy {
  const entries = (allowedEnv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    return { allowed: vercelEnv !== 'production', configured: false };
  }
  const allowed = entries.some((entry) => (entry.endsWith('.') ? ip.startsWith(entry) : ip === entry));
  return { allowed, configured: true };
}

// iPadOS Safari "데스크톱 웹사이트 요청" 모드는 Mac UA를 보내지만 터치포인트가 있다. 클라이언트 UI 안내용.
export function isIpadDesktopMode(userAgent: string, maxTouchPoints: number): boolean {
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: `pass 11, fail 0` (attendance 10개 + analytics 1개).

- [ ] **Step 6: 커밋**

```bash
git add lib/attendance/policy.ts tests/attendance/policy.test.mjs package.json
git commit -m "feat(attendance): 모바일/IP/iPad 판정 순수 함수 + node:test"
```

---

### Task 2: 출퇴근 API 수정

**Files:**
- Modify: `app/api/attendance/route.ts` (전체 교체)

- [ ] **Step 1: route.ts 전체를 아래로 교체**

```ts
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
```

- [ ] **Step 2: 로컬 환경변수 추가**

`.env.local`에 한 줄 추가 (값은 Supabase 대시보드 → Project Settings → API → `service_role` secret):
```
SUPABASE_SERVICE_ROLE_KEY=<service_role 키>
```
`.env*`는 `.gitignore`에 이미 포함되어 있다. 커밋되지 않는지 `git status`로 확인한다.

- [ ] **Step 3: 빌드 통과 확인**

Run: `npm run build`
Expected: 타입 오류 없이 `✓ Compiled successfully`. 아래 grep 결과가 비어야 한다:
```bash
grep -n "frameStddev\|isAllowedIp\|getAuthUser" app/api/attendance/route.ts
```

- [ ] **Step 4: 커밋**

```bash
git add app/api/attendance/route.ts
git commit -m "feat(attendance): API 모바일 거부 + service_role 쓰기 + IP fail-closed + 프레임 감지 제거"
```

---

### Task 3: 출석 페이지 수정

**Files:**
- Modify: `app/(main)/attendance/page.tsx`

- [ ] **Step 1: import 추가**

파일 상단 `import { getTodayCoreValue, getTodayCoreValueIndex, isGracePeriod } from '@/lib/coreValues';` 아래에 추가:
```ts
import { isIpadDesktopMode } from '@/lib/attendance/policy';
```

- [ ] **Step 2: `mobile` 상태 추가**

`const [detectedIp, setDetectedIp] = useState<string | null>(null);` 아래에 추가:
```ts
const [mobile, setMobile] = useState(false);
```

- [ ] **Step 3: fetchData에서 mobile 저장**

`fetchData` 안의 `setDetectedIp(json.ip || null);` 아래에 추가:
```ts
setMobile(Boolean(json.mobile) || isIpadDesktopMode(navigator.userAgent, navigator.maxTouchPoints));
```

- [ ] **Step 4: 원격 데스크톱 감지 삭제**

`// requestAnimationFrame 프레임 타이밍으로 원격 데스크톱 감지` 주석부터 `detectRemoteDesktop` 함수의 닫는 `}`까지 통째로 삭제한다.

- [ ] **Step 5: handleAction 단순화**

`handleAction` 전체를 아래로 교체:
```ts
async function handleAction(action: 'check_in' | 'check_out') {
  setActionLoading(true);
  try {
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || '처리 실패');
      return;
    }
    setTodayRecord(json.record);
    await fetchData();
  } catch {
    alert('네트워크 오류가 발생했습니다.');
  } finally {
    setActionLoading(false);
  }
}
```

- [ ] **Step 6: 버튼 잠금 + 안내 문구**

`const status = getStatusLabel(todayRecord, now);` 아래에 추가:
```ts
const canAct = Boolean(allowed) && !mobile;
```

JSX의 `{/* 출퇴근 버튼 */}` 블록에서 기존 `{!allowed && (<p ...>회사 WiFi에서만 출퇴근이 가능합니다</p>)}` 를 아래로 교체:
```tsx
{mobile ? (
  <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-700 text-center">
    사무실 PC에서만 출퇴근이 가능합니다
  </p>
) : !allowed ? (
  <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-700 text-center">
    회사 WiFi에서만 출퇴근이 가능합니다
  </p>
) : null}
```

두 버튼의 `disabled`를 수정:
- 출근: `disabled={!canAct || !!todayRecord?.check_in || actionLoading}`
- 퇴근: `disabled={!canAct || !todayRecord?.check_in || !!todayRecord?.check_out || actionLoading}`

- [ ] **Step 7: 빌드 통과 확인**

Run: `npm run build`
Expected: 성공. 아래 grep 결과가 비어야 한다:
```bash
grep -n "detectRemoteDesktop\|frameStddev" "app/(main)/attendance/page.tsx"
```

- [ ] **Step 8: 로컬 수동 확인**

Run: `npm run dev` 후 `http://localhost:3000/attendance`
- PC 크롬: 버튼 활성, 출근 클릭 → 핵심가치 모달 → 출근 시각 표시.
- PC 크롬 DevTools → Device toolbar로 Galaxy/iPhone 에뮬레이션 후 새로고침: "사무실 PC에서만 출퇴근이 가능합니다" + 버튼 비활성. (에뮬레이션은 UA와 `Sec-CH-UA-Mobile`을 바꾼다.)
- 콘솔에서 강제 호출:
  ```js
  fetch('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check_in' }) }).then(r => r.json()).then(console.log)
  ```
  모바일 에뮬레이션 상태에서 `{ error: '모바일에서는 출퇴근이 불가합니다. ...' }`.

- [ ] **Step 9: 커밋**

```bash
git add "app/(main)/attendance/page.tsx"
git commit -m "feat(attendance): 모바일이면 버튼 잠금 + 안내, 프레임 원격 감지 제거"
```

---

### Task 4: 마이그레이션 파일 작성 (적용은 Task 5)

**Files:**
- Create: `supabase/migrations/20261028000000_attendance_drop_user_write_policies.sql`

- [ ] **Step 1: 파일 작성**

```sql
-- 일반 직원의 attendance 직접 INSERT/UPDATE 차단. 쓰기는 서버 API(service_role)만 한다.
-- 조회 정책과 admin/leader 정책은 유지한다. 테이블 권한 REVOKE는 하지 않는다.
-- 적용 전제: SUPABASE_SERVICE_ROLE_KEY가 운영에 설정되고 새 API 코드가 배포·검증된 상태.
drop policy if exists "Users can insert own attendance" on public.attendance;
drop policy if exists "Users can update own attendance" on public.attendance;
```

- [ ] **Step 2: 커밋 + 푸시**

```bash
git add supabase/migrations/20261028000000_attendance_drop_user_write_policies.sql
git commit -m "db(attendance): 일반 사용자 INSERT/UPDATE 정책 삭제 마이그레이션 (적용은 배포 검증 후)"
git push origin main
```

---

### Task 5: 배포 → 검증 → 정책 삭제 (순서 엄수)

**Files:** 없음 (운영 작업)

- [ ] **Step 1: Vercel 환경변수 추가 (사용자 작업)**

Vercel 프로젝트 → Settings → Environment Variables → `SUPABASE_SERVICE_ROLE_KEY` (Production 환경에 추가, Preview는 선택). `ALLOWED_ATTENDANCE_IPS`가 Production에 설정되어 있는지도 함께 확인한다. 비어 있으면 배포 후 모든 출퇴근이 503으로 막힌다.

- [ ] **Step 2: 배포**

Task 4의 `git push origin main`으로 Vercel 자동 배포. 환경변수를 Step 1 이후에 넣었으면 Vercel에서 Redeploy 한 번 더.

- [ ] **Step 3: 새 코드로 출퇴근 성공 확인 (정책 삭제 전)**

사무실 PC 크롬에서 출근 또는 퇴근 1회 실제 수행. 성공해야 service_role 쓰기가 동작하는 것이다. 실패하면 Step 1의 키를 다시 확인하고, 정책 삭제로 넘어가지 않는다.

- [ ] **Step 4: 정책 삭제 적용**

Supabase MCP `apply_migration` (name: `attendance_drop_user_write_policies`, query: Task 4 파일 내용) 또는 대시보드 SQL 편집기에서 같은 SQL 실행.

확인 쿼리:
```sql
select policyname, cmd from pg_policies where schemaname='public' and tablename='attendance' order by cmd, policyname;
```
Expected: `Users can insert own attendance`, `Users can update own attendance` 없음. 나머지 6개(Admin delete/insert/update/view, Leader view, Users view) 유지.

- [ ] **Step 5: 운영 수동 검증 (설계 문서 7절)**

1. 사무실 PC 크롬: 출근·퇴근 정상.
2. 폰 크롬(Android)·폰 사파리(iOS)로 ERP 접속: 버튼 비활성 + "사무실 PC에서만" 안내. 콘솔 강제 POST → 403.
3. 직원 계정 PC 크롬에서 직접 쓰기: Network 탭에서 기존 `rest/v1/attendance` 요청을 "Copy as fetch"로 복사해 method를 POST(INSERT)로 바꿔 재전송 → 42501 RLS 에러. PATCH(UPDATE)는 오류 없이 0행일 수 있으므로 새로고침해 `check_in` 값이 그대로인지 확인.
4. 관리자 페이지(`/attendance-admin`): 신규 행 추가, 기존 행 수정, 삭제 정상.
5. 이전 배포 URL(Vercel Deployments 목록의 직전 배포)에서 출근 시도: 거부(구버전은 service_role 키 없이 빌드됨 + 정책 삭제됨).

- [ ] **Step 6: 네트워크 분리 (사용자 운영 작업, 설계 문서 5절)**

- 사내 WiFi 비밀번호 변경, 직원 미공유. PC는 유선 또는 새 비밀번호로 연결.
- 게스트 SSID를 두는 경우: 게스트망에서 ERP(커스텀 도메인 + `*.vercel.app`) 차단 또는 별도 공인 IP. 폰을 게스트망에 붙여 실제 HTTPS로 ERP가 안 열리는지 확인.

---

## 롤백

정책 복원 → 이전 코드 배포 순서. 코드부터 되돌리면 일반 직원 쓰기가 실패한다.
```sql
create policy "Users can insert own attendance" on public.attendance for insert with check (auth.uid() = user_id);
create policy "Users can update own attendance" on public.attendance for update using (auth.uid() = user_id);
```
