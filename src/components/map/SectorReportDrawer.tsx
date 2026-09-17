'use client'

import { useEffect, useRef, useState, type JSX } from 'react'
import { ParcelIcon, GridIcon, RoadIcon } from '@/components/map/icons'

// Must match the drawer-swipe-in/-out keyframes' duration in globals.css --
// this is what the unmount timeout below waits out before actually removing
// the drawer from the DOM, so the swipe-out animation gets to finish playing.
const DRAWER_ANIM_MS = 260

// Opens as a short strip (just the header/handle plus a sliver of content)
// rather than immediately taking over most of the map -- the user drags the
// top handle to grow it, same resize-by-drag interaction as the Stats
// panel's width handle, just on the vertical axis instead of horizontal.
const DEFAULT_HEIGHT_VH = 18
const MIN_HEIGHT_PX = 120
const MAX_HEIGHT_VH = 88
// Height the drawer opens to when the user actually activates it (heading-row click, or the
// drag-handle pill -- see toggleActive below), tall enough that the report's three columns are
// actually readable instead of just a sliver. Only ever *raises* height, never shrinks a height
// the user already dragged taller than this -- see toggleActive's Math.max.
const ACTIVE_HEIGHT_VH = 48
// Pointer travel (px) past which the drag strip's gesture counts as a resize rather than a click.
// The pill sits *inside* the drag strip, and because dragging up grows the drawer upward the pill
// tracks the cursor the whole way -- so a resize that starts on the pill also ends on it, and the
// browser fires a perfectly ordinary click on pointerup. Without this guard, dragging the one
// obvious grab affordance resized the drawer and then immediately collapsed it again.
const DRAG_SLOP_PX = 4
// How much one ArrowUp/ArrowDown on the drag handle changes the drawer's height.
const KEYBOARD_RESIZE_STEP_PX = 48

type Report = {
  sectorNo: number
  name: string
  landSummary: {
    totalGeographicHectares: number
    totalMelaLandHectares: number
    byClass: Record<string, number>
  }
  keyActivities: { classGroup: string; items: { subclass: string; label: string }[] }[]
  utilityInfrastructure: {
    roadLengthKm: number
    dustBins: number
    transformers: number
    toilets: number
    toiletBlockCount: number
    toiletBlocks: { name: string | null; seats: number }[]
    ghats: number
  }
}

const SECTION_THEMES = {
  blue: { bg: 'var(--map-section-blue-bg)', fg: 'var(--map-section-blue-fg)' },
  amber: { bg: 'var(--map-section-amber-bg)', fg: 'var(--map-section-amber-fg)' },
  teal: { bg: 'var(--map-section-teal-bg)', fg: 'var(--map-section-teal-fg)' },
  violet: { bg: 'var(--map-section-violet-bg)', fg: 'var(--map-section-violet-fg)' },
} as const
type Theme = keyof typeof SECTION_THEMES

// One fixed theme per Land Summary stat and per Key Activities class_group so
// each reads consistently across sectors instead of shuffling colors --
// unrecognized class_groups (a sector can have activities outside the 6
// Land Summary classes, e.g. "Amenities"/"Other"/"Road") fall back to blue.
const LAND_STAT_THEME: Record<string, Theme> = {
  Parking: 'blue',
  Commercial: 'amber',
  'Religious Camping': 'violet',
  'Police Camping': 'violet',
  'Administrative Camping': 'teal',
  'Health Camping': 'amber',
}
const LAND_STAT_LABEL: Record<string, string> = {
  Parking: 'Parking area',
  Commercial: 'Commercial area',
  'Religious Camping': 'Religious camping area',
  'Police Camping': 'Police camping area',
  'Administrative Camping': 'Admin camping area',
  'Health Camping': 'Health camping area',
}
const ACTIVITY_THEME: Record<string, Theme> = {
  Parking: 'blue',
  'Police Camping': 'violet',
  'Administrative Camping': 'teal',
  'Religious Camping': 'violet',
  Commercial: 'amber',
  'Health Camping': 'amber',
}

