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

export const CORE_VALUE_START = new Date(2026, 6, 1); // 2026-07-01 (JS month 6 = 7월)

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
