'use client'

import { useEffect, useState } from 'react'
import { BUCKET_COLORS, type StatusBucket } from '@/lib/insights/statusBuckets'
import { TicketField, type InsightsTicketData } from '@/lib/insights/types'
import { useInsightTheme } from '@/components/map/insights/useInsightTheme'

// Deliberately imports nothing from insights/charts.tsx: that module pulls in recharts, and this
// file is reachable from MapView's static SectorReportDrawer import in Map mode.

type BucketCounts = Record<StatusBucket, number>

export type Tally = { counts: BucketCounts; total: number; resolved: number }

export type SubRow = Tally & { name: string }
export type CategoryRow = Tally & { name: string; subs: SubRow[] }

export type WorkDoneSummary = Tally & { categories: CategoryRow[] }

/** Label for tickets whose parcel snapshot carries no subclass. */
export const UNSPECIFIED_SUBCLASS = 'Unspecified'

function emptyTally(): Tally {
  return { counts: { new: 0, open: 0, pending: 0, resolved: 0 }, total: 0, resolved: 0 }
}

function addTo(tally: Tally, bucket: StatusBucket) {
  tally.counts[bucket]++
  tally.total++
  if (bucket === 'resolved') tally.resolved++
}

/** Whole percent, but never rounds a partial job up to "100%" or a started one down to "0%". */
export function formatDonePct(t: Tally) {
  if (t.total === 0) return '0%'
  const pct = (t.resolved / t.total) * 100
  if (pct > 0 && pct < 1) return '<1%'
  if (pct < 100 && pct > 99) return '99%'
  return `${Math.round(pct)}%`
}

/** Rolls the sector's tickets up into category → sub-category tallies, split by status bucket. */
export function summarizeWorkDone(data: InsightsTicketData, sectorNo: number): WorkDoneSummary {
  const total = emptyTally()
  const byClass = new Map<string, { tally: Tally; subs: Map<string, Tally> }>()
  for (const t of data.tickets) {
    if (t[TicketField.SectorNo] !== sectorNo) continue
    const bucket = data.statuses[t[TicketField.StatusIdx]]?.bucket ?? 'open'
    const cls = data.classGroups[t[TicketField.ClassGroupIdx]] ?? 'Other'
    const subIdx = t[TicketField.SubclassIdx]
    const sub = (subIdx >= 0 ? data.subclasses[subIdx] : null) || UNSPECIFIED_SUBCLASS

    addTo(total, bucket)
    let entry = byClass.get(cls)
    if (!entry) {
      entry = { tally: emptyTally(), subs: new Map() }
      byClass.set(cls, entry)
    }
    addTo(entry.tally, bucket)
    let subTally = entry.subs.get(sub)
    if (!subTally) {
      subTally = emptyTally()
      entry.subs.set(sub, subTally)
    }
    addTo(subTally, bucket)
  }

  const categories: CategoryRow[] = [...byClass.entries()].map(([name, { tally, subs }]) => ({
    name,
    ...tally,
    subs: [...subs.entries()]
      .map(([subName, subTally]) => ({ name: subName, ...subTally }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  }))
  return { ...total, categories }
}

export function ProgressRing({ fraction: done, label }: { fraction: number; label: string }) {
  const theme = useInsightTheme()
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          stroke="var(--map-switch-track)"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke={BUCKET_COLORS.resolved[theme]}
          strokeDasharray={c}
          strokeDashoffset={grown ? c * (1 - done) : c}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-out"
          style={{ opacity: done > 0 ? 1 : 0 }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[15px] font-bold tabular-nums"
        style={{ color: 'var(--map-fg)' }}
      >
        {label}
      </span>
    </div>
  )
}

/** Completion pill shared by the ticket and work-head views: neutral at 0, tinted once started. */
export function PctPill({ fraction, label }: { fraction: number; label: string }) {
  const theme = useInsightTheme()
  const complete = fraction >= 1
  const color = BUCKET_COLORS.resolved[theme]
  // Green only means progress: neutral at 0%, tinted once anything is resolved, solid when done.
  const style = complete
    ? theme === 'dark'
      ? { backgroundColor: color, color: '#052e16' }
      : { backgroundColor: '#15803d', color: '#ffffff' }
    : fraction > 0
      ? {
          backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
          color: 'var(--map-fg)',
        }
      : { backgroundColor: 'var(--map-switch-track)', color: 'var(--map-fg-muted)' }
  return (
    <span
      className="inline-flex min-w-[44px] shrink-0 items-center justify-center rounded-full px-1.5 py-[3px] text-[12px] font-bold leading-none tabular-nums"
      style={style}
    >
      {complete ? '✓ Done' : label}
    </span>
  )
}

/** Wraps the first case-insensitive occurrence of `query` in an accent highlight. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark
        className="rounded-[3px] px-px"
        style={{ backgroundColor: 'var(--map-accent-bg-hover)', color: 'inherit' }}
      >
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  )
}