function IconTent({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6l7-3z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  )
}
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"
        stroke="currentColor"
        strokeWidth={1.8}
      />
    </svg>
  )
}
function IconShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2l2.4 5 5.6.8-4 4 1 5.5L12 15l-5 2.3 1-5.5-4-4 5.6-.8L12 2z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  )
}
function IconParking({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.5" y="9" width="17" height="10" rx="1.4" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M7 9V6.5A2.5 2.5 0 0 1 9.5 4h5A2.5 2.5 0 0 1 17 6.5V9"
        stroke="currentColor"
        strokeWidth={1.6}
      />
    </svg>
  )
}
function IconOffice({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 21V9l8-6 8 6v12" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />
      <path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />
    </svg>
  )
}
function IconStore({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 21V9l4-5h10l4 5v12"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <path d="M3 9h18" stroke="currentColor" strokeWidth={1.7} />
    </svg>
  )
}
function IconCross({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth={1.6} />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}
function IconTransformer({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="6" y="3" width="12" height="18" rx="1.4" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M9 8h6M9 12h6M9 16h3"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  )
}
function IconToilet({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="6" r="2.5" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M12 8.5V16M8 12h8M8 21l4-5 4 5"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  )
}
function IconBin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 7h12l-1 13H7L6 7z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"
        stroke="currentColor"
        strokeWidth={1.6}
      />
      <path
        d="M10 10.5v6M14 10.5v6"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  )
}
function IconWave({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 15c2 0 2-3 4-3s2 3 4 3 2-3 4-3 2 3 4 3M3 19c2 0 2-3 4-3s2 3 4 3 2-3 4-3 2 3 4 3"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </svg>
  )
}
function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </svg>
  )
}

const LAND_STAT_ICON: Record<string, (p: { className?: string }) => JSX.Element> = {
  Parking: IconParking,
  Commercial: IconStore,
  'Religious Camping': IconTent,
  'Police Camping': IconShield,
  'Administrative Camping': IconOffice,
  'Health Camping': IconCross,
}
const ACTIVITY_ICON: Record<string, (p: { className?: string }) => JSX.Element> = {
  Parking: IconParking,
  'Police Camping': IconShield,
  'Administrative Camping': IconOffice,
  'Religious Camping': IconTent,
  Commercial: IconStore,
  'Health Camping': IconCross,
}

/** Sub-1% shares are the norm here (a 0.02 ha plot of 9 ha), so "0%" would be actively misleading. */
function formatShare(share: number) {
  const pct = share * 100
  if (pct > 0 && pct < 0.1) return '<0.1%'
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`
}

function StatTile({
  theme,
  icon: Icon,
  value,
  label,
  share,
  note,
}: {
  theme: Theme
  icon: (p: { className?: string }) => JSX.Element
  value: string
  label: string
  /** 0-1. Renders a hairline share bar -- the hectare figures are meaningless without a denominator. */
  share?: number
  /** Plain-text alternative to `share`, for a figure measured against a different denominator. */
  note?: string
}) {
  const t = SECTION_THEMES[theme]
  return (
    <div
      className="flex items-center gap-2 rounded-[10px] border p-2"
      style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
    >
      <span
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]"
        style={{ backgroundColor: t.bg, color: t.fg }}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div
          className="text-[13.5px] font-bold leading-tight tabular-nums"
          style={{ color: 'var(--map-fg)' }}
        >
          {value}
        </div>
        <div
          className="mt-0.5 text-[10.5px] leading-tight"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          {label}
        </div>
        {note !== undefined && (
          <div
            className="mt-1 text-[9.5px] font-semibold leading-none tabular-nums"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {note}
          </div>
        )}
        {share !== undefined && (
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className="h-[3px] min-w-[14px] flex-1 overflow-hidden rounded-full"
              style={{ backgroundColor: 'var(--map-switch-track)' }}
            >
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.min(100, share * 100)}%`, backgroundColor: t.fg }}
              />
            </span>
            <span
              className="shrink-0 text-[9.5px] font-semibold leading-none tabular-nums"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              {formatShare(share)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Sinks groups that carry no detail beyond their own name -- "Road" whose every plot is labelled
 * "Road" -- below the ones that actually list something. Presentation only: nothing is dropped,
 * because which class groups are worth a planner's attention is a product call, not a UI one.
 */
function sortActivitiesByDetail(groups: Report['keyActivities']) {
  const isBare = (g: Report['keyActivities'][number]) =>
    g.items.every((i) => i.label === g.classGroup)
  return [...groups].sort((a, b) => Number(isBare(a)) - Number(isBare(b)))
}

/**
 * Collapses byte-identical block descriptions into a single row. Sectors routinely carry two dozen
 * blocks sharing one name and seat count, which rendered as two dozen identical lines -- a list
 * that was longer than the scrollport it sat in while saying nothing a single row wouldn't.
 */
function groupToiletBlocks(blocks: { name: string | null; seats: number }[]): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>()
  for (const b of blocks) {
    const text = b.name?.trim() || '(no seat breakdown recorded)'
    const key = `${text}|${b.seats}`
    const existing = rows.get(key)
    if (existing) {
      existing.seats += b.seats
      existing.count += 1
    } else {
      rows.set(key, { key, text, seats: b.seats, count: 1 })
    }
  }
  return [...rows.values()]
}

type BreakdownRow = {
  key: string
  text: string
  /** Total seats across every block sharing this description. */
  seats: number
  /** How many blocks collapsed into this row. */
  count: number
}

