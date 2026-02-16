import { differenceInMonths, differenceInYears, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';

/**
 * 근속기간을 기반으로 연차/월차를 자동 계산
 *
 * 규칙:
 * - 1년 미만: 매월 만근 시 월차 1개 (최대 11개)
 * - 1년 이상: 연차 15개
 */

export interface LeaveInfo {
  totalLeave: number;        // 총 연차/월차 개수
  usedLeave: number;         // 사용한 개수
  remainingLeave: number;    // 남은 개수
  leaveType: 'monthly' | 'annual';  // 월차 또는 연차
  description: string;       // 설명
}

/**
 * 입사일 기반 연차/월차 계산
 * @param joinDate 입사일 (YYYY-MM-DD)
 * @param usedCount 이미 사용한 연차/월차 개수
 * @returns LeaveInfo 객체
 */
export function calculateLeave(joinDate: string, usedCount: number = 0): LeaveInfo {
  const join = new Date(joinDate);
  const today = new Date();

  // 근속 월수
  const monthsWorked = differenceInMonths(today, join);

  // 1년 미만 근로자 (월차)
  if (monthsWorked < 12) {
    // 만근한 개월수 기준으로 월차 계산
    // 실제로는 출근 기록을 확인해야 하지만, 여기서는 근무한 완전한 개월수로 계산
    const totalMonthlyLeave = monthsWorked;

    return {
      totalLeave: totalMonthlyLeave,
      usedLeave: usedCount,
      remainingLeave: Math.max(0, totalMonthlyLeave - usedCount),
      leaveType: 'monthly',
      description: `입사 ${monthsWorked}개월차 (월차)`
    };
  }

  // 1년 이상 근로자 (연차)
  // 기본 연차 15개
  const yearsWorked = differenceInYears(today, join);
  let totalAnnualLeave = 15;

  // 3년 이상 근속 시 2년마다 1개씩 추가 (최대 25개)
  if (yearsWorked >= 3) {
    const additionalYears = Math.floor((yearsWorked - 1) / 2);
    totalAnnualLeave = Math.min(25, 15 + additionalYears);
  }

  return {
    totalLeave: totalAnnualLeave,
    usedLeave: usedCount,
    remainingLeave: Math.max(0, totalAnnualLeave - usedCount),
    leaveType: 'annual',
    description: `근속 ${yearsWorked}년차 (연차)`
  };
}

/**
 * 연차/월차 사용 가능 여부 확인
 */
export function canUseLeave(joinDate: string, usedCount: number): boolean {
  const leaveInfo = calculateLeave(joinDate, usedCount);
  return leaveInfo.remainingLeave > 0;
}

/**
 * 연차 유형별 표시 텍스트
 */
export function getLeaveTypeText(leaveType: 'monthly' | 'annual'): string {
  return leaveType === 'monthly' ? '월차' : '연차';
}
