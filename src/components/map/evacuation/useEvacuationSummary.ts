'use client'

import { useEffect, useRef, useState } from 'react'
import type { EvacFocus } from '@/lib/evacuation/layers'

export type EvacSummaryFeature = {
  id: number | string
  label: string
  sublabel: string | null
  bbox: [number, number, number, number] | null
  anchor: [number, number] | null
}

export type EvacSummaryFocus = {
  sectorNo: number | null
  zone: string | null
  layers: { layer: string; features: EvacSummaryFeature[] }[]
  care: EvacSummaryFeature[]
}

export type EvacSummary = {
  counts: Record<string, number>
  zones: { zone: string; geojson: unknown; bbox: [number, number, number, number] }[]
  focus: EvacSummaryFocus | null
}

/**
 * Debounce-free fetch of /api/evacuation/summary (PLAN-evacuation.md §7.3/§8.2), re-run whenever
 * `evacFocus` changes (sector/zone/overview) -- same AbortController-per-request shape as
 * useEvacuationSearch, but no debounce since evacFocus only changes on a deliberate
 * click/search-select, never on every keystroke.
 */
export function useEvacuationSummary(evacFocus: EvacFocus) {
  const [summary, setSummary] = useState<EvacSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (evacFocus?.kind === 'sector') params.set('sector', String(evacFocus.sectorNo))
    else if (evacFocus?.kind === 'zone') params.set('zone', evacFocus.zone)
    const qs = params.toString()
    fetch(`/api/evacuation/summary${qs ? `?${qs}` : ''}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`summary failed: ${r.status}`)
        return r.json()
      })
      .then((data: EvacSummary) => {
        setSummary(data)
        setLoading(false)
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setError('Could not load evacuation summary')
        setLoading(false)
      })
    return () => controller.abort()
  }, [evacFocus])

  return { summary, loading, error }
}
