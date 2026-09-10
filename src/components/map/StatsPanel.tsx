'use client'

import { Fragment, type ReactNode, useEffect, useState } from 'react'
import {
  CLASS_GROUP_COLORS,
  POINT_LAYER_COLORS,
  POINT_LAYER_LABELS,
  LINE_LAYER_COLORS,
  LINE_LAYER_LABELS,
  POLYGON_LAYER_COLORS,
  POLYGON_LAYER_LABELS,
  POI_SIGNAGE_CODES,
  ROAD_TYPE_COLORS,
  ROAD_TYPE_DASH,
} from '@/lib/classColors'
import Panel from '@/components/map/Panel'
import {
  ParcelIcon,
  RoadIcon,
  PinClusterIcon,
  GridIcon,
  ChevronDownIcon,
  MapPinIcon,
} from '@/components/map/icons'

const POI_COLORS: Record<string, string> = {
  ...POINT_LAYER_COLORS,
  ...LINE_LAYER_COLORS,
  ...POLYGON_LAYER_COLORS,
}
const POI_LABELS: Record<string, string> = {
  ...POINT_LAYER_LABELS,
  ...LINE_LAYER_LABELS,
  ...POLYGON_LAYER_LABELS,
}

// Must match MapView.tsx's ROAD_TYPE_DEFS key derivation -- the two files
// don't share that array directly, so the same "type string -> visibility
// key" mapping is reproduced here.
function roadTypeKey(type: string): string {
  return `road_${type.toLowerCase().replace(/\s+/g, '_')}`
}

/** Must match MapView.tsx's locateKey -- identifies one open locator list so
 *  several can be tracked at once in the keyed results maps below. */
function locateKey(group: string, subclass: string | null, sector?: number | null): string {
  return `${group}||${subclass ?? ''}||${sector ?? ''}`
}

type Stats = {
  byClass: { class_group: string; features: number; hectares: string }[]
  bySubclass: { class_group: string; subclass: string; features: number; hectares: string }[]
  roadByType: { type: string; segments: number; metres: string }[]
  perSector: {
    sector_no: number
    name: string
    boundary_hectares: string
    plan_features: number
    plan_hectares: string
  }[]
  poiByLayer: { layer: string; features: number; hectares: string | null }[]
  poiBySubclass: { layer: string; subclass: string; features: number }[]
  /** kumbh.tertiary_road's total feature count (sector-scoped like every other stat
   *  here) -- deliberately NOT a poiByLayer row (21k+ rows would dominate that
   *  features-sorted list), surfaced instead as a standalone footer note under the
   *  Points of interest section. See the comment on POI_TABLES in /api/stats. */
  tertiaryRoadCount: number
}

/** Bounding box + per-feature centroids for whichever class or sub-class row
 *  currently has its "show list" chevron open (see locateTarget) -- backs
 *  the locator list rendered under that row in ClassAreaTable. Independent
 *  of classFilter/subclassFilter: opening a row's list doesn't select it,
 *  and selecting a row doesn't open its list. Null while nothing is open, or
 *  while the fetch for a just-opened row hasn't resolved yet. */
type LocateResult = {
  classGroup: string
  subclass: string | null
  total: number
  bbox: [number, number, number, number] | null
  features: {
    id: number
    sector_no: number | null
    plot_no: string | null
    block: string | null
    label: string | null
    lng: number
    lat: number
  }[]
}

/** Same idea as LocateResult but for a single POI layer -- POI tables live
 *  outside kumbh.sector_plan and carry no plot/block fields; the sector is
 *  derived spatially by /api/poi/locate rather than stored on the row. */
type PoiLocateResult = {
  layer: string
  /** Which sub-class the locate result is scoped to, or null when it covers
   *  the whole layer -- mirrors LocateResult.subclass above. */
  subclass: string | null
  total: number
  bbox: [number, number, number, number] | null
  features: {
    id: number
    label: string | null
    sector_no: number | null
    lng: number
    lat: number
  }[]
}

/** A locate that failed, as opposed to one still in flight (`null`) -- the
 *  two were indistinguishable before, so a failed fetch spun forever. */
type LocateState<T> = T | 'error' | null

// Per-section accent hue, referencing the theme-aware CSS variables defined alongside
// globals.css's --map-* group (dark: brighter hue over a translucent tint; light: the original
// flat pastel fill) -- see the matching --map-section-* block in globals.css.
const SECTION_THEMES = {
  blue: { bg: 'var(--map-section-blue-bg)', text: 'var(--map-section-blue-fg)' },
  amber: { bg: 'var(--map-section-amber-bg)', text: 'var(--map-section-amber-fg)' },
  teal: { bg: 'var(--map-section-teal-bg)', text: 'var(--map-section-teal-fg)' },
  violet: { bg: 'var(--map-section-violet-bg)', text: 'var(--map-section-violet-fg)' },
} as const

