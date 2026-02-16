// 직원 정보 타입
export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  checkInTime?: string;
  joinDate: string;
  status: 'active' | 'dayoff' | 'vacation'; // 재직, 휴무, 연차
  usedLeave: number; // 사용한 연차/월차 개수
  avatar?: string;
}

// 게시글 타입
export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  likes: number;
  dislikes: number;
  likedBy: string[]; // 추천한 사용자 ID 목록
  dislikedBy: string[]; // 비추천한 사용자 ID 목록
  commentCount: number;
}

// 댓글 타입
export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// 근무 일정 타입
export interface Schedule {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD 형식
  type: 'work' | 'dayoff' | 'vacation' | 'sick'; // 근무, 휴무, 연차, 병가
  note?: string;
}

// 캘린더 이벤트 타입
export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'work' | 'dayoff' | 'vacation' | 'sick';
  employeeId: string;
  employeeName: string;
}
