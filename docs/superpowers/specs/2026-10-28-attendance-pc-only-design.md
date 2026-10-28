# 출퇴근 PC 전용화 1단계 설계 (모바일 차단 + DB 직접쓰기 차단)

작성일: 2026-10-28
대상 프로젝트: gesi ERP (Next.js 16 App Router + Supabase, Vercel 배포)
범위: 1~2겹 (네트워크 분리 + 모바일 소프트 차단). 회사 PC 에이전트(3겹)는 별도 설계로 후속.

---

## 1. 배경과 문제

직원이 출근길에 폰이 사내 WiFi에 자동 접속되면, 사무실 도착 전에 폰으로 출근 체크를 한다.

현재 `app/api/attendance/route.ts`의 방어는 두 겹이다.

1. `ALLOWED_ATTENDANCE_IPS` 환경변수와 요청 IP 비교. 사무실 공인 IP가 하나라 폰과 PC를 구분하지 못한다.
2. 클라이언트가 보낸 `frameStddev`(requestAnimationFrame 프레임 간격 표준편차)가 5ms를 넘으면 원격 데스크톱으로 보고 거부. 클라이언트가 값을 조작할 수 있고, 정상 PC도 부하·절전 상태에서 오탐이 난다. 보안 경계로 쓸 수 없다.

추가로 발견한 구멍: `attendance` 테이블 RLS에 `Users can insert own attendance`, `Users can update own attendance` 정책이 있어, 직원이 브라우저 개발자 도구에서 Supabase 클라이언트로 출근 시각을 직접 INSERT/UPDATE 할 수 있다. 서버 검증을 아무리 붙여도 이 경로가 열려 있으면 우회된다.

## 2. 목표

- 폰 브라우저에서 출퇴근 버튼이 동작하지 않는다 (서버가 거부, UI는 안내).
- 일반 직원의 `attendance` 쓰기는 서버 API만 가능하게 한다. 관리자는 기존 직접 쓰기(관리자 페이지)를 유지한다. 테이블 권한 REVOKE는 하지 않고 일반 사용자 정책 2개만 삭제한다.
- 신뢰할 수 없는 원격 감지 코드를 제거한다.
- `ALLOWED_ATTENDANCE_IPS` 누락 시 전체 허용되는 fail-open을 없앤다.
- 앱 구조·버전·배포 방식은 그대로 둔다. 변경 파일은 2개 + 마이그레이션 1개.

## 3. 비목표 (이번 범위 밖)

- 회사 PC 원격 접속(RDP, Chrome Remote Desktop, AnyDesk 등) 차단. 3겹째인 PC 에이전트 설계에서 다룬다.
- 폰 "데스크톱 모드" 완전 차단. UA 기반 판정은 소프트 가드다. 네트워크 분리(5절)가 이를 받친다.
- 관리자 페이지(`attendance-admin`)의 수정 기능 변경. admin 정책을 쓰므로 영향 없다.

## 4. 설계

### 4.1 서버: `app/api/attendance/route.ts`

**(a) 프레임 타이밍 원격 감지 제거**
- POST 바디의 `frameStddev` 파싱과 `> 5` 거부 분기를 삭제한다.

**(b) 모바일 판정 함수 `isMobileRequest(request)` 추가**

판정 순서. 하나라도 참이면 모바일.
1. `sec-ch-ua-mobile` 헤더가 `?1`
2. `sec-ch-ua-platform` 헤더가 `"Android"` 또는 `"iOS"` (따옴표 포함 값)
3. User-Agent가 정규식 `/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i`에 매칭

근거: Chromium 계열은 Accept-CH 없이도 저엔트로피 Client Hints(`Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`)를 HTTPS 요청에 기본 제공한다. 다만 생략될 수 있고 Safari·Firefox는 보내지 않으므로 UA로 폴백한다. 헤더 부재는 PC라는 증거가 아니다. 이 판정은 소프트 가드다.

- GET 응답에 `mobile: boolean` 필드를 추가한다. 기존 `allowed`, `ip`, `record`는 유지.
- POST에서 모바일이면 IP 검사 직후 다음으로 거부한다.
  ```json
  { "error": "모바일에서는 출퇴근이 불가합니다. 사무실 PC에서 진행해주세요." }  // 403
  ```

