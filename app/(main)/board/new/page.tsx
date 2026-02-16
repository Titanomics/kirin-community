'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useData } from '@/contexts/DataContext';

export default function NewPostPage() {
  const router = useRouter();
  const { addPost, posts } = useData();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newPost = {
      id: String(posts.length + 1),
      authorId: '1',
      authorName: '김철수',
      title,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likes: 0,
      dislikes: 0,
      likedBy: [],
      dislikedBy: [],
      commentCount: 0,
    };

    addPost(newPost);
    alert('게시글이 작성되었습니다!');
    router.push('/board');
  };

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/board" className="text-blue-600 hover:underline">
          갤러리
        </Link>
        <span className="text-gray-400">&gt;</span>
        <span className="text-gray-700">글쓰기</span>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-white shadow">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h1 className="font-bold text-gray-900">글쓰기</h1>
          </div>

          <div className="space-y-4 p-4">
            <div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="제목을 입력하세요"
              />
            </div>

            <div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
                rows={20}
                className="w-full rounded border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="내용을 입력하세요"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 rounded-lg bg-white p-4 shadow">
          <Link
            href="/board"
            className="rounded border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            취소
          </Link>
          <button
            type="submit"
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            작성완료
          </button>
        </div>
      </form>
    </div>
  );
}
