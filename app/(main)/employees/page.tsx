'use client';

import { useState } from 'react';
import { mockEmployees } from '@/lib/mockData';
import { Edit, Search, UserPlus, Download, Calendar as CalendarIcon } from 'lucide-react';
import { format, differenceInMonths } from 'date-fns';
import { ko } from 'date-fns/locale';
import { calculateLeave, getLeaveTypeText } from '@/lib/leaveCalculator';
import { useData } from '@/contexts/DataContext';

export default function EmployeesPage() {
  const { employees, setEmployees, addSchedule, schedules } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<typeof mockEmployees[0] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    date: '',
    type: 'vacation' as 'vacation' | 'dayoff',
    note: '',
  });

  const filteredEmployees = employees.filter(
    (emp) =>
      emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const calculateTenure = (joinDate: string) => {
    const months = differenceInMonths(new Date(), new Date(joinDate));
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;

    if (years === 0) {
      return `${remainingMonths}개월`;
    } else if (remainingMonths === 0) {
      return `${years}년`;
    } else {
      return `${years}년 ${remainingMonths}개월`;
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap = {
      active: { label: '재직', color: 'bg-green-100 text-green-800' },
      vacation: { label: '연차', color: 'bg-yellow-100 text-yellow-800' },
      dayoff: { label: '휴무', color: 'bg-gray-100 text-gray-800' },
    };
    const statusInfo = statusMap[status as keyof typeof statusMap];
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusInfo.color}`}>
        {statusInfo.label}
      </span>
    );
  };

  const handleEdit = (employee: typeof mockEmployees[0]) => {
    setSelectedEmployee(employee);
    setShowModal(true);
  };

  const handleAddSchedule = (employee: typeof mockEmployees[0]) => {
    setSelectedEmployee(employee);
    setScheduleForm({ date: '', type: 'vacation', note: '' });
    setShowScheduleModal(true);
  };

  const handleScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !scheduleForm.date) return;

    // 중복 체크: 같은 날짜에 같은 직원이 이미 등록되어 있는지 확인
    const isDuplicate = schedules.some(
      (schedule) => schedule.date === scheduleForm.date && schedule.employeeId === selectedEmployee.id
    );

    if (isDuplicate) {
      alert(`${selectedEmployee.name}님은 이미 해당 날짜에 일정이 등록되어 있습니다.`);
      return;
    }

    // 연차 사용 시 남은 개수 확인
    if (scheduleForm.type === 'vacation') {
      const leaveInfo = calculateLeave(selectedEmployee.joinDate, selectedEmployee.usedLeave);
      if (leaveInfo.remainingLeave <= 0) {
        alert('사용 가능한 연차/월차가 없습니다!');
        return;
      }
    }

    const newSchedule = {
      id: String(Date.now()),
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      date: scheduleForm.date,
      type: scheduleForm.type,
      note: scheduleForm.note,
    };

    addSchedule(newSchedule);

    // 연차 사용 시 자동으로 usedLeave 증가
    if (scheduleForm.type === 'vacation') {
      const updatedEmployees = employees.map((emp) =>
        emp.id === selectedEmployee.id
          ? { ...emp, usedLeave: emp.usedLeave + 1 }
          : emp
      );
      setEmployees(updatedEmployees);

      const newLeaveInfo = calculateLeave(selectedEmployee.joinDate, selectedEmployee.usedLeave + 1);
      alert(`${selectedEmployee.name}님의 연차가 등록되었습니다.\n남은 연차: ${newLeaveInfo.remainingLeave}개 / 총 ${newLeaveInfo.totalLeave}개`);
    } else {
      alert(`${selectedEmployee.name}님의 휴무가 등록되었습니다.`);
    }

    setShowScheduleModal(false);
    setSelectedEmployee(null);
  };

  const handleUpdateEmployee = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    const formData = new FormData(e.currentTarget);
    const updatedEmployee = {
      ...selectedEmployee,
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      role: formData.get('role') as string,
      checkInTime: formData.get('checkInTime') as string,
      joinDate: formData.get('joinDate') as string,
      status: formData.get('status') as 'active' | 'vacation' | 'dayoff',
    };

    setEmployees(
      employees.map((emp) => (emp.id === selectedEmployee.id ? updatedEmployee : emp))
    );
    setShowModal(false);
    setSelectedEmployee(null);
  };

  const exportCSV = () => {
    const headers = ['이름', '이메일', '역할', '출근시간', '입사일', '근속기간', '연차/월차', '상태'];
    const data = employees.map((emp) => {
      const leaveInfo = calculateLeave(emp.joinDate, emp.usedLeave);
      return [
        emp.name,
        emp.email,
        emp.role,
        emp.checkInTime || '-',
        emp.joinDate,
        calculateTenure(emp.joinDate),
        `${leaveInfo.remainingLeave}/${leaveInfo.totalLeave} (${getLeaveTypeText(leaveInfo.leaveType)})`,
        emp.status === 'active' ? '재직' : emp.status === 'vacation' ? '연차' : '휴무',
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...data.map((row) => row.join(','))].join('\n');

    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `인원관리_${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">인원 관리</h1>
          <p className="mt-2 text-gray-600">전체 인원의 상태를 관리하세요</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-5 w-5" />
            CSV 내보내기
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
            <UserPlus className="h-5 w-5" />
            인원 추가
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="이름, 이메일, 역할로 검색..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  이름
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  이메일
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  역할
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  출근시간
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  입사일
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  근속기간
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  연차/월차
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700">
                  상태
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-700">
                  관리
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredEmployees.map((employee) => {
                const leaveInfo = calculateLeave(employee.joinDate, employee.usedLeave);
                return (
                  <tr key={employee.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center">
                        <div className="h-10 w-10 flex-shrink-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white font-semibold">
                            {employee.name[0]}
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="font-medium text-gray-900">{employee.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {employee.email}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {employee.role}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {employee.checkInTime || '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {format(new Date(employee.joinDate), 'yyyy.MM.dd')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {calculateTenure(employee.joinDate)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900">
                          {leaveInfo.remainingLeave} / {leaveInfo.totalLeave}
                        </span>
                        <span className="text-xs text-gray-500">
                          {getLeaveTypeText(leaveInfo.leaveType)}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {getStatusBadge(employee.status)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleAddSchedule(employee)}
                          className="text-green-600 hover:text-green-900"
                          title="연차/휴무 추가"
                        >
                          <CalendarIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleEdit(employee)}
                          className="text-blue-600 hover:text-blue-900"
                          title="정보 수정"
                        >
                          <Edit className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredEmployees.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-gray-500">검색 결과가 없습니다.</p>
          </div>
        )}
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/30 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-gray-900">연차/휴무 등록</h3>
            <p className="mt-1 text-sm text-gray-600">{selectedEmployee.name}님의 휴가 일정을 등록합니다</p>

            <form onSubmit={handleScheduleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">날짜</label>
                <input
                  type="date"
                  value={scheduleForm.date}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">유형</label>
                <select
                  value={scheduleForm.type}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value as 'vacation' | 'dayoff' })}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="vacation">연차</option>
                  <option value="dayoff">휴무</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">메모 (선택)</label>
                <textarea
                  value={scheduleForm.note}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, note: e.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="예: 개인 연차, 정기 휴무 등"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowScheduleModal(false);
                    setSelectedEmployee(null);
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700"
                >
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showModal && selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/30 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-gray-900">인원 정보 수정</h3>

            <form onSubmit={handleUpdateEmployee} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">이름</label>
                  <input
                    type="text"
                    name="name"
                    defaultValue={selectedEmployee.name}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">이메일</label>
                  <input
                    type="email"
                    name="email"
                    defaultValue={selectedEmployee.email}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">역할</label>
                  <input
                    type="text"
                    name="role"
                    defaultValue={selectedEmployee.role}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">출근시간</label>
                  <input
                    type="time"
                    name="checkInTime"
                    defaultValue={selectedEmployee.checkInTime}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">입사일</label>
                  <input
                    type="date"
                    name="joinDate"
                    defaultValue={selectedEmployee.joinDate}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">상태</label>
                  <select
                    name="status"
                    defaultValue={selectedEmployee.status}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="active">재직</option>
                    <option value="vacation">연차</option>
                    <option value="dayoff">휴무</option>
                  </select>
                </div>
              </div>

              {/* 연차/월차 정보 표시 */}
              <div className="rounded-lg bg-blue-50 p-4">
                <p className="text-sm font-medium text-blue-900">연차/월차 정보</p>
                <p className="mt-1 text-sm text-blue-700">
                  {(() => {
                    const leaveInfo = calculateLeave(selectedEmployee.joinDate, selectedEmployee.usedLeave);
                    return `${leaveInfo.description} - 남은 ${getLeaveTypeText(leaveInfo.leaveType)}: ${leaveInfo.remainingLeave}개 / 총 ${leaveInfo.totalLeave}개`;
                  })()}
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setSelectedEmployee(null);
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
