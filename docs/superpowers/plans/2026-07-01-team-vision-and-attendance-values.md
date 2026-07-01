# 팀 비전 + 출석 핵심가치 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gesi ERP에 (1) 팀별 비전 페이지와 (2) 출근 시 핵심가치 팝업을 추가한다.

**Architecture:** 기존 `profiles.team`(커머스팀/콘텐츠팀)과 `useAuth()`를 재활용한다. 팀 비전은 새 라우트 `/team-vision`에 팀별 React 컴포넌트로, 핵심가치는 날짜 기반 전사 공통 인덱스를 계산해 출근 성공 직후 모달로 띄운다.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Supabase, date-fns, date-holidays, lucide-react.

**검증 방식:** 이 프로젝트엔 테스트 프레임워크가 없다. 각 Task는 `npm run build`(타입·빌드 통과) + `npm run dev` 후 브라우저 수동 확인으로 검증한다.

---

## 파일 구조

- `lib/coreValues.ts` (신규) — 핵심가치 9쌍 데이터 + 오늘의 인덱스 계산 함수. 순수 함수라 단독 테스트 가능.
- `app/(main)/attendance/CoreValueModal.tsx` (신규) — 핵심가치 팝업 UI.
- `app/(main)/attendance/page.tsx` (수정) — 출근 성공 직후 모달 오픈.
- `app/(main)/team-vision/CommerceVision.tsx` (신규) — 커머스팀 공유용 비전.
- `app/(main)/team-vision/ContentVision.tsx` (신규) — 콘텐츠팀 공유용 비전.
- `app/(main)/team-vision/page.tsx` (신규) — 팀 인식 + 관리자 토글 + 해당 컴포넌트 렌더.
- `components/Sidebar.tsx` (수정) — `우리 팀 비전` 메뉴 추가.

---

## Task 1: 핵심가치 데이터 + 오늘의 인덱스 계산

**Files:**
- Create: `lib/coreValues.ts`

- [ ] **Step 1: 데이터 + 계산 함수 작성**

`lib/coreValues.ts`:
```typescript
export interface CoreValue {
  category: '전문성' | '대중성' | '역동성';
  do: string;
  dont: string;
}

// 9쌍 순환 (전문성 3 · 대중성 3 · 역동성 3)
export const CORE_VALUES: CoreValue[] = [
  { category: '전문성', do: '기획 먼저 — 의도와 예상 결과를 정하고 시작', dont: '같은 실수 반복 — 같은 피드백 2번 이상' },
  { category: '전문성', do: '내 결과물은 내 얼굴 — 검수 전 셀프 완벽검증', dont: '과정 호소 — "밤샜는데…"로 낮은 퀄리티 합리화' },
  { category: '전문성', do: '시간은 신뢰 — 못 지킬 것 같으면 미리 공유', dont: '문제 은폐 — 혼자 끙끙대다 골든타임 놓침' },
  { category: '대중성', do: '고객 집착 — 리뷰·CS·CTR이 최고 의사결정 근거', dont: '공급자 마인드 — 데이터는 No인데 "내 감엔 멋있다"' },
  { category: '대중성', do: '눈높이 번역 — 중학생도 이해하는 말로', dont: '고객 무시 — 불만 고객을 진상 취급' },
  { category: '대중성', do: '선제적 제안 — "이거 필요하시죠?"', dont: '시장성 무시 — 안 팔리는 예술/학문 탐구' },
  { category: '역동성', do: 'R&R 초월 — "제가 해보겠습니다"', dont: '수동적 태도 — 시키는 일만 기계적으로' },
  { category: '역동성', do: 'Solution 지향 — 해결책까지 들고 와서 보고', dont: '핑계 — "지시 없어서", "내 담당 아니라서"' },
  { category: '역동성', do: 'Agile & Trend — 80점이라도 오늘 출시, 오늘 밈을 내일 콘텐츠에', dont: '굼뜬 태도 — 시장 바뀌었는데 "원래 계획대로" 고집' },
];

export const CORE_VALUE_START = new Date(2026, 6, 1); // 2026-07-01 (월=6)

// 시작일부터 today까지의 평일 수 기준으로 그날의 인덱스(0~8) 반환.
// 주말(토·일)은 건너뛴다. 공휴일 반영은 후순위.
export function getTodayCoreValueIndex(today: Date = new Date()): number {
  const start = CORE_VALUE_START;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (t < start) return 0;
  let weekdays = 0;
  const cur = new Date(start);
  while (cur <= t) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) weekdays++;
    cur.setDate(cur.getDate() + 1);
  }
  return (Math.max(1, weekdays) - 1) % CORE_VALUES.length;
}

export function getTodayCoreValue(today: Date = new Date()): CoreValue {
  return CORE_VALUES[getTodayCoreValueIndex(today)];
}
```

