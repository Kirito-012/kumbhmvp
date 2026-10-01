'use client'

import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { AlertCircle, ArrowDown, ArrowUp, Check, ChevronRight } from 'lucide-react'
import { formatDonePct, type WorkDoneSummary } from '@/components/map/SectorWorkDone'
import { useInsightTheme } from '@/components/map/insights/useInsightTheme'
import type { SectorInsightsState } from '@/components/map/insights/useSectorInsights'
import { BUCKET_COLORS, BUCKET_LABELS, type StatusBucket } from '@/lib/insights/statusBuckets'
import type { Theme } from '@/lib/insights/heatScale'
import type { SectorTrendDay } from '@/lib/insights/types'

// "Insights" view of the Work Done tab: live ticket numbers for the selected sector, nothing else.
// Three cards, each answering one question --
//   Resolution      how much is done, and what is the rest waiting on?   (status ring)
//   Ticket volume   is the backlog growing or shrinking?                 (7-day line chart)
//   By category     where is the work concentrated, and what is left?    (stacked bars)
// (The planning-document heads, which are demo data, live in "Work heads".)

// recharts only loads when this view is actually opened; the placeholder holds the chart's box so
// nothing shifts when it arrives.
const TicketVolumeChart = dynamic(
  () => import('@/components/map/SectorTicketCharts').then((m) => m.TicketVolumeChart),
  { ssr: false, loading: () => <ChartPlaceholder /> },
)

// Seven rows in all (six + the roll-up) is what fits the expanded drawer without scrolling.
const MAX_CATEGORY_BARS = 6

/** Resolved first (the "done" run), then the unresolved buckets from furthest-along to least. */
const STACK_ORDER: StatusBucket[] = ['resolved', 'pending', 'open', 'new']

/** Unresolved hues are softened so the green "done" run reads as the progress, not one of four. */
const statusOpacity = (b: StatusBucket, theme: Theme) =>
  b === 'resolved' ? 1 : theme === 'dark' ? 0.62 : 0.7

/** Text-safe green for "done" copy: the bright map green fails contrast on a light card. */
const doneTextColor = (theme: Theme) => (theme === 'dark' ? BUCKET_COLORS.resolved.dark : '#15803d')

// Column template shared by the category rows and their skeleton, so loading never shifts them:
// name | "33% · 4 left" | bar | chevron.
const CATEGORY_GRID =
  'grid grid-cols-[minmax(0,10rem)_7.5rem_minmax(0,1fr)_1rem] items-center gap-x-3 @min-[900px]:grid-cols-[minmax(0,13rem)_8rem_minmax(0,1fr)_1rem]'

/** Staggers a card's entrance: `--i` feeds the `.insight-rise` delay in globals.css. */
const cssVar = (name: string, value: string | number) => ({ [name]: value }) as CSSProperties

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 0 -> 1 on an ease-out curve over `ms` (after `delay`), driven by rAF so the ring sweep and its
 * percentage stay in lockstep. Starts at 1 when not animating or when the user prefers reduced
 * motion, so those users never depend on a frame tick to see the final state.
 */
function useTween(animate: boolean, ms: number, delay = 0) {
  const [t, setT] = useState(() => (animate && !prefersReducedMotion() ? 0 : 1))
  useEffect(() => {
    if (!animate || prefersReducedMotion()) return
    const start = performance.now() + delay
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / ms))
      setT(1 - Math.pow(1 - p, 3))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, ms, delay])
  return t
}

/** False for the first painted frame, then true -- lets CSS transitions animate from empty. */
function useGrown(animate: boolean) {
  const [grown, setGrown] = useState(() => !animate || prefersReducedMotion())
  useEffect(() => {
    if (!animate || prefersReducedMotion()) return
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [animate])
  return grown
}

/**
 * Faint gridlines where the chart's own will land, so its arrival doesn't change the picture.
 * The insets are the plot area's inside SectorTicketCharts (margin top/right 8, y-axis 28 wide,
 * x-axis band 30 tall) -- keep the two in step.
 */
function ChartPlaceholder() {
  return (
    <div className="absolute inset-0 pb-[30px] pl-[28px] pr-2 pt-2" aria-hidden="true">
      <div className="flex h-full flex-col justify-between">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-px" style={{ backgroundColor: 'var(--map-border)' }} />
        ))}
      </div>
    </div>
  )
}

