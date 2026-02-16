'use client';

import { useState } from 'react';
import { ArrowLeft, ThumbsUp, ThumbsDown } from 'lucide-react';
import Link from 'next/link';
import { useData } from '@/contexts/DataContext';

export default function PostDetailPageClient({ postId }: { postId: string }) {
  const { posts, comments: allComments, addComment, updatePostVote } = useData();
  const post = posts.find((p) => p.id === postId);
  const comments = allComments.filter((c) => c.postId === postId);
  const [newComment, setNewComment] = useState('');
  const [userVote, setUserVote] = useState<'like' | 'dislike' | null>(null);

  if (!post) {
    return (
      <div className="rounded-lg bg-white p-12 text-center shadow">
        <p className="text-gray-500">게시글을 찾을 수 없습니다.</p>
      </div>
    );
  }

  const handleLike = () => {
    if (!post) return;

    let newLikes = post.likes;
    let newDislikes = post.dislikes;

    if (userVote === 'like') {
      newLikes = post.likes - 1;
      setUserVote(null);
    } else {
      if (userVote === 'dislike') {
        newDislikes = post.dislikes - 1;
      }
      newLikes = post.likes + 1;
      setUserVote('like');
    }

    updatePostVote(postId, newLikes, newDislikes);
  };

  const handleDislike = () => {
    if (!post) return;

    let newLikes = post.likes;
    let newDislikes = post.dislikes;

    if (userVote === 'dislike') {
      newDislikes = post.dislikes - 1;
      setUserVote(null);
    } else {
      if (userVote === 'like') {
        newLikes = post.likes - 1;
      }
      newDislikes = post.dislikes + 1;
      setUserVote('dislike');
    }

    updatePostVote(postId, newLikes, newDislikes);
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    const comment = {
      id: String(allComments.length + 1),
      postId: postId,
      authorId: '1',
      authorName: '김철수',
      content: newComment,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    addComment(comment);
    setNewComment('');
  };

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/board" className="text-blue-600 hover:underline">
          갤러리
        </Link>
        <span className="text-gray-400">&gt;</span>
        <span className="text-gray-700">게시글</span>
      </div>

      {/* Post Content */}
      <div className="rounded-lg bg-white shadow">
        {/* Header */}
        <div className="border-b border-gray-200 p-4">
          <h1 className="text-xl font-bold text-gray-900">{post.title}</h1>
          <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
            <span className="font-medium">{post.authorName}</span>
            <span className="text-gray-400">|</span>
            <span>{new Date(post.createdAt).toLocaleString('ko-KR')}</span>
            <span className="text-gray-400">|</span>
            <span>조회 {post.likes + post.dislikes + 150}</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="min-h-40 whitespace-pre-wrap text-gray-800">{post.content}</div>
        </div>

        {/* Vote Buttons */}
        <div className="border-t border-gray-200 bg-gray-50 p-6">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleLike}
              className={`flex min-w-24 flex-col items-center gap-2 rounded-lg border-2 px-6 py-4 transition ${
                userVote === 'like'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
              }`}
            >
              <ThumbsUp className={`h-6 w-6 ${userVote === 'like' ? 'text-blue-600' : 'text-gray-600'}`} />
              <span className={`text-lg font-bold ${userVote === 'like' ? 'text-blue-600' : 'text-gray-700'}`}>
                {post.likes}
              </span>
              <span className="text-xs text-gray-600">개념글</span>
            </button>

            <button
              onClick={handleDislike}
              className={`flex min-w-24 flex-col items-center gap-2 rounded-lg border-2 px-6 py-4 transition ${
                userVote === 'dislike'
                  ? 'border-red-500 bg-red-50'
                  : 'border-gray-300 bg-white hover:border-red-400 hover:bg-red-50'
              }`}
            >
              <ThumbsDown className={`h-6 w-6 ${userVote === 'dislike' ? 'text-red-600' : 'text-gray-600'}`} />
              <span className={`text-lg font-bold ${userVote === 'dislike' ? 'text-red-600' : 'text-gray-700'}`}>
                {post.dislikes}
              </span>
              <span className="text-xs text-gray-600">비추</span>
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
          {comments.map((comment, index) => (
            <div key={comment.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900">{comment.authorName}</span>
                    <span className="text-xs text-gray-500">
                      {new Date(comment.createdAt).toLocaleString('ko-KR')}
                    </span>
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
