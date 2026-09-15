'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
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

const REVEAL_BASE_DELAY_MS = 100
const REVEAL_STEP_MS = 70
const REVEAL_DURATION_MS = 360

/** Same stagger math Reveal below uses for its own animation-delay -- exported so a section's
 *  *contents* (AnimatedBar via pillEntranceDelayMs) can key off exactly when that section starts
 *  fading in, without duplicating the `100 + index * 70` formula at every call site. */
function revealDelayMs(index: number): number {
  return REVEAL_BASE_DELAY_MS + index * REVEAL_STEP_MS
}

/** Staggers a Heatmap/Ticket mode panel's top-level sections into view on mount -- pairs with
 *  Panel's `entrance="slide"` so the docked panel itself slides in and its content cascades in
 *  right behind it, rather than the whole block popping in flat. `index` sets the stagger order
 *  (gaps between indices are fine -- callers skip indices for sections that are conditionally
 *  absent). Reuses the dashboard's existing fade-in keyframe (globals.css) rather than inventing a
 *  second "fade up" animation that looks the same. */
export function Reveal({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div
      className="animate-[fade-in_360ms_ease-out_backwards]"
      style={{ animationDelay: `${revealDelayMs(index)}ms` }}
    >
      {children}
    </div>
  )
}

/** When an AnimatedBar lives inside a `<Reveal index={n}>` section, its entrance grow-in needs to
 *  start once that section has finished fading in -- not at the same instant it mounts. A bar's own
 *  useEffect/rAF fires immediately on mount regardless of the *parent's* CSS animation-delay, so
 *  without this a bar nested a few Reveal steps deep would finish growing (500ms after mount) while
 *  its section is still sitting at opacity 0 (still inside its own animation-delay), or barely
 *  visible for a frame or two right as the fade-in completes -- the grow effect the bar is supposed
 *  to show ends up invisible. Passing this as `delayMs` holds the bar at 0% until the section is
 *  fully faded in, so the whole grow animation plays out on a section the user can actually see. */
export function pillEntranceDelayMs(index: number): number {
  return revealDelayMs(index) + REVEAL_DURATION_MS
}

/** The coloured "pill" progress bar used all over the insights panels (Categories rows, Priority
 *  rows, the sector-ranked list, ...) -- a rounded track with a filled, coloured inner bar sized to
 *  `percent`. Starts at 0 width and animates up to `percent` after `delayMs` (one rAF tick past the
 *  timeout so the browser actually sees the 0% frame before the transition kicks in -- setting the
 *  target width in the same tick the DOM node appears would just paint it at full width with
 *  nothing to transition from), and keeps transitioning smoothly whenever `percent` changes
 *  afterwards (e.g. a filter narrowing the counts) -- `delayMs` only ever holds up that first grow,
 *  never a later value change, via the mountedRef guard below. `fill` is a full CSS background
 *  value, not just a colour, so callers that want a gradient fill (StatusHoverCard below) don't need
 *  their own bar markup. */
