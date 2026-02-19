'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, eachDayOfInterval as eachDay, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import { createClient } from '@/lib/supabase/client';

interface CalendarLeave {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  profiles: { display_name: string | null; email: string | null } | null;
}

interface DayEvent {
  id: string;
  name: string;
  type: string;
  reason: string | null;
}

export default function CalendarPage() {
  const supabase = createClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [leaves, setLeaves] = useState<CalendarLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDayEvents, setSelectedDayEvents] = useState<DayEvent[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDateLabel, setSelectedDateLabel] = useState('');

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    fetchLeaves();
  }, [currentDate]);

  async function fetchLeaves() {
    const start = format(monthStart, 'yyyy-MM-dd');
    const end = format(monthEnd, 'yyyy-MM-dd');

    const { data } = await supabase
      .from('leave_requests')
      .select('*, profiles!leave_requests_user_id_fkey(display_name, email)')
      .eq('status', '승인')
      .lte('start_date', end)
      .gte('end_date', start);

    setLeaves(data || []);
    setLoading(false);
  }

  // 특정 날짜에 해당하는 승인된 휴가 이벤트 계산
  function getEventsForDate(date: Date): DayEvent[] {
    const dateStr = format(date, 'yyyy-MM-dd');
    const events: DayEvent[] = [];

    for (const leave of leaves) {
      if (dateStr >= leave.start_date && dateStr <= leave.end_date) {
        events.push({
          id: leave.id,
          name: leave.profiles?.display_name || leave.profiles?.email || '알 수 없음',
          type: leave.leave_type,
          reason: leave.reason,
        });
      }
    }
    return events;
  }

  function handleDayClick(date: Date) {
    const events = getEventsForDate(date);
    if (events.length > 0) {
      setSelectedDayEvents(events);
      setSelectedDateLabel(format(date, 'yyyy년 M월 d일', { locale: ko }));
      setShowDetailModal(true);
    }
  }

  const leaveTypeColor = (type: string) => {
    switch (type) {
      case '연차': return 'bg-yellow-100 text-yellow-800';
      case '반차': return 'bg-orange-100 text-orange-800';
      case '월차': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 첫 번째 날의 요일에 맞춰 빈 셀 추가
  const firstDayOfWeek = monthStart.getDay();
  const emptyCells = Array.from({ length: firstDayOfWeek }, (_, i) => i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">캘린더</h1>
        <p className="mt-2 text-gray-600">승인된 휴가 일정을 확인하세요</p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">
            {format(currentDate, 'yyyy년 M월', { locale: ko })}
          </h2>
          <div className="flex gap-2">
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="rounded-lg p-2 hover:bg-gray-100">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-100">
              오늘
            </button>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="rounded-lg p-2 hover:bg-gray-100">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>
        ) : (
          <div className="grid grid-cols-7 gap-2">
            {['일', '월', '화', '수', '목', '금', '토'].map((day, index) => (
              <div
                key={day}
                className={`py-2 text-center text-sm font-semibold ${
                  index === 0 ? 'text-red-600' : index === 6 ? 'text-blue-600' : 'text-gray-700'
                }`}
              >
                {day}
              </div>
            ))}

            {emptyCells.map((i) => (
              <div key={`empty-${i}`} className="min-h-24" />
            ))}

            {days.map((day) => {
              const events = getEventsForDate(day);
              const isToday = isSameDay(day, new Date());

              return (
                <div
                  key={day.toString()}
                  onClick={() => handleDayClick(day)}
                  className={`min-h-24 cursor-pointer rounded-lg border p-2 transition hover:bg-gray-50 ${
                    isToday ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  <div className={`text-sm font-medium ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                    {format(day, 'd')}
                  </div>
                  <div className="mt-1 space-y-1">
                    {events.slice(0, 3).map((event) => (
                      <div key={event.id} className={`rounded px-1 py-0.5 text-xs ${leaveTypeColor(event.type)}`}>
                        {event.name}
                      </div>
                    ))}
                    {events.length > 3 && (
                      <div className="text-xs text-gray-400">+{events.length - 3}명</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 rounded-lg bg-white p-4 shadow">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-yellow-100" />
          <span className="text-sm text-gray-700">연차</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-orange-100" />
          <span className="text-sm text-gray-700">반차</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-blue-100" />
          <span className="text-sm text-gray-700">월차</span>
        </div>
      </div>

      {/* Detail Modal */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-gray-900">{selectedDateLabel} 일정</h3>
            <div className="mt-4 space-y-3">
              {selectedDayEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${leaveTypeColor(event.type)}`}>
                    {event.type}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{event.name}</p>
                    {event.reason && <p className="text-xs text-gray-500">{event.reason}</p>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowDetailModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
