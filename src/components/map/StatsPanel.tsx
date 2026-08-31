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
} from '@/lib/classColors'
import Panel from '@/components/map/Panel'

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      {children}
    </div>
  )
}

function Table({
  columns,
  rows,
  scrollable,
}: {
  columns: { header: string; align?: 'left' | 'right' }[]
  rows: ReactNode[][]
  /** Gives the table its own scroll container so its header can stick
   * without colliding with the other tables sharing the panel's scroll. */
  scrollable?: boolean
}) {
  const table = (
    <table className="w-full border-separate border-spacing-0 text-[12px]">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={i}
              className={`${scrollable ? 'sticky top-0' : ''} bg-white/95 pb-1.5 pr-2 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 ${
                c.align === 'right' ? 'text-right' : 'text-left'
              }`}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className={ri % 2 === 1 ? 'bg-slate-50/70' : ''}>
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={`py-1 pr-2 text-slate-700 ${
                  columns[ci]?.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  return scrollable ? (
    <div className="kumbh-scroll max-h-56 overflow-y-auto rounded-lg border border-slate-100 px-2 pt-1">
      {table}
    </div>
  ) : (
    table
  )
}

export default function StatsPanel({
  icon,
  onClose,
  sectorNo,
  sectorLabel,
  onClearSector,
}: {
  icon: ReactNode
  onClose: () => void
  /** Restricts every table to one sector's rows when set. */
  sectorNo: number | null
  sectorLabel?: string
  onClearSector?: () => void
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
      subtitle={
        filtered ? (sectorLabel ?? `Sector ${sectorNo}`) : 'All sectors · Live from PostGIS'
      }
      side="right"
      onClose={onClose}
      resizable
      defaultWidth={320}
      minWidth={260}
      maxWidth={640}
    >
      {filtered && onClearSector && (
        <button
          onClick={onClearSector}
          className="mb-3 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11.5px] font-medium text-blue-700 transition-colors hover:bg-blue-100 cursor-pointer"
        >
          ← Show all sectors
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-6 text-[12.5px] text-slate-500">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          Loading stats…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[12.5px] text-red-700">
          Failed to load stats: {error}
        </div>
      )}

      {stats && (
        <div className="flex flex-col gap-4">
          <Section title={filtered ? 'Area by class (this sector)' : 'Area by class'}>
            {stats.byClass.length === 0 ? (
              <p className="text-[12px] text-slate-400">No sector-plan features in this sector.</p>
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
              />
            )}
          </Section>

          <Section title={filtered ? 'Road length by type (this sector)' : 'Road length by type'}>
            {stats.roadByType.length === 0 ? (
              <p className="text-[12px] text-slate-400">No road segments in this sector.</p>
            ) : (
              <Table
                columns={[
                  { header: 'Type' },
                  { header: 'Segments', align: 'right' },
                  { header: 'Km', align: 'right' },
                ]}
                rows={stats.roadByType.map((row) => [
                  row.type,
                  row.segments,
                  (Number(row.metres) / 1000).toFixed(1),
                ])}
              />
            )}
          </Section>

          <Section title={filtered ? 'Points of interest (this sector)' : 'Points of interest'}>
            {stats.poiByLayer.every((row) => row.features === 0) ? (
              <p className="text-[12px] text-slate-400">No POI features in this sector.</p>
            ) : (
              <Table
                columns={[{ header: 'Layer' }, { header: 'Features', align: 'right' }]}
                rows={stats.poiByLayer
                  .filter((row) => row.features > 0)
                  .map((row) => [
                    <span key="l" className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: POI_COLORS[row.layer] ?? '#cbd5e1' }}
                      />
                      <span className="truncate">{POI_LABELS[row.layer] ?? row.layer}</span>
                    </span>,
                    row.features,
                  ])}
              />
            )}
          </Section>

          {!filtered && (
            <Section title="Per-sector totals">
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
                    {row.sector_no}. {row.name}
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