function formatDuration(hours: number) {
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`
  const days = hours / 24
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} d`
}

function Card({
  title,
  subtitle,
  index,
  rise,
  className = '',
  aside,
  children,
}: {
  title: string
  subtitle: ReactNode
  /** Position in the entrance sequence. */
  index: number
  /** Play the entrance (off for revisits and when a skeleton with the same chrome was showing). */
  rise: boolean
  className?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      className={`${rise ? 'insight-rise ' : ''}flex min-w-0 flex-col rounded-xl border p-4 ${className}`}
      style={{
        ...cssVar('--i', index),
        backgroundColor: 'var(--map-surface-alt)',
        borderColor: 'var(--map-border)',
      }}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            {title}
          </h3>
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
            {subtitle}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

function Dot({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color, opacity }}
      aria-hidden="true"
    />
  )
}

/** Donut split by status; the centre carries the one number that matters. */
function StatusRing({ tally, animate }: { tally: WorkDoneSummary; animate: boolean }) {
  const theme = useInsightTheme()
  // Two beats: the green "done" run sweeps while the figure counts up with it (always the same
  // ~0.7s, whatever the percentage), then the unresolved arcs follow as a short coda.
  const share = tally.resolved / tally.total
  const tDone = useTween(animate, 700, 120)
  const tRest = useTween(animate, 300, tally.resolved > 0 ? 760 : 120)
  const sweep = share * tDone + (1 - share) * tRest
  const maskId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const R = 52
  const C = 2 * Math.PI * R
  // Hairline between neighbouring arcs; a lone full ring needs none.
  const live = STACK_ORDER.filter((b) => tally.counts[b] > 0)
  const gap = live.length > 1 ? 2.5 : 0
  const arcs = live.reduce<{ b: StatusBucket; len: number; start: number }[]>((acc, b) => {
    const len = (tally.counts[b] / tally.total) * C
    const prev = acc[acc.length - 1]
    return [...acc, { b, len, start: prev ? prev.start + prev.len : 0 }]
  }, [])
  const pct = (tally.resolved / tally.total) * 100

  return (
    <div className="relative h-[152px] w-[152px] shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden="true">
        <defs>
          {/* One clockwise sweep reveals all the arcs together, instead of each growing alone. */}
          <mask id={maskId}>
            <circle
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke="#fff"
              strokeWidth="20"
              strokeDasharray={`${C * sweep} ${C}`}
            />
          </mask>
        </defs>
        <circle
          cx="64"
          cy="64"
          r={R}
          fill="none"
          strokeWidth="12"
          stroke="var(--map-switch-track)"
          opacity="0.45"
        />
        <g mask={`url(#${maskId})`}>
          {arcs.map(({ b, len, start }) => (
            <circle
              key={b}
              cx="64"
              cy="64"
              r={R}
              fill="none"
              strokeWidth="12"
              stroke={BUCKET_COLORS[b][theme]}
              strokeDasharray={`${Math.max(0.5, len - gap)} ${C}`}
              strokeDashoffset={-start}
              opacity={statusOpacity(b, theme)}
            />
          ))}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[34px] font-semibold leading-none tracking-tight tabular-nums"
          style={{ color: 'var(--map-fg)' }}
        >
          {/* The green run comes first from 12 o'clock, so the figure counts up as it grows. */}
          {tDone < 1 ? `${Math.round(pct * tDone)}%` : formatDonePct(tally)}
        </span>
        <span className="mt-1.5 text-[12px] tabular-nums" style={{ color: 'var(--map-fg-muted)' }}>
          {tally.resolved.toLocaleString('en-IN')} of {tally.total.toLocaleString('en-IN')}
          <span className="sr-only"> tickets resolved</span>
        </span>
      </div>
    </div>
  )
}

