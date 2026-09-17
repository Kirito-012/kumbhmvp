'use client'

import { useEffect, useRef, useState } from 'react'
import type { InsightsTicketData } from '@/lib/insights/types'

export type TicketInsightsState = {
  data: InsightsTicketData | null
  loading: boolean
  error: string | null
}

/**
 * Fetches /api/insights/tickets once per `active` transition to true (entering Heatmap or Ticket
 * mode), not on every render or filter change -- filtering/recolouring after that runs entirely
 * client-side against the cached `data` (see PLAN-heatmap.md §3.3). Never fetches while inactive,
 * so a Surveyor session (canUseInsights false, `active` always false) never even calls the
 * 401/403-gated route.
 */
export function useTicketInsights(active: boolean): TicketInsightsState & { refetch: () => void } {
  const [data, setData] = useState<InsightsTicketData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!active) return
    if (fetchedRef.current && nonce === 0) return
    fetchedRef.current = true
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/api/insights/tickets')
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json() as Promise<InsightsTicketData>
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message || 'Failed to load insights data')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, nonce])

  function refetch() {
    fetchedRef.current = false
    setNonce((n) => n + 1)
  }

  return { data, loading, error, refetch }
}
