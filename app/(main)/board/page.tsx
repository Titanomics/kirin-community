'use client';

import { useState } from 'react';
import { MessageSquare, Search, Star } from 'lucide-react';
import Link from 'next/link';
import { useData } from '@/contexts/DataContext';

type TabType = 'all' | 'best' | 'notice';

export default function BoardPage() {
  const { posts } = useData();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('all');

  const BEST_THRESHOLD = 20; // 개념글 기준 추천수

  // 개념글 판별 함수
  const isBestPost = (post: typeof posts[0]) => post.likes >= BEST_THRESHOLD;

  // 탭에 따른 필터링
  const getFilteredPosts = () => {
    let filtered = posts;

    // 탭 필터링
    if (activeTab === 'best') {
      filtered = filtered.filter(isBestPost);
    } else if (activeTab === 'notice') {
      // 공지사항은 나중에 추가 가능
      filtered = [];
    }

    // 검색 필터링
    if (searchTerm) {
      filtered = filtered.filter(
        (post) =>
          post.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          post.content.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  const filteredPosts = getFilteredPosts();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg bg-white p-4 shadow">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">갤러리</h1>
          <Link
            href="/board/new"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            글쓰기
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-lg bg-white shadow">
        <div className="flex border-b-2 border-gray-300">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex-1 px-4 py-3 text-sm font-bold transition ${
              activeTab === 'all'
                ? 'border-b-2 border-blue-600 bg-blue-50 text-blue-600 -mb-0.5'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            전체글
          </button>
          <button
            onClick={() => setActiveTab('best')}
            className={`flex-1 px-4 py-3 text-sm font-bold transition ${
              activeTab === 'best'
                ? 'border-b-2 border-blue-600 bg-blue-50 text-blue-600 -mb-0.5'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            개념글
          </button>
          <button
            onClick={() => setActiveTab('notice')}
            className={`flex-1 px-4 py-3 text-sm font-bold transition ${
              activeTab === 'notice'
                ? 'border-b-2 border-blue-600 bg-blue-50 text-blue-600 -mb-0.5'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            공지
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-lg bg-white p-4 shadow">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="검색어를 입력하세요"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Posts Table */}
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <table className="w-full">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">번호</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">제목</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">글쓴이</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">작성일</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">조회</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">추천</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredPosts.map((post, index) => {
              const isTopPost = isBestPost(post);
              return (
                <tr key={post.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-center text-sm">
                    {isTopPost ? (
                      <Star className="mx-auto h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ) : (
                      <span className="text-gray-700">{filteredPosts.length - index}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/board/${post.id}`} className="group flex items-center gap-2">
                      <span className="text-sm text-gray-900 group-hover:text-blue-600 group-hover:underline">
                        {post.title}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-blue-600">
                        <MessageSquare className="h-3 w-3" />
                        [{post.commentCount}]
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700">
                    {post.authorName}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">
                    {new Date(post.createdAt).toLocaleDateString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700">
                    {post.likes + post.dislikes + 100}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-medium ${isTopPost ? 'text-yellow-600' : 'text-blue-600'}`}>
                      {post.likes}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredPosts.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-gray-500">검색 결과가 없습니다.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex justify-center gap-2 rounded-lg bg-white p-4 shadow">
        <button className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100">
          이전
        </button>
        <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white">1</button>
        <button className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100">
          2
        </button>
        <button className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100">
          3
        </button>
        <button className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100">
          다음
        </button>
      </div>
    </div>
  );
}