function Fact({
  label,
  value,
  loaded,
  hint,
  hintTitle,
}: {
  label: string
  value: ReactNode
  /** The value is real (not the "…" stand-in): fades in when it replaces the stand-in. */
  loaded: boolean
  hint?: string
  hintTitle?: string
}) {
  const [hadAtMount] = useState(loaded)
  return (
    <div className="min-w-0">
      <dt className="text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
        {label}
      </dt>
      <dd
        key={loaded ? 'value' : 'standin'}
        className={`${loaded && !hadAtMount ? 'animate-fade-in ' : ''}mt-1 text-[24px] font-semibold leading-none tabular-nums`}
        style={{ color: 'var(--map-fg)' }}
      >
        {value}
      </dd>
      {/* Always rendered, so the column's height never changes when the hint arrives. */}
      <p
        className="mt-1 h-[18px] truncate text-[12px]"
        style={{ color: 'var(--map-fg-muted)' }}
        title={hintTitle}
      >
        {hint ?? '\u00a0'}
      </p>
    </div>
  )
}

function ResolutionCard({
  tickets,
  insights,
  rise,
  animate,
  className,
}: {
  tickets: WorkDoneSummary
  insights: SectorInsightsState
  rise: boolean
  animate: boolean
  className?: string
}) {
  const theme = useInsightTheme()
  const { data: detail, error } = insights
  // "…" while the per-sector detail is on its way; "—" if it will never arrive.
  const dash = error ? '—' : '…'
  const oldest = detail?.oldestOpen
  return (
    <Card
      index={0}
      rise={rise}
      className={className}
      title="Resolution"
      subtitle={`${(tickets.total - tickets.resolved).toLocaleString('en-IN')} remaining`}
    >
      <div className="flex flex-1 flex-wrap items-center gap-x-10 gap-y-6">
        <StatusRing tally={tickets} animate={animate} />
        <ul className="min-w-[190px] max-w-[240px] flex-1 space-y-3">
          {STACK_ORDER.map((b) => {
            const n = tickets.counts[b]
            return (
              <li
                key={b}
                title={`${Math.round((n / tickets.total) * 100)}% of tickets`}
                className="flex h-5 items-center gap-2.5 text-[13px]"
                style={{ color: n > 0 ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
              >
                <Dot color={BUCKET_COLORS[b][theme]} opacity={statusOpacity(b, theme)} />
                <span className="flex-1">{BUCKET_LABELS[b]}</span>
                <span className="font-semibold tabular-nums">{n.toLocaleString('en-IN')}</span>
              </li>
            )
          })}
        </ul>
        <dl
          className="min-w-[150px] space-y-5 @min-[700px]:border-l @min-[700px]:pl-8"
          style={{ borderColor: 'var(--map-border)' }}
        >
          <Fact
            label="Median time to resolve"
            loaded={!!detail}
            value={
              detail
                ? detail.medianResolveHours != null
                  ? formatDuration(detail.medianResolveHours)
                  : '—'
                : dash
            }
          />
          <Fact
            label="Oldest open"
            loaded={!!detail}
            value={detail ? (oldest ? `${oldest.ageDays} d` : '—') : dash}
            hint={oldest ? `Ticket #${oldest.number}` : undefined}
            hintTitle={oldest?.subject}
          />
        </dl>
      </div>
    </Card>
  )
}

/** Created minus resolved: positive means the backlog grew this week. */
function BacklogChip({ delta, animate }: { delta: number; animate: boolean }) {
  const tint = delta > 0 ? 'amber' : delta < 0 ? 'teal' : null
  const text = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : 'Steady'
  return (
    <span
      className={`${animate ? 'animate-fade-in ' : ''}inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold tabular-nums`}
      style={{
        backgroundColor: tint ? `var(--map-section-${tint}-bg)` : 'var(--map-switch-track)',
        color: tint ? `var(--map-section-${tint}-fg)` : 'var(--map-fg-muted)',
      }}
      title="Created minus resolved over the last 7 days"
    >
      <span className="font-medium opacity-80">Backlog</span>
      {delta > 0 && <ArrowUp className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />}
      {delta < 0 && <ArrowDown className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />}
      {text}
    </span>
  )
}

function VolumeCard({
  insights,
  rise,
  animate,
  className,
}: {
  insights: SectorInsightsState & { refetch: () => void }
  rise: boolean
  animate: boolean
  className?: string
}) {
  const theme = useInsightTheme()
  // "Created" is the New status's own blue, so the two never read as near-duplicates.
  const createdColor = BUCKET_COLORS.new[theme]
  const resolvedColor = BUCKET_COLORS.resolved[theme]
  const trend: SectorTrendDay[] | null = insights.data?.trend7d ?? null
  const totals = useMemo(() => {
    if (!trend) return null
    return trend.reduce(
      (acc, d) => ({ created: acc.created + d.created, resolved: acc.resolved + d.resolved }),
      { created: 0, resolved: 0 },
    )
  }, [trend])

  return (
    <Card
      index={1}
      rise={rise}
      className={className}
      title="Ticket volume"
      subtitle="Created vs. resolved, last 7 days"
    >
      {/* Legend, totals and the verdict they add up to, side by side: 20 created - 15 resolved. */}
      <div className="mb-3 flex min-h-[26px] flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <span className="flex items-center gap-2" style={{ color: 'var(--map-fg-muted)' }}>
          <Dot color={createdColor} />
          Created
          <b className="inline-block min-w-[2ch] tabular-nums" style={{ color: 'var(--map-fg)' }}>
            {totals ? totals.created : ''}
          </b>
        </span>
        <span className="flex items-center gap-2" style={{ color: 'var(--map-fg-muted)' }}>
          <Dot color={resolvedColor} />
          Resolved
          <b className="inline-block min-w-[2ch] tabular-nums" style={{ color: 'var(--map-fg)' }}>
            {totals ? totals.resolved : ''}
          </b>
        </span>
        {totals && <BacklogChip delta={totals.created - totals.resolved} animate={animate} />}
      </div>
      <div className="relative min-h-[140px] flex-1">
        {trend ? (
          <TicketVolumeChart
            data={trend}
            createdColor={createdColor}
            resolvedColor={resolvedColor}
            animate={animate}
            begin={rise ? 260 : 0}
          />
        ) : insights.error ? (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-[12px]"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            <span>Couldn’t load the 7-day trend.</span>
            <button
              type="button"
              onClick={insights.refetch}
              className="cursor-pointer rounded-lg border px-3 py-1 font-semibold transition-colors hover:bg-[var(--map-surface-hover)]"
              style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg)' }}
            >
              Try again
            </button>
          </div>
        ) : (
          <ChartPlaceholder />
        )}
      </div>
    </Card>
  )
}

type CategoryBar = {
  name: string
  total: number
  resolved: number
  counts: WorkDoneSummary['counts']
}

function CategoryRow({
  row,
  max,
  grown,
  index,
  onOpen,
}: {
  row: CategoryBar
  max: number
  grown: boolean
  index: number
  /** Drill through to the Tickets view (opened on this category, or unfiltered for the roll-up). */
  onOpen: () => void
}) {
  const theme = useInsightTheme()
  const left = row.total - row.resolved
  const ratio = row.total / max
  const done = row.total > 0 && left === 0
  const pct = formatDonePct({ counts: row.counts, total: row.total, resolved: row.resolved })
  const breakdown = STACK_ORDER.map((b) => `${BUCKET_LABELS[b]} ${row.counts[b]}`).join(' · ')
  const summary = `${row.name}: ${row.resolved} of ${row.total} resolved (${pct}) · ${breakdown}`
  const cls = `group ${CATEGORY_GRID} h-9 w-full rounded-lg px-2 text-left`
  const content = (
    <>
      <span className="truncate text-[13px]" style={{ color: 'var(--map-fg)' }}>
        {row.name}
      </span>
      {/* How done it is, and how much is still to do -- the two things a lead scans for. */}
      {done ? (
        <span
          className="flex items-center gap-1 text-[12px] font-semibold"
          style={{ color: doneTextColor(theme) }}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
          All done
        </span>
      ) : (
        <span className="whitespace-nowrap text-[13px] tabular-nums">
          <b style={{ color: 'var(--map-fg)' }}>{pct}</b>
          <span style={{ color: 'var(--map-fg-muted)' }}> · {left} left</span>
        </span>
      )}
      <span className="flex h-3.5 items-center" aria-hidden="true">
        <span
          // Length is this category's share of the busiest one (its ticket total is printed at the
          // end), so bars compare volume; the segments inside show status. No track behind it: an
          // empty remainder would read as "work left". Revealed left-to-right with a clip so the
          // segments never reflow, at a pace proportional to length so every bar's leading edge
          // moves at the same speed.
          className="flex h-full flex-none gap-px overflow-hidden rounded-[4px] motion-safe:transition-[clip-path] motion-safe:ease-out motion-safe:[transition-delay:var(--d)] motion-safe:[transition-duration:var(--dur)]"
          style={{
            ...cssVar('--d', `${200 + index * 40}ms`),
            ...cssVar('--dur', `${Math.round(300 + 450 * ratio)}ms`),
            width: `calc(min(100% - 2.5rem, 42rem) * ${ratio})`,
            clipPath: grown ? 'inset(0 0 0 0 round 4px)' : 'inset(0 100% 0 0 round 4px)',
          }}
        >
          {STACK_ORDER.map((b) =>
            row.counts[b] > 0 ? (
              <span
                key={b}
                className="block h-full min-w-[3px]"
                style={{
                  flexGrow: row.counts[b],
                  flexBasis: 0,
                  backgroundColor: BUCKET_COLORS[b][theme],
                  opacity: statusOpacity(b, theme),
                }}
              />
            ) : null,
          )}
        </span>
        <span
          className="ml-2 w-8 text-[12px] tabular-nums motion-safe:transition-opacity motion-safe:duration-300 motion-safe:[transition-delay:var(--d)]"
          style={{
            ...cssVar('--d', `${200 + index * 40 + Math.round(0.65 * (300 + 450 * ratio))}ms`),
            color: 'var(--map-fg-muted)',
            opacity: grown ? 1 : 0,
          }}
        >
          {row.total}
        </span>
      </span>
      <ChevronRight
        className="h-4 w-4 opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: 'var(--map-fg-muted)' }}
        aria-hidden="true"
      />
    </>
  )
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${summary}. View tickets`}
        title={`${summary} — view tickets`}
        className={`${cls} cursor-pointer transition-colors hover:bg-[var(--map-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--map-accent)]`}
      >
        {content}
      </button>
    </li>
  )
}

function CategoryCard({
  tickets,
  rise,
  animate,
  className,
  onOpenCategory,
}: {
  tickets: WorkDoneSummary
  rise: boolean
  animate: boolean
  className?: string
  onOpenCategory: (name?: string) => void
}) {
  const theme = useInsightTheme()
  const grown = useGrown(animate)

  const rows = useMemo<CategoryBar[]>(() => {
    const sorted = [...tickets.categories].sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name),
    )
    const shown: CategoryBar[] = sorted.slice(0, MAX_CATEGORY_BARS)
    const rest = sorted.slice(MAX_CATEGORY_BARS)
    if (rest.length > 0) {
      const counts = { new: 0, open: 0, pending: 0, resolved: 0 }
      for (const c of rest) for (const b of STACK_ORDER) counts[b] += c.counts[b]
      shown.push({
        name: `Other (${rest.length})`,
        total: rest.reduce((n, c) => n + c.total, 0),
        resolved: counts.resolved,
        counts,
      })
    }
    return shown
  }, [tickets])
  const max = rows.reduce((m, r) => Math.max(m, r.total), 1)
  const otherName = rows.length > MAX_CATEGORY_BARS ? rows[rows.length - 1].name : null
  const n = tickets.categories.length

  return (
    <Card
      index={2}
      rise={rise}
      className={className}
      title="Tickets by category"
      subtitle={`${n} ${n === 1 ? 'category' : 'categories'} · largest first · select one to see its tickets`}
      aside={
        <div
          className="hidden shrink-0 items-center gap-4 text-[12px] @min-[640px]:flex"
          style={{ color: 'var(--map-fg-muted)' }}
          aria-hidden="true"
        >
          {STACK_ORDER.map((b) => (
            <span key={b} className="flex items-center gap-1.5">
              <Dot color={BUCKET_COLORS[b][theme]} opacity={statusOpacity(b, theme)} />
              {BUCKET_LABELS[b]}
            </span>
          ))}
        </div>
      }
    >
      <ul className="-mx-2 flex flex-col">
        {rows.map((row, i) => (
          <CategoryRow
            key={row.name}
            row={row}
            max={max}
            grown={grown}
            index={i}
            onOpen={() => onOpenCategory(row.name === otherName ? undefined : row.name)}
          />
        ))}
      </ul>
    </Card>
  )
}

/** Same cards, same titles, same geometry as the loaded view, so nothing jumps when data lands. */
function InsightsSkeleton() {
  const bar = (w: string, h = 'h-3') => (
    <div
      className={`${h} rounded motion-safe:animate-pulse`}
      style={{ width: w, backgroundColor: 'var(--map-switch-track)', opacity: 0.5 }}
    />
  )
  return (
    <div role="status" aria-live="polite" className="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-3">
      <span className="sr-only">Loading ticket insights…</span>
      <div className="grid grid-cols-1 gap-3 @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card
          index={0}
          rise={false}
          title="Resolution"
          subtitle={<div className="flex h-[18px] items-center">{bar('6rem', 'h-2.5')}</div>}
        >
          <div className="flex flex-1 flex-wrap items-center gap-x-10 gap-y-6">
            {/* The ring's outer edge sits 7px inside its 152px box. */}
            <div className="h-[152px] w-[152px] shrink-0 p-[7px]">
              <div
                className="h-full w-full rounded-full border-[14px] motion-safe:animate-pulse"
                style={{ borderColor: 'var(--map-switch-track)', opacity: 0.4 }}
              />
            </div>
            <div className="min-w-[190px] max-w-[240px] flex-1 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex h-5 items-center">
                  {bar('100%')}
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card
          index={1}
          rise={false}
          title="Ticket volume"
          subtitle="Created vs. resolved, last 7 days"
          className="hidden @min-[900px]:flex"
        >
          <div className="mb-3 min-h-[26px]" />
          <div className="relative min-h-[140px] flex-1">
            <ChartPlaceholder />
          </div>
        </Card>
        <Card
          index={2}
          rise={false}
          title="Tickets by category"
          subtitle="Largest first · select one to see its tickets"
          className="@min-[900px]:col-span-2"
        >
          <ul className="-mx-2 flex flex-col">
            {['100%', '66%', '66%', '45%', '33%', '15%', '15%'].map((w, i) => (
              <li key={i} className={`${CATEGORY_GRID} h-9 px-2`}>
                {bar('60%', 'h-3')}
                {bar('4.5rem', 'h-3')}
                {bar(w, 'h-3.5')}
                <span />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
      >
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-[14px] font-semibold" style={{ color: 'var(--map-fg)' }}>
          Couldn’t load this sector’s tickets
        </p>
        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--map-fg-muted)' }} title={message}>
          Check your connection and try again.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="cursor-pointer rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-[var(--map-surface-hover)]"
        style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg)' }}
      >
        Try again
      </button>
    </div>
  )
}

export default function SectorOverview({
  tickets,
  error,
  onRetry,
  insights,
  animate,
  onOpenCategory,
}: {
  /** Live ticket rollup for this sector (null while the bulk ticket data is still loading). */
  tickets: WorkDoneSummary | null
  /** Bulk ticket-data failure, if any. */
  error: string | null
  onRetry: () => void
  /** Per-sector detail (7-day trend, median time to resolve, oldest open). */
  insights: SectorInsightsState & { refetch: () => void }
  /** Play the opening choreography. Off when the user is simply returning to this view. */
  animate: boolean
  onOpenCategory: (name?: string) => void
}) {
  // When a skeleton with the same card chrome was on screen, the cards are already there: only the
  // contents animate in, so the cards don't vanish and rise a second time.
  const [sawSkeleton, setSawSkeleton] = useState(false)
  if (!tickets && !sawSkeleton) setSawSkeleton(true)
  const rise = animate && !sawSkeleton

  if (!tickets) {
    return error ? <InlineError message={error} onRetry={onRetry} /> : <InsightsSkeleton />
  }

  if (tickets.total === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-5 py-10 text-center">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--map-fg)' }}>
          No tickets in this sector yet
        </p>
        <p className="text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
          Insights will appear once tickets are filed against its parcels.
        </p>
      </div>
    )
  }

  return (
    <div className="kumbh-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
      <div className="grid grid-cols-1 gap-3 @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ResolutionCard
          tickets={tickets}
          insights={insights}
          rise={rise}
          animate={animate}
          className="order-1"
        />
        {/* In one column the by-category breakdown comes second: it answers "where is the work"
            right after "how much is done", and the trend chart can wait below the fold. */}
        <VolumeCard
          insights={insights}
          rise={rise}
          animate={animate}
          className="order-3 @min-[900px]:order-2"
        />
        <CategoryCard
          tickets={tickets}
          rise={rise}
          animate={animate}
          className="order-2 @min-[900px]:order-3 @min-[900px]:col-span-2"
          onOpenCategory={onOpenCategory}
        />
      </div>
    </div>
  )
}
