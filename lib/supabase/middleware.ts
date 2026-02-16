import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isLoginPage = pathname === '/login'
  const isAdminLoginPage = pathname === '/admin/login'
  const isAuthRoute = pathname.startsWith('/auth')
  const isAdminRoute = pathname.startsWith('/admin') && !isAdminLoginPage

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
  }

  return supabaseResponse
}
