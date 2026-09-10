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

function StatTile({
  theme,
  icon: Icon,
  value,
  label,
}: {
  theme: Theme
  icon: (p: { className?: string }) => JSX.Element
  value: string
  label: string
}) {
  const t = SECTION_THEMES[theme]
  return (
    <div
      className="flex items-center gap-2 rounded-[10px] border p-2"
      style={{ background: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
    >
      <span
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]"
        style={{ background: t.bg, color: t.fg }}
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
        <div className="mt-0.5 text-[9.5px] leading-tight" style={{ color: 'var(--map-fg-muted)' }}>
          {label}
        </div>
      </div>
    </div>
  )
}

function UtilRow({
  theme,
  icon: Icon,
  value,
  label,
  breakdown,
}: {
  theme: Theme
  icon: (p: { className?: string }) => JSX.Element
  value: string
  label: string
  /** Optional expandable detail rows (e.g. per-block toilet seat math) shown below on click. */
  breakdown?: { key: string; text: string; seats: number }[]
}) {
  const t = SECTION_THEMES[theme]
  const [open, setOpen] = useState(false)
  const hasBreakdown = !!breakdown && breakdown.length > 0
  return (
    <div
      className="rounded-[9px] border"
      style={{ background: 'var(--map-surface-alt)', borderColor: 'var(--map-border)' }}
    >
      <div
        className={`flex items-center gap-2.5 px-2 py-[7px] ${hasBreakdown ? 'cursor-pointer' : ''}`}
        onClick={hasBreakdown ? () => setOpen((v) => !v) : undefined}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: t.bg, color: t.fg }}
        >
          <Icon className="h-[15px] w-[15px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold leading-tight" style={{ color: 'var(--map-fg)' }}>
            {value}
          </div>
          <div
            className="mt-0.5 text-[10px] leading-tight"
            style={{ color: 'var(--map-fg-muted)' }}
          >
            {label}
          </div>
        </div>
        {hasBreakdown && (
          <span
            className="shrink-0 text-[9px] font-semibold"
            style={{ color: 'var(--map-fg-faint)' }}
          >
            {open ? 'Hide math ▲' : 'Show math ▼'}
          </span>
        )}
      </div>
      {hasBreakdown && open && (
        <div
          className="kumbh-scroll flex max-h-[160px] flex-col gap-0.5 overflow-y-auto border-t px-2 py-1.5"
          style={{ borderColor: 'var(--map-border)' }}
        >
          {breakdown.map((b) => (
            <div
              key={b.key}
              className="flex items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-[10.5px]"
            >
              <span
                className="min-w-0 truncate"
                style={{ color: 'var(--map-fg-muted)' }}
                title={b.text}
              >
                {b.text}
              </span>
              <span
                className="shrink-0 font-semibold tabular-nums"
                style={{ color: 'var(--map-fg)' }}
              >
                {b.seats}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
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
    <div className="mb-3 flex items-center gap-1.5">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{ background: t.bg, color: t.fg }}
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
  onClose,
}: {
  /** Drawer is hidden entirely when null -- same "no sector selected" gate as the Stats panel's filtered view. */
  sectorNo: number | null
  sectorLabel: string
  onClose: () => void
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
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
  const dragState = useRef({ startY: 0, startHeight: height })

  function startDrag(e: React.PointerEvent) {
    e.preventDefault()
    dragState.current = { startY: e.clientY, startHeight: height }
    setDragging(true)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      // Dragging the top handle up (negative delta) grows the drawer.
      const delta = dragState.current.startY - ev.clientY
      const maxHeight = Math.min(
        (window.innerHeight * MAX_HEIGHT_VH) / 100,
        window.innerHeight - 96,
      )
      const next = Math.min(
        maxHeight,
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

  // Re-opens automatically (starts expanded) whenever a different sector is picked --
  // a user who collapsed the drawer for sector A shouldn't have it stay collapsed
  // when they then pick sector B, since that hides the very thing they just asked to see.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting UI-only collapsed state on sectorNo changing, not state synced from an external system
    setCollapsed(false)
  }, [sectorNo])

  if (!mounted) return null

  const landClasses = report
    ? (Object.keys(LAND_STAT_LABEL) as (keyof typeof LAND_STAT_LABEL)[]).filter(
        (cls) => report.landSummary.byClass[cls] !== undefined,
      )
    : []

  return (
    <div
      style={{
        background: 'var(--map-panel-bg)',
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
      className={`absolute bottom-0 left-3 right-3 z-20 flex max-h-[calc(100dvh-96px)] max-w-[calc(100vw-24px)] flex-col rounded-t-2xl border border-b-0 backdrop-blur-md sm:left-[336px] sm:right-[336px] sm:max-w-[calc(100vw-360px)] ${
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
            setCollapsed((v) => !v)
          }}
          aria-label={collapsed ? 'Expand sector report' : 'Collapse sector report'}
          aria-expanded={!collapsed}
          className="cursor-pointer rounded-full p-1.5"
        >
          <span
            className="block h-1 w-9 rounded-full transition-colors"
            style={{ background: dragging ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
          />
        </button>
      </div>

      <div
        style={{ borderColor: 'var(--map-panel-border)' }}
        className="flex shrink-0 items-center gap-2.5 border-b px-5 pb-3.5"
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
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
            style={{ color: 'var(--map-fg-faint)' }}
          >
            {sectorLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label="Close sector report"
          style={{ color: 'var(--map-fg-faint)' }}
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
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                }}
              >
                Failed to load sector report: {error}
              </div>
            </div>
          )}
          {report && (
            <div
              // Three side-by-side scrollable columns on a desktop-width drawer; below `sm`
              // there's nowhere near enough width for that (the third column alone was a fixed
              // 260px), so it becomes one vertically-stacked, vertically-scrolling column instead
              // -- each section keeps its own internal overflow-y-auto either way.
              className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-[1fr_1fr_260px] sm:overflow-hidden"
            >
              {/* Land Summary */}
              <div
                className="kumbh-scroll min-h-0 overflow-y-auto border-b p-4 sm:border-b-0 sm:border-r"
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
                  />
                  {landClasses.map((cls) => (
                    <StatTile
                      key={cls}
                      theme={LAND_STAT_THEME[cls]}
                      icon={LAND_STAT_ICON[cls]}
                      value={`${report.landSummary.byClass[cls]} ha`}
                      label={LAND_STAT_LABEL[cls]}
                    />
                  ))}
                </div>
              </div>

              {/* Key Activities */}
              <div
                className="kumbh-scroll min-h-0 overflow-y-auto border-b p-4 sm:border-b-0 sm:border-r"
                style={{ borderColor: 'var(--map-panel-border)' }}
              >
                <ColHead theme="violet" icon={GridIcon} title="Key Activities" />
                {report.keyActivities.length === 0 && report.utilityInfrastructure.ghats === 0 ? (
                  <p className="text-[12px]" style={{ color: 'var(--map-fg-faint)' }}>
                    No activities recorded for this sector.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {report.keyActivities.map((group) => {
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
                            background: 'var(--map-surface-alt)',
                            borderColor: 'var(--map-border)',
                          }}
                        >
                          <div
                            className="flex items-center gap-1.5 border-b px-2.5 py-2"
                            style={{ borderColor: 'var(--map-border)' }}
                          >
                            <span
                              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
                              style={{ background: t.bg, color: t.fg }}
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
                              className="ml-auto text-[10px] font-semibold tabular-nums"
                              style={{ color: 'var(--map-fg-faint)' }}
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
                          background: 'var(--map-surface-alt)',
                          borderColor: 'var(--map-border)',
                        }}
                      >
                        <span
                          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
                          style={{
                            background: 'var(--map-section-blue-bg)',
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
                          className="ml-auto text-[10px] font-semibold tabular-nums"
                          style={{ color: 'var(--map-fg-faint)' }}
                        >
                          {report.utilityInfrastructure.ghats}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Utility Infrastructure */}
              <div className="kumbh-scroll min-h-0 overflow-y-auto p-4">
                <ColHead theme="amber" icon={RoadIcon} title="Utility Infrastructure" />
                <div className="flex flex-col gap-2">
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
                    breakdown={report.utilityInfrastructure.toiletBlocks.map((b, i) => ({
                      key: `${i}-${b.name ?? ''}`,
                      text: b.name?.trim() || '(no seat breakdown recorded)',
                      seats: b.seats,
                    }))}
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