function Section({
  title,
  icon,
  theme,
  count,
  children,
}: {
  title: string
  icon: ReactNode
  theme: keyof typeof SECTION_THEMES
  /** Shown as a rounded badge at the header's trailing edge, e.g. total row count. */
  count?: number
  children: ReactNode
}) {
  const t = SECTION_THEMES[theme]
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
          style={{ background: t.bg, color: t.text }}
        >
          <span className="h-3 w-3">{icon}</span>
        </span>
        <h3
          className="text-[11.5px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          {title}
        </h3>
        {count !== undefined && (
          <span
            className="ml-auto rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums"
            style={{ background: t.bg, color: t.text }}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function Table({
  columns,
  rows,
  scrollable,
  activeRow,
  activeRows,
  activeColors,
  onRowClick,
}: {
  columns: { header: string; align?: 'left' | 'right' }[]
  rows: ReactNode[][]
  /** Gives the table its own scroll container so its header can stick
   * without colliding with the other tables sharing the panel's scroll. */
  scrollable?: boolean
  /** Index of the row to highlight as active, when rows are clickable
   * (single-select tables, e.g. Area by class). */
  activeRow?: number
  /** Indices of every active row, for multi-select tables (e.g. Points of
   * interest, where several layers can be toggled on at once). Takes
   * precedence over `activeRow` when both are given. */
  activeRows?: number[]
  /** Per-row swatch color (parallel to `rows`) -- when set, an active row's
   * highlight is tinted from its own swatch instead of a generic blue, so
   * the selection reads as "this class/layer" rather than a plain focus box. */
  activeColors?: (string | undefined)[]
  onRowClick?: (index: number) => void
}) {
  const activeSet = activeRows ? new Set(activeRows) : null
  // Rows bleed out to the panel's true edges (cancelling Panel's own
  // px-3.5) so an active row's tint/accent reads as a clean full-width band
  // instead of a floating pill with dead margin on both sides. The first/
  // last cell in each row restores that same padding so column content
  // lines up exactly where it sat before.
  const firstCellPad = scrollable ? 'pl-2' : 'pl-3.5'
  const lastCellPad = scrollable ? 'pr-2' : 'pr-3.5'

  const table = (
    <table className="w-full border-separate border-spacing-0 text-[12px]">
      <thead>
        <tr>
          {columns.map((c, i) => {
            const isFirst = i === 0
            const isLast = i === columns.length - 1
            return (
              <th
                key={i}
                style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
                className={`${scrollable ? 'sticky top-0 z-10' : ''} pt-1 pb-1.5 ${
                  isFirst ? firstCellPad : ''
                } ${isLast ? lastCellPad : 'pr-2'} text-[10.5px] font-semibold uppercase tracking-wide ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {c.header}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          const isActive = activeSet ? activeSet.has(ri) : activeRow === ri
          const swatch = activeColors?.[ri]
          // color-mix (not a hex alpha suffix) so the same swatch tints consistently across
          // themes -- a fixed alpha suffix reads as a much harsher block over the dark panel
          // than the light one for the same saturated color (e.g. Emergency Exit's red).
          const rowTint = swatch
            ? `color-mix(in srgb, ${swatch} var(--map-row-tint-pct), transparent)`
            : 'var(--map-accent-bg)'
          return (
            <tr
              key={ri}
              onClick={onRowClick ? () => onRowClick(ri) : undefined}
              className={`${onRowClick && !isActive ? 'cursor-pointer hover:bg-[var(--map-surface-hover)]' : onRowClick ? 'cursor-pointer' : ''}`}
              style={isActive ? { background: rowTint } : undefined}
            >
              {row.map((cell, ci) => {
                const isFirst = ci === 0
                const isLast = ci === columns.length - 1
                return (
                  <td
                    key={ci}
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`relative py-1.5 ${isFirst ? firstCellPad : ''} ${
                      isLast ? lastCellPad : 'pr-2'
                    } ${columns[ci]?.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${
                      isActive ? 'font-semibold' : ''
                    }`}
                  >
                    {isActive && isFirst && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1 left-0 w-[3px] rounded-full"
                        style={{ background: swatch ?? 'var(--map-accent)' }}
                      />
                    )}
                    {cell}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return scrollable ? (
    <div
      className="kumbh-scroll max-h-56 overflow-y-auto rounded-lg border"
      style={{ borderColor: 'var(--map-border)' }}
    >
      {table}
    </div>
  ) : (
    <div className="-mx-3.5">{table}</div>
  )
}

/** Rows shown per class before a "Show N more" link caps a long sub-class
 *  tail (e.g. Other/Police Camping run 30+ deep) instead of dumping the
 *  whole list into the panel. */
const SUBCLASS_ROW_CAP = 4

/** Rows shown in a locator list before "Show N more" caps it -- kept small
 *  since this renders once per matched sub-class/POI row, nested even
 *  deeper than the row it belongs to. */
const LOCATOR_ROW_CAP = 4

/** Which column a stats table is sorted by, and in which direction. Sorting
 *  is per-table local UI state -- it never touches the filters or the map. */
type SortKey = 'name' | 'features' | 'area'
type SortState = { key: SortKey; desc: boolean }

/** Clickable column header. Numeric columns default to descending on first
 *  click (planners scanning "what's biggest?" want the top of the list, not
 *  the bottom); the name column defaults to ascending. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'right',
  className = '',
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const isActive = sort.key === sortKey
  return (
    <th
      // Deliberately NOT sticky: every section's table shares the panel's one
      // scroll container, so `sticky top-0` pins each header independently and
      // one section's header ends up floating over the next section's rows.
      // Fixing that properly needs a scroll container per section, which is a
      // bigger change than the benefit justifies here.
      aria-sort={isActive ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
      className={`pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label}`}
        style={{ color: isActive ? 'var(--map-fg-muted)' : 'inherit' }}
        className={`inline-flex cursor-pointer items-center gap-0.5 rounded uppercase tracking-wide hover:text-[var(--map-fg-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)] ${
          align === 'right' ? 'flex-row-reverse' : ''
        }`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={isActive ? '' : 'opacity-0'}>
          {sort.desc ? '↓' : '↑'}
        </span>
      </button>
    </th>
  )
}

/** The same checkbox the left search panel draws for every class/layer, so a
 *  Stats row's selectability is visible before clicking rather than inferred.
 *  Without it the row label looks like plain text and gives no hint that it
 *  filters the map (and is a different action from the expand chevron beside
 *  it and the locate pin after it). Supports the indeterminate dash for a
 *  parent with only some sub-classes selected. */
function RowCheckbox({
  checked,
  indeterminate = false,
  color,
  size = 'md',
}: {
  checked: boolean
  indeterminate?: boolean
  color: string
  size?: 'sm' | 'md'
}) {
  const box = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const tick = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  return (
    <span
      aria-hidden="true"
      className={`flex ${box} shrink-0 items-center justify-center rounded-[4px] border`}
      style={{
        // Unchecked still carries the class colour (at low alpha) rather than
        // a neutral grey: this box is now the only swatch on the row, so it
        // has to keep tying the row to its colour on the map and in the left
        // panel's tree even when nothing is selected.
        borderColor:
          checked || indeterminate ? color : `color-mix(in srgb, ${color} 45%, transparent)`,
        background: checked || indeterminate ? color : 'transparent',
      }}
    >
      {indeterminate ? (
        <span className="h-[2px] w-1.5 rounded-full bg-white" />
      ) : (
        checked && (
          <svg viewBox="0 0 24 24" fill="none" className={tick}>
            <path
              d="M5 13l4 4L19 7"
              stroke="white"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )
      )}
    </span>
  )
}

/** Compact hectare/count formatting -- these columns are ~58px wide, and a
 *  raw value like kumbh.district_boundary's 5341448.0 ha physically overflows
 *  the panel. Thousands/millions collapse to 5.3M, everything else keeps the
 *  precision it already had. */
function formatStatValue(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '—'
  const n = Number(raw)
  if (!Number.isFinite(n)) return String(raw)
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(0)}k`
  // No "<0.1" case here on purpose: /api/stats already rounds hectares to one
  // decimal in SQL, so a sub-0.05 ha parcel reaches this function as exactly
  // 0 and is indistinguishable from a true zero. Showing "<0.1" would need
  // the API to send more precision first.
  return String(raw)
}

/** Horizontal magnitude bar drawn behind a numeric cell, so relative size is
 *  readable at a glance instead of requiring the reader to compare digits
 *  down a 26-row column.
 *
 *  Rendered as a thin rule UNDER the number on a fixed-width track, not as a
 *  wash behind it. An earlier version sized the bar as a percentage of the
 *  cell: because each cell is only ~55px wide, the largest row filled it edge
 *  to edge with no visible terminus while small rows collapsed to 2-3px
 *  slivers pressed against the digits, reading as rendering artifacts rather
 *  than data. A constant-width track gives every row the same baseline to be
 *  compared against, and putting it below the text keeps the number legible
 *  and clear of the row's selection tint. */
const BAR_TRACK_PX = 34

function MagnitudeBar({ value, max, color }: { value: number; max: number; color: string }) {
  if (!(max > 0) || !(value > 0)) return null
  // sqrt compresses one dominant outlier (Parking's 365 ha vs Pathway's 0.2)
  // so smaller rows stay distinguishable from each other.
  const pct = Math.max(4, Math.min(100, Math.sqrt(value / max) * 100))
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-[3px] right-2 h-[3px] rounded-full"
      style={{
        width: BAR_TRACK_PX,
        // The unfilled remainder has to stay visible -- it's the "out of what"
        // reference that makes the fixed track worth its vertical space.
        background: `color-mix(in srgb, ${color} 24%, transparent)`,
      }}
    >
      <span
        className="absolute inset-y-0 right-0 rounded-full"
        style={{ width: `${pct}%`, background: color }}
      />
    </span>
  )
}

/** Per-row "show list" affordance -- a pin distinct from the row's own
 *  selection click, so clicking it opens/closes that row's LocatorList
 *  without touching classFilter/subclassFilter (or poiSubclassFilter/
 *  poiVisibility).
 *
 *  Deliberately a PIN, not a chevron: the row's leading disclosure control
 *  is already a chevron (expand sub-classes), and drawing both with the
 *  same glyph at the same size made two unrelated actions indistinguishable
 *  before clicking. The pin matches the marker drawn beside every entry in
 *  the list it opens, so the icon predicts its own payload. Filled with the
 *  row's color while open; a spinner replaces it while its fetch is in
 *  flight. Stops propagation so it never also triggers the row's onClick
 *  underneath it. */
function LocateToggleButton({
  isOpen,
  isLoading,
  color,
  onClick,
  label,
}: {
  isOpen: boolean
  isLoading: boolean
  color: string
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-expanded={isOpen}
      aria-label={label}
      title={label}
      style={{
        color: isOpen ? color : 'var(--map-fg-faint)',
        background: isOpen ? `color-mix(in srgb, ${color} 16%, transparent)` : undefined,
      }}
      className="flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded hover:bg-[var(--map-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
    >
      {isLoading ? (
        <span
          className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px]"
          style={{ borderColor: 'var(--map-switch-track)', borderTopColor: color }}
        />
      ) : (
        <MapPinIcon className="h-3 w-3" />
      )}
    </button>
  )
}

/** Shown in place of a locator list whose fetch failed. Mirrors the panel's
 *  existing "Failed to load stats" treatment, which the locate lists
 *  previously had no equivalent of -- they just spun. */
/** Subtitle for a POI locator entry: the sector it sits in plus its row id.
 *  POI titles are frequently useless as identifiers -- 42 of the 50 layers in
 *  /api/poi/locate have no name column at all (every row renders the bare
 *  layer name), and even the named ones repeat heavily: kumbh.sanitation's
 *  114 Toilets share 7 capacity-spec strings, and all 1022 ashram rows carry
 *  the same name. Without this, expanding a list gives a column of rows with
 *  identical text that differ only in where they fly. The id is the tiebreak
 *  when several sit in one sector. */
function makePoiSubtitle(sectorNo: number | null) {
  return (f: { id: number; sector_no: number | null }): string => {
    // With a sector already selected every row sits in it, so repeating it on
    // each line is noise -- the id alone is what distinguishes them there.
    if (sectorNo !== null) return `#${f.id}`
    const where =
      f.sector_no !== null ? `Sector ${String(f.sector_no).padStart(2, '0')}` : 'Outside sectors'
    return `${where} · #${f.id}`
  }
}

function LocatorError({ onRetry }: { onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={3} className="py-0 pl-0 pr-3.5">
        <div
          className="my-0.5 ml-[30px] flex items-center gap-2 border-l-2 py-1 pl-2 text-[11px]"
          style={{ borderColor: 'var(--map-danger, #ef4444)', color: 'var(--map-fg-faint)' }}
        >
          <span>Couldn&apos;t load locations.</span>
          <button
            type="button"
            onClick={onRetry}
            style={{ color: 'var(--map-accent)' }}
            className="cursor-pointer font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
          >
            Retry
          </button>
        </div>
      </td>
    </tr>
  )
}

/** One clickable "fly to this feature" list, nested under whatever row
 *  (a sub-class in ClassAreaTable, a POI layer below) it belongs to.
 *  Generic over the feature shape via `title`/`subtitle` renderers -- the
 *  sector_plan-backed LocateResult and the POI-backed PoiLocateResult carry
 *  different fields (sector/plot/block vs. just an optional name), but the
 *  list chrome (icon, hover arrow, cap/uncap) is identical either way. */
function LocatorList<F extends { id: number; lng: number; lat: number }>({
  features,
  total,
  onFeatureClick,
  color,
  title,
  subtitle,
  sectorNo,
}: {
  features: F[]
  total: number
  onFeatureClick: (lng: number, lat: number) => void
  color: string
  title: (f: F) => string
  subtitle?: (f: F) => string | null
  /** Only so the empty state can word itself correctly -- "none in this
   *  sector" is a false statement when no sector is selected. */
  sectorNo?: number | null
}) {
  const [uncapped, setUncapped] = useState(false)
  const visible = uncapped ? features : features.slice(0, LOCATOR_ROW_CAP)
  // Counted against what actually arrived, not the DB total: the locate
  // endpoints cap their feature list server-side (MAX_FEATURES), so a class
  // with 800 matches ships far fewer rows. Subtracting from `total` promised
  // "Show 796 more…" and then produced a fraction of that, with nothing
  // explaining where the rest went. `truncated` states that separately and
  // honestly, instead of hiding it inside a number that was never real.
  const hiddenCount = features.length - visible.length
  const truncated = total > features.length

  return (
    <tr>
      <td colSpan={3} className="py-0 pl-0 pr-3.5">
        <div
          className="my-0.5 ml-[30px] flex flex-col gap-0.5 border-l-2 pl-2"
          style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
        >
          {/* Reachable in normal use, not just in theory: /api/stats returns
              0-count rows on purpose so every known value stays listed, and
              now that locate is sector-scoped those rows genuinely have no
              features here. Without this the row rendered as a bare coloured
              strip with nothing in it. */}
          {features.length === 0 && (
            <div className="py-1 pl-1.5 text-[11px]" style={{ color: 'var(--map-fg-faint)' }}>
              {sectorNo !== null && sectorNo !== undefined
                ? 'None in this sector'
                : 'No features to show'}
            </div>
          )}
          {visible.map((f) => {
            const sub = subtitle?.(f)
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onFeatureClick(f.lng, f.lat)}
                style={{ color: 'var(--map-fg)' }}
                className="group flex w-full cursor-pointer items-center gap-2 rounded-md py-1 pl-1.5 pr-1 text-left hover:bg-[var(--map-surface-hover)]"
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center"
                  style={{ color: 'var(--map-fg-faint)' }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-3.5 w-3.5 group-hover:opacity-100"
                    style={{ color }}
                  >
                    <path
                      d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"
                      stroke="currentColor"
                      strokeWidth={2}
                    />
                    <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth={2} />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium">{title(f)}</div>
                  {sub && (
                    <div
                      className="truncate text-[10.5px]"
                      style={{ color: 'var(--map-fg-faint)' }}
                    >
                      {sub}
                    </div>
                  )}
                </span>
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color }}
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                    <path
                      d="M13 5l7 7-7 7M5 12h15"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            )
          })}
          {!uncapped && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setUncapped(true)}
              style={{ color: 'var(--map-accent)' }}
              className="cursor-pointer py-1 pl-1.5 text-left text-[11px] font-semibold hover:brightness-90"
            >
              Show {hiddenCount} more…
            </button>
          )}
          {/* Only once the list is fully expanded, so it explains the gap at
              the moment the user can see there is one. */}
          {(uncapped || hiddenCount === 0) && truncated && (
            <div className="py-1 pl-1.5 text-[10.5px]" style={{ color: 'var(--map-fg-faint)' }}>
              Showing {features.length} of {total} — zoom or filter to narrow
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

/** "Points of interest" table -- same row/cell visual language as the
 *  generic `Table` (active-row tint, left accent bar) but, like
 *  ClassAreaTable, needs a locator list nested under one specific row
 *  (whichever layer was last clicked), which `Table`'s flat
 *  `rows: ReactNode[][]` shape can't express. */
function PoiTable({
  rows,
  poiSubclassRows,
  poiVisibility,
  poiSubclassFilter,
  onRowClick,
  onSubclassFilterChange,
  expandedLayers,
  onToggleExpanded,
  poiLocateTargets,
  onTogglePoiLocate,
  onRetryPoiLocate,
  poiLocateResults,
  onPoiLocateFeatureClick,
  sectorNo,
}: {
  rows: { layer: string; features: number; hectares: string | null }[]
  poiSubclassRows: { layer: string; subclass: string; features: number }[]
  poiVisibility: Record<string, boolean>
  poiSubclassFilter: Record<string, string[]>
  onRowClick: (layerKey: string) => void
  onSubclassFilterChange: (layerKey: string, subclass: string) => void
  expandedLayers: Set<string>
  onToggleExpanded: (layerKey: string) => void
  poiLocateTargets: { layer: string; subclass: string | null }[]
  onTogglePoiLocate: (layerKey: string, subclass: string | null) => void
  /** Clears a failed locate so it refetches -- see MapView's retryPoiLocate.
   *  Distinct from the toggle: the row is still open when the error shows. */
  onRetryPoiLocate: (layerKey: string, subclass: string | null) => void
  poiLocateResults: Record<string, LocateState<PoiLocateResult>>
  onPoiLocateFeatureClick: (lng: number, lat: number) => void
  /** Part of the locate cache key -- see locateKey. */
  sectorNo: number | null
}) {
  // Defaults to name-ascending, matching how this list has always read; the
  // numeric columns are opt-in via their headers.
  const [sort, setSort] = useState<SortState>({ key: 'name', desc: false })
  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== 'name' },
    )
  }
  const label = (layer: string) => POI_LABELS[layer] ?? layer
  const sortedRows = [...rows].sort((a, b) => {
    const dir = sort.desc ? -1 : 1
    if (sort.key === 'name') return dir * label(a.layer).localeCompare(label(b.layer))
    if (sort.key === 'features') return dir * (a.features - b.features)
    return dir * ((Number(a.hectares) || 0) - (Number(b.hectares) || 0))
  })
  const maxFeatures = Math.max(...rows.map((r) => r.features), 0)
  const maxArea = Math.max(...rows.map((r) => Number(r.hectares) || 0), 0)

  return (
    <div className="-mx-3.5">
      {/* table-fixed + explicit numeric widths: without them the long class
          names size the first column and push Features/Ha past the panel's
          right edge, clipping the values. */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]">
        <colgroup>
          <col />
          <col className="w-[62px]" />
          <col className="w-[58px]" />
        </colgroup>
        <thead>
          <tr>
            <SortHeader
              label="Layer"
              sortKey="name"
              sort={sort}
              onSort={onSort}
              align="left"
              className="pl-3.5 pr-2"
            />
            <SortHeader
              label="Features"
              sortKey="features"
              sort={sort}
              onSort={onSort}
              className="pr-2"
            />
            <SortHeader label="Ha" sortKey="area" sort={sort} onSort={onSort} className="pr-3.5" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const signageCode = POI_SIGNAGE_CODES[row.layer]
            const color = POI_COLORS[row.layer] ?? '#cbd5e1'
            const subs = poiSubclassRows.filter((r) => r.layer === row.layer)
            const hasChildren = subs.length > 1
            // Auto-expands when this layer's list (or a sub-class within it)
            // is open, so opening a sub-class's list from elsewhere (e.g. the
            // Layers panel) never leaves it hidden behind a collapsed row.
            const isExpanded =
              expandedLayers.has(row.layer) || poiLocateTargets.some((t) => t.layer === row.layer)
            const partialSubs = poiSubclassFilter[row.layer]
            const isFullyOn = poiVisibility[row.layer] && !partialSubs
            const isActive = isFullyOn || (!!partialSubs && partialSubs.length > 0)
            const isPartial = !isFullyOn && !!partialSubs && partialSubs.length > 0
            const rowTint = `color-mix(in srgb, ${color} var(--map-row-tint-pct), transparent)`
            const isLayerListOpen = poiLocateTargets.some(
              (t) => t.layer === row.layer && t.subclass === null,
            )
            const layerListResult = poiLocateResults[locateKey(row.layer, null, sectorNo)] ?? null
            const isLayerListLoading = isLayerListOpen && layerListResult === null

            return (
              <Fragment key={row.layer}>
                <tr
                  className={isActive ? '' : 'cursor-pointer hover:bg-[var(--map-surface-hover)]'}
                  style={isActive ? { background: rowTint } : undefined}
                >
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`relative py-1.5 pl-3.5 pr-2 text-left ${isActive ? 'font-semibold' : ''}`}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1 left-0 w-[3px] rounded-full"
                        style={{ background: color }}
                      />
                    )}
                    <span className="flex items-center gap-1">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => onToggleExpanded(row.layer)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${POI_LABELS[row.layer] ?? row.layer} sub-classes`}
                          title={`${isExpanded ? 'Collapse' : 'Expand'} sub-classes`}
                          style={{ color: 'var(--map-fg-faint)' }}
                          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-[var(--map-surface-hover)]"
                        >
                          <ChevronDownIcon
                            className={`h-3 w-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                          />
                        </button>
                      ) : (
                        <span className="h-4 w-4 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => onRowClick(row.layer)}
                        aria-pressed={isActive}
                        title={`${isActive ? 'Hide' : 'Show'} ${POI_LABELS[row.layer] ?? row.layer} on the map`}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
                      >
                        <RowCheckbox checked={isActive} indeterminate={isPartial} color={color} />
                        {/* Signage-coded layers keep their badge; everything
                            else relies on the checkbox's own colour -- see the
                            matching note in ClassAreaTable. */}
                        {signageCode && (
                          <span
                            className="flex h-3.5 shrink-0 items-center justify-center rounded-[3px] px-1 text-[8.5px] font-bold leading-none text-white"
                            style={{ background: color }}
                          >
                            {signageCode}
                          </span>
                        )}
                        <span className="truncate">{POI_LABELS[row.layer] ?? row.layer}</span>
                      </button>
                      <LocateToggleButton
                        isOpen={isLayerListOpen}
                        isLoading={isLayerListLoading}
                        color={color}
                        onClick={() => onTogglePoiLocate(row.layer, null)}
                        label={`${isLayerListOpen ? 'Hide' : 'Show'} ${POI_LABELS[row.layer] ?? row.layer} locations`}
                      />
                    </span>
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`relative cursor-pointer overflow-hidden pt-1.5 pb-2.5 pr-2 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                    onClick={() => onRowClick(row.layer)}
                  >
                    <MagnitudeBar value={row.features} max={maxFeatures} color={color} />
                    <span className="relative" title={String(row.features)}>
                      {formatStatValue(row.features)}
                    </span>
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                    className={`relative cursor-pointer overflow-hidden pt-1.5 pb-2.5 pr-3.5 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                    onClick={() => onRowClick(row.layer)}
                  >
                    <MagnitudeBar value={Number(row.hectares) || 0} max={maxArea} color={color} />
                    <span className="relative" title={row.hectares ?? undefined}>
                      {formatStatValue(row.hectares)}
                    </span>
                  </td>
                </tr>
                {isLayerListOpen && layerListResult === 'error' && (
                  <LocatorError onRetry={() => onRetryPoiLocate(row.layer, null)} />
                )}
                {isLayerListOpen && layerListResult && layerListResult !== 'error' && (
                  <LocatorList
                    features={layerListResult.features}
                    total={layerListResult.total}
                    onFeatureClick={onPoiLocateFeatureClick}
                    color={color}
                    title={(f) => f.label ?? POI_LABELS[row.layer] ?? row.layer}
                    subtitle={makePoiSubtitle(sectorNo)}
                  />
                )}
                {hasChildren &&
                  isExpanded &&
                  subs.map((sub) => {
                    const subChecked = isFullyOn
                      ? true
                      : (partialSubs?.includes(sub.subclass) ?? false)
                    const isSubListOpen = poiLocateTargets.some(
                      (t) => t.layer === row.layer && t.subclass === sub.subclass,
                    )
                    const subListResult =
                      poiLocateResults[locateKey(row.layer, sub.subclass, sectorNo)] ?? null
                    const isSubListLoading = isSubListOpen && subListResult === null
                    return (
                      <Fragment key={`${row.layer}::${sub.subclass}`}>
                        <tr
                          className="cursor-pointer hover:bg-[var(--map-surface-hover)]"
                          style={
                            subChecked
                              ? {
                                  background: `color-mix(in srgb, ${color} var(--map-row-tint-pct), transparent)`,
                                }
                              : undefined
                          }
                          onClick={() => onSubclassFilterChange(row.layer, sub.subclass)}
                        >
                          <td
                            style={{ color: subChecked ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                            className={`relative py-1 pl-3.5 pr-2 text-left text-[11.5px] ${subChecked ? 'font-semibold' : ''}`}
                          >
                            {subChecked && (
                              <span
                                aria-hidden="true"
                                className="absolute inset-y-0.5 left-0 w-[3px] rounded-full"
                                style={{ background: color }}
                              />
                            )}
                            <span className="flex items-center gap-1.5 pl-5">
                              {/* The row's <tr> keeps its own onClick for mouse users, but the
                                  label is a real button so the primary action is focusable and
                                  reachable by keyboard -- a <tr onClick> alone is not. */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onSubclassFilterChange(row.layer, sub.subclass)
                                }}
                                aria-pressed={subChecked}
                                title={`${subChecked ? 'Clear' : 'Filter map to'} ${sub.subclass}`}
                                className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
                              >
                                <RowCheckbox checked={subChecked} color={color} size="sm" />
                                <span className="min-w-0 truncate">{sub.subclass}</span>
                              </button>
                              <LocateToggleButton
                                isOpen={isSubListOpen}
                                isLoading={isSubListLoading}
                                color={color}
                                onClick={() => onTogglePoiLocate(row.layer, sub.subclass)}
                                label={`${isSubListOpen ? 'Hide' : 'Show'} ${sub.subclass} locations`}
                              />
                            </span>
                          </td>
                          <td
                            style={{ color: subChecked ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                            className="py-1 pr-2 text-right text-[11.5px] tabular-nums"
                          >
                            {sub.features}
                          </td>
                          <td
                            style={{ color: subChecked ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                            className="py-1 pr-3.5 text-right text-[11.5px] tabular-nums"
                          >
                            —
                          </td>
                        </tr>
                        {isSubListOpen && subListResult === 'error' && (
                          <LocatorError onRetry={() => onRetryPoiLocate(row.layer, sub.subclass)} />
                        )}
                        {isSubListOpen && subListResult && subListResult !== 'error' && (
                          <LocatorList
                            features={subListResult.features}
                            total={subListResult.total}
                            onFeatureClick={onPoiLocateFeatureClick}
                            color={color}
                            title={(f) => f.label ?? sub.subclass}
                            subtitle={makePoiSubtitle(sectorNo)}
                          />
                        )}
                      </Fragment>
                    )
                  })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** "Area by class" table, in the same visual language as the generic
 *  `Table` above (same row/cell classes, same active-row tint) but with a
 *  per-row expand chevron revealing that class's sub-classes -- `Table`'s
 *  flat `rows: ReactNode[][]` shape can't express that nesting, so this is
 *  a dedicated sibling rather than a `Table` variant. */

function ClassAreaTable({
  rows,
  subclassRows,
  classFilter,
  onClassFilterChange,
  subclassFilter,
  onSubclassFilterChange,
  expandedClasses,
  onToggleExpanded,
  uncappedClasses,
  onUncap,
  locateTargets,
  onToggleLocate,
  onRetryLocate,
  locateResults,
  onLocateFeatureClick,
  sectorNo,
}: {
  rows: Stats['byClass']
  subclassRows: Stats['bySubclass']
  classFilter: string[]
  onClassFilterChange: (className: string) => void
  subclassFilter: Record<string, string[]>
  onSubclassFilterChange: (className: string, subclass: string) => void
  expandedClasses: Set<string>
  onToggleExpanded: (cls: string) => void
  uncappedClasses: Set<string>
  onUncap: (cls: string) => void
  locateTargets: { classGroup: string; subclass: string | null }[]
  onToggleLocate: (classGroup: string, subclass: string | null) => void
  /** See onRetryPoiLocate. */
  onRetryLocate: (classGroup: string, subclass: string | null) => void
  locateResults: Record<string, LocateState<LocateResult>>
  onLocateFeatureClick: (lng: number, lat: number) => void
  /** Part of the locate cache key -- see locateKey. */
  sectorNo: number | null
}) {
  const [sort, setSort] = useState<SortState>({ key: 'area', desc: true })
  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== 'name' },
    )
  }
  const sortedRows = [...rows].sort((a, b) => {
    const dir = sort.desc ? -1 : 1
    if (sort.key === 'name') return dir * a.class_group.localeCompare(b.class_group)
    if (sort.key === 'features') return dir * (a.features - b.features)
    return dir * (Number(a.hectares) - Number(b.hectares))
  })
  const maxFeatures = Math.max(...rows.map((r) => r.features), 0)
  const maxArea = Math.max(...rows.map((r) => Number(r.hectares) || 0), 0)

  return (
    <div className="-mx-3.5">
      {/* table-fixed + explicit numeric widths: without them the long class
          names size the first column and push Features/Ha past the panel's
          right edge, clipping the values. */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-[12px]">
        <colgroup>
          <col />
          <col className="w-[62px]" />
          <col className="w-[58px]" />
        </colgroup>
        <thead>
          <tr>
            <SortHeader
              label="Class"
              sortKey="name"
              sort={sort}
              onSort={onSort}
              align="left"
              className="pl-3.5 pr-2"
            />
            <SortHeader
              label="Features"
              sortKey="features"
              sort={sort}
              onSort={onSort}
              className="pr-2"
            />
            <SortHeader label="Ha" sortKey="area" sort={sort} onSort={onSort} className="pr-3.5" />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const cls = row.class_group
            const color = CLASS_GROUP_COLORS[cls] ?? '#cbd5e1'
            // Null-subclass rows are excluded, matching the left panel's
            // dropdown tree. kumbh.sector_plan has 2 such rows (both in
            // "Reserved Area"), and /api/stats does not filter them out, so
            // they previously rendered as a nameless row whose checkbox and
            // pin sat next to blank text -- and worse, that pin's identity
            // was (cls, null), colliding with the class-level pin: the same
            // locateKey, so the two rows shared one open state and one
            // cached result.
            const subs = subclassRows.filter((r) => r.class_group === cls && r.subclass !== null)
            const hasChildren = subs.length > 1
            // Auto-expands when this class's list (or a sub-class within it)
            // is open, so opening a sub-class's list from elsewhere (e.g. the
            // Layers panel) never leaves it hidden behind a collapsed row.
            const isExpanded =
              expandedClasses.has(cls) || locateTargets.some((t) => t.classGroup === cls)
            const isFullySelected = classFilter.includes(cls)
            const partialSubs = subclassFilter[cls]
            const isActive = isFullySelected || (!!partialSubs && partialSubs.length > 0)
            const rowTint = `color-mix(in srgb, ${color} var(--map-row-tint-pct), transparent)`
            const isClassListOpen = locateTargets.some(
              (t) => t.classGroup === cls && t.subclass === null,
            )
            const classListResult = locateResults[locateKey(cls, null, sectorNo)] ?? null
            const isClassListLoading = isClassListOpen && classListResult === null
            // Also uncaps automatically when the open list is a sub-class
            // that would otherwise fall past the default cap -- a user who
            // explicitly opened it (from here or the Layers panel) shouldn't
            // have its locator list silently missing.
            const targetSubclassCapped = locateTargets.some(
              (t) =>
                t.classGroup === cls &&
                t.subclass !== null &&
                subs.findIndex((s) => s.subclass === t.subclass) >= SUBCLASS_ROW_CAP,
            )
            const capped = !uncappedClasses.has(cls) && !targetSubclassCapped
            const visibleSubs = capped ? subs.slice(0, SUBCLASS_ROW_CAP) : subs
            const hiddenCount = subs.length - visibleSubs.length

            return (
              <Fragment key={cls}>
                <tr
                  className={isActive ? '' : 'cursor-pointer hover:bg-[var(--map-surface-hover)]'}
                  style={isActive ? { background: rowTint } : undefined}
                >
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`relative py-1.5 pl-3.5 pr-2 text-left ${isActive ? 'font-semibold' : ''}`}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1 left-0 w-[3px] rounded-full"
                        style={{ background: color }}
                      />
                    )}
                    <span className="flex items-center gap-1">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => onToggleExpanded(cls)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${cls} sub-classes`}
                          title={`${isExpanded ? 'Collapse' : 'Expand'} sub-classes`}
                          style={{ color: 'var(--map-fg-faint)' }}
                          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-[var(--map-surface-hover)]"
                        >
                          <ChevronDownIcon
                            className={`h-3 w-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                          />
                        </button>
                      ) : (
                        <span className="h-4 w-4 shrink-0" />
                      )}
                      <button
                        type="button"
                        onClick={() => onClassFilterChange(cls)}
                        aria-pressed={isActive}
                        title={`${isActive ? 'Clear' : 'Filter map to'} ${cls}`}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
                      >
                        <RowCheckbox
                          checked={isActive}
                          indeterminate={
                            !isFullySelected && !!partialSubs && partialSubs.length > 0
                          }
                          color={color}
                        />
                        {/* No separate colour dot: RowCheckbox already fills
                            with the class colour when checked, and its border
                            carries it when unchecked, so a second swatch 2px
                            away just read as one smeared control. */}
                        <span className="truncate">{cls}</span>
                      </button>
                      <LocateToggleButton
                        isOpen={isClassListOpen}
                        isLoading={isClassListLoading}
                        color={color}
                        onClick={() => onToggleLocate(cls, null)}
                        label={`${isClassListOpen ? 'Hide' : 'Show'} ${cls} locations`}
                      />
                    </span>
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`relative cursor-pointer overflow-hidden pt-1.5 pb-2.5 pr-2 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                    onClick={() => onClassFilterChange(cls)}
                  >
                    <MagnitudeBar value={row.features} max={maxFeatures} color={color} />
                    <span className="relative" title={String(row.features)}>
                      {formatStatValue(row.features)}
                    </span>
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`relative cursor-pointer overflow-hidden pt-1.5 pb-2.5 pr-3.5 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                    onClick={() => onClassFilterChange(cls)}
                  >
                    <MagnitudeBar value={Number(row.hectares)} max={maxArea} color={color} />
                    <span className="relative" title={row.hectares}>
                      {formatStatValue(row.hectares)}
                    </span>
                  </td>
                </tr>
                {isClassListOpen && classListResult === 'error' && (
                  <LocatorError onRetry={() => onRetryLocate(cls, null)} />
                )}
                {isClassListOpen && classListResult && classListResult !== 'error' && (
                  <LocatorList
                    key={`${cls}::locate`}
                    features={classListResult.features}
                    total={classListResult.total}
                    onFeatureClick={onLocateFeatureClick}
                    color={color}
                    title={(f) =>
                      (f.sector_no !== null
                        ? `Sector ${String(f.sector_no).padStart(2, '0')}`
                        : 'Peripheral') + (f.plot_no ? ` · Plot ${f.plot_no}` : '')
                    }
                    subtitle={(f) => f.label}
                  />
                )}
                {hasChildren &&
                  isExpanded &&
                  visibleSubs.map((sub) => {
                    const subChecked = isFullySelected
                      ? true
                      : (partialSubs?.includes(sub.subclass) ?? false)
                    const isSubListOpen = locateTargets.some(
                      (t) => t.classGroup === cls && t.subclass === sub.subclass,
                    )
                    const subListResult =
                      locateResults[locateKey(cls, sub.subclass, sectorNo)] ?? null
                    const isSubListLoading = isSubListOpen && subListResult === null
                    return (
                      <Fragment key={`${cls}::${sub.subclass}`}>
                        <tr
                          className="cursor-pointer hover:bg-[var(--map-surface-hover)]"
                          style={
                            subChecked
                              ? {
                                  background: `color-mix(in srgb, ${color} calc(var(--map-row-tint-pct) * 0.6), transparent)`,
                                }
                              : undefined
                          }
                          onClick={() => onSubclassFilterChange(cls, sub.subclass)}
                        >
                          <td
                            style={{ color: subChecked ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                            className={`relative py-1 pl-3.5 pr-2 text-left text-[11.5px] ${subChecked ? 'font-semibold' : ''}`}
                          >
                            {/* Same selected-state treatment as PoiTable's
                                sub-rows: these two tables sit inches apart and
                                otherwise share a visual language, but this one
                                drew no accent bar and used a lighter weight,
                                so the identical state read differently
                                depending on which table you were looking at. */}
                            {subChecked && (
                              <span
                                aria-hidden="true"
                                className="absolute inset-y-0.5 left-0 w-[3px] rounded-full"
                                style={{ background: color }}
                              />
                            )}
                            <span className="flex items-center gap-1.5 pl-5">
                              {/* Focusable label button -- see the matching comment in PoiTable. */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onSubclassFilterChange(cls, sub.subclass)
                                }}
                                aria-pressed={subChecked}
                                title={`${subChecked ? 'Clear' : 'Filter map to'} ${sub.subclass}`}
                                className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--map-accent)]"
                              >
                                <RowCheckbox checked={subChecked} color={color} size="sm" />
                                <span className="min-w-0 truncate">{sub.subclass}</span>
                              </button>
                              <LocateToggleButton
                                isOpen={isSubListOpen}
                                isLoading={isSubListLoading}
                                color={color}
                                onClick={() => onToggleLocate(cls, sub.subclass)}
                                label={`${isSubListOpen ? 'Hide' : 'Show'} ${sub.subclass} locations`}
                              />
                            </span>
                          </td>
                          <td
                            style={{ color: subChecked ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                            className="py-1 pr-2 text-right text-[11.5px] tabular-nums"
                          >
                            {sub.features}
                          </td>
                          <td
                            style={{ color: subChecked ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                            className="py-1 pr-3.5 text-right text-[11.5px] tabular-nums"
                          >
                            {sub.hectares}
                          </td>
                        </tr>
                        {isSubListOpen && subListResult === 'error' && (
                          <LocatorError onRetry={() => onRetryLocate(cls, sub.subclass)} />
                        )}
                        {isSubListOpen && subListResult && subListResult !== 'error' && (
                          <LocatorList
                            features={subListResult.features}
                            total={subListResult.total}
                            onFeatureClick={onLocateFeatureClick}
                            color={color}
                            title={(f) =>
                              (f.sector_no !== null
                                ? `Sector ${String(f.sector_no).padStart(2, '0')}`
                                : 'Peripheral') + (f.plot_no ? ` · Plot ${f.plot_no}` : '')
                            }
                            subtitle={(f) => f.label}
                          />
                        )}
                      </Fragment>
                    )
                  })}
                {hasChildren && isExpanded && hiddenCount > 0 && (
                  <tr key={`${cls}::more`}>
                    <td colSpan={3} className="py-1 pl-3.5 pr-3.5 text-left">
                      <button
                        type="button"
                        onClick={() => onUncap(cls)}
                        style={{ color: 'var(--map-accent)' }}
                        className="cursor-pointer pl-5 text-[11px] font-semibold hover:brightness-90"
                      >
                        Show {hiddenCount} more…
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function StatsPanel({
  icon,
  sectorNo,
  sectorLabel,
  onClearSector,
  onSelectSector,
  classFilter,
  onClassFilterChange,
  subclassFilter,
  onSubclassFilterChange,
  locateTargets,
  onToggleLocate,
  onRetryLocate,
  locateResults,
  onLocateFeatureClick,
  poiVisibility,
  onTogglePoiLayer,
  poiSubclassFilter,
  onPoiSubclassFilterChange,
  poiLocateTargets,
  onTogglePoiLocate,
  onRetryPoiLocate,
  poiLocateResults,
  onPoiLocateFeatureClick,
  roadTypeVisibility,
  onToggleRoadType,
  onWidthChange,
  forceCollapsed,
  onExpand,
  onCollapse,
}: {
  icon: ReactNode
  /** Restricts every table to one sector's rows when set. */
  sectorNo: number | null
  sectorLabel?: string
  onClearSector?: () => void
  /** Selects a sector from "Per-sector totals" -- same action as the search
   *  panel's "Jump to sector" rows (flies the map there; that fly-to is
   *  driven by the effect watching selectedSector in MapView, not by this
   *  callback itself). */
  onSelectSector: (sectorNo: number) => void
  /** Currently active classes in "Area by class" -- empty means no row is
   *  active (all classes shown). Several rows can be active at once. */
  classFilter: string[]
  /** Toggles a single class in/out of the active set. */
  onClassFilterChange: (className: string) => void
  /** Sub-class selections for classes that are only partially checked --
   *  keyed by class_group, same partial-selection model as the Layers
   *  panel's class tree (a class fully in classFilter implies all its
   *  sub-classes and has no entry here). Several sub-classes across several
   *  classes can be selected at once -- this is a genuine multi-select. */
  subclassFilter: Record<string, string[]>
  /** Toggles a single (class, subclass) pair in/out of the active set. */
  onSubclassFilterChange: (className: string, subclass: string) => void
  /** Every class/sub-class row with its locator list currently open --
   *  independent of classFilter/subclassFilter (a class can be selected
   *  without its list open, or listed without being selected). subclass is
   *  null for the class-level (not sub-class) list. Several stay open at
   *  once so two classes can be compared side by side. */
  locateTargets: { classGroup: string; subclass: string | null }[]
  /** Opens/closes one row's locator list, mirroring onTogglePoiLocate. */
  onToggleLocate: (classGroup: string, subclass: string | null) => void
  /** See onRetryPoiLocate. */
  onRetryLocate: (classGroup: string, subclass: string | null) => void
  /** Bbox + per-feature centroids per open row, keyed by locateKey. A key
   *  mapped to null means its fetch is still in flight (drives that row's
   *  spinner); an absent key means that row's list is closed. */
  locateResults: Record<string, LocateState<LocateResult>>
  /** Flies the map to one specific matched feature from the locator list. */
  onLocateFeatureClick: (lng: number, lat: number) => void
  /** Same on/off map keyed by POI layer key as the Layers panel's toggles --
   * shared state so a row clicked here and a switch flipped there always
   * agree, same as classFilter driving the Class dropdown. */
  poiVisibility: Record<string, boolean>
  onTogglePoiLayer: (layerKey: string) => void
  /** Sub-class selections for POI layers that are only partially checked --
   *  same partial-selection model as subclassFilter, keyed by POI layer key
   *  instead of class_group. Also a genuine multi-select now (Temple and
   *  Mosque can both be checked at once). */
  poiSubclassFilter: Record<string, string[]>
  onPoiSubclassFilterChange: (layerKey: string, subclass: string) => void
  /** Every POI layer/sub-class row with its locator list open -- mirrors
   *  locateTargets above, independent of poiSubclassFilter/poiVisibility. */
  poiLocateTargets: { layer: string; subclass: string | null }[]
  /** Opens/closes one row's locator list, mirroring onToggleLocate. */
  onTogglePoiLocate: (layerKey: string, subclass: string | null) => void
  /** Clears a failed locate so it refetches -- see MapView's retryPoiLocate.
   *  Distinct from the toggle: the row is still open when the error shows. */
  onRetryPoiLocate: (layerKey: string, subclass: string | null) => void
  /** Keyed by locateKey, mirroring locateResults. */
  poiLocateResults: Record<string, LocateState<PoiLocateResult>>
  /** Flies the map to one specific matched POI feature. */
  onPoiLocateFeatureClick: (lng: number, lat: number) => void
  /** Same visibility map, keyed by road type -- independent on/off per row,
   * same as poiVisibility/onTogglePoiLayer, so all 3 can be active together. */
  roadTypeVisibility: Record<string, boolean>
  onToggleRoadType: (roadTypeKey: string) => void
  /** Reports this panel's live on-screen width (0 while collapsed) up to
   *  MapView, which uses it to keep fitBounds/flyTo results centered in the
   *  space actually free of this panel instead of half-hidden behind it. */
  onWidthChange?: (width: number) => void
  /** Forwarded to the underlying Panel -- forces this panel closed on a phone-width viewport
   *  while the left search panel is open there instead (see Panel.tsx's forceCollapsed doc). */
  forceCollapsed?: boolean
  /** Forwarded to the underlying Panel -- fires when the user expands this panel, so MapView can
   *  force-collapse the left search panel on a phone-width viewport. */
  onExpand?: () => void
  /** Forwarded to the underlying Panel -- fires when the user collapses this panel, so MapView
   *  can clear its "which panel is expanded" tracker and let the search panel reappear. */
  onCollapse?: () => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Which classes have their sub-class rows expanded in "Area by class" --
  // UI-only, not persisted, same disclosure-per-row idea as the Layers
  // panel's class tree (kept as separate state since the two panels don't
  // share component state, only the filter values themselves).
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  // Classes whose "Show N more" link has been clicked, to reveal their full
  // sub-class list instead of the default ~4-row cap.
  const [uncappedClasses, setUncappedClasses] = useState<Set<string>>(new Set())

  function toggleExpanded(cls: string) {
    setExpandedClasses((prev) => {
      const next = new Set(prev)
      if (next.has(cls)) next.delete(cls)
      else next.add(cls)
      return next
    })
  }

  // Mirrors expandedClasses/toggleExpanded above, for PoiTable's own
  // chevrons -- separate Set since a layer being expanded in Stats has no
  // bearing on whether it's expanded in the left search panel's own tree
  // (expandedFilterPois in MapView), same "two independent UIs, two
  // independent expansion states" split classFilter/expandedClasses already
  // has.
  const [expandedPoiLayers, setExpandedPoiLayers] = useState<Set<string>>(new Set())

  function togglePoiExpanded(layerKey: string) {
    setExpandedPoiLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layerKey)) next.delete(layerKey)
      else next.add(layerKey)
      return next
    })
  }

  useEffect(() => {
    // Keep the previous sector's stats on screen while the new fetch is in
    // flight (no spinner flash on every sector click) -- `loading` only
    // ever gates the very first load.
    const url = sectorNo !== null ? `/api/stats?sector=${sectorNo}` : '/api/stats'
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${r.status}`)
        return r.json()
      })
      .then((data) => {
        setStats(data)
        setError(null)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [sectorNo])

  const filtered = sectorNo !== null

  return (
    <Panel
      icon={icon}
      title="Stats"
      subtitle={filtered ? (sectorLabel ?? `Sector ${sectorNo}`) : 'All sectors'}
      side="right"
      defaultCollapsed
      resizable
      defaultWidth={320}
      minWidth={260}
      maxWidth={640}
      onRenderedWidthChange={onWidthChange}
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
    >
      {filtered && onClearSector && (
        <button
          onClick={onClearSector}
          style={{
            borderColor: 'var(--map-accent-bg-hover)',
            background: 'var(--map-accent-bg)',
            color: 'var(--map-accent-fg)',
          }}
          className="mb-3 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:brightness-95 cursor-pointer"
        >
          ← Show all sectors
        </button>
      )}

      {loading && (
        <div
          className="flex items-center gap-2 py-6 text-[12.5px]"
          style={{ color: 'var(--map-fg-muted)' }}
        >
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--map-switch-track)', borderTopColor: 'var(--map-accent)' }}
          />
          Loading stats…
        </div>
      )}
      {error && (
        <div
          className="rounded-lg border px-2.5 py-2 text-[12.5px]"
          style={{
            borderColor: 'var(--danger-soft)',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
          }}
        >
          Failed to load stats: {error}
        </div>
      )}

      {stats && (
        <div className="flex flex-col gap-4">
          <Section
            title={filtered ? 'Area by class (this sector)' : 'Area by class'}
            icon={<ParcelIcon className="h-full w-full" />}
            theme="blue"
            count={stats.byClass.length}
          >
            {stats.byClass.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--map-fg-faint)' }}>
                No sector-plan features in this sector.
              </p>
            ) : (
              <ClassAreaTable
                rows={stats.byClass}
                subclassRows={stats.bySubclass}
                classFilter={classFilter}
                onClassFilterChange={onClassFilterChange}
                subclassFilter={subclassFilter}
                onSubclassFilterChange={onSubclassFilterChange}
                expandedClasses={expandedClasses}
                onToggleExpanded={toggleExpanded}
                uncappedClasses={uncappedClasses}
                onUncap={(cls) =>
                  setUncappedClasses((prev) => {
                    const next = new Set(prev)
                    next.add(cls)
                    return next
                  })
                }
                locateTargets={locateTargets}
                onToggleLocate={onToggleLocate}
                onRetryLocate={onRetryLocate}
                locateResults={locateResults}
                onLocateFeatureClick={onLocateFeatureClick}
                sectorNo={sectorNo}
              />
            )}
          </Section>

          <Section
            title={filtered ? 'Road length by type (this sector)' : 'Road length by type'}
            icon={<RoadIcon className="h-full w-full" />}
            theme="amber"
            count={stats.roadByType.length}
          >
            {stats.roadByType.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--map-fg-faint)' }}>
                No road segments in this sector.
              </p>
            ) : (
              <Table
                columns={[
                  { header: 'Type' },
                  { header: 'Segments', align: 'right' },
                  { header: 'Km', align: 'right' },
                ]}
                rows={stats.roadByType.map((row) => {
                  const color = ROAD_TYPE_COLORS[row.type] ?? '#78716c'
                  const dash = ROAD_TYPE_DASH[row.type]
                  return [
                    <span key="t" className="flex items-center gap-1.5">
                      <span
                        className="h-0 w-3 shrink-0"
                        style={{
                          borderTopWidth: 2,
                          borderTopColor: color,
                          borderTopStyle: dash ? 'dashed' : 'solid',
                        }}
                      />
                      <span className="truncate">{row.type}</span>
                    </span>,
                    row.segments,
                    (Number(row.metres) / 1000).toFixed(1),
                  ]
                })}
                activeRows={stats.roadByType
                  .map((row, i) => (roadTypeVisibility[roadTypeKey(row.type)] ? i : -1))
                  .filter((i) => i !== -1)}
                activeColors={stats.roadByType.map(
                  (row) => ROAD_TYPE_COLORS[row.type] ?? '#78716c',
                )}
                onRowClick={(i) => onToggleRoadType(roadTypeKey(stats.roadByType[i].type))}
              />
            )}
          </Section>

          <Section
            title={filtered ? 'Points of interest (this sector)' : 'Points of interest'}
            icon={<PinClusterIcon className="h-full w-full" />}
            theme="teal"
            count={stats.poiByLayer.length}
          >
            {stats.poiByLayer.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--map-fg-faint)' }}>
                No POI layers configured.
              </p>
            ) : (
              (() => {
                return (
                  <>
                    {/* PoiTable sorts its own rows (name-ascending by default,
                        or whichever column header was clicked). */}
                    <PoiTable
                      rows={stats.poiByLayer}
                      poiSubclassRows={stats.poiBySubclass}
                      poiVisibility={poiVisibility}
                      poiSubclassFilter={poiSubclassFilter}
                      onRowClick={onTogglePoiLayer}
                      onSubclassFilterChange={onPoiSubclassFilterChange}
                      expandedLayers={expandedPoiLayers}
                      onToggleExpanded={togglePoiExpanded}
                      poiLocateTargets={poiLocateTargets}
                      onTogglePoiLocate={onTogglePoiLocate}
                      onRetryPoiLocate={onRetryPoiLocate}
                      poiLocateResults={poiLocateResults}
                      onPoiLocateFeatureClick={onPoiLocateFeatureClick}
                      sectorNo={sectorNo}
                    />
                    {/* Standalone footer note, not a PoiTable row -- see
                        tertiaryRoadCount's comment on the Stats type. Same
                        click-to-toggle affordance as a table row (reuses
                        onTogglePoiLayer/poiVisibility) but visually set apart
                        so its 21k+ count never reads as comparable to the
                        curated layers above it. */}
                    <button
                      type="button"
                      onClick={() => onTogglePoiLayer('tertiary_road')}
                      className="mt-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-left text-[11px] hover:bg-[var(--map-surface-hover)]"
                      style={{ color: 'var(--map-fg-faint)' }}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background: POI_COLORS.tertiary_road,
                          opacity: poiVisibility.tertiary_road ? 1 : 0.45,
                        }}
                      />
                      <span className="truncate">
                        + {stats.tertiaryRoadCount.toLocaleString()}{' '}
                        {POI_LABELS.tertiary_road ?? 'Street network (OSM)'} segments
                      </span>
                      <span
                        className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                        style={{
                          background: 'var(--map-surface-hover)',
                          color: 'var(--map-fg-faint)',
                        }}
                      >
                        reference
                      </span>
                    </button>
                  </>
                )
              })()
            )}
          </Section>

          {!filtered && (
            <Section
              title="Per-sector totals"
              icon={<GridIcon className="h-full w-full" />}
              theme="violet"
              count={stats.perSector.length}
            >
              <Table
                columns={[
                  { header: 'Sector' },
                  { header: 'Boundary ha', align: 'right' },
                  { header: 'Features', align: 'right' },
                  { header: 'Plan ha', align: 'right' },
                ]}
                rows={stats.perSector.map((row) => [
                  <span key="s" className="truncate">
                    {String(row.sector_no).padStart(2, '0')}. {row.name.replace(/-\d+$/, '')}
                  </span>,
                  row.boundary_hectares,
                  row.plan_features,
                  row.plan_hectares,
                ])}
                onRowClick={(i) => onSelectSector(stats.perSector[i].sector_no)}
              />
            </Section>
          )}
        </div>
      )}
    </Panel>
  )
}
