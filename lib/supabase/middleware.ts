import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Vercel 미들웨어 전체 제한(25초)보다 훨씬 짧게 끊어서 504 대신 페이지를 그대로 내보낸다.
const AUTH_FETCH_TIMEOUT_MS = 5000

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
  })
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const pathname = request.nextUrl.pathname
  const isLoginPage = pathname === '/login'
  const isAdminLoginPage = pathname === '/admin/login'
  const isAuthRoute = pathname.startsWith('/auth')
  const isAdminRoute = pathname.startsWith('/admin') && !isAdminLoginPage

  // 쿠키 자체가 없으면 Supabase에 물어볼 필요 없이 바로 로그인으로 보낸다 (네트워크 호출 0회)
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))

  let user: { id: string } | null = null
  let authUnavailable = false

  if (hasAuthCookie) {
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch (err) {
      // 인증 서버 지연/장애: 차단하지 말고 통과시켜 페이지/API 단에서 다시 판단하게 한다
      authUnavailable = true
      console.error('[middleware] auth.getUser failed, passing through:', err)
    }
  }

  // Allow access to login pages and auth routes without authentication
  if (isLoginPage || isAdminLoginPage || isAuthRoute) {
    // Redirect authenticated users away from general login page
    if (user && isLoginPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  if (authUnavailable) {
    return supabaseResponse
  }

  // Redirect unauthenticated users to login
  if (!user) {
    const url = request.nextUrl.clone()
    const next = pathname + request.nextUrl.search
    if (isAdminRoute) {
      url.pathname = '/admin/login'
    } else {
      url.pathname = '/login'
    }
    url.searchParams.set('next', next)
    return NextResponse.redirect(url)
  }

  // Admin route protection: check role from profiles table
  if (isAdminRoute) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') {
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
      }
    } catch (err) {
      console.error('[middleware] profiles query failed, passing through:', err)
    }
  }

  return supabaseResponse
}
