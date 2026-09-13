'use client'

import { useEffect, useRef, useState } from 'react'
import type { SectorInsights } from '@/lib/insights/types'

export type SectorInsightsState = {
  data: SectorInsights | null
  loading: boolean
  error: string | null
}

/** URL segment for a given `insightSector` value -- `null` means the workspace overview (no
 *  sector selected), which hits the same route's "all" branch rather than a fourth, parallel
 *  fetch path. See PLAN-heatmap.md §6.2's "with no sector selected it shows the workspace
 *  overview, with the same blocks computed over all tickets". */
function targetFor(sector: number | 'peripheral' | null): string {
  if (sector === null) return 'all'
  if (sector === 'peripheral') return 'peripheral'
  return String(sector)
}

/**
 * Fetches /api/insights/sectors/:sectorNo whenever `sector` changes, while `active` (Heatmap or
 * Ticket mode is on). Mirrors useTicketInsights.ts's shape (data/loading/error/refetch) but keyed
 * on `sector` instead of a one-time `active` transition, since this is the on-demand half of the
 * data contract (PLAN-heatmap.md §3.3) -- every sector click is a fresh, small request rather than
 * something derivable from the bulk tuple array already cached client-side.
 */
export function useSectorInsights(
  active: boolean,
  sector: number | 'peripheral' | null,
): SectorInsightsState & { refetch: () => void } {
  const [data, setData] = useState<SectorInsights | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const requestIdRef = useRef(0)
  // Skips a redundant re-fetch when `active` flips back on for the same sector/nonce (e.g.
  // leaving and re-entering Heatmap mode without picking a different sector) -- mirrors
  // useTicketInsights.ts's fetchedRef idempotency guard, keyed on sector+nonce instead of "ever".
  const lastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!active) return
    const key = `${targetFor(sector)}:${nonce}`
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key
    const requestId = ++requestIdRef.current
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/insights/sectors/${targetFor(sector)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`)
        return r.json() as Promise<SectorInsights>
      })
      .then((json) => {
        // A slower, superseded request (e.g. clicking two sectors in quick succession) must not
        // clobber the result of a request started after it.
        if (cancelled || requestId !== requestIdRef.current) return
        setData(json)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled || requestId !== requestIdRef.current) return
        setError(e.message || 'Failed to load sector insights')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, sector, nonce])

  function refetch() {
    setNonce((n) => n + 1)
  }

  return { data, loading, error, refetch }
}
