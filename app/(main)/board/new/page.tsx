'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ImagePlus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function NewPostPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, profile } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = profile?.role === 'admin';

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (images.length + files.length > 5) {
      alert('이미지는 최대 5장까지 첨부할 수 있습니다.');
      return;
    }
    setImages((prev) => [...prev, ...files]);
    const newPreviews = files.map((file) => URL.createObjectURL(file));
    setPreviews((prev) => [...prev, ...newPreviews]);
  }

  function removeImage(index: number) {
    URL.revokeObjectURL(previews[index]);
    setImages((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    // 이미지 업로드
    const imageUrls: string[] = [];
    for (const file of images) {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('post-images').upload(path, file);
      if (!error) {
        const { data: urlData } = supabase.storage.from('post-images').getPublicUrl(path);
        imageUrls.push(urlData.publicUrl);
      }
    }

    const { error } = await supabase.from('posts').insert({
      author_id: user.id,
      title,
      content,
      image_urls: imageUrls.length > 0 ? imageUrls : null,
    });

    if (error) {
      alert('게시글 작성 실패: ' + error.message);
    } else {
      router.push('/board');
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-4">
      {/* Navigation */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/board" className="text-blue-600 hover:underline">
          게시판
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
                rows={15}
                className="w-full rounded border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="내용을 입력하세요"
              />
            </div>

            {/* Image Upload */}
            <div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <ImagePlus className="h-4 w-4" />
                  사진 첨부 ({images.length}/5)
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </div>

              {previews.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {previews.map((src, i) => (
                    <div key={i} className="group relative">
                      <img src={src} alt="" className="h-24 w-24 rounded-lg border object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute -right-2 -top-2 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
            disabled={submitting}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? '작성 중...' : '작성완료'}
          </button>
        </div>
      </form>
    </div>
  );
}
