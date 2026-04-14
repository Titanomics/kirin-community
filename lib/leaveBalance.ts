import { differenceInMonths, eachDayOfInterval, format } from 'date-fns';

export interface LeaveRequestLike {
  leave_type: '연차' | '반차' | '월차';
  start_date: string;
  end_date: string;
}

export interface LeaveBalance {
  kind: '월차' | '연차' | '미설정';
  total: number;
  autoTotal: number;
  used: number;
  remaining: number;
  note: string;
  nextIncreaseDate: string | null;
  daysUntilNext: number | null;
  periodStart: string | null;
}

function countBusinessDays(start: string, end: string): number {
  const days = eachDayOfInterval({ start: new Date(start), end: new Date(end) });
  return days.filter((d) => d.getDay() !== 0 && d.getDay() !== 6).length;
}

/**
 * 잔여 연차/월차 계산 (버그 수정판)
 * - Bug 2 Fix: 현재 기간의 휴가 사용만 차감 (과거 월차 사용이 연차에서 차감되지 않음)
 * - Bug 3 Fix: joined_at null 처리
 * - Bug 4 Fix: 다음 증가 예정일 반환
 */
export function calcLeaveBalance(
  joinedAt: string | null,
  approvedLeaves: LeaveRequestLike[],
  adjustment = 0
): LeaveBalance {
  if (!joinedAt) {
    return {
      kind: '미설정',
      total: 0,
      autoTotal: 0,
      used: 0,
      remaining: 0,
      note: '입사일이 입력되지 않아 계산할 수 없습니다',
      nextIncreaseDate: null,
      daysUntilNext: null,
      periodStart: null,
    };
  }

  const today = new Date();
  const joined = new Date(joinedAt);
  const totalMonths = differenceInMonths(today, joined);
  const years = Math.floor(totalMonths / 12);

  // 현재 기간 시작일 (Bug 2 수정)
  let periodStart: Date;
  if (years < 1) {
    periodStart = joined;
  } else {
    periodStart = new Date(joined);
    periodStart.setFullYear(joined.getFullYear() + years);
  }
  const periodStartStr = format(periodStart, 'yyyy-MM-dd');

  // 현재 기간 내 사용량만 집계
  const periodLeaves = approvedLeaves.filter((l) => l.start_date >= periodStartStr);
  const used = periodLeaves.reduce((sum, l) => {
    if (l.leave_type === '반차') return sum + 0.5;
    return sum + countBusinessDays(l.start_date, l.end_date);
  }, 0);

  if (years < 1) {
    // 1년 미만: 입사일부터 매월 1개씩 부여 (최대 11개)
    const autoTotal = Math.min(totalMonths, 11);
    const total = autoTotal + adjustment;

    // 다음 증가일 = 입사일 + (totalMonths + 1)개월
    let nextIncreaseDate: string | null = null;
    let daysUntilNext: number | null = null;
    if (totalMonths < 11) {
      const next = new Date(joined);
      next.setMonth(joined.getMonth() + totalMonths + 1);
      nextIncreaseDate = format(next, 'yyyy-MM-dd');
      daysUntilNext = Math.max(0, Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    } else {
      // 11개월이면 다음달에 연차로 전환
      const next = new Date(joined);
      next.setFullYear(joined.getFullYear() + 1);
      nextIncreaseDate = format(next, 'yyyy-MM-dd');
      daysUntilNext = Math.max(0, Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    }

    const joinDay = joined.getDate();
    return {
      kind: '월차',
      total,
      autoTotal,
      used,
      remaining: Math.max(0, total - used),
      note: `입사 ${totalMonths}개월 경과 · 매월 ${joinDay}일마다 +1 (1년 경과 시 연차 15개로 전환)`,
      nextIncreaseDate,
      daysUntilNext,
      periodStart: periodStartStr,
    };
  } else {
    // 1년 이상: 15 + 매 2년마다 +1 (3년차부터, 최대 25)
    const autoTotal = Math.min(15 + Math.max(0, Math.floor((years - 1) / 2)), 25);
    const total = autoTotal + adjustment;

    // 다음 증가 연도 계산 (3, 5, 7, 9, ... 단, 25개 상한)
    let nextIncreaseDate: string | null = null;
    let daysUntilNext: number | null = null;
    if (autoTotal < 25) {
      let nextYear: number;
      if (years < 3) nextYear = 3;
      else nextYear = years % 2 === 1 ? years + 2 : years + 1;

      const nextAuto = Math.min(15 + Math.floor((nextYear - 1) / 2), 25);
      if (nextAuto > autoTotal) {
        const next = new Date(joined);
        next.setFullYear(joined.getFullYear() + nextYear);
        nextIncreaseDate = format(next, 'yyyy-MM-dd');
        daysUntilNext = Math.max(0, Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      }
    }

    // 기간 리셋일
    const reset = new Date(joined);
    reset.setFullYear(joined.getFullYear() + years + 1);
    const resetDateStr = format(reset, 'yyyy-MM-dd');

    const addedDays = autoTotal - 15;
    const note =
      autoTotal >= 25
        ? `근속 ${years}년 · 최대 25개 (상한 도달) · ${resetDateStr}에 리셋`
        : addedDays > 0
          ? `근속 ${years}년 · 기본 15일 + 추가 ${addedDays}일 · ${resetDateStr}에 리셋`
          : `근속 ${years}년 · 기본 15일 (3년차부터 2년마다 +1, 최대 25) · ${resetDateStr}에 리셋`;

    return {
      kind: '연차',
      total,
      autoTotal,
      used,
      remaining: Math.max(0, total - used),
      note,
      nextIncreaseDate,
      daysUntilNext,
      periodStart: periodStartStr,
    };
  }
}
