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
}

/** Bounding box + per-feature centroids for whatever single class or
 *  sub-class the filter currently narrows to -- backs the locator list
 *  rendered under that row in ClassAreaTable. Null once the selection is
 *  broader than one target (nothing to locate a single place for). */
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
 *  outside kumbh.sector_plan and carry only an id/optional name label, not
 *  the sector/plot/block fields sector_plan features have. */
type PoiLocateResult = {
  layer: string
  total: number
  bbox: [number, number, number, number] | null
  features: { id: number; label: string | null; lng: number; lat: number }[]
}

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
}: {
  features: F[]
  total: number
  onFeatureClick: (lng: number, lat: number) => void
  color: string
  title: (f: F) => string
  subtitle?: (f: F) => string | null
}) {
  const [uncapped, setUncapped] = useState(false)
  const visible = uncapped ? features : features.slice(0, LOCATOR_ROW_CAP)
  const hiddenCount = total - visible.length

  return (
    <tr>
      <td colSpan={3} className="py-0 pl-0 pr-3.5">
        <div
          className="my-0.5 ml-[30px] flex flex-col gap-0.5 border-l-2 pl-2"
          style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}
        >
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
  poiVisibility,
  onRowClick,
  poiLocateResult,
  onPoiLocateFeatureClick,
}: {
  rows: { layer: string; features: number; hectares: string | null }[]
  poiVisibility: Record<string, boolean>
  onRowClick: (layerKey: string) => void
  poiLocateResult: PoiLocateResult | null
  onPoiLocateFeatureClick: (lng: number, lat: number) => void
}) {
  return (
    <div className="-mx-3.5">
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            <th
              style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
              className="pl-3.5 pt-1 pb-1.5 pr-2 text-left text-[10.5px] font-semibold uppercase tracking-wide"
            >
              Layer
            </th>
            <th
              style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
              className="pt-1 pb-1.5 pr-2 text-right text-[10.5px] font-semibold uppercase tracking-wide"
            >
              Features
            </th>
            <th
              style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
              className="pt-1 pb-1.5 pr-3.5 text-right text-[10.5px] font-semibold uppercase tracking-wide"
            >
              Ha
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const signageCode = POI_SIGNAGE_CODES[row.layer]
            const color = POI_COLORS[row.layer] ?? '#cbd5e1'
            const isActive = poiVisibility[row.layer]
            const rowTint = `color-mix(in srgb, ${color} var(--map-row-tint-pct), transparent)`
            const showLocator = poiLocateResult && poiLocateResult.layer === row.layer

            return (
              <Fragment key={row.layer}>
                <tr
                  onClick={() => onRowClick(row.layer)}
                  className={
                    isActive
                      ? 'cursor-pointer'
                      : 'cursor-pointer hover:bg-[var(--map-surface-hover)]'
                  }
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
                    <span className="flex items-center gap-1.5">
                      {signageCode ? (
                        <span
                          className="flex h-3.5 shrink-0 items-center justify-center rounded-[3px] px-1 text-[8.5px] font-bold leading-none text-white"
                          style={{ background: color }}
                        >
                          {signageCode}
                        </span>
                      ) : (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                      )}
                      <span className="truncate">{POI_LABELS[row.layer] ?? row.layer}</span>
                    </span>
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`py-1.5 pr-2 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                  >
                    {row.features}
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-faint)' }}
                    className={`py-1.5 pr-3.5 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                  >
                    {row.hectares ?? '—'}
                  </td>
                </tr>
                {showLocator && poiLocateResult && (
                  <LocatorList
                    features={poiLocateResult.features}
                    total={poiLocateResult.total}
                    onFeatureClick={onPoiLocateFeatureClick}
                    color={color}
                    title={(f) => f.label ?? POI_LABELS[row.layer] ?? row.layer}
                  />
                )}
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
  locateResult,
  onLocateFeatureClick,
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
  locateResult: LocateResult | null
  onLocateFeatureClick: (lng: number, lat: number) => void
}) {
  return (
    <div className="-mx-3.5">
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            <th
              style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
              className="pl-3.5 pt-1 pb-1.5 pr-2 text-left text-[10.5px] font-semibold uppercase tracking-wide"
            >
              Class
            </th>
            <th
              style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
              className="pt-1 pb-1.5 pr-2 text-right text-[10.5px] font-semibold uppercase tracking-wide"
            >
              Features
            </th>
            <th
              style={{ background: 'var(--map-surface)', color: 'var(--map-fg-faint)' }}
              className="pt-1 pb-1.5 pr-3.5 text-right text-[10.5px] font-semibold uppercase tracking-wide"
            >
              Ha
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cls = row.class_group
            const color = CLASS_GROUP_COLORS[cls] ?? '#cbd5e1'
            const subs = subclassRows.filter((r) => r.class_group === cls)
            const hasChildren = subs.length > 1
            // Auto-expands when the locate target lands inside this class
            // (e.g. a sub-class checked from the Layers panel's tree, not
            // this row's own chevron) so the locator list is never hidden
            // behind a collapsed row.
            const isExpanded =
              expandedClasses.has(cls) || (locateResult !== null && locateResult.classGroup === cls)
            const isFullySelected = classFilter.includes(cls)
            const partialSubs = subclassFilter[cls]
            const isActive = isFullySelected || (!!partialSubs && partialSubs.length > 0)
            const rowTint = `color-mix(in srgb, ${color} var(--map-row-tint-pct), transparent)`
            // Also uncaps automatically when the locate target is a
            // sub-class that would otherwise fall past the default cap --
            // a user who explicitly picked it (from here or the Layers
            // panel) shouldn't have its locator list silently missing.
            const targetSubclassCapped =
              locateResult !== null &&
              locateResult.classGroup === cls &&
              locateResult.subclass !== null &&
              subs.findIndex((s) => s.subclass === locateResult.subclass) >= SUBCLASS_ROW_CAP
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
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-[2px]"
                          style={{ background: color }}
                        />
                        <span className="truncate">{cls}</span>
                      </button>
                    </span>
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`cursor-pointer py-1.5 pr-2 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                    onClick={() => onClassFilterChange(cls)}
                  >
                    {row.features}
                  </td>
                  <td
                    style={{ color: isActive ? 'var(--map-fg)' : 'var(--map-fg-muted)' }}
                    className={`cursor-pointer py-1.5 pr-3.5 text-right tabular-nums ${isActive ? 'font-semibold' : ''}`}
                    onClick={() => onClassFilterChange(cls)}
                  >
                    {row.hectares}
                  </td>
                </tr>
                {isFullySelected &&
                  locateResult &&
                  locateResult.classGroup === cls &&
                  locateResult.subclass === null && (
                    <LocatorList
                      key={`${cls}::locate`}
                      features={locateResult.features}
                      total={locateResult.total}
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
                    const showLocator =
                      !isFullySelected &&
                      subChecked &&
                      partialSubs?.length === 1 &&
                      locateResult &&
                      locateResult.classGroup === cls &&
                      locateResult.subclass === sub.subclass
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
                            className={`py-1 pl-3.5 pr-2 text-left text-[11.5px] ${subChecked ? 'font-medium' : ''}`}
                          >
                            <span className="flex items-center gap-1.5 pl-5">
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ background: color, opacity: subChecked ? 1 : 0.45 }}
                              />
                              <span className="truncate">{sub.subclass}</span>
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
                        {showLocator && locateResult && (
                          <LocatorList
                            features={locateResult.features}
                            total={locateResult.total}
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
  locateResult,
  onLocateFeatureClick,
  poiVisibility,
  onTogglePoiLayer,
  poiLocateResult,
  onPoiLocateFeatureClick,
  roadTypeVisibility,
  onToggleRoadType,
  onWidthChange,
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
   *  sub-classes and has no entry here). */
  subclassFilter: Record<string, string[]>
  /** Toggles a single (class, subclass) pair in/out of the active set. */
  onSubclassFilterChange: (className: string, subclass: string) => void
  /** Bbox + per-feature centroids for the single class/sub-class the
   *  filter currently resolves to, or null when the selection is broader
   *  than one target -- drives the locator list nested under that row. */
  locateResult: LocateResult | null
  /** Flies the map to one specific matched feature from the locator list. */
  onLocateFeatureClick: (lng: number, lat: number) => void
  /** Same on/off map keyed by POI layer key as the Layers panel's toggles --
   * shared state so a row clicked here and a switch flipped there always
   * agree, same as classFilter driving the Class dropdown. */
  poiVisibility: Record<string, boolean>
  onTogglePoiLayer: (layerKey: string) => void
  /** Bbox + per-feature centroids for whichever POI layer was last clicked
   *  on here, or null once nothing's been clicked -- drives the locator
   *  list nested under that layer's row, mirroring locateResult above. */
  poiLocateResult: PoiLocateResult | null
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
                locateResult={locateResult}
                onLocateFeatureClick={onLocateFeatureClick}
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
                const poiRows = [...stats.poiByLayer].sort((a, b) =>
                  (POI_LABELS[a.layer] ?? a.layer).localeCompare(POI_LABELS[b.layer] ?? b.layer),
                )
                return (
                  <PoiTable
                    rows={poiRows}
                    poiVisibility={poiVisibility}
                    onRowClick={onTogglePoiLayer}
                    poiLocateResult={poiLocateResult}
                    onPoiLocateFeatureClick={onPoiLocateFeatureClick}
                  />
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
