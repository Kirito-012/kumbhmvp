'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const REFRESH_MS = 60_000

// Silently re-runs the dashboard's server component (router.refresh() re-fetches getDashboardData
// on the server and streams in fresh props, no client-visible reload/flash) every 60s, so numbers
// don't go stale if the page is left open on a screen. Paused while the tab isn't visible, so it
// doesn't keep hitting the DB for a backgrounded/minimized tab nobody is looking at.
export function DashboardAutoRefresh() {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const start = () => {
      if (timerRef.current) return
      timerRef.current = setInterval(() => router.refresh(), REFRESH_MS)
    }
    const stop = () => {
      if (!timerRef.current) return
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    const handleVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [router])

  return null
}
