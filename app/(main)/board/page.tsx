'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Search, Star, Pin } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type TabType = 'all' | 'best' | 'notice';

interface Post {
  id: string;
  author_id: string;
  title: string;
  content: string;
  is_notice: boolean;
  image_urls: string[] | null;
  likes_count: number;
  views_count: number;
  created_at: string;
  profiles: { display_name: string | null; email: string | null } | null;
  comment_count: number;
}

export default function BoardPage() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [loading, setLoading] = useState(true);

  const isAdmin = profile?.role === 'admin';
  const BEST_RATIO = 0.7; // 인기글 기준: 전체 유저의 70%

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const [postsRes, profilesRes] = await Promise.all([
      supabase
        .from('posts')
        .select('*, profiles(display_name, email)')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);

    // 댓글 수 가져오기
    const postsData = postsRes.data || [];
    const postIds = postsData.map((p) => p.id);

    let commentCounts: Record<string, number> = {};
    if (postIds.length > 0) {
      const { data: comments } = await supabase
        .from('post_comments')
        .select('post_id');

      if (comments) {
        for (const c of comments) {
          commentCounts[c.post_id] = (commentCounts[c.post_id] || 0) + 1;
        }
      }
    }

    setPosts(
      postsData.map((p) => ({
        ...p,
        comment_count: commentCounts[p.id] || 0,
      }))
    );
    setTotalUsers(profilesRes.count || 0);
    setLoading(false);
  }

  const bestThreshold = Math.max(1, Math.floor(totalUsers * BEST_RATIO));
  const isBestPost = (post: Post) => post.likes_count >= bestThreshold;

  const getFilteredPosts = () => {
    let filtered = posts;

    if (activeTab === 'best') {
      filtered = filtered.filter(isBestPost);
    } else if (activeTab === 'notice') {
      filtered = filtered.filter((p) => p.is_notice);
    }

    if (searchTerm) {
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.content.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  // 공지사항을 항상 맨 위에 + 나머지
  const filteredPosts = getFilteredPosts();
  const noticePosts = activeTab !== 'notice' ? filteredPosts.filter((p) => p.is_notice) : [];
  const regularPosts = activeTab !== 'notice' ? filteredPosts.filter((p) => !p.is_notice) : filteredPosts;
  const displayPosts = [...noticePosts, ...regularPosts];

  async function handleToggleNotice(postId: string, currentNotice: boolean) {
    const { error } = await supabase
      .from('posts')
      .update({ is_notice: !currentNotice })
      .eq('id', postId);
    if (!error) fetchData();
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg bg-white p-4 shadow">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">게시판</h1>
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
          {[
            { key: 'all' as TabType, label: '전체글' },
            { key: 'best' as TabType, label: '인기글' },
            { key: 'notice' as TabType, label: '공지' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-4 py-3 text-sm font-bold transition ${
                activeTab === tab.key
                  ? 'border-b-2 border-blue-600 bg-blue-50 text-blue-600 -mb-0.5'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
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
              {isAdmin && <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">관리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {displayPosts.map((post, index) => {
              const isTop = isBestPost(post);
              return (
                <tr key={post.id} className={`hover:bg-gray-50 ${post.is_notice ? 'bg-yellow-50' : ''}`}>
                  <td className="px-4 py-3 text-center text-sm">
                    {post.is_notice ? (
                      <Pin className="mx-auto h-4 w-4 text-red-500" />
                    ) : isTop ? (
                      <Star className="mx-auto h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ) : (
                      <span className="text-gray-700">{displayPosts.length - index}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/board/${post.id}`} className="group flex items-center gap-2">
                      {post.is_notice && (
                        <span className="rounded bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">공지</span>
                      )}
                      {isTop && !post.is_notice && (
                        <span className="rounded bg-yellow-500 px-1.5 py-0.5 text-xs font-bold text-white">인기</span>
                      )}
                      <span className="text-sm text-gray-900 group-hover:text-blue-600 group-hover:underline">
                        {post.title}
                      </span>
                      {post.image_urls && post.image_urls.length > 0 && (
                        <span className="text-xs text-gray-400">[이미지]</span>
                      )}
                      {post.comment_count > 0 && (
                        <span className="flex items-center gap-1 text-xs text-blue-600">
                          <MessageSquare className="h-3 w-3" />
                          [{post.comment_count}]
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700">
                    {post.profiles?.display_name || post.profiles?.email || '알 수 없음'}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">
                    {new Date(post.created_at).toLocaleDateString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-700">{post.views_count}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-medium ${isTop ? 'text-yellow-600' : 'text-blue-600'}`}>
                      {post.likes_count}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleNotice(post.id, post.is_notice)}
                        className={`text-xs font-medium ${
                          post.is_notice ? 'text-red-600 hover:text-red-800' : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {post.is_notice ? '공지해제' : '공지등록'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {displayPosts.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-gray-500">
              {activeTab === 'best' ? '인기글이 없습니다.' : activeTab === 'notice' ? '공지사항이 없습니다.' : '게시글이 없습니다.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
