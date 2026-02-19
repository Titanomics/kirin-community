'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ThumbsUp, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

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
}

interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  profiles: { display_name: string | null; email: string | null } | null;
}

export default function PostDetailPageClient({ postId }: { postId: string }) {
  const supabase = createClient();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [hasLiked, setHasLiked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPost();
    fetchComments();
    checkLikeStatus();
    incrementViews();
  }, [postId]);

  async function fetchPost() {
    try {
      const { data } = await supabase
        .from('posts')
        .select('*, profiles(display_name, email)')
        .eq('id', postId)
        .single();
      setPost(data);
    } catch (err) {
      console.error('게시글 로딩 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchComments() {
    const { data } = await supabase
      .from('post_comments')
      .select('*, profiles(display_name, email)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    setComments(data || []);
  }

  async function checkLikeStatus() {
    if (!user) return;
    const { data } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', user.id)
      .maybeSingle();
    setHasLiked(!!data);
  }

  async function incrementViews() {
    const { error } = await supabase.rpc('increment_views', { post_id: postId });
    if (error) {
      await supabase.from('posts').update({ views_count: (post?.views_count || 0) + 1 }).eq('id', postId);
    }
  }

  async function handleLike() {
    if (!user) return;
    if (hasLiked) {
      await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id);
      setHasLiked(false);
    } else {
      await supabase.from('post_likes').insert({ post_id: postId, user_id: user.id });
      setHasLiked(true);
    }
    await fetchPost();
  }

  async function handleCommentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim() || !user) return;

    await supabase.from('post_comments').insert({
      post_id: postId,
      author_id: user.id,
      content: newComment,
    });
    setNewComment('');
    await fetchComments();
  }

  async function handleDeleteComment(commentId: string) {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    await supabase.from('post_comments').delete().eq('id', commentId);
    await fetchComments();
  }

  async function handleDeletePost() {
    if (!confirm('게시글을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('posts').delete().eq('id', postId);
    if (!error) {
      window.location.href = '/board';
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  if (!post) {
    return (
      <div className="rounded-lg bg-white p-12 text-center shadow">
        <p className="text-gray-500">게시글을 찾을 수 없습니다.</p>
      </div>
    );
  }

  const isAuthor = user?.id === post.author_id;

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/board" className="text-blue-600 hover:underline">
          게시판
        </Link>
        <span className="text-gray-400">&gt;</span>
        <span className="text-gray-700">게시글</span>
      </div>

      {/* Post Content */}
      <div className="rounded-lg bg-white shadow">
        {/* Header */}
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-start justify-between">
            <div>
              {post.is_notice && (
                <span className="mb-2 inline-block rounded bg-red-500 px-2 py-0.5 text-xs font-bold text-white">공지</span>
              )}
              <h1 className="text-xl font-bold text-gray-900">{post.title}</h1>
            </div>
            {isAuthor && (
              <button
                onClick={handleDeletePost}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                삭제
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
            <span className="font-medium">
              {post.profiles?.display_name || post.profiles?.email || '알 수 없음'}
            </span>
            <span className="text-gray-400">|</span>
            <span>{new Date(post.created_at).toLocaleString('ko-KR')}</span>
            <span className="text-gray-400">|</span>
            <span>조회 {post.views_count}</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="min-h-40 whitespace-pre-wrap text-gray-800">{post.content}</div>

          {/* Images */}
          {post.image_urls && post.image_urls.length > 0 && (
            <div className="mt-6 space-y-4">
              {post.image_urls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`첨부 이미지 ${i + 1}`}
                  className="max-w-full rounded-lg border"
                />
              ))}
            </div>
          )}
        </div>

        {/* Like Button */}
        <div className="border-t border-gray-200 bg-gray-50 p-6">
          <div className="flex items-center justify-center">
            <button
              onClick={handleLike}
              className={`flex min-w-28 flex-col items-center gap-2 rounded-lg border-2 px-6 py-4 transition ${
                hasLiked
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
              }`}
            >
              <ThumbsUp className={`h-6 w-6 ${hasLiked ? 'text-blue-600' : 'text-gray-600'}`} />
              <span className={`text-lg font-bold ${hasLiked ? 'text-blue-600' : 'text-gray-700'}`}>
                {post.likes_count}
              </span>
              <span className="text-xs text-gray-600">추천</span>
            </button>
          </div>
        </div>
      </div>

      {/* Comments Section */}
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="font-bold text-gray-900">
            댓글 <span className="text-blue-600">{comments.length}</span>개
          </h2>
        </div>

        {/* Comment Form */}
        <div className="border-b border-gray-200 p-4">
          <form onSubmit={handleCommentSubmit} className="space-y-3">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="댓글을 입력하세요"
              rows={3}
              className="w-full rounded border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                댓글 작성
              </button>
            </div>
          </form>
        </div>

        {/* Comments List */}
        <div className="divide-y divide-gray-200">
          {comments.map((comment) => (
            <div key={comment.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
                  {(comment.profiles?.display_name || comment.profiles?.email || '?').charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-900">
                        {comment.profiles?.display_name || comment.profiles?.email || '알 수 없음'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(comment.created_at).toLocaleString('ko-KR')}
                      </span>
                    </div>
                    {user?.id === comment.author_id && (
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-gray-800">{comment.content}</p>
                </div>
              </div>
            </div>
          ))}

          {comments.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-gray-500">첫 댓글을 작성해보세요!</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow">
        <Link
          href="/board"
          className="flex items-center gap-2 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" />
          목록
        </Link>
        <Link
          href="/board/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          글쓰기
        </Link>
      </div>
    </div>
  );
}
