'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns';
import { ko } from 'date-fns/locale';
import { calculateLeave, canUseLeave } from '@/lib/leaveCalculator';
import { useData } from '@/contexts/DataContext';

export default function CalendarPage() {
  const { schedules, setSchedules, addSchedule, deleteSchedule, employees, setEmployees } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedDaySchedules, setSelectedDaySchedules] = useState<typeof schedules>([]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getSchedulesForDate = (date: Date) => {
    return schedules.filter((s) => isSameDay(new Date(s.date), date));
  };

  const handlePrevMonth = () => {
    setCurrentDate(subMonths(currentDate, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1));
  };


  const handleAddSchedule = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedDate) return;

    const formData = new FormData(e.currentTarget);
    const employeeId = formData.get('employeeId') as string;
    const type = formData.get('type') as 'vacation' | 'dayoff' | 'sick';
    const note = formData.get('note') as string;

    const employee = employees.find((emp) => emp.id === employeeId);
    if (!employee) return;

    // 중복 체크: 같은 날짜에 같은 직원이 이미 등록되어 있는지 확인
    const dateString = format(selectedDate, 'yyyy-MM-dd');
    const isDuplicate = schedules.some(
      (schedule) => schedule.date === dateString && schedule.employeeId === employeeId
    );

    if (isDuplicate) {
      alert(`${employee.name}님은 이미 해당 날짜에 일정이 등록되어 있습니다.`);
      return;
    }

    // 연차/월차 사용 가능 여부 확인
    if (type === 'vacation') {
      if (!canUseLeave(employee.joinDate, employee.usedLeave)) {
        alert('사용 가능한 연차/월차가 없습니다!');
        return;
      }
    }

    const newSchedule = {
      id: String(Date.now()),
      employeeId,
      employeeName: employee.name,
      date: dateString,
      type,
      note,
    };

    addSchedule(newSchedule);

    // 연차 사용 시 자동으로 usedLeave 증가
    if (type === 'vacation') {
      setEmployees(
        employees.map((emp) =>
          emp.id === employeeId
            ? { ...emp, usedLeave: emp.usedLeave + 1 }
            : emp
        )
      );
      alert(`${employee.name}님의 연차가 사용되었습니다. (남은 연차: ${calculateLeave(employee.joinDate, employee.usedLeave + 1).remainingLeave}개)`);
    }

    setShowModal(false);
    e.currentTarget.reset();
  };

  const handleDeleteSchedule = (schedule: typeof schedules[0]) => {
    if (!confirm(`${schedule.employeeName}님의 ${schedule.type === 'vacation' ? '연차' : schedule.type === 'dayoff' ? '휴무' : '병가'} 일정을 삭제하시겠습니까?`)) {
      return;
    }

    deleteSchedule(schedule.id);

    // 연차였다면 자동으로 usedLeave 감소
    if (schedule.type === 'vacation') {
      const employee = employees.find(emp => emp.id === schedule.employeeId);
      if (employee) {
        setEmployees(
          employees.map((emp) =>
            emp.id === schedule.employeeId
              ? { ...emp, usedLeave: Math.max(0, emp.usedLeave - 1) }
              : emp
          )
        );
        const newLeaveInfo = calculateLeave(employee.joinDate, Math.max(0, employee.usedLeave - 1));
        alert(`${employee.name}님의 연차가 복구되었습니다.\n남은 연차: ${newLeaveInfo.remainingLeave}개 / 총 ${newLeaveInfo.totalLeave}개`);
      }
    } else {
      alert('일정이 삭제되었습니다.');
    }
  };

  const handleDayClick = (date: Date) => {
    const daySchedules = getSchedulesForDate(date);
    if (daySchedules.length > 0) {
      setSelectedDaySchedules(daySchedules);
      setShowDetailModal(true);
    } else {
      setSelectedDate(date);
      setShowModal(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">캘린더</h1>
          <p className="mt-2 text-gray-600">구성원 근무 현황</p>
        </div>
      </div>

      {/* Calendar Navigation */}
      <div className="rounded-lg bg-white p-6 shadow">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">
            {format(currentDate, 'yyyy년 M월', { locale: ko })}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={handlePrevMonth}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => setCurrentDate(new Date())}
              className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-100"
            >
              오늘
            </button>
            <button
              onClick={handleNextMonth}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-2">
          {/* Day Headers */}
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

          {/* Calendar Days */}
          {days.map((day) => {
            const daySchedules = getSchedulesForDate(day);
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={day.toString()}
                onClick={() => handleDayClick(day)}
                className={`min-h-24 cursor-pointer rounded-lg border p-2 transition hover:bg-gray-50 ${
                  isToday ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div
                  className={`text-sm font-medium ${
                    isToday ? 'text-blue-600' : 'text-gray-700'
                  }`}
                >
                  {format(day, 'd')}
                </div>
                <div className="mt-1 space-y-1">
                  {daySchedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className={`rounded px-1 py-0.5 text-xs ${
                        schedule.type === 'vacation'
                          ? 'bg-yellow-100 text-yellow-800'
                          : schedule.type === 'dayoff'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {schedule.employeeName}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 rounded-lg bg-white p-4 shadow">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-yellow-100"></div>
          <span className="text-sm text-gray-700">연차</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-gray-100"></div>
          <span className="text-sm text-gray-700">휴무</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-red-100"></div>
          <span className="text-sm text-gray-700">병가</span>
        </div>
      </div>

      {/* Schedule Detail Modal */}
      {showDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/30 backdrop-blur-md">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-gray-900">일정 목록</h3>

            <div className="mt-4 space-y-3">
              {selectedDaySchedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{schedule.employeeName}</span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          schedule.type === 'vacation'
                            ? 'bg-yellow-100 text-yellow-800'
                            : schedule.type === 'dayoff'
                            ? 'bg-gray-100 text-gray-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {schedule.type === 'vacation' ? '연차' : schedule.type === 'dayoff' ? '휴무' : '병가'}
                      </span>
                    </div>
                    {schedule.note && (
                      <p className="mt-1 text-sm text-gray-600">{schedule.note}</p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      handleDeleteSchedule(schedule);
                      setSelectedDaySchedules(selectedDaySchedules.filter(s => s.id !== schedule.id));
                      if (selectedDaySchedules.length <= 1) {
                        setShowDetailModal(false);
                      }
                    }}
                    className="ml-3 rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowDetailModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
              >
                닫기
              </button>
              <button
                onClick={() => {
                  setShowDetailModal(false);
                  setShowModal(true);
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
              >
                일정 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Schedule Modal */}
      {showModal && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/30 backdrop-blur-md">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-gray-900">
              일정 추가 - {format(selectedDate, 'yyyy년 M월 d일', { locale: ko })}
            </h3>

            <form onSubmit={handleAddSchedule} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">구성원</label>
                <select
                  name="employeeId"
                  required
                  onChange={(e) => {
                    const employee = employees.find(emp => emp.id === e.target.value);
                    if (employee) {
                      const leaveInfo = calculateLeave(employee.joinDate, employee.usedLeave);
                      const leaveDisplay = document.getElementById('leaveDisplay');
                      if (leaveDisplay) {
                        leaveDisplay.textContent = `남은 연차/월차: ${leaveInfo.remainingLeave}/${leaveInfo.totalLeave}`;
                      }
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">선택하세요</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.role})
                    </option>
                  ))}
                </select>
                <p id="leaveDisplay" className="mt-1 text-xs text-gray-500">
                  구성원을 선택하면 남은 연차가 표시됩니다
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">유형</label>
                <select
                  name="type"
                  required
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="vacation">연차 (자동 차감)</option>
                  <option value="dayoff">휴무</option>
                  <option value="sick">병가</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">메모</label>
                <input
                  type="text"
                  name="note"
                  placeholder="선택사항"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
                >
                  추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