function UtilRow({
  theme,
  icon: Icon,
  value,
  label,
  breakdown,
  breakdownId,
}: {
  theme: Theme
  icon: (p: { className?: string }) => JSX.Element
  value: string
  label: string
  /** Optional expandable detail rows (e.g. per-block toilet seat math) shown below on click. */
  breakdown?: BreakdownRow[]
  breakdownId?: string
}) {
  const t = SECTION_THEMES[theme]
  const [open, setOpen] = useState(false)
  const hasBreakdown = !!breakdown && breakdown.length > 0
  const total = hasBreakdown ? breakdown.reduce((sum, b) => sum + b.seats, 0) : 0
  const blockCount = hasBreakdown ? breakdown.reduce((sum, b) => sum + b.count, 0) : 0
  return (
    <div
      className="rounded-[9px] border"
      style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
    >
      {/* A real <button> when it toggles something -- it used to be a bare div with onClick, so
          the expander was invisible to keyboard and screen-reader users entirely. */}
      {(() => {
        const inner = (
          <>
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: t.bg, color: t.fg }}
            >
              <Icon className="h-[15px] w-[15px]" />
            </span>
            <div className="min-w-0 flex-1 text-left">
              <div
                className="text-[13px] font-bold leading-tight"
                style={{ color: 'var(--map-fg)' }}
              >
                {value}
              </div>
              <div
                className="mt-0.5 text-[10.5px] leading-tight"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                {label}
              </div>
            </div>
            {hasBreakdown && (
              <span
                className="shrink-0 text-[10.5px] font-semibold"
                style={{ color: 'var(--map-fg-muted)' }}
              >
                {open ? 'Hide math ▲' : 'Show math ▼'}
              </span>
            )}
          </>
        )
        return hasBreakdown ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={breakdownId}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2 py-[7px] text-left"
          >
            {inner}
          </button>
        ) : (
          <div className="flex items-center gap-2.5 px-2 py-[7px]">{inner}</div>
        )
      })()}
      {hasBreakdown && open && (
        <div
          id={breakdownId}
          className="kumbh-scroll flex max-h-[180px] flex-col gap-0.5 overflow-y-auto border-t px-2 py-1.5"
          style={{ borderColor: 'var(--map-border)' }}
        >
          {breakdown.map((b) => (
            <div
              key={b.key}
              className="flex items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-[10.5px]"
            >
              <span className="min-w-0 truncate" style={{ color: 'var(--map-fg-muted)' }}>
                <span title={b.text}>{b.text}</span>
                {/* The actual arithmetic, which is the whole point of "show math" -- a lone
                    grouped row otherwise just restated the collapsed header's own total. */}
                {b.count > 1 && (
                  <span className="font-semibold tabular-nums">
                    {' '}
                    · {b.count} × {b.seats / b.count}
                  </span>
                )}
              </span>
              <span
                className="shrink-0 font-semibold tabular-nums"
                style={{ color: 'var(--map-fg)' }}
              >
                {b.seats}
              </span>
            </div>
          ))}
          {breakdown.length > 1 && (
            <div
              className="mt-0.5 flex items-baseline justify-between gap-2 border-t px-1 pt-1 text-[10.5px] font-semibold"
              style={{ borderColor: 'var(--map-border)' }}
            >
              <span style={{ color: 'var(--map-fg-muted)' }}>Total · {blockCount} blocks</span>
              <span className="shrink-0 tabular-nums" style={{ color: 'var(--map-fg)' }}>
                {total}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HeadChip({ value, label }: { value: string; label: string }) {
  return (
    <span
      className="flex items-baseline gap-1 rounded-md border px-1.5 py-1 text-[10.5px] leading-none"
      style={{ backgroundColor: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
    >
      <span className="font-bold tabular-nums" style={{ color: 'var(--map-fg)' }}>
        {value}
      </span>
      <span style={{ color: 'var(--map-fg-muted)' }}>{label}</span>
    </span>
  )
}

function ColHead({
  theme,
  icon: Icon,
  title,
}: {
  theme: Theme
  icon: (p: { className?: string }) => JSX.Element
  title: string
}) {
  const t = SECTION_THEMES[theme]
  return (
    <div
      // Sticky so a row is never orphaned from the section it belongs to. Scrolled even slightly
      // into the report, every heading used to be gone and what was left was a wall of unlabelled
      // tiles ("0.17 ha", "46 nos") with nothing saying which section they came from. It sticks to
      // the grid's scrollport below 820px and to its own column's above, because the section
      // between them never establishes a scroll container of its own.
      //
      // The top padding lives HERE rather than on the section, and there is deliberately no
      // negative *vertical* margin: `top: 0` aligns an element's MARGIN box to the scrollport, so
      // a `-mt-4` put the margin box 16px above the border box and left a 16px strip of live
      // content scrolling uncovered above the heading -- which is what made group cards appear to
      // float above their own column title and clipped the first row in half. `-mx-4` is safe
      // because only the vertical axis participates in `top` stickiness.
      className="sticky top-0 z-10 -mx-4 mb-1 flex items-center gap-1.5 px-4 pb-2 pt-4 backdrop-blur-md"
      style={{
        // The panel token is translucent (0.92 light / 0.85 dark), which let tiles ghost through
        // the band as they scrolled under it and read as a broken row. Painting it twice --
        // once as the color, once as a flat gradient layer -- composites to ~0.99/0.98 without
        // hardcoding a second colour outside the token set.
        backgroundColor: 'var(--map-panel-bg)',
        backgroundImage: 'linear-gradient(var(--map-panel-bg), var(--map-panel-bg))',
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: t.bg, color: t.fg }}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span
        className="text-[11px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--map-fg-muted)' }}
      >
        {title}
      </span>
    </div>
  )
}

export default function SectorReportDrawer({
  sectorNo,
  sectorLabel,
}: {
  /** Drawer is hidden entirely when null -- same "no sector selected" gate as the Stats panel's filtered view. */
  sectorNo: number | null
  sectorLabel: string
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Starts collapsed (matches the effect below, which enforces this on every sectorNo change
  // too) so a sector already selected on first mount -- e.g. a deep link -- never flashes the
  // full report open for a frame before that effect collapses it back.
  const [collapsed, setCollapsed] = useState(true)
  // Keeps the drawer mounted for the swipe-out animation's duration after
  // sectorNo goes back to null, instead of vanishing instantly -- mirrors
  // the DRAWER_ANIM_MS timeout below, which is what actually unmounts it.
  const [closing, setClosing] = useState(false)
  const [mounted, setMounted] = useState(sectorNo !== null)
  // Drawer opens as a short strip and grows only when the user drags the
  // handle -- same resize-by-drag model as Panel.tsx's width handle, just
  // measured in viewport-height px instead of width px.
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined'
      ? 200
      : Math.round((window.innerHeight * DEFAULT_HEIGHT_VH) / 100),
  )
  const [dragging, setDragging] = useState(false)
  const dragState = useRef({ startY: 0, startHeight: height, moved: false })
  const rootRef = useRef<HTMLDivElement>(null)

  // Shared by the drag clamp below and toggleActive's expand bump, so the two never drift apart
  // (a bumped-open height must still respect the same ceiling a drag would).
  function maxDrawerHeightPx() {
    return Math.min((window.innerHeight * MAX_HEIGHT_VH) / 100, window.innerHeight - 96)
  }

  function startDrag(e: React.PointerEvent) {
    e.preventDefault()
    dragState.current = {
      startY: e.clientY,
      // While collapsed the container ignores `height` entirely (see its style prop), so the
      // state value is a stale leftover from the last expansion -- measuring the strip keeps a
      // drag that begins collapsed from jumping to that old height on its first move.
      startHeight: rootRef.current?.offsetHeight ?? height,
      moved: false,
    }
    setDragging(true)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      // Dragging the top handle up (negative delta) grows the drawer.
      const delta = dragState.current.startY - ev.clientY
      if (Math.abs(delta) > DRAG_SLOP_PX) {
        dragState.current.moved = true
        // Dragging the strip open is the same intent as clicking it open. Without this the
        // gesture did nothing at all from a collapsed drawer: `height` is ignored while
        // collapsed, and the click that used to expand it is now swallowed as a drag.
        setCollapsed(false)
      }
      const next = Math.min(
        maxDrawerHeightPx(),
        Math.max(MIN_HEIGHT_PX, dragState.current.startHeight + delta),
      )
      setHeight(next)
    }
    function onUp() {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Shared by both activation gestures (heading-row click and the drag-handle pill's click --
  // see their onClick handlers below). Only *opening* (collapsed -> active) also bumps `height`
  // up to ACTIVE_HEIGHT_VH when it's currently smaller -- e.g. still at the short default strip
  // height, or a small height left over from a previous drag -- so activating the drawer always
  // shows enough of the report to be useful instead of reopening at whatever sliver of a height
  // happened to be set last. Never *shrinks* a height the user already dragged taller than that,
  // and never touches height on the way back to collapsed (collapsing ignores height entirely --
  // see the container's `height: collapsed ? undefined : height` below).
  function toggleActive() {
    setCollapsed((wasCollapsed) => {
      if (wasCollapsed) {
        const activeHeight = Math.min(
          maxDrawerHeightPx(),
          Math.round((window.innerHeight * ACTIVE_HEIGHT_VH) / 100),
        )
        setHeight((h) => Math.max(h, activeHeight))
      }
      return !wasCollapsed
    })
  }

  useEffect(() => {
    if (sectorNo !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local mount/closing state to the sectorNo prop transition itself (open), not state driven by an external system
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, DRAWER_ANIM_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mounted` is read but intentionally excluded: including it would re-run this on the timeout's own setMounted(false) and cancel/restart the just-completed close
  }, [sectorNo])

  useEffect(() => {
    if (sectorNo === null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off a fresh fetch's loading state on sectorNo changing, not state synced from an external system
    setLoading(true)
    setError(null)
    let cancelled = false
    fetch(`/api/sector-plan/report?sector=${sectorNo}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        setReport(data)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sectorNo])

  // Always (re)starts collapsed -- an inactive strip, not the full report -- whenever a
  // (different) sector is picked. Selecting a sector is not itself a request to see the report;
  // the drawer only goes active once the user deliberately clicks its heading row (see the
  // heading's onClick below). Runs on every sectorNo change, not just null-to-number, so picking
  // sector B while sector A's drawer happened to be left expanded doesn't carry that open state
  // over -- each newly picked sector starts from the same inactive state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting UI-only collapsed state on sectorNo changing, not state synced from an external system
    setCollapsed(true)
  }, [sectorNo])

  if (!mounted) return null

  const landClasses = report
    ? (Object.keys(LAND_STAT_LABEL) as (keyof typeof LAND_STAT_LABEL)[]).filter(
        (cls) => report.landSummary.byClass[cls] !== undefined,
      )
    : []

  return (
    <div
      ref={rootRef}
      style={{
        backgroundColor: 'var(--map-panel-bg)',
        borderColor: 'var(--map-panel-border)',
        boxShadow: '0 -8px 30px var(--map-panel-shadow)',
        color: 'var(--map-fg)',
        animationDuration: `${DRAWER_ANIM_MS}ms`,
        height: collapsed ? undefined : height,
      }}
      // 336px on each side clears the two docked side panels at their default desktop widths
      // (~w-72 left + offset, ~320px right default + offset). Below `sm` those panels are
      // collapsed-by-default and, when open, cover the full width themselves rather than
      // docking beside content -- so the drawer only needs a small fixed margin there, not an
      // inset sized for panels that aren't sharing the screen with it on a phone.
      //
      // `@container` here is load-bearing, not decorative: this element's own *rendered* width
      // (viewport minus the 336px side margins above) is what the report grid below actually has
      // to work with -- and that is NOT the same number as the viewport-width `sm` breakpoint.
      // A 1024-1200px-wide screen still satisfies `sm` (640px) so a viewport-media-query grid
      // would force the 3-column report layout, but only leaves ~350-500px of real estate once
      // both docked panels are accounted for -- nowhere near enough, which is what was squeezing
      // stat values into mid-word wraps. Querying this element's own size instead of the
      // viewport's is what lets the report grid react to the space it actually has.
      className={`@container absolute bottom-0 left-3 right-3 z-20 flex max-h-[calc(100dvh-96px)] max-w-[calc(100vw-24px)] flex-col rounded-t-2xl border border-b-0 backdrop-blur-md sm:left-[336px] sm:right-[336px] sm:max-w-[calc(100vw-360px)] ${
        dragging ? '' : 'transition-[height] duration-150 ease-out'
      } ${closing ? 'animate-[drawer-swipe-out_ease-in_forwards]' : 'animate-[drawer-swipe-in_ease-out]'}`}
    >
      {/* Drag strip -- grabbing anywhere in it and moving vertically resizes
          the drawer (same pointer-capture drag pattern as Panel.tsx's width
          handle); clicking the pill itself without dragging still toggles
          collapsed, so both gestures live on one strip instead of competing
          for space. */}
      <div
        onPointerDown={startDrag}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize sector report drawer"
        className="flex shrink-0 cursor-row-resize touch-none select-none items-center justify-center pb-1 pt-2"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            // A drag that started here also *ends* here (see DRAG_SLOP_PX) and arrives as a click.
            // `detail > 0` keeps this to real pointer clicks -- a keyboard Enter/Space produces a
            // click with no preceding pointerdown, so it would otherwise read a stale `moved`.
            if (e.detail > 0 && dragState.current.moved) return
            toggleActive()
          }}
          // Arrow keys resize, matching what the pointer drag does -- the resize was otherwise
          // reachable only with a pointer.
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            e.preventDefault()
            setCollapsed(false)
            setHeight((h) => {
              const from = collapsed ? (rootRef.current?.offsetHeight ?? h) : h
              const step = e.key === 'ArrowUp' ? KEYBOARD_RESIZE_STEP_PX : -KEYBOARD_RESIZE_STEP_PX
              return Math.min(maxDrawerHeightPx(), Math.max(MIN_HEIGHT_PX, from + step))
            })
          }}
          aria-label={collapsed ? 'Expand sector report' : 'Collapse sector report'}
          aria-expanded={!collapsed}
          className="cursor-pointer rounded-full p-1.5"
        >
          <span
            className="block h-1 w-9 rounded-full transition-colors"
            style={{ backgroundColor: dragging ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
          />
        </button>
      </div>

      {/* Heading row -- icon, title, sector label, and the collapse ("X") button. Clicking
          anywhere in this row *other than* the "X" button (which stops its own propagation)
          toggles the drawer between its inactive strip and the full report -- picking a sector
          only ever opens the inactive strip (see the sectorNo effect above); this is the one
          gesture that actually shows the report. The "X" button only ever collapses back to that
          same inactive strip now -- it no longer deselects the sector (that used to call the
          removed onClose prop), so the drawer stays available for a re-click without having to
          re-pick the sector. */}
      {/* Deliberately NOT role="button"/tabIndex: it contains the "X" button and the summary
          chips, and an ARIA button may not contain interactive descendants -- it also flattened
          the chips into its own label, so screen-reader users got a duplicate "Expand sector
          report" and none of the figures. The pill above is the real, labelled, keyboard-
          reachable expand/collapse control; this stays a plain click-anywhere convenience. */}
      <div
        onClick={toggleActive}
        style={{ borderColor: 'var(--map-panel-border)' }}
        className="flex shrink-0 cursor-pointer items-center gap-2.5 border-b px-5 pb-3.5"
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
        >
          <ParcelIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[14.5px] font-bold leading-tight"
            style={{ color: 'var(--map-fg)' }}
          >
            Sector Report
          </p>
          <p
            className="truncate text-[11.5px] leading-tight"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {sectorLabel}
          </p>
        </div>
        {/* Headline figures inline in the heading, so the collapsed strip is worth the ~76px of
            map it costs -- on its own it only repeated the sector name the left panel already
            shows. Hidden below 380px of drawer width, where the title alone fills the row. */}
        {report && (
          <div className="hidden shrink-0 items-center gap-1.5 @min-[380px]:flex">
            <HeadChip value={`${report.landSummary.totalMelaLandHectares} ha`} label="Mela land" />
            {/* Plots, not groups -- `keyActivities.length` is the number of class_group cards,
                so a sector with 21 plots across 7 groups read as "7 activities". */}
            <HeadChip
              value={`${report.keyActivities.reduce((n, g) => n + g.items.length, 0)}`}
              label="plots"
            />
            <HeadChip value={`${report.utilityInfrastructure.roadLengthKm} km`} label="roads" />
          </div>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setCollapsed(true)
          }}
          aria-label="Collapse sector report"
          style={{ color: 'var(--map-fg-muted)' }}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--map-surface-hover)]"
        >
          <IconClose className="h-[15px] w-[15px]" />
        </button>
      </div>

      {!collapsed && (
        <>
          {loading && (
            <div
              className="flex items-center gap-2 px-5 py-8 text-[12.5px]"
              style={{ color: 'var(--map-fg-muted)' }}
            >
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                style={{
                  borderColor: 'var(--map-switch-track)',
                  borderTopColor: 'var(--map-accent)',
                }}
              />
              Loading sector report…
            </div>
          )}
          {error && (
            <div className="px-5 py-4">
              <div
                className="rounded-lg border px-2.5 py-2 text-[12.5px]"
                style={{
                  borderColor: 'var(--danger-soft)',
                  backgroundColor: 'var(--danger-soft)',
                  color: 'var(--danger)',
                }}
              >
                Failed to load sector report: {error}
              </div>
            </div>
          )}
          {report && (
            <div
              // Three tiers, keyed off this container's *actual* rendered width (see the
              // `@container` note on the root drawer div above), not the viewport:
              //  - narrow: one vertically-stacked column.
              //  - >=460px of real width: Land Summary + Key Activities side by side, Utility
              //    Infrastructure spanning full-width below -- two columns is the point past
              //    which each still fits its 2-across stat-tile grid without wrapping.
              //  - >=820px: three side by side, each its own scrollport. Land Summary is capped
              //    at 340px (its 2-across tiles never need more; 1fr handed it ~480px and left
              //    the slack sitting empty) so the overflow goes to Key Activities, the one
              //    section whose content is genuinely unbounded.
              //
              // WHO SCROLLS is the load-bearing part, and it flips at 820px. Only in the 3-column
              // tier -- one grid row, every column the full height of the drawer -- does a
              // per-column scrollport make sense. Below that the sections are stacked grid ROWS,
              // and giving each its own `overflow-y-auto` was actively broken: `align-content`
              // defaults to `normal` (= stretch), so auto rows split the drawer's fixed height
              // *equally* regardless of content, and each row then clipped itself. Measured at
              // 1350px wide: two 141px rows, with 949px of Key Activities content trapped in one
              // of them, while the grid itself had nothing to scroll. `auto-rows-min` is what
              // actually sizes the rows to their content -- `content-start` alone does NOT, since
              // implicit `auto` rows in a definite-height grid get divided evenly regardless of
              // align-content (verified: rows stayed 141.95px under both `normal` and `start`).
              // The single `overflow-y-auto` here then makes the whole report one scroller, which
              // is also what gives the sticky ColHeads something to stick to. At >=820px both
              // revert so the one row fills the drawer and each column scrolls on its own again.
              //
              // WHICH SECTIONS SHARE A ROW matters for the same reason. A grid row is as tall as
              // its tallest item, so pairing Land Summary (bounded, ~390px) with Key Activities
              // (unbounded, 1500px+) left Land Summary in a 1500px box that was ~1100px of blank
              // space, with its sticky heading pinned over nothing and Utility Infrastructure
              // stranded five screenfuls down. The middle tier therefore pairs the two *bounded*
              // sections on row 1 and gives the unbounded one a full-width row 2. That is why the
              // placement below is explicit rather than relying on source order.
              className="kumbh-scroll grid min-h-0 flex-1 auto-rows-min grid-cols-1 content-start overflow-y-auto @min-[460px]:grid-cols-2 @min-[820px]:auto-rows-auto @min-[820px]:grid-cols-[340px_1fr_260px] @min-[820px]:content-normal @min-[820px]:overflow-hidden"
            >
              {/* Land Summary */}
              <div
                className="kumbh-scroll min-h-0 border-b px-4 pb-4 @min-[460px]:col-start-1 @min-[460px]:row-start-1 @min-[460px]:border-b-0 @min-[460px]:border-r @min-[820px]:overflow-y-auto"
                style={{ borderColor: 'var(--map-panel-border)' }}
              >
                <ColHead theme="teal" icon={GridIcon} title="Land Summary" />
                <div className="grid grid-cols-2 gap-2">
                  <StatTile
                    theme="blue"
                    icon={IconGlobe}
                    value={`${report.landSummary.totalGeographicHectares} ha`}
                    label="Total geographic area"
                  />
                  <StatTile
                    theme="amber"
                    icon={IconTent}
                    value={`${report.landSummary.totalMelaLandHectares} ha`}
                    label="Utilized Mela Land"
                    // Stated inline rather than as a bar: this one is a share of the sector's
                    // geographic area while every other bar is a share of Mela land, and two
                    // denominators drawn as adjacent identical bars invite a false comparison.
                    note={
                      report.landSummary.totalGeographicHectares > 0
                        ? `${formatShare(report.landSummary.totalMelaLandHectares / report.landSummary.totalGeographicHectares)} of sector`
                        : undefined
                    }
                  />
                  {landClasses.map((cls) => (
                    <StatTile
                      key={cls}
                      theme={LAND_STAT_THEME[cls]}
                      icon={LAND_STAT_ICON[cls]}
                      value={`${report.landSummary.byClass[cls]} ha`}
                      label={LAND_STAT_LABEL[cls]}
                      // Against Mela land, not the sector's whole geographic area -- these are
                      // allocations *within* the utilized land, and the geographic figure is
                      // ~60x larger, which would render every class as an identical "<0.1%".
                      // A 0 ha class still earns its tile -- "no health camping here" is a real
                      // answer -- but an empty bar reading "0.0%" beside it is just noise.
                      share={
                        report.landSummary.totalMelaLandHectares > 0 &&
                        report.landSummary.byClass[cls] > 0
                          ? report.landSummary.byClass[cls] /
                            report.landSummary.totalMelaLandHectares
                          : undefined
                      }
                    />
                  ))}
                </div>
                <p
                  className="mt-2 text-[10px] leading-snug"
                  style={{ color: 'var(--map-fg-muted)' }}
                >
                  Bars show each class as a share of utilized Mela land.
                </p>
              </div>

              {/* Key Activities */}
              <div
                className="kumbh-scroll @container min-h-0 border-b px-4 pb-4 @min-[460px]:col-span-2 @min-[460px]:row-start-2 @min-[460px]:border-b-0 @min-[460px]:border-t @min-[820px]:col-span-1 @min-[820px]:col-start-2 @min-[820px]:row-start-1 @min-[820px]:border-r @min-[820px]:border-t-0 @min-[820px]:overflow-y-auto"
                style={{ borderColor: 'var(--map-panel-border)' }}
              >
                <ColHead theme="violet" icon={GridIcon} title="Key Activities" />
                {report.keyActivities.length === 0 && report.utilityInfrastructure.ghats === 0 ? (
                  <p className="text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
                    No activities recorded for this sector.
                  </p>
                ) : (
                  // Two-up once this column itself is wide enough (it is its own `@container`, so
                  // this measures the column, not the drawer) -- it is the only section with
                  // unbounded content, and at the 3-column tier it gets all the slack width.
                  // `break-inside-avoid` keeps a group's header and its list together.
                  <div className="flex flex-col gap-2.5 @min-[430px]:block @min-[430px]:columns-2 @min-[430px]:gap-x-2.5 [&>*]:break-inside-avoid @min-[430px]:[&>*]:mb-2.5">
                    {sortActivitiesByDetail(report.keyActivities).map((group) => {
                      const theme = ACTIVITY_THEME[group.classGroup] ?? 'blue'
                      const t = SECTION_THEMES[theme]
                      const Icon = ACTIVITY_ICON[group.classGroup] ?? GridIcon
                      // Same generic label repeated for every plot in a group (e.g. every
                      // Religious Camping row's subclass is literally "Religious Camping")
                      // isn't a useful bullet list -- collapse those groups to just a count
                      // instead of dumping the identical string N times.
                      const distinctLabels = new Set(group.items.map((i) => i.label))
                      const showList =
                        distinctLabels.size > 1 ||
                        (distinctLabels.size === 1 && group.items.length <= 6)
                      return (
                        <div
                          key={group.classGroup}
                          className="overflow-hidden rounded-[10px] border"
                          style={{
                            backgroundColor: 'var(--map-surface-alt)',
                            borderColor: 'var(--map-border)',
                          }}
                        >
                          <div
                            className="flex items-center gap-1.5 border-b px-2.5 py-2"
                            style={{ borderColor: 'var(--map-border)' }}
                          >
                            <span
                              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
                              style={{ backgroundColor: t.bg, color: t.fg }}
                            >
                              <Icon className="h-[13px] w-[13px]" />
                            </span>
                            <span
                              className="text-[11.5px] font-bold"
                              style={{ color: 'var(--map-fg)' }}
                            >
                              {group.classGroup}
                            </span>
                            <span
                              className="ml-auto text-[10.5px] font-semibold tabular-nums"
                              style={{ color: 'var(--map-fg-muted)' }}
                            >
                              {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                            </span>
                          </div>
                          {showList && (
                            <ul className="flex flex-col gap-0.5 p-1">
                              {[...distinctLabels].map((label) => (
                                <li
                                  key={label}
                                  className="truncate rounded-md px-1.5 py-1 text-[11px]"
                                  style={{ color: 'var(--map-fg-muted)' }}
                                >
                                  {label}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                    {report.utilityInfrastructure.ghats > 0 && (
                      <div
                        className="flex items-center gap-1.5 rounded-[10px] border px-2.5 py-2"
                        style={{
                          backgroundColor: 'var(--map-surface-alt)',
                          borderColor: 'var(--map-border)',
                        }}
                      >
                        <span
                          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
                          style={{
                            backgroundColor: 'var(--map-section-blue-bg)',
                            color: 'var(--map-section-blue-fg)',
                          }}
                        >
                          <IconWave className="h-[13px] w-[13px]" />
                        </span>
                        <span
                          className="text-[11.5px] font-bold"
                          style={{ color: 'var(--map-fg)' }}
                        >
                          Ghats
                        </span>
                        <span
                          className="ml-auto text-[10.5px] font-semibold tabular-nums"
                          style={{ color: 'var(--map-fg-muted)' }}
                        >
                          {report.utilityInfrastructure.ghats}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Utility Infrastructure */}
              <div
                className="kumbh-scroll min-h-0 px-4 pb-4 @min-[460px]:col-start-2 @min-[460px]:row-start-1 @min-[820px]:col-start-3 @min-[820px]:overflow-y-auto"
                style={{ borderColor: 'var(--map-panel-border)' }}
              >
                <ColHead theme="amber" icon={RoadIcon} title="Utility Infrastructure" />
                {/* Two-up only in the middle tier, where this section spans the drawer's full
                    width -- four left-aligned rows across 650px was mostly empty space. At >=820px
                    it is back to a 260px column and stacks again. */}
                <div className="grid grid-cols-1 items-start gap-2 @min-[460px]:grid-cols-2 @min-[820px]:grid-cols-1">
                  <UtilRow
                    theme="amber"
                    icon={RoadIcon}
                    value={`${report.utilityInfrastructure.roadLengthKm} km`}
                    label="Total road length"
                  />
                  <UtilRow
                    theme="teal"
                    icon={IconBin}
                    value={`${report.utilityInfrastructure.dustBins} nos`}
                    label="Total dust bins"
                  />
                  <UtilRow
                    theme="violet"
                    icon={IconToilet}
                    value={`${report.utilityInfrastructure.toilets} nos`}
                    label={`Toilet seats · ${report.utilityInfrastructure.toiletBlockCount} block${report.utilityInfrastructure.toiletBlockCount === 1 ? '' : 's'}`}
                    breakdown={groupToiletBlocks(report.utilityInfrastructure.toiletBlocks)}
                    breakdownId="sector-report-toilet-breakdown"
                  />
                  <UtilRow
                    theme="blue"
                    icon={IconTransformer}
                    value={`${report.utilityInfrastructure.transformers} nos`}
                    label="Transformers"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
