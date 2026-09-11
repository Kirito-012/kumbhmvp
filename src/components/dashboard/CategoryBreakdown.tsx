'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Shapes, CheckCircle2, Circle, MapPin } from 'lucide-react'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { cn } from '@/lib/utils'

export type CategoryBreakdownEntry = {
  name: string
  color: string
  total: number
  completed: number
}

/** One sector's ticket counts, keyed by class-group name -> [total, completed]. Only the numbers
 *  travel: names and colours already live in the `data` prop, so a sector selection just swaps
 *  counts into those same entries rather than shipping 32 duplicated copies of the whole list. */
export type CategorySectorOption = {
  sectorNo: number
  name: string | null
  total: number
  counts: Record<string, [total: number, completed: number]>
}

/** Solid fill for an active sector selection, so the filter reads as "on" at a glance — same
 *  treatment the Tickets page's class filter gives its selection. This is --accent; solidFillColor
 *  deepens it to #047a54 before it becomes a fill, because white-on-#10b981 measures 2.56:1. */
const SECTOR_FILTER_COLOR = '#10b981'

// Theme-aware via CSS custom properties defined in globals.css (--category-*): dark mode keeps
// deep glass + a translucent glowing liquid; light mode swaps to opaque solid-color liquid on
// white glass (a translucent fill over white reads as cheap pastel tint, not premium).

// One wave period spans 120 viewBox units, drawn twice (240) on a 200%-wide SVG, so the
// liquid-drift keyframe's -50% translateX loops seamlessly.
const WAVE_PATH =
  'M0,8 C20,2 40,14 60,8 C80,2 100,14 120,8 C140,2 160,14 180,8 C200,2 220,14 240,8 L240,16 L0,16 Z'

const RISE_MS = 1100
const STAGGER_MS = 70
const CARD_WIDTH = 208
const CARD_GAP_ABOVE_CURSOR = 22
const VIEWPORT_MARGIN = 12

// Fixed (not Math.random()) bubble timing sets, cycled per tube by index — deterministic so
// there's no server/client render mismatch, but varied enough across 4 sets that adjacent tubes
// don't look synchronized. { left%, delayS, durationS, sizePx }
const BUBBLE_SEEDS: { left: number; delay: number; duration: number; size: number }[][] = [
  [
    { left: 22, delay: 0, duration: 4.2, size: 5 },
    { left: 58, delay: 1.6, duration: 5.1, size: 4 },
    { left: 78, delay: 3, duration: 4.6, size: 6 },
  ],
  [
    { left: 15, delay: 0.8, duration: 4.8, size: 4 },
    { left: 45, delay: 2.4, duration: 4.3, size: 6 },
    { left: 70, delay: 0.2, duration: 5.4, size: 5 },
  ],
  [
    { left: 30, delay: 1.4, duration: 4.5, size: 6 },
    { left: 60, delay: 3.2, duration: 4.9, size: 4 },
    { left: 85, delay: 0.6, duration: 4.2, size: 5 },
  ],
  [
    { left: 18, delay: 2.2, duration: 5.2, size: 5 },
    { left: 50, delay: 0.4, duration: 4.4, size: 6 },
    { left: 82, delay: 1.8, duration: 4.7, size: 4 },
  ],
]