**(c) 쓰기를 service_role 클라이언트로 전환**
- 서버 전용 환경변수 `SUPABASE_SERVICE_ROLE_KEY`를 추가한다 (Vercel 프로젝트 환경변수 + 로컬 `.env.local`). `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
- `createAdminClient()`를 route 파일 내부에 추가한다. `@supabase/supabase-js`의 `createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })`.
- 사용자 인증(`getAuthUser`)은 기존대로 쿠키 기반 anon 클라이언트로 한다. 인증된 `user.id`로만 쓴다.
- POST의 `upsert`(check_in)와 `update`(check_out)만 admin 클라이언트로 수행한다. GET의 조회와 POST의 `existing` 조회는 기존 anon 클라이언트를 유지한다 (SELECT 정책은 남아 있으므로).
- 환경변수가 없으면 POST는 500 `{ error: '서버 설정 오류 (SUPABASE_SERVICE_ROLE_KEY 미설정)' }`로 명확히 실패한다. 조용히 anon으로 폴백하지 않는다.
- 코드 내 로컬 함수명이 `createClient`이므로 SDK import는 `import { createClient as createSupabaseClient } from '@supabase/supabase-js'`로 별칭을 쓴다.

**(d) IP 허용목록 fail-open 제거**
- 현재 `isAllowedIp`는 `ALLOWED_ATTENDANCE_IPS`가 비어 있으면 전부 허용한다. 배포 설정 누락 하나로 네트워크 방어가 사라지는 구조다.
- 변경: `process.env.VERCEL_ENV === 'production'`이고 허용목록이 비어 있으면 POST는 503 `{ error: '서버 설정 오류 (ALLOWED_ATTENDANCE_IPS 미설정)' }`, GET은 `allowed: false`. 로컬 개발·Preview(`VERCEL_ENV`가 `production`이 아님)에서는 기존처럼 허용한다.

**(e) `existing` 조회의 오류 처리 수정**
- 현재 POST는 `.single()` 결과의 `error`를 무시하고 `existing`이 null이면 "기록 없음"으로 본다. 0행이 아니라 실제 조회 오류(네트워크, RLS 변경 등)여도 같은 분기로 가서, service_role `upsert`가 **기존 출근 시각을 덮어쓸 수 있다**.
- 변경: `.maybeSingle()`로 0행을 정상 처리하고, `error`가 있으면 쓰기 없이 500으로 중단한다.

### 4.2 DB: 마이그레이션 `supabase/migrations/20261028000000_attendance_drop_user_write_policies.sql`

앱 저장소 안의 `supabase/migrations/`(병원 분석 기능이 쓰기 시작한 위치)에 둔다. 적용은 Supabase MCP `apply_migration` 또는 대시보드 SQL 편집기로 한다.

```sql
drop policy if exists "Users can insert own attendance" on public.attendance;
drop policy if exists "Users can update own attendance" on public.attendance;
```

유지하는 정책: `Users can view own attendance`, `Admin can view/insert/update/delete all attendance`, `Leader can view team attendance`.

적용 순서가 중요하다.

1. Vercel에 `SUPABASE_SERVICE_ROLE_KEY` 추가
2. 코드 배포
3. **새 코드로 실제 출근·퇴근이 성공하는지 확인** (service_role 쓰기 동작 확인)
4. 마이그레이션 적용 (두 정책 삭제)

역순이면 배포 사이에 출퇴근이 전부 실패한다. 롤백은 **정책 복원 → 이전 코드 배포** 순서다. 코드부터 되돌리면 일반 직원 쓰기가 실패한다.

이전 배포 URL(구버전 코드)은 빌드 시점에 `SUPABASE_SERVICE_ROLE_KEY`가 없었으므로, 정책 삭제 후에는 쓰기가 실패한다. 즉 모바일 검사 없는 구버전이 우회 경로가 되지는 않는다. 배포 후 이전 배포 URL에서 출근 시도가 거부되는지 1회 확인한다.

### 4.3 클라이언트: `app/(main)/attendance/page.tsx`

- `detectRemoteDesktop` 함수와 `handleAction` 내 호출, `frameStddev` 전송을 삭제한다.
- 상태 `mobile: boolean` 추가. `fetchData`에서 GET 응답의 `json.mobile`을 저장한다.
- 클라이언트 보완 판정: `navigator.userAgent`에 `Macintosh`가 있고 `navigator.maxTouchPoints > 1`이면 iPad 데스크톱 모드로 보고 `mobile = true`. 서버는 이 경우를 못 잡으므로 UI 안내 목적이다.
- `mobile`이 true면:
  - 출근/퇴근 버튼 `disabled`
  - 기존 "회사 WiFi에서만 출퇴근이 가능합니다" 안내 자리에 "사무실 PC에서만 출퇴근이 가능합니다" 문구를 우선 표시
- 헤더의 네트워크 배지(사내 네트워크 ✓ / 외부 네트워크 ✕)는 그대로 둔다.

### 4.4 환경변수 정리

| 이름 | 위치 | 용도 |
|---|---|---|
| `ALLOWED_ATTENDANCE_IPS` | Vercel | 기존. 사무실 공인 IP |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + `.env.local` | 신규. 서버 전용 쓰기 |

`.env.local`은 이미 `.gitignore`에 포함되어 있는지 확인하고, 없으면 추가한다.

## 5. 네트워크 분리 (코드 변경 없음, 운영 가이드)

UA 판정은 폰 데스크톱 모드로 우회된다. 아래 운영 조치가 그 빈틈을 받친다.

핵심 원칙: **폰이 붙을 수 있는 어떤 WiFi도 허용 공인 IP로 ERP에 닿으면 안 된다.** 게스트 SSID가 PC망과 같은 공인 IP로 나가면, PC망 비밀번호를 바꿔도 폰은 게스트망에서 허용 IP로 접근한다.

두 가지 중 하나를 택한다.

- **방식 1 (게스트 WiFi 없음):** 사내 WiFi 비밀번호를 변경하고 직원에게 알리지 않는다. PC는 유선 또는 그 SSID로 연결한다. 직원 폰은 LTE를 쓴다. LTE 접속은 기존 `ALLOWED_ATTENDANCE_IPS`가 막는다.
- **방식 2 (게스트 WiFi 제공):** 방식 1에 더해 게스트 SSID를 만들고, 게스트망에서 ERP 접근을 실제로 차단한다. 공유기 방화벽/URL 필터로 커스텀 도메인과 `*.vercel.app`을 차단하거나, 게스트망을 허용목록에 없는 별도 공인 IP로 내보낸다. DNS 차단만으로는 부족할 수 있으므로 **폰을 게스트망에 붙여 실제 HTTPS로 ERP를 열어 보고 차단을 확인**한다.

## 6. 막는 것 / 못 막는 것

| 경로 | 결과 |
|---|---|
| 폰 브라우저(일반 모드)로 출석 | 서버 403 + UI 비활성 |
| 폰 데스크톱 모드 + 사내 WiFi | UA로는 못 막음. 5절 네트워크 분리로 WiFi 자체를 못 잡게 함 |
| 폰 데스크톱 모드 + LTE | IP 허용목록이 막음 |
| 개발자 도구에서 Supabase 직접 INSERT/UPDATE | RLS 거부 |
| 회사 PC 원격 접속 | 못 막음. 3겹째(에이전트) 후속 |
| 운영 환경변수 누락 | 전체 허용 대신 명확한 실패 |

## 7. 검증

테스트 프레임워크가 없으므로 `npm run build` 통과 + 수동 확인.

1. PC 크롬, 사무실 네트워크: GET `mobile: false`, 출근/퇴근 정상.
2. 폰 크롬(Android), 폰 사파리(iOS): GET `mobile: true`, 버튼 비활성, 강제 POST 시 403.
3. 아이패드 사파리 데스크톱 모드: UI 비활성 (서버는 통과할 수 있음, 알려진 한계).
4. 직원 계정으로 브라우저 콘솔에서 `supabase.from('attendance').insert(...)`: RLS 에러. `update(...)`는 오류 없이 0행으로 끝날 수 있으므로 **실제 값이 안 바뀌었는지** 재조회로 확인.
5. 관리자 페이지: 신규 행 upsert, 기존 행 수정, 삭제 모두 기존대로 동작.
6. `SUPABASE_SERVICE_ROLE_KEY` 제거 후 POST: 500 명확 실패.
7. 운영에서 `ALLOWED_ATTENDANCE_IPS`를 비운 상태로 POST: 503 명확 실패 (로컬에서는 `VERCEL_ENV=production`을 임시로 넣어 확인).
8. 이미 출근한 상태에서 조회 오류를 흉내 내 다시 출근 POST: 기존 출근 시각이 덮어써지지 않음.
9. 이전 배포 URL에서 출근 시도: 거부.

사전 확인 완료: 운영 DB의 `attendance` 쓰기 정책은 본 문서의 8개가 전부이며, 테이블은 서버 API와 관리자 페이지만 쓴다 (2026-10-28 조회).

## 8. 롤백

- 코드: 이전 커밋으로 revert.
- DB: 삭제한 두 정책을 원래 정의로 재생성.
  ```sql
  create policy "Users can insert own attendance" on public.attendance for insert with check (auth.uid() = user_id);
  create policy "Users can update own attendance" on public.attendance for update using (auth.uid() = user_id);
  ```

## 9. 후속 (별도 설계)

3겹째: 회사 PC 10대에 각각 설치하는 로컬 에이전트. 서버 챌린지 + PC별 키 서명 + RDP/잠금 세션 거부. 사용자 결정: 전용 PC 1대가 아니라 직원 PC 각각 설치.
