'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { CheckCircle2 } from 'lucide-react'

export type PriorityBreakdownEntry = { name: string; slug: string; color: string; value: number }

const CARD_WIDTH = 176
const CARD_GAP_ABOVE_CURSOR = 20
const VIEWPORT_MARGIN = 12

// Custom cursor-following hover card, portaled to document.body with position: fixed — same
// pattern as CategoryBreakdown's HoverCard. Recharts' built-in Tooltip is positioned relative to
// the chart container, which clips/overlaps awkwardly against the center label overlay; a
// fixed-position portal sidesteps that entirely and lets this match the rest of the dashboard's
// premium hover-card language (color accent bar, big %, icon rows).
function PriorityHoverCard({
  entry,
  total,
  cursorX,
  cursorY,
}: {
  entry: PriorityBreakdownEntry
  total: number
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
      Math.max(cursorX - w / 2, VIEWPORT_MARGIN),
      window.innerWidth - w - VIEWPORT_MARGIN,
    )
    const top = Math.max(cursorY - CARD_GAP_ABOVE_CURSOR - h, VIEWPORT_MARGIN)
    setPos({ left, top })
  }, [cursorX, cursorY])

  const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
  const c = entry.color

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="pointer-events-none fixed z-[999] overflow-hidden rounded-2xl backdrop-blur-xl"
      style={{
        width: CARD_WIDTH,
        left: pos?.left ?? cursorX,
        top: pos?.top ?? cursorY,
        opacity: pos ? 1 : 0,
        background: 'var(--category-hovercard-bg)',
        border: '1px solid var(--category-hovercard-border)',
        boxShadow: `0 24px 48px -12px rgba(0,0,0,0.5), 0 0 0 1px ${c}1a, 0 -1px 0 0 rgba(255,255,255,0.06) inset`,
      }}
    >
      <div
        className="h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${c}, ${c}66)` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(120% 90% at 0% 0%, ${c}1f, transparent 60%)` }}
        aria-hidden
      />

      <div className="relative px-3.5 pb-3.5 pt-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: c, boxShadow: `0 0 8px ${c}99` }}
            aria-hidden
          />
          <p
            className="truncate text-[13px] font-semibold"
            style={{ color: 'var(--category-heading)' }}
          >
            {entry.name} priority
          </p>
        </div>

        <div className="mt-2.5 flex items-baseline gap-1.5">
          <span
            className="text-[28px] font-semibold leading-none tracking-tight tabular-nums"
            style={{ color: 'var(--category-heading)' }}
          >
            {entry.value.toLocaleString()}
          </span>
          <span
            className="text-[11px] font-medium"
            style={{ color: 'var(--category-label-muted)' }}
          >
            open tickets
          </span>
        </div>

        <div
          className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--category-tube-bg)' }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${c}cc, ${c})` }}
          />
        </div>

        <div
          className="mt-2 flex items-center justify-between text-[11px]"
          style={{ color: 'var(--category-label-muted)' }}
        >
          <span>Share of open</span>
          <span className="font-semibold tabular-nums" style={{ color: 'var(--category-heading)' }}>
            {pct}%
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function PriorityBreakdown({ data: priorityBreakdown }: { data: PriorityBreakdownEntry[] }) {
  const router = useRouter()
  const total = priorityBreakdown.reduce((sum, d) => sum + d.value, 0)
  // hoverSlug drives the shared highlight (dims the other wedge/legend rows) whether the pointer
  // is over the donut or a legend row. chartHoverSlug is scoped to the donut only and is the sole
  // thing that decides whether the floating hover card shows — hovering the legend text on the
  // right should highlight its wedge but must NOT pop the card, since the card is meant to read
  // as "detail about what's under the cursor", and the cursor isn't over the chart there.
  const [hoverSlug, setHoverSlug] = useState<string | null>(null)
  const [chartHoverSlug, setChartHoverSlug] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })

  const hoveredEntry = chartHoverSlug
    ? (priorityBreakdown.find((d) => d.slug === chartHoverSlug) ?? null)
    : null

  // Tickets page reads the priority filter from ?priority=<slug> (listTickets() matches it
  // against TicketPriority.slug, not the display name — see ticket.service.ts:54).
  const goToPriority = (entry: PriorityBreakdownEntry) => {
    router.push(`/tickets?priority=${encodeURIComponent(entry.slug)}`)
  }

  // All-zero data still arrives as 4 entries (low/normal/high/critical, each value: 0) rather than
  // an empty array, since priorityBreakdown always lists every seeded priority — a Pie fed all
  // zeros renders as a broken/invisible ring with no explanation, so this is caught explicitly.
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-foreground">All caught up</p>
        <p className="text-xs text-muted">No open tickets right now.</p>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-6"
      onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
    >
      <div
        className="relative h-36 w-36 shrink-0"
        onMouseLeave={() => {
          setHoverSlug(null)
          setChartHoverSlug(null)
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={priorityBreakdown}
              dataKey="value"
              nameKey="name"
              innerRadius={44}
              outerRadius={64}
              paddingAngle={3}
              stroke="none"
              onMouseEnter={(_, index) => {
                const slug = priorityBreakdown[index]?.slug ?? null
                setHoverSlug(slug)
                setChartHoverSlug(slug)
              }}
              onMouseLeave={() => {
                setHoverSlug(null)
                setChartHoverSlug(null)
              }}
              onClick={(_, index) => {
                const entry = priorityBreakdown[index]
                if (entry) goToPriority(entry)
              }}
            >
              {priorityBreakdown.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.color}
                  style={{ transition: 'opacity 150ms ease', cursor: 'pointer' }}
                  opacity={hoverSlug && hoverSlug !== entry.slug ? 0.45 : 1}
                />
              ))}
            </Pie>
            {/* Recharts' own Tooltip is disabled in favor of the custom portal card above — its
                default popup renders inside the chart container and collides with the center
                label overlay. content=() => null keeps the hover/cursor machinery (which drives
                onMouseEnter/onMouseLeave above) without rendering recharts' own popup. */}
            <Tooltip content={() => null} cursor={false} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold text-foreground">{total}</span>
          <span className="text-[10px] text-muted">open</span>
        </div>
      </div>

      <div className="flex-1 space-y-2.5">
        {priorityBreakdown.map((entry) => (
          <div
            key={entry.name}
            role="link"
            tabIndex={0}
            aria-label={`View ${entry.name} priority tickets — ${entry.value} open`}
            onClick={() => goToPriority(entry)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                goToPriority(entry)
              }
            }}
            onMouseEnter={() => setHoverSlug(entry.slug)}
            onMouseLeave={() => setHoverSlug(null)}
            className="flex cursor-pointer items-center justify-between rounded-md text-sm outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            style={{ opacity: hoverSlug && hoverSlug !== entry.slug ? 0.5 : 1 }}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span className="text-muted-strong">{entry.name}</span>
            </div>
            <span className="font-medium text-foreground">{entry.value}</span>
          </div>
        ))}
      </div>

      {hoveredEntry && (
        <PriorityHoverCard
          entry={hoveredEntry}
          total={total}
          cursorX={cursor.x}
          cursorY={cursor.y}
        />
      )}
    </div>
  )
}