function Tube({
  entry,
  index,
  active,
  isHovered,
  maxWidth,
  tubeRef,
  onOpen,
}: {
  entry: CategoryBreakdownEntry
  index: number
  active: boolean
  isHovered: boolean
  maxWidth: number
  tubeRef: (el: HTMLDivElement | null) => void
  onOpen: (entry: CategoryBreakdownEntry) => void
}) {
  const pct = entry.total > 0 ? Math.round((entry.completed / entry.total) * 100) : 0
  const delayMs = index * STAGGER_MS
  const shown = active ? pct : 0

  const c = entry.color
  const liquidTop = `color-mix(in srgb, ${c} var(--category-liquid-top-mix), var(--category-panel-top))`
  const liquidDeep = `color-mix(in srgb, ${c} var(--category-liquid-deep-mix), var(--category-panel-deep))`

  // Deterministic per-tube "randomness" (seeded by index, not Math.random()) so bubble timing
  // varies tube-to-tube without reshuffling on every re-render.
  const bubbles = BUBBLE_SEEDS[index % BUBBLE_SEEDS.length]

  return (
    <div
      ref={tubeRef}
      data-tube-index={index}
      className="flex min-w-[56px] flex-col"
      style={{
        flexGrow: Math.sqrt(entry.total) || 1,
        flexBasis: 0,
        // Capped so a sector with only a handful of categories gets a row of normal-looking tubes
        // rather than three tubes stretched across the whole panel (the cap is relaxed for sparse
        // rows by the caller). flex-grow is transitioned because filtering re-proportions every
        // surviving tube.
        maxWidth,
        transition: 'flex-grow 600ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        role="link"
        tabIndex={0}
        aria-label={`View ${entry.name} tickets — ${entry.completed} of ${entry.total} resolved`}
        onClick={() => onOpen(entry)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(entry)
          }
        }}
        className="relative h-52 cursor-pointer overflow-hidden rounded-xl outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        style={{
          border: `1px solid ${isHovered ? c : 'var(--category-tube-border)'}`,
          background: 'var(--category-tube-bg)',
          // The 4th shadow (inset 2px 0 0 ...) is a thin left-edge glass refraction highlight,
          // paired with the existing top-edge one, so the tube reads as a lit glass cylinder
          // rather than a flat rounded rect.
          boxShadow: isHovered
            ? `inset 0 1px 0 var(--category-tube-inset-top), inset 0 -10px 20px var(--category-tube-inset-bottom), inset 2px 0 0 var(--category-tube-inset-top), 0 0 0 3px ${c}26`
            : 'inset 0 1px 0 var(--category-tube-inset-top), inset 0 -10px 20px var(--category-tube-inset-bottom), inset 2px 0 0 var(--category-tube-inset-top)',
          transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
        }}
      >
        {/* Liquid: full-height layer slid up by translateY so the wave keeps its shape. The rise
            transition and the idle breathing both target transform, so they're split across two
            nested layers rather than fighting on one element: this outer one owns the one-time
            rise transition, the inner one (below) owns the continuous idle animation. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            transform: `translateY(${100 - shown}%)`,
            transition: `transform ${RISE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms`,
          }}
          aria-hidden
        >
          <div
            className="absolute inset-0"
            style={
              active
                ? { animation: `liquid-idle ${5 + (index % 3)}s ease-in-out infinite ${delayMs}ms` }
                : undefined
            }
          >
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(to bottom, ${liquidTop}, ${liquidDeep})` }}
            />
            {/* Under-surface bloom — dark mode only (--category-liquid-glow toggles opacity to 0 in light) */}
            <div
              className="absolute left-0 right-0 top-0 h-12"
              style={{
                background: `linear-gradient(to bottom, ${c}66, transparent)`,
                opacity: 'var(--category-liquid-glow)',
              }}
            />
            {/* Drifting wave crest — fill matches the body's top stop so they merge seamlessly */}
            <svg
              className="absolute -top-[9px] left-0 h-3 w-[200%]"
              viewBox="0 0 240 16"
              preserveAspectRatio="none"
              style={{
                fill: liquidTop,
                animation: `liquid-drift ${7 + (index % 4)}s linear infinite`,
              }}
            >
              <path d={WAVE_PATH} />
            </svg>
            {/* Glowing waterline — glow only in dark mode, always a crisp color edge */}
            <div
              className="absolute -top-px left-0 right-0 h-[2px]"
              style={{
                background: c,
                boxShadow: `0 0 calc(10px * var(--category-liquid-glow)) ${c}, 0 0 calc(24px * var(--category-liquid-glow)) ${c}66`,
              }}
            />
            {/* Rising bubbles — clipped by the outer tube box's overflow-hidden, so they never
                appear to float above the waterline into the empty glass above the liquid. */}
            {bubbles.map((b, i) => (
              <span
                key={i}
                className="absolute rounded-full"
                style={{
                  left: `${b.left}%`,
                  bottom: 6,
                  width: b.size,
                  height: b.size,
                  background: 'white',
                  opacity: 'calc(0.25 + 0.35 * var(--category-liquid-glow))',
                  mixBlendMode: 'overlay',
                  animation: `bubble-rise ${b.duration}s ease-in ${b.delay}s infinite`,
                }}
              />
            ))}
          </div>
        </div>

        {/* % pill riding the waterline */}
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums backdrop-blur-sm"
          style={{
            bottom: `clamp(8px, calc(${shown}% + 8px), calc(100% - 32px))`,
            transition: `bottom ${RISE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms`,
            background: 'var(--category-pill-bg)',
            color: 'var(--category-pill-fg)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          }}
        >
          {/* CSS-driven count-up: --pct-count transitions from 0 to `shown` on the compositor
              (no JS per-frame work), rendered via counter(pct-count) in ::before. See the
              @property --pct-count rule in globals.css for why this replaced a requestAnimationFrame
              loop — 11 concurrent RAF loops (one per tube) were heavy enough to visibly stall other
              animations mounting around the same time, like the priority donut's entrance sweep. */}
          <span
            className="pct-counter"
            style={{
              // @ts-expect-error -- CSS custom property, not a standard React CSSProperties key
              '--pct-count': shown,
              transition: `--pct-count ${RISE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms`,
            }}
          />
          %
        </div>
      </div>

      <div className="mt-2 flex min-w-0 flex-col items-center gap-0.5">
        {/* Wraps to two lines rather than truncating: at a full row of categories the tubes sit
            near their min-width, and an ellipsis there hides the very thing that identifies the
            tube. Anything past two lines still clamps, and the hover card always has the full name. */}
        <span className="flex max-w-full items-start gap-1.5">
          <span
            className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: c }}
            aria-hidden
          />
          <span
            className="line-clamp-2 text-center text-[11px] font-medium leading-tight"
            style={{ color: 'var(--category-label)' }}
          >
            {entry.name}
          </span>
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: 'var(--category-label-muted)' }}>
          {entry.completed}/{entry.total}
        </span>
      </div>
    </div>
  )
}

