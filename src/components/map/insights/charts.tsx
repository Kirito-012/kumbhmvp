'use client'

import { useEffect, useState } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import {
  BUCKET_COLORS,
  BUCKET_ORDER,
  BUCKET_LABELS,
  type StatusBucket,
} from '@/lib/insights/statusBuckets'
import type { Theme } from '@/lib/insights/heatScale'
import type { SectorTrendDay } from '@/lib/insights/types'

/**
 * Mirrors MapView's readMapTheme()/theme-swap MutationObserver, but for React-rendered panel
 * content rather than MapLibre paint properties. BUCKET_COLORS' light/dark hexes -- not a
 * `--map-*` CSS variable -- are the source of truth for status colour (PLAN-heatmap.md §6: "reuse
 * BUCKET_COLORS ... don't invent a second palette"), so a parcel's colour on the map and its
 * swatch here always match; this hook is the one place in the panels that needs the theme as a
 * JS value instead of leaving it to the cascade.
 */
export function useInsightTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark',
  )
  useEffect(() => {
    const root = document.documentElement
    const read = () => setTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

export function bucketColor(bucket: StatusBucket, theme: Theme): string {
  return BUCKET_COLORS[bucket][theme]
}

/** Centred "% resolved" ring for Ticket mode's hero block (PLAN-heatmap.md §6.2 item 1). */
export function ProgressRing({
  percent,
  size = 96,
  strokeWidth = 9,
  label,
  sublabel,
}: {
  percent: number
  size?: number
  strokeWidth?: number
  label: string
  sublabel?: string
}) {
  const theme = useInsightTheme()
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = circumference * (1 - clamped / 100)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          stroke="var(--map-border)"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke={bucketColor('resolved', theme)}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span
          className="text-[17px] font-semibold leading-none tabular-nums"
          style={{ color: 'var(--map-fg)' }}
        >
          {label}
        </span>
        {sublabel && (
          <span className="text-[9.5px] leading-none" style={{ color: 'var(--map-fg-faint)' }}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  )
}

/** One-row, four-segment bar of bucket counts (Ticket mode's hero, and reused for the status &
 *  progress block's own proportion read) -- segments with zero count are simply omitted rather
 *  than rendered as a zero-width sliver. */
export function StackedStatusBar({
  counts,
  total,
  height = 7,
}: {
  counts: Record<StatusBucket, number>
  total: number
  height?: number
}) {
  const theme = useInsightTheme()
  if (total <= 0) {
    return (
      <div
        className="w-full rounded-full"
        style={{ height, background: 'var(--map-border)' }}
        aria-hidden
      />
    )
  }
  return (
    <div
      className="flex w-full overflow-hidden rounded-full"
      style={{ height, background: 'var(--map-border)' }}
      role="img"
      aria-label={BUCKET_ORDER.map((b) => `${BUCKET_LABELS[b]}: ${counts[b] ?? 0}`).join(', ')}
    >
      {BUCKET_ORDER.map((bucket) => {
        const count = counts[bucket] ?? 0
        if (count <= 0) return null
        return (
          <div
            key={bucket}
            style={{
              width: `${(count / total) * 100}%`,
              background: bucketColor(bucket, theme),
              transition: 'width 300ms ease-out',
            }}
          />
        )
      })}
    </div>
  )
}

/** Compact 7-day created-vs-resolved trend (PLAN-heatmap.md §6.2 item 4), styled down from
 *  dashboard/VolumeChart.tsx's full axed chart -- no axes/gridlines, just the two area strokes and
 *  a tooltip, sized to sit inline in a ~300px-wide sidebar block rather than a dashboard card. */
export function Sparkline({ data }: { data: SectorTrendDay[] }) {
  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
          <defs>
            <linearGradient id="insight-trend-created" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--map-accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--map-accent)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="insight-trend-resolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--map-mode-tickets)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--map-mode-tickets)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" hide />
          <Tooltip
            cursor={{ stroke: 'var(--map-border)', strokeWidth: 1 }}
            contentStyle={{
              background: 'var(--map-popup-bg)',
              border: '1px solid var(--map-popup-border)',
              borderRadius: 8,
              fontSize: 11,
              boxShadow: '0 8px 24px -6px rgba(0,0,0,0.5)',
            }}
            labelStyle={{ color: 'var(--map-popup-heading)', fontWeight: 600, marginBottom: 2 }}
          />
          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="var(--map-accent)"
            strokeWidth={1.5}
            fill="url(#insight-trend-created)"
          />
          <Area
            type="monotone"
            dataKey="resolved"
            name="Resolved"
            stroke="var(--map-mode-tickets)"
            strokeWidth={1.5}
            fill="url(#insight-trend-resolved)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
