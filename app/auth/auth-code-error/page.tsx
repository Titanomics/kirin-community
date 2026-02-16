import Link from 'next/link'

export default function AuthCodeError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">인증 오류</h1>
        <p className="text-gray-600 mb-6">로그인 처리 중 문제가 발생했습니다. 다시 시도해주세요.</p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          로그인 페이지로 돌아가기
        </Link>
      </div>
    </div>
  )
}
