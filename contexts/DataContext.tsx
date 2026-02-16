'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { mockEmployees, mockPosts, mockComments, mockSchedules } from '@/lib/mockData';
import type { Employee, Post, Comment, Schedule } from '@/types';

interface DataContextType {
  employees: Employee[];
  setEmployees: (employees: Employee[]) => void;
  posts: Post[];
  setPosts: (posts: Post[]) => void;
  addPost: (post: Post) => void;
  updatePostVote: (postId: string, likes: number, dislikes: number) => void;
  comments: Comment[];
  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  schedules: Schedule[];
  setSchedules: (schedules: Schedule[]) => void;
  addSchedule: (schedule: Schedule) => void;
  deleteSchedule: (scheduleId: string) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const [employees, setEmployees] = useState<Employee[]>(mockEmployees);
  const [posts, setPosts] = useState<Post[]>(mockPosts);
  const [comments, setComments] = useState<Comment[]>(mockComments);
  const [schedules, setSchedules] = useState<Schedule[]>(mockSchedules);

  const addPost = (post: Post) => {
    setPosts([post, ...posts]);
  };

  const updatePostVote = (postId: string, likes: number, dislikes: number) => {
    setPosts(posts.map(p =>
      p.id === postId ? { ...p, likes, dislikes } : p
    ));
  };

  const addComment = (comment: Comment) => {
    setComments([...comments, comment]);
    // 해당 게시글의 댓글 수 업데이트
    setPosts(posts.map(p =>
      p.id === comment.postId
        ? { ...p, commentCount: p.commentCount + 1 }
        : p
    ));
  };

  const addSchedule = (schedule: Schedule) => {
    setSchedules([...schedules, schedule]);
  };

  const deleteSchedule = (scheduleId: string) => {
    setSchedules(schedules.filter(s => s.id !== scheduleId));
  };

  return (
    <DataContext.Provider
      value={{
        employees,
        setEmployees,
        posts,
        setPosts,
        addPost,
        updatePostVote,
        comments,
        setComments,
        addComment,
        schedules,
        setSchedules,
        addSchedule,
        deleteSchedule,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