function HoverCard({
  entry,
  cursorX,
  cursorY,
}: {
  entry: CategoryBreakdownEntry
  cursorX: number
  cursorY: number
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measure the card's actual rendered size before placing it, so it's clamped against the real
  // viewport-space box instead of a guessed height — always fully above the cursor, never offscreen.
  // `left` is the card's true CSS left edge (no centering transform involved): it starts centered
  // under the cursor (cursorX - w / 2) and is clamped to the viewport, so near the right edge it
  // slides left to stay fully on-screen instead of overflowing off the right side.
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

  const pct = entry.total > 0 ? Math.round((entry.completed / entry.total) * 100) : 0
  const open = entry.total - entry.completed
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
      {/* Category-colored top accent bar */}
      <div
        className="h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${c}, ${c}66)` }}
        aria-hidden
      />

      {/* Ambient tint wash from the category color, matching the panel's own sheen language */}
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
            {entry.name}
          </p>
        </div>

        <div className="mt-2.5 flex items-baseline gap-1.5">
          <span
            className="text-[28px] font-semibold leading-none tracking-tight tabular-nums"
            style={{ color: 'var(--category-heading)' }}
          >
            {pct}%
          </span>
          <span
            className="text-[11px] font-medium"
            style={{ color: 'var(--category-label-muted)' }}
          >
            resolved
          </span>
        </div>

        {/* Proportion bar — visual echo of the tube's own liquid, quick second read of the split */}
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
          className="mt-3 space-y-1.5 border-t pt-2.5"
          style={{ borderColor: 'var(--category-hovercard-border)' }}
        >
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span
              className="flex items-center gap-1.5"
              style={{ color: 'var(--category-label-muted)' }}
            >
              <CheckCircle2 className="h-3 w-3" style={{ color: c }} />
              Completed
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: 'var(--category-heading)' }}
            >
              {entry.completed.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span
              className="flex items-center gap-1.5"
              style={{ color: 'var(--category-label-muted)' }}
            >
              <Circle className="h-3 w-3" style={{ color: 'var(--category-label-muted)' }} />
              Open
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: 'var(--category-heading)' }}
            >
              {open.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span style={{ color: 'var(--category-label-muted)' }}>Total tickets</span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: 'var(--category-heading)' }}
            >
              {entry.total.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function CategoryBreakdown({
  data,
  sectors,
}: {
  data: CategoryBreakdownEntry[]
  sectors: CategorySectorOption[]
}) {
  const router = useRouter()

  // '' = all sectors (the default). Filtering is purely client-side: every sector's counts ship
  // with the page, so switching is instant and the tubes animate between levels instead of
  // re-mounting from zero after a server round-trip.
  const [sectorValue, setSectorValue] = useState('')
  const activeSector = sectors.find((s) => String(s.sectorNo) === sectorValue) ?? null

  const sorted = useMemo(() => {
    const scoped = activeSector
      ? data.map((e) => {
          const c = activeSector.counts[e.name]
          return { ...e, total: c?.[0] ?? 0, completed: c?.[1] ?? 0 }
        })
      : data
    // Empty categories are dropped in every scope, not just a filtered one. `data` carries an
    // entry for all ~25 CLASS_GROUP_COLORS keys whether or not any ticket uses them, so the
    // default view was leading with 16 flat "0%" glass tubes pushed off the right edge — the
    // unfiltered panel looked worse than a filtered one, which is backwards.
    return scoped.filter((e) => e.total > 0).sort((a, b) => b.total - a.total)
  }, [data, activeSector])

  const totalAll = sorted.reduce((s, e) => s + e.total, 0)
  const doneAll = sorted.reduce((s, e) => s + e.completed, 0)
  const pctAll = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0

  const sectorLabel = (s: CategorySectorOption) =>
    s.name ? `${s.sectorNo}. ${s.name}` : `Sector ${s.sectorNo}`

  // Tickets page reads these filters from ?class=<classGroup>&sector=<sectorNo> (see
  // TicketsToolbar.tsx) — URLSearchParams handles the encoding, so the raw category name
  // (spaces included) is fine here. Carrying the sector through means the list the user lands on
  // matches the exact number they clicked on the tube.
  const goToCategory = (entry: CategoryBreakdownEntry) => {
    const params = new URLSearchParams({ class: entry.name })
    if (activeSector) params.set('sector', String(activeSector.sectorNo))
    router.push(`/tickets?${params.toString()}`)
  }

  const [active, setActive] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const tubeRefs = useRef<(HTMLDivElement | null)[]>([])

  // Cursor-following hover card, rendered via a portal to document.body with position: fixed in
  // viewport coordinates. A card positioned relative to the row (the earlier approach) gets
  // clipped, because overflow-x-auto on that row implicitly forces overflow-y: auto too — a
  // fixed-position portal sidesteps every ancestor's clip/overflow box entirely.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [cursor, setCursor] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        setActive(true)
        observer.disconnect()
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handlePointerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    setCursor({ x: e.clientX, y: e.clientY })

    let nextIndex: number | null = null
    // Bounded by the *current* tube count, not the ref array's length — switching sectors can
    // shrink the row, and a detached element left in a trailing slot would still match on x.
    for (let i = 0; i < sorted.length; i++) {
      const el = tubeRefs.current[i]
      if (!el || !el.isConnected) continue
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right) {
        nextIndex = i
        break
      }
    }
    setHoverIndex(nextIndex)
  }

  const hoveredEntry = (hoverIndex !== null ? sorted[hoverIndex] : null) ?? null

  // Which side(s) of the tube row have content scrolled out of view, so the row can fade at
  // exactly those edges. Without it the row just ends mid-tube at the panel's edge with nothing
  // to say there's more — and at 375px most of it is off-screen.
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [sorted.length])

  // Masking the scroll container (rather than laying a coloured gradient over it) lets the
  // panel's own vertical gradient show through the faded edge, so the hint can't mismatch the
  // background the way a hardcoded fade colour would.
  const EDGE_FADE = 40
  const rowMask =
    edges.left || edges.right
      ? `linear-gradient(to right, transparent 0px, #000 ${edges.left ? EDGE_FADE : 0}px, #000 calc(100% - ${edges.right ? EDGE_FADE : 0}px), transparent 100%)`
      : undefined

  // A sector with two categories shouldn't leave 780px of dead panel to the right: sparse rows
  // get wider tubes and centre themselves instead of hugging the left edge.
  const sparse = sorted.length <= 5
  const tubeMaxWidth = sparse ? 176 : 148

  return (
    <section
      ref={panelRef}
      className="relative overflow-hidden rounded-2xl animate-fade-in"
      style={{
        border: '1px solid var(--category-panel-border)',
        background:
          'linear-gradient(180deg, var(--category-panel-top), var(--category-panel-deep))',
        boxShadow:
          'inset 0 1px 0 0 var(--category-tube-inset-top), 0 16px 40px -20px rgba(0,0,0,calc(0.5 * var(--category-liquid-glow) + 0.08))',
      }}
    >
      {/* Faint ambient sheen so the glass doesn't read as a flat slab */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(55% 45% at 85% 0%, var(--category-panel-sheen-1), transparent 60%), radial-gradient(40% 35% at 10% 100%, var(--category-panel-sheen-2), transparent 60%)',
        }}
        aria-hidden
      />

      <div className="relative flex flex-col gap-4 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{
              border: '1px solid var(--category-tube-border)',
              background: 'var(--category-tube-bg)',
              color: 'var(--category-label)',
            }}
          >
            <Shapes className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--category-heading)' }}>
              Tickets by category
            </h3>
            <p
              className="mt-0.5 truncate text-[11px]"
              style={{ color: 'var(--category-label-muted)' }}
            >
              {activeSector
                ? `${sorted.length} ${sorted.length === 1 ? 'category' : 'categories'} in this sector`
                : sectors.length > 0
                  ? `Across all ${sectors.length} sectors`
                  : 'Across all sectors'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {sectors.length > 0 && (
            <div className="w-full min-w-0 sm:w-60">
              <SearchableSelect
                value={sectorValue}
                onChange={(v) => {
                  setSectorValue(v)
                  // The row can shrink under the cursor; a stale index would point at a tube
                  // that no longer exists (or a different category entirely).
                  setHoverIndex(null)
                }}
                placeholder="All sectors"
                emptyLabel="All sectors"
                // The fill rides on the *selection*, not on each option: every sector would carry
                // the same dot, and 32 identical dots encode nothing — they just add noise to a
                // list being scanned by name.
                selectionColor={SECTOR_FILTER_COLOR}
                className="text-[var(--category-label)]"
                inputClassName="border-[var(--category-control-border)] bg-[var(--category-control-bg)] text-[var(--category-heading)] placeholder:text-[var(--category-label)]"
                menuClassName="border-[var(--category-control-menu-border)] bg-[var(--category-control-menu-bg)]"
                options={sectors.map((s) => ({
                  value: String(s.sectorNo),
                  label: sectorLabel(s),
                }))}
              />
            </div>
          )}
          <div className="shrink-0 pt-0.5 text-right">
            <p
              className="text-xl font-semibold leading-none tracking-tight tabular-nums"
              style={{ color: 'var(--category-heading)' }}
            >
              {pctAll}%
            </p>
            <p
              className="mt-1 whitespace-nowrap text-[11px] tabular-nums"
              style={{ color: 'var(--category-label-muted)' }}
            >
              {doneAll.toLocaleString()} of {totalAll.toLocaleString()} resolved
            </p>
          </div>
        </div>
      </div>

      {totalAll === 0 ? (
        <div className="relative flex flex-col items-center justify-center gap-1.5 px-5 pb-8 pt-2 text-center">
          <MapPin className="mb-1 h-5 w-5" style={{ color: 'var(--category-label-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--category-heading)' }}>
            {activeSector ? `No tickets in ${sectorLabel(activeSector)}` : 'No category data yet'}
          </p>
          <p className="text-xs" style={{ color: 'var(--category-label-muted)' }}>
            {activeSector
              ? 'Pick another sector, or clear the filter to see every category.'
              : 'Tickets imported with a map location will show up here.'}
          </p>
        </div>
      ) : (
        <div
          ref={rowRef}
          className="relative overflow-x-auto px-5 pb-5 pt-6"
          style={{ WebkitMaskImage: rowMask, maskImage: rowMask }}
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* min-width forces horizontal scroll rather than squeezing tubes, but is scaled to the
              tube count so a 3-category sector doesn't sit in a mostly-empty 680px scroll area. */}
          <div
            className={cn('flex items-end gap-2.5', sparse && 'justify-center')}
            style={{ minWidth: Math.min(680, sorted.length * 62) }}
          >
            {sorted.map((entry, i) => (
              <Tube
                key={entry.name}
                entry={entry}
                index={i}
                active={active}
                isHovered={hoverIndex === i}
                maxWidth={tubeMaxWidth}
                onOpen={goToCategory}
                tubeRef={(el) => {
                  tubeRefs.current[i] = el
                }}
              />
            ))}
          </div>
        </div>
      )}

      {hoveredEntry && <HoverCard entry={hoveredEntry} cursorX={cursor.x} cursorY={cursor.y} />}
    </section>
  )
}
