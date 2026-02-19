import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      auth: {
        // Bypass navigator.locks to prevent deadlock during token refresh.
        // Supabase's _initialize() holds a lock while _callRefreshToken()
        // tries to acquire the same lock, causing permanent deadlock on reload.
        // See: https://github.com/supabase/auth-js/issues/762
        lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => {
          return await fn()
        },
      },
    }
  )
}
