'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { Clock, LogIn, LogOut, CheckCircle, AlertCircle, Wifi, WifiOff, Calendar } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isSameMonth } from 'date-fns';
import { ko } from 'date-fns/locale';

interface AttendanceRecord {
  id: string;
  user_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  check_in_ip: string | null;
  check_out_ip: string | null;
  status: 'checked_in' | 'checked_out';
  note: string | null;
}

function calculateWorkInfo(checkIn: string | null, checkOut: string | null) {
  if (!checkIn) return null;
  const inTime = new Date(checkIn);
  const outTime = checkOut ? new Date(checkOut) : new Date();
  const diffMs = outTime.getTime() - inTime.getTime();
  const totalMinutes = Math.max(0, Math.floor(diffMs / 60000) - 60); // 점심 1시간 차감

  const inH = inTime.getHours();
  const inM = inTime.getMinutes();
  const isLate = inH > 10 || (inH === 10 && inM > 0);
  const expectedCheckOut = new Date(inTime.getTime() + 9 * 60 * 60 * 1000);
  const isComplete = totalMinutes >= 480;
  const isEarlyLeave = checkOut !== null && !isComplete;

  return { totalMinutes, isComplete, isLate, isEarlyLeave, expectedCheckOut, inTime };
}

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}시간 ${m}분`;
}

function getStatusLabel(record: AttendanceRecord | null, now: Date): { label: string; color: string } {
  if (!record?.check_in) return { label: '미출근', color: 'bg-gray-100 text-gray-600' };
  const info = calculateWorkInfo(record.check_in, record.check_out);
  if (!info) return { label: '미출근', color: 'bg-gray-100 text-gray-600' };

  if (record.check_out) {
    if (info.isEarlyLeave) return { label: '조기퇴근', color: 'bg-orange-100 text-orange-700' };
    return { label: '퇴근완료', color: 'bg-green-100 text-green-700' };
  }
  if (info.isLate) return { label: '지각 근무중', color: 'bg-yellow-100 text-yellow-700' };
  return { label: '근무중', color: 'bg-blue-100 text-blue-700' };
}

function getDayStatus(record: AttendanceRecord | undefined, isWeekend: boolean, isHoliday: boolean, isPast: boolean) {
  if (isWeekend || isHoliday) return null;
  if (!isPast) return null;
  if (!record?.check_in) return 'absent';
  const info = calculateWorkInfo(record.check_in, record.check_out);
  if (!info) return 'absent';
  if (!record.check_out) return 'working';
  if (info.isEarlyLeave) return 'early';
  if (info.isLate) return 'late';
  return 'normal';
}

const dayStatusStyle: Record<string, string> = {
  normal: 'bg-green-500',
  late: 'bg-yellow-400',
  early: 'bg-orange-400',
  absent: 'bg-red-400',
  working: 'bg-blue-400',
};

export default function AttendancePage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [now, setNow] = useState(new Date());
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [detectedIp, setDetectedIp] = useState<string | null>(null);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [recentRecords, setRecentRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // 1초마다 시간 업데이트
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/attendance');
      const json = await res.json();
      setAllowed(json.allowed);
      setDetectedIp(json.ip || null);
      setTodayRecord(json.record);
    } catch {}

    if (!user) return;
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

    const [monthRes, recentRes] = await Promise.all([
      supabase.from('attendance').select('*').eq('user_id', user.id).gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: true }),
      supabase.from('attendance').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(14),
    ]);
    setMonthRecords(monthRes.data || []);
    setRecentRecords(recentRes.data || []);
  }, [user, currentMonth]);

  useEffect(() => {
    if (user) {
      fetchData().finally(() => setLoading(false));
    }
  }, [user, fetchData]);

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

  const workInfo = todayRecord ? calculateWorkInfo(todayRecord.check_in, todayRecord.check_out) : null;
  const workMinutes = workInfo ? (todayRecord?.check_out ? workInfo.totalMinutes : Math.max(0, Math.floor((now.getTime() - new Date(todayRecord!.check_in!).getTime()) / 60000) - 60)) : 0;
  const workProgress = Math.min(100, Math.round((workMinutes / 480) * 100));
  const status = getStatusLabel(todayRecord, now);

  // 달력 계산
  const calendarDays = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const firstDayOfWeek = getDay(calendarDays[0]); // 0=일, 1=월...
  const recordMap = Object.fromEntries(monthRecords.map((r) => [r.date, r]));

  // 이번 달 통계
  const today = format(now, 'yyyy-MM-dd');
  const workdays = calendarDays.filter((d) => {
    const dow = getDay(d);
    return dow !== 0 && dow !== 6 && format(d, 'yyyy-MM-dd') <= today;
  });
  const attended = workdays.filter((d) => recordMap[format(d, 'yyyy-MM-dd')]?.check_in).length;
  const lateCount = workdays.filter((d) => {
    const r = recordMap[format(d, 'yyyy-MM-dd')];
    if (!r?.check_in) return false;
    const t = new Date(r.check_in);
    return t.getHours() > 10 || (t.getHours() === 10 && t.getMinutes() > 0);
  }).length;
  const earlyCount = workdays.filter((d) => {
    const r = recordMap[format(d, 'yyyy-MM-dd')];
    if (!r?.check_in || !r?.check_out) return false;
    const info = calculateWorkInfo(r.check_in, r.check_out);
    return info?.isEarlyLeave;
  }).length;
  const absentCount = workdays.filter((d) => !recordMap[format(d, 'yyyy-MM-dd')]?.check_in).length;

  const avgCheckInMinutes = (() => {
    const times = workdays.filter((d) => recordMap[format(d, 'yyyy-MM-dd')]?.check_in).map((d) => {
      const t = new Date(recordMap[format(d, 'yyyy-MM-dd')].check_in!);
      return t.getHours() * 60 + t.getMinutes();
    });
    if (!times.length) return null;
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    return `${Math.floor(avg / 60).toString().padStart(2, '0')}:${(avg % 60).toString().padStart(2, '0')}`;
  })();

  const avgWorkMinutes = (() => {
    const mins = workdays.filter((d) => {
      const r = recordMap[format(d, 'yyyy-MM-dd')];
      return r?.check_in && r?.check_out;
    }).map((d) => {
      const r = recordMap[format(d, 'yyyy-MM-dd')];
      return calculateWorkInfo(r.check_in, r.check_out)?.totalMinutes ?? 0;
    });
    if (!mins.length) return null;
    return formatMinutes(Math.round(mins.reduce((a, b) => a + b, 0) / mins.length));
  })();

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* 헤더: 현재 시간 + IP 상태 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">출퇴근</h1>
          <p className="mt-1 text-sm text-gray-500">{format(now, 'yyyy년 M월 d일 (EEEE)', { locale: ko })}</p>
        </div>
        <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2">
          <p className="text-3xl font-mono font-bold text-gray-900 tabular-nums sm:text-4xl">
            {format(now, 'HH:mm:ss')}
          </p>
          <div className="flex flex-col items-end gap-1">
            {allowed === null ? (
              <span className="text-xs text-gray-400">네트워크 확인 중...</span>
            ) : allowed ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                <Wifi className="h-3 w-3" /> 사내 네트워크 ✓
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-600">
                <WifiOff className="h-3 w-3" /> 외부 네트워크 ✕
              </span>
            )}
            {detectedIp && (
              <span className="text-xs text-gray-400">내 IP: {detectedIp}</span>
            )}
          </div>
        </div>
      </div>

      {/* 출퇴근 카드 */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-6 space-y-5">
        {/* 상태 + 출퇴근 시간 */}
        <div className="flex items-center justify-between">
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${status.color}`}>
            {status.label}
          </span>
          {workInfo && (
            <span className="text-sm text-gray-500">
              예상 퇴근: <strong>{format(workInfo.expectedCheckOut, 'HH:mm')}</strong>
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs text-gray-500 mb-1">출근 시간</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">
              {todayRecord?.check_in ? format(new Date(todayRecord.check_in), 'HH:mm') : '--:--'}
            </p>
            {workInfo?.isLate && (
              <p className="mt-1 text-xs text-yellow-600">지각</p>
            )}
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs text-gray-500 mb-1">퇴근 시간</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">
              {todayRecord?.check_out ? format(new Date(todayRecord.check_out), 'HH:mm') : '--:--'}
            </p>
          </div>
        </div>

        {/* 근무시간 프로그레스 */}
        {todayRecord?.check_in && (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600 font-medium">
                {formatMinutes(workMinutes)}
              </span>
              <span className="text-gray-400">/ 8시간 ({workProgress}%)</span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-100">
              <div
                className={`h-3 rounded-full transition-all ${workProgress >= 100 ? 'bg-green-500' : workProgress >= 60 ? 'bg-blue-500' : 'bg-yellow-400'}`}
                style={{ width: `${workProgress}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">점심 1시간 자동 차감 기준</p>
          </div>
        )}

        {/* 출퇴근 버튼 */}
        {!allowed && (
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-700 text-center">
            회사 WiFi에서만 출퇴근이 가능합니다
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleAction('check_in')}
            disabled={!allowed || !!todayRecord?.check_in || actionLoading}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-4 text-base font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 transition-all"
          >
            {todayRecord?.check_in ? (
              <><CheckCircle className="h-5 w-5" /> 출근 완료</>
            ) : (
              <><LogIn className="h-5 w-5" /> 출근하기</>
            )}
          </button>
          <button
            onClick={() => handleAction('check_out')}
            disabled={!allowed || !todayRecord?.check_in || !!todayRecord?.check_out || actionLoading}
            className="flex items-center justify-center gap-2 rounded-xl bg-gray-700 py-4 text-base font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 transition-all"
          >
            {todayRecord?.check_out ? (
              <><CheckCircle className="h-5 w-5" /> 퇴근 완료</>
            ) : (
              <><LogOut className="h-5 w-5" /> 퇴근하기</>
            )}
          </button>
        </div>
      </div>

      {/* 월간 캘린더 */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-gray-400" />
            {format(currentMonth, 'yyyy년 M월')} 출석 현황
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm hover:bg-gray-50"
            >
              ‹
            </button>
            <button
              onClick={() => setCurrentMonth(new Date())}
              className="rounded-lg border border-gray-200 px-3 py-1 text-xs hover:bg-gray-50"
            >
              이번달
            </button>
            <button
              onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm hover:bg-gray-50"
            >
              ›
            </button>
          </div>
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 mb-2">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div key={d} className={`text-center text-xs font-medium py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* 날짜 그리드 */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {calendarDays.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const record = recordMap[dateStr];
            const dow = getDay(day);
            const isWeekend = dow === 0 || dow === 6;
            const isPast = dateStr <= today;
            const isToday = dateStr === today;
            const dayStatus = getDayStatus(record, isWeekend, false, isPast);

            return (
              <div
                key={dateStr}
                className={`aspect-square flex flex-col items-center justify-center rounded-lg text-sm relative
                  ${isToday ? 'ring-2 ring-blue-500 bg-blue-50' : ''}
                  ${isWeekend ? 'opacity-40' : ''}
                  ${!isSameMonth(day, currentMonth) ? 'opacity-20' : ''}
                `}
              >
                <span className={`text-xs font-medium ${isToday ? 'text-blue-700' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-gray-700'}`}>
                  {format(day, 'd')}
                </span>
                {dayStatus && (
                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${dayStatusStyle[dayStatus]}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* 범례 */}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
          {[['bg-green-500', '정상'], ['bg-yellow-400', '지각'], ['bg-orange-400', '조기퇴근'], ['bg-red-400', '결근'], ['bg-blue-400', '근무중']].map(([color, label]) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${color}`} />
              {label}
            </span>
          ))}
        </div>

        {/* 이번 달 통계 */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: '출석', value: `${attended}일`, color: 'text-green-600' },
            { label: '지각', value: `${lateCount}회`, color: 'text-yellow-600' },
            { label: '조기퇴근', value: `${earlyCount}회`, color: 'text-orange-500' },
            { label: '결근', value: `${absentCount}일`, color: 'text-red-500' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {avgCheckInMinutes || avgWorkMinutes ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {avgCheckInMinutes && (
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500">평균 출근시간</p>
                <p className="text-xl font-bold text-gray-800">{avgCheckInMinutes}</p>
              </div>
            )}
            {avgWorkMinutes && (
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500">평균 근무시간</p>
                <p className="text-xl font-bold text-gray-800">{avgWorkMinutes}</p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 최근 14일 기록 */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">최근 기록</h2>
        </div>
        {recentRecords.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">출퇴근 기록이 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentRecords.map((r) => {
              const info = calculateWorkInfo(r.check_in, r.check_out);
              const dow = getDay(new Date(r.date));
              const statusInfo = getStatusLabel(r, new Date());
              return (
                <div key={r.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-4">
                    <div className="w-20">
                      <p className={`text-sm font-medium ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-900'}`}>
                        {format(new Date(r.date), 'M/d (EEE)', { locale: ko })}
                      </p>
                    </div>
                    <div className="flex gap-4 text-sm text-gray-700 tabular-nums">
                      <span>{r.check_in ? format(new Date(r.check_in), 'HH:mm') : '--:--'}</span>
                      <span className="text-gray-300">→</span>
                      <span>{r.check_out ? format(new Date(r.check_out), 'HH:mm') : '--:--'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {info && (
                      <span className="text-xs text-gray-500 tabular-nums">
                        {r.check_out ? formatMinutes(info.totalMinutes) : '근무중'}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