- [ ] **Step 2: 계산 로직 임시 검증 (콘솔)**

프로젝트 루트에서 임시 확인:
```bash
node -e "const {getTodayCoreValueIndex}=require('./lib/coreValues.ts')" 2>/dev/null || echo "TS는 node 직접 실행 불가 — Step 3 빌드로 검증"
```
대신 논리 검증: 2026-07-01(수)=인덱스 0, 7-02(목)=1, 7-03(금)=2, 7-04(토)·05(일) 스킵, 7-06(월)=3. 코드가 이 순서를 만드는지 눈으로 확인.

- [ ] **Step 3: 빌드로 타입 검증**

Run: `npm run build`
Expected: 타입 에러 없이 빌드 성공 (`lib/coreValues.ts` 관련 에러 0).

- [ ] **Step 4: Commit**

```bash
git add lib/coreValues.ts
git commit -m "feat: 핵심가치 9쌍 데이터 + 날짜 기반 인덱스 계산"
```

---

## Task 2: 출석 핵심가치 모달

**Files:**
- Create: `app/(main)/attendance/CoreValueModal.tsx`
- Modify: `app/(main)/attendance/page.tsx`

- [ ] **Step 1: 모달 컴포넌트 작성**

`app/(main)/attendance/CoreValueModal.tsx`:
```tsx
'use client';

import { CoreValue } from '@/lib/coreValues';
import { CheckCircle2, XCircle, Sparkles } from 'lucide-react';

const categoryColor: Record<CoreValue['category'], string> = {
  전문성: 'from-blue-500 to-blue-600',
  대중성: 'from-emerald-500 to-emerald-600',
  역동성: 'from-amber-500 to-amber-600',
};

export default function CoreValueModal({ value, onClose }: { value: CoreValue; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2 text-sm font-bold tracking-widest text-gray-400">
          <Sparkles className="h-4 w-4" /> 오늘의 핵심가치
        </div>
        <div className={`mb-5 inline-block rounded-full bg-gradient-to-r ${categoryColor[value.category]} px-4 py-1 text-sm font-bold text-white`}>
          {value.category}
        </div>
        <div className="space-y-3">
          <div className="rounded-xl bg-green-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold text-green-700">
              <CheckCircle2 className="h-4 w-4" /> DO
            </div>
            <p className="text-sm text-gray-800">{value.do}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold text-red-700">
              <XCircle className="h-4 w-4" /> DON'T
            </div>
            <p className="text-sm text-gray-800">{value.dont}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          확인
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: attendance 페이지에 연결**

`app/(main)/attendance/page.tsx` 수정:
1. 상단 import 추가:
```tsx
import CoreValueModal from './CoreValueModal';
import { getTodayCoreValue } from '@/lib/coreValues';
```
2. 컴포넌트 내부 state 추가 (기존 `const [actionLoading, setActionLoading] = useState(false);` 아래):
```tsx
const [showCoreValue, setShowCoreValue] = useState(false);
```
3. `handleAction` 함수 안에서, `check_in` 성공 후 모달 오픈. 기존:
```tsx
      setTodayRecord(json.record);
      await fetchData();
```
를 이렇게 변경:
```tsx
      setTodayRecord(json.record);
      if (action === 'check_in') setShowCoreValue(true);
      await fetchData();
```
4. 최상위 return의 최상단(`<div className="space-y-6 max-w-2xl mx-auto">` 바로 다음 줄)에 모달 추가:
```tsx
      {showCoreValue && (
        <CoreValueModal value={getTodayCoreValue()} onClose={() => setShowCoreValue(false)} />
      )}