export function AnimatedBar({
  percent,
  fill,
  height = 6,
  trackClassName = 'w-full',
  delayMs = 0,
}: {
  percent: number
  fill: string
  height?: number
  trackClassName?: string
  /** Delay before the *initial* grow-in only -- see pillEntranceDelayMs for the common case of a
   *  bar nested inside a Reveal section. Defaults to 0 for bars that aren't part of an entrance
   *  sequence (e.g. the hover-card bar, which should react the instant it's hovered). */
  delayMs?: number
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const [width, setWidth] = useState(0)
  // Flips to true only once the delayed grow-in has actually fired (inside the setTimeout
  // callback below) -- NOT synchronously when the effect first runs. React 18 Strict Mode
  // double-invokes every mount effect in dev (mount -> cleanup -> mount again) to surface exactly
  // this kind of bug: setting the ref eagerly at the top of the first (throwaway) invocation made
  // it look, to the second (real) invocation, like the delayed grow had already happened, so the
  // delay got skipped entirely and the bar jumped near-instantly. Cancelling the throwaway timer
  // in its cleanup before it ever fires keeps the ref false until a real, uncancelled delay
  // completes -- in dev that's the second invocation; in production (no double-invoke) it's the
  // only one.
  const hasGrownRef = useRef(false)
  useEffect(() => {
    if (!hasGrownRef.current) {
      const timer = setTimeout(() => {
        hasGrownRef.current = true
        requestAnimationFrame(() => setWidth(clamped))
      }, delayMs)
      return () => clearTimeout(timer)
    }
    const raf = requestAnimationFrame(() => setWidth(clamped))
    return () => cancelAnimationFrame(raf)
    // delayMs is only meant to gate the very first grow-in (see hasGrownRef above); including it
    // as a dep here would re-delay every later update too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped])
  return (
    <span
      className={`block overflow-hidden rounded-full ${trackClassName}`}
      style={{ height, backgroundColor: 'var(--map-border)' }}
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${width}%`,
          backgroundColor: fill,
          transition: 'width 500ms cubic-bezier(0.16,1,0.3,1)',
        }}
      />
    </span>
  )
}

const DONUT_HOVER_CARD_WIDTH = 164
const DONUT_CARD_GAP_ABOVE_CURSOR = 18
const DONUT_VIEWPORT_MARGIN = 10

// Cursor-following hover card for the status donut below -- same portal-to-body pattern as
// dashboard/PriorityBreakdown.tsx's PriorityHoverCard (fixed positioning sidesteps the panel's own
// clipping/scroll container), restyled onto the map popup surface tokens (--map-popup-*) instead
// of the dashboard's --category-* tokens, since this renders inside the map chrome, not the
// dashboard shell.
function StatusHoverCard({
  bucket,
  count,
  total,
  color,
  cursorX,
  cursorY,
}: {
  bucket: StatusBucket
  count: number
  total: number
  color: string
  cursorX: number
  cursorY: number
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const left = Math.min(
      Math.max(cursorX - w / 2, DONUT_VIEWPORT_MARGIN),
      window.innerWidth - w - DONUT_VIEWPORT_MARGIN,
    )
    const top = Math.max(cursorY - DONUT_CARD_GAP_ABOVE_CURSOR - h, DONUT_VIEWPORT_MARGIN)
    setPos({ left, top })
  }, [cursorX, cursorY])

  const pct = total > 0 ? Math.round((count / total) * 100) : 0

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="pointer-events-none fixed z-[999] overflow-hidden rounded-2xl backdrop-blur-xl"
      style={{
        width: DONUT_HOVER_CARD_WIDTH,
        left: pos?.left ?? cursorX,
        top: pos?.top ?? cursorY,
        opacity: pos ? 1 : 0,
        backgroundColor: 'var(--map-popup-bg)',
        border: '1px solid var(--map-popup-border)',
        boxShadow: `0 24px 48px -12px rgba(0,0,0,0.5), 0 0 0 1px ${color}1a`,
      }}
    >
      <div
        className="h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${color}, ${color}66)` }}
        aria-hidden
      />
      <div className="px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}99` }}
            aria-hidden
          />
          <p
            className="truncate text-[12px] font-semibold"
            style={{ color: 'var(--map-popup-heading)' }}
          >
            {BUCKET_LABELS[bucket]}
          </p>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className="text-[24px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--map-popup-heading)' }}
          >
            {count.toLocaleString()}
          </span>
          <span className="text-[10.5px] font-medium" style={{ color: 'var(--map-popup-faint)' }}>
            ticket{count === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-2">
          <AnimatedBar percent={pct} fill={`linear-gradient(90deg, ${color}cc, ${color})`} />
        </div>
        <div
          className="mt-1.5 flex items-center justify-between text-[10.5px]"
          style={{ color: 'var(--map-popup-faint)' }}
        >
          <span>Share of total</span>
          <span
            className="font-semibold tabular-nums"
            style={{ color: 'var(--map-popup-heading)' }}
          >
            {pct}%
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Status-bucket donut + legend for Ticket/Heatmap mode's hero block -- replaces the old
 *  single-value "% resolved" ring with a real multi-segment breakdown across all four buckets,
 *  styled after dashboard/PriorityBreakdown.tsx (donut, centred total, coloured legend rows,
 *  cursor-following hover card) so the map's insights read as the same visual language as the
 *  dashboard instead of a separate, more generic one. */
export function StatusBreakdownDonut({
  counts,
  total,
  activeBuckets,
  onSelect,
  size = 92,
}: {
  counts: Record<StatusBucket, number>
  total: number
  /** Buckets the current status filter is scoped to -- dims the rest, same as a hovered row. */
  activeBuckets?: ReadonlySet<StatusBucket>
  onSelect?: (bucket: StatusBucket) => void
  size?: number
}) {
  const theme = useInsightTheme()
  const [hoverBucket, setHoverBucket] = useState<StatusBucket | null>(null)
  const [chartHoverBucket, setChartHoverBucket] = useState<StatusBucket | null>(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })

  const data = BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    color: bucketColor(bucket, theme),
    value: counts[bucket] ?? 0,
  }))

  const dimmed = (bucket: StatusBucket) => {
    if (hoverBucket) return hoverBucket !== bucket
    if (activeBuckets && activeBuckets.size > 0) return !activeBuckets.has(bucket)
    return false
  }

  if (total <= 0) {
    return (
      <div className="flex items-center gap-4">
        <div
          className="relative shrink-0 rounded-full"
          style={{ width: size, height: size, border: '9px solid var(--map-border)' }}
        />
        <p className="text-[12px]" style={{ color: 'var(--map-fg-faint)' }}>
          No tickets in scope.
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-4"
      onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
    >
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        onMouseLeave={() => {
          setHoverBucket(null)
          setChartHoverBucket(null)
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={size * 0.34}
              outerRadius={size * 0.5}
              paddingAngle={3}
              stroke="none"
              onMouseEnter={(_, index) => {
                const bucket = data[index]?.bucket ?? null
                setHoverBucket(bucket)
                setChartHoverBucket(bucket)
              }}
              onMouseLeave={() => {
                setHoverBucket(null)
                setChartHoverBucket(null)
              }}
              onClick={(_, index) => {
                const bucket = data[index]?.bucket
                if (bucket) onSelect?.(bucket)
              }}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.bucket}
                  fill={entry.color}
                  style={{
                    transition: 'opacity 150ms ease',
                    cursor: onSelect ? 'pointer' : 'default',
                  }}
                  opacity={dimmed(entry.bucket) ? 0.35 : 1}
                />
              ))}
            </Pie>
            {/* Recharts' own popup is disabled -- content=() => null keeps the hover/cursor
                machinery driving onMouseEnter/onMouseLeave above without rendering it. */}
            <Tooltip content={() => null} cursor={false} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center gap-0.5">
          <span
            className="text-[17px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--map-fg)' }}
          >
            {total.toLocaleString()}
          </span>
          <span className="text-[9.5px] leading-none" style={{ color: 'var(--map-fg-faint)' }}>
            ticket{total === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {data.map((entry) => (
          <div
            key={entry.bucket}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-pressed={activeBuckets?.has(entry.bucket)}
            aria-label={`${onSelect ? (activeBuckets?.has(entry.bucket) ? 'Clear' : 'Filter to') + ' ' : ''}${entry.label} -- ${entry.value}`}
            onClick={() => onSelect?.(entry.bucket)}
            onKeyDown={(e) => {
              if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                onSelect(entry.bucket)
              }
            }}
            onMouseEnter={() => setHoverBucket(entry.bucket)}
            onMouseLeave={() => setHoverBucket(null)}
            className={`flex items-center justify-between gap-2 rounded-md px-0.5 text-[11px] outline-none transition-opacity duration-150 ${onSelect ? 'cursor-pointer' : ''}`}
            style={{
              opacity: dimmed(entry.bucket) ? 0.5 : 1,
              fontWeight: activeBuckets?.has(entry.bucket) ? 600 : 400,
            }}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span className="truncate" style={{ color: 'var(--map-fg-muted)' }}>
                {entry.label}
              </span>
            </span>
            <span
              className="shrink-0 font-semibold tabular-nums"
              style={{ color: 'var(--map-fg)' }}
            >
              {entry.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {chartHoverBucket && (
        <StatusHoverCard
          bucket={chartHoverBucket}
          count={counts[chartHoverBucket] ?? 0}
          total={total}
          color={bucketColor(chartHoverBucket, theme)}
          cursorX={cursor.x}
          cursorY={cursor.y}
        />
      )}
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
              backgroundColor: 'var(--map-popup-bg)',
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
