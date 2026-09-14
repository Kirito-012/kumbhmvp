'use client'

import { useEffect, useRef, useState } from 'react'

export type EvacSearchResult = {
  id: number | string
  label: string
  sublabel: string | null
  sectorNo: number | null
  sectorName: string | null
  zone: string | null
  bbox: [number, number, number, number] | null
  anchor: [number, number] | null
  source: string
}

export type EvacSearchGroup = {
  layer: string
  total: number
  results: EvacSearchResult[]
}

/**
 * Debounced + abortable fetch of /api/evacuation/search (PLAN-evacuation.md §7.2/§8.1). Mirrors
 * the shape of MapView's other locate-fetch effects (see poiLocateFetchedRef and friends) but as
 * a self-contained hook, since this is the one piece of Evacuation mode's search genuinely new
 * rather than shared with Map mode's own unified search.
 *
 * 200ms debounce + AbortController (not just a monotonic token, since an in-flight request should
 * actually be cancelled, not just ignored, so a slow response for an abandoned query never even
 * finishes doing DB work) -- an older response can never overwrite a newer query's results.
 */
export function useEvacuationSearch(query: string) {
  const [groups, setGroups] = useState<EvacSearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    abortRef.current?.abort()
    if (trimmed.length < 2) {
      setGroups([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    const timer = setTimeout(() => {
      fetch(`/api/evacuation/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`search failed: ${r.status}`)
          return r.json()
        })
        .then((data: { groups: EvacSearchGroup[] }) => {
          setGroups(data.groups ?? [])
          setLoading(false)
        })
        .catch((err) => {
          if (err?.name === 'AbortError') return
          setError('Search failed')
          setLoading(false)
        })
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  return { groups, loading, error }
}
