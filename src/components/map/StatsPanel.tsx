'use client'

import { type ReactNode, useEffect, useState } from 'react'
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
import { ParcelIcon, RoadIcon, PinClusterIcon, GridIcon } from '@/components/map/icons'

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
  roadByType: { type: string; segments: number; metres: string }[]
  perSector: {
    sector_no: number
    name: string
    boundary_hectares: string
    plan_features: number
    plan_hectares: string
  }[]
  poiByLayer: { layer: string; features: number }[]
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

export default function StatsPanel({
  icon,
  sectorNo,
  sectorLabel,
  onClearSector,
  classFilter,
  onClassFilterChange,
  poiVisibility,
  onTogglePoiLayer,
  roadTypeVisibility,
  onToggleRoadType,
}: {
  icon: ReactNode
  /** Restricts every table to one sector's rows when set. */
  sectorNo: number | null
  sectorLabel?: string
  onClearSector?: () => void
  /** Currently active classes in "Area by class" -- empty means no row is
   *  active (all classes shown). Several rows can be active at once. */
  classFilter: string[]
  /** Toggles a single class in/out of the active set. */
  onClassFilterChange: (className: string) => void
  /** Same on/off map keyed by POI layer key as the Layers panel's toggles --
   * shared state so a row clicked here and a switch flipped there always
   * agree, same as classFilter driving the Class dropdown. */
  poiVisibility: Record<string, boolean>
  onTogglePoiLayer: (layerKey: string) => void
  /** Same visibility map, keyed by road type -- independent on/off per row,
   * same as poiVisibility/onTogglePoiLayer, so all 3 can be active together. */
  roadTypeVisibility: Record<string, boolean>
  onToggleRoadType: (roadTypeKey: string) => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
              <Table
                columns={[
                  { header: 'Class' },
                  { header: 'Features', align: 'right' },
                  { header: 'Ha', align: 'right' },
                ]}
                rows={stats.byClass.map((row) => [
                  <span key="c" className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-[2px]"
                      style={{ background: CLASS_GROUP_COLORS[row.class_group] ?? '#cbd5e1' }}
                    />
                    <span className="truncate">{row.class_group}</span>
                  </span>,
                  row.features,
                  row.hectares,
                ])}
                activeRows={stats.byClass
                  .map((row, i) => (classFilter.includes(row.class_group) ? i : -1))
                  .filter((i) => i !== -1)}
                activeColors={stats.byClass.map(
                  (row) => CLASS_GROUP_COLORS[row.class_group] ?? '#cbd5e1',
                )}
                onRowClick={(i) => onClassFilterChange(stats.byClass[i].class_group)}
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
            count={stats.poiByLayer.filter((row) => row.features > 0).length}
          >
            {stats.poiByLayer.every((row) => row.features === 0) ? (
              <p className="text-[12px]" style={{ color: 'var(--map-fg-faint)' }}>
                No POI features in this sector.
              </p>
            ) : (
              (() => {
                const poiRows = stats.poiByLayer
                  .filter((row) => row.features > 0)
                  .sort((a, b) =>
                    (POI_LABELS[a.layer] ?? a.layer).localeCompare(POI_LABELS[b.layer] ?? b.layer),
                  )
                return (
                  <Table
                    columns={[{ header: 'Layer' }, { header: 'Features', align: 'right' }]}
                    rows={poiRows.map((row) => {
                      const signageCode = POI_SIGNAGE_CODES[row.layer]
                      const color = POI_COLORS[row.layer] ?? '#cbd5e1'
                      return [
                        <span key="l" className="flex items-center gap-1.5">
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
                        </span>,
                        row.features,
                      ]
                    })}
                    activeRows={poiRows
                      .map((row, i) => (poiVisibility[row.layer] ? i : -1))
                      .filter((i) => i !== -1)}
                    activeColors={poiRows.map((row) => POI_COLORS[row.layer] ?? '#cbd5e1')}
                    onRowClick={(i) => onTogglePoiLayer(poiRows[i].layer)}
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
                scrollable
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
              />
            </Section>
          )}
        </div>
      )}
    </Panel>
  )
}