```

- [ ] **Step 3: 빌드 검증**

Run: `npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: 브라우저 수동 확인**

Run: `npm run dev` → `http://localhost:3000/attendance` 접속.
Expected: `출근하기` 버튼 클릭(사내망 조건 충족 시) → 출근 완료 → 「오늘의 핵심가치」 모달 표시 → 확인 누르면 닫힘. 퇴근에는 안 뜸.
※ 사내망 조건으로 출근이 막히면, 임시로 `handleAction` 성공 분기 대신 버튼 onClick에 `setShowCoreValue(true)`를 잠깐 걸어 모달만 눈으로 확인 후 원복.

- [ ] **Step 5: Commit**

```bash
git add "app/(main)/attendance/CoreValueModal.tsx" "app/(main)/attendance/page.tsx"
git commit -m "feat: 출근 체크인 시 오늘의 핵심가치 모달"
```

---

## Task 3: 공유용 팀 비전 컴포넌트 2개

**Files:**
- Create: `app/(main)/team-vision/CommerceVision.tsx`
- Create: `app/(main)/team-vision/ContentVision.tsx`

**콘텐츠 소스 및 제외 규칙:**
- 소스: `C:\Users\김경록\iCloudDrive\iCloud~md~obsidian\03-projects\kirin-os.html`(커머스팀), `content-team-os.html`(콘텐츠팀).
- **포함 섹션만 옮긴다:** 미션 / 5년 비전·목표 / 핵심가치(전문성·대중성·역동성 + DO/DON'T) / 분기 짱돌(팀 공동) / 책임조직도(자리+담당자 이름).
- **반드시 제외:** 직원별 핵심숫자·KPI 3축, 기본급·성과급·복리후생·서명란, 인사 변동 박스(연봉 인상·신혼여행 등), 개인 열정지점·성과급 트리거.

- [ ] **Step 1: 커머스팀 비전 컴포넌트 작성**

`app/(main)/team-vision/CommerceVision.tsx` — `kirin-os.html`의 포함 섹션을 Tailwind 카드 레이아웃으로 옮긴다. 상단부터: ① 미션 한 줄 ② 5년 비전(영업이익 100억·브랜드 10개 등) ③ 핵심가치 3개 카드(각 DO/DON'T) ④ Q3 분기 짱돌 목록(팀 공동, 담당자 이름은 표기하되 성과급·KPI 숫자는 제외) ⑤ 책임조직도(자리+담당자 이름). export default 컴포넌트 하나.

```tsx
export default function CommerceVision() {
  return (
    <div className="space-y-6">
      {/* ① 미션 / ② 5년비전 / ③ 핵심가치 / ④ Q3 짱돌 / ⑤ 조직도 — kirin-os.html 포함 섹션만 이식 */}
      {/* 민감정보(KPI숫자·성과급·연봉·인사변동) 절대 포함 금지 */}
    </div>
  );
}
```
(실제 실행 시 kirin-os.html을 열어 해당 섹션 텍스트를 카드로 옮긴다. 뼈대 위에 콘텐츠 채움.)

- [ ] **Step 2: 콘텐츠팀 비전 컴포넌트 작성**

`app/(main)/team-vision/ContentVision.tsx` — `content-team-os.html`의 포함 섹션을 동일 규칙으로 이식. ① 미션(진료 외 통합 위탁 MSO) ② 5년 비전(매출 50억·이익 15억·검진센터 1호점) ③ 핵심가치 3카드 ④ Q3 짱돌(위탁운영매뉴얼·표준브랜딩·콘텐츠스터디·AI사진정리·삼성아이웰·에이블ROAS) ⑤ 책임조직도(CMO/COO/CCO + 담당자 이름). **인사 변동 박스·성과급·연봉 절대 제외.**

```tsx
export default function ContentVision() {
  return (
    <div className="space-y-6">
      {/* content-team-os.html 포함 섹션만 이식 / 민감정보 제외 */}
    </div>
  );
}
```

- [ ] **Step 3: 빌드 검증**

Run: `npm run build`
Expected: 두 컴포넌트 타입·빌드 통과.

- [ ] **Step 4: Commit**

```bash
git add "app/(main)/team-vision/CommerceVision.tsx" "app/(main)/team-vision/ContentVision.tsx"
git commit -m "feat: 공유용 팀 비전 컴포넌트(커머스/콘텐츠) — 민감정보 제외"
```

---

## Task 4: 팀 비전 페이지 + 사이드바 메뉴

**Files:**
- Create: `app/(main)/team-vision/page.tsx`
- Modify: `components/Sidebar.tsx`

- [ ] **Step 1: 비전 페이지 작성 (팀 인식 + 관리자 토글)**

`app/(main)/team-vision/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import CommerceVision from './CommerceVision';
import ContentVision from './ContentVision';

type Team = '커머스팀' | '콘텐츠팀';

export default function TeamVisionPage() {
  const { profile, loading } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [viewTeam, setViewTeam] = useState<Team>('커머스팀');

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  // 관리자는 토글로 선택, 일반 직원은 본인 팀 고정
  const effectiveTeam: Team | null = isAdmin
    ? viewTeam
    : (profile?.team ?? null);

  if (!effectiveTeam) {
    return (
      <div className="rounded-lg bg-white p-8 text-center text-gray-500 shadow">
        아직 팀이 지정되지 않았습니다. 관리자에게 팀 지정을 요청해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow">
        <h1 className="text-2xl font-bold text-gray-900">
          {effectiveTeam} 비전
        </h1>
        {isAdmin && (
          <div className="flex gap-2">
            {(['커머스팀', '콘텐츠팀'] as Team[]).map((t) => (
              <button
                key={t}
                onClick={() => setViewTeam(t)}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  viewTeam === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      {effectiveTeam === '커머스팀' ? <CommerceVision /> : <ContentVision />}
    </div>
  );
}
```

- [ ] **Step 2: 사이드바 메뉴 추가**

`components/Sidebar.tsx` 수정:
1. lucide-react import에 `Compass` 추가 (5번째 줄 import 목록 끝에):
```tsx
import { MessageSquare, Calendar, Users, LayoutDashboard, CalendarDays, BarChart3, Shield, Clock, UserCheck, X, Target, Building2, CalendarRange, Compass } from 'lucide-react';
```
2. `menuItems`의 기본 배열(대시보드~팀 캘린더)에 `우리 팀 비전` 추가. 기존:
```tsx
      { name: '팀 캘린더', href: '/team-calendar', icon: CalendarRange },
    ];
```
를:
```tsx
      { name: '팀 캘린더', href: '/team-calendar', icon: CalendarRange },
      { name: '우리 팀 비전', href: '/team-vision', icon: Compass },
    ];
```
(모든 팀이 보는 항목이므로 팀 조건 분기 없이 기본 배열에 둔다. 페이지 내부에서 팀별 콘텐츠가 갈린다.)

- [ ] **Step 3: 빌드 검증**

Run: `npm run build`
Expected: 빌드 성공, `/team-vision` 라우트 생성됨.

- [ ] **Step 4: 브라우저 수동 확인**

Run: `npm run dev`
- 커머스팀 계정 → 왼쪽 `우리 팀 비전` 클릭 → 커머스팀 비전만. 콘텐츠팀 토글 없음.
- 콘텐츠팀 계정 → 콘텐츠팀 비전만.
- 관리자 계정 → 상단 토글로 두 팀 전환 확인.
- 민감정보(KPI·성과급·연봉·인사변동)가 화면에 **없는지** 반드시 확인.

- [ ] **Step 5: Commit**

```bash
git add "app/(main)/team-vision/page.tsx" components/Sidebar.tsx
git commit -m "feat: 팀 비전 페이지 + 사이드바 메뉴 (팀별 노출·관리자 토글)"
```

---

## Self-Review 체크

- **스펙 커버리지:** 팀 비전(팀별 노출·관리자 열람·민감정보 제외) = Task 3·4 / 출석 핵심가치(DO/DON'T 팝업·날짜 기반 순환) = Task 1·2. 모두 커버.
- **타입 일관성:** `CoreValue`, `getTodayCoreValue`, `Team`('커머스팀'|'콘텐츠팀'), `profile.team`/`profile.role` 명칭이 AuthContext 정의와 일치.
- **제외 규칙:** Task 3·4에 민감정보 제외를 반복 명시.
