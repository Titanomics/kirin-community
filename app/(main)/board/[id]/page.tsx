import PostDetailPageClient from './PostDetailPageClient';

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <PostDetailPageClient postId={id} />;
}
