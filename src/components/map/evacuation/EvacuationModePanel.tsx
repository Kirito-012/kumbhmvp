'use client'

import { useMemo, useRef, useState } from 'react'
import Panel from '@/components/map/Panel'
import { EvacuationIcon, GridIcon, MapPinIcon, ParcelIcon, SearchIcon, TagIcon, XIcon } from '@/components/map/icons'
import { Reveal } from '@/components/map/insights/charts'
import {
  EVAC_CORE_KEYS,
  EVAC_FLOOD_KEYS,
  EVAC_LAYER_LABELS,
  EVAC_SHP_SOURCED_KEYS,
  EVAC_SUPPORT_KEYS,
  type EvacKey,
} from '@/lib/evacuation/layers'
import {
  EVAC_CORRIDOR_LABELS,
  isEvacFiltersEmpty,
  type EvacCorridor,
  type EvacDirection,
  type EvacFilters,
  type EvacPlan,
} from '@/lib/evacuation/filters'
import { useEvacuationSearch, type EvacSearchResult } from './useEvacuationSearch'

type SectorSummary = {
  sector_no: number
  name: string
  zone?: string | null
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

type ZoneEntry = { zone: string; bbox: [number, number, number, number] }

/** Matches MapView's own module-private formatSectorLabel -- small enough to duplicate rather
 *  than thread through props just for this, same call Heatmap's InsightsModePanel already made. */
function formatSectorLabel(sector: Pick<SectorSummary, 'sector_no' | 'name'>): string {
  const title = sector.name.replace(/-\d+$/, '')
  return `${String(sector.sector_no).padStart(2, '0')}. ${title}`
}

function zoneTitleCase(zone: string): string {
  // 'BAIRAGICAMP ZONE' -> 'Bairagicamp zone'
  return zone.charAt(0) + zone.slice(1).toLowerCase()
}

/** A single flattened, keyboard-navigable row -- sectors/zones/search results all reduce to one
 *  of these so ArrowUp/ArrowDown/Enter can walk them without caring which group a row came from. */
type FlatRow =
  | { kind: 'sector'; sector: SectorSummary }
  | { kind: 'zone'; entry: ZoneEntry }
  | { kind: 'result'; layer: string; result: EvacSearchResult }

function SectionLabel({ children }: { children: string }) {
  return (
    <h3
      className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--map-fg-faint)' }}
    >
      {children}
    </h3>
  )
}

function LayerToggleRow({
  evacKey,
  on,
  onToggle,
}: {
  evacKey: EvacKey
  on: boolean
  onToggle: () => void
}) {
  const shpSourced = EVAC_SHP_SOURCED_KEYS.includes(evacKey)
  return (
    <div className="flex items-center gap-2 py-1 text-[12.5px]" style={{ color: 'var(--map-fg)' }}>
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" className="peer sr-only" checked={on} onChange={onToggle} />
        <span
          aria-hidden
          className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
          style={{ background: on ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
        >
          <span
            className="absolute h-3 w-3 rounded-full bg-white shadow transition-transform"
            style={{ transform: on ? 'translateX(14px)' : 'translateX(2px)' }}
          />
        </span>
        <span className="min-w-0 flex-1 truncate">{EVAC_LAYER_LABELS[evacKey]}</span>
      </label>
      {shpSourced && (
        <span className="shrink-0 text-[10px]" style={{ color: 'var(--map-fg-faint)' }}>
          25 Aug 2026
        </span>
      )}
    </div>
  )
}

/** The 3 base toggles Evacuation mode shares with Map mode (PLAN-evacuation.md §1 decision #6/
 *  §7.2 item 6) -- same keys as MapView's own module-private `baseLayerRows`, duplicated here
 *  rather than exported/shared since MapView's copy also carries its own `theme`/icon-in-a-chip
 *  styling this panel doesn't use. */
const BASE_LAYER_ROWS: Array<{
  key: 'sector_plan' | 'sector_boundary' | 'sector_names'
  label: string
  icon: typeof ParcelIcon
}> = [
  { key: 'sector_plan', label: 'Sector plan', icon: ParcelIcon },
  { key: 'sector_boundary', label: 'Boundaries', icon: GridIcon },
  { key: 'sector_names', label: 'Sector names', icon: TagIcon },
]

function BaseLayerRow({
  icon: Icon,
  label,
  on,
  onToggle,
}: {
  icon: typeof ParcelIcon
  label: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-2 py-1 text-[12.5px]" style={{ color: 'var(--map-fg)' }}>
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" className="peer sr-only" checked={on} onChange={onToggle} />
        <span
          aria-hidden
          className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
          style={{ background: on ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
        >
          <span
            className="absolute h-3 w-3 rounded-full bg-white shadow transition-transform"
            style={{ transform: on ? 'translateX(14px)' : 'translateX(2px)' }}
          />
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--map-fg-faint)]" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </label>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        borderColor: active ? 'var(--map-accent)' : 'var(--map-border)',
        background: active ? 'var(--map-accent)' : 'var(--map-input-bg)',
        color: active ? '#fff' : 'var(--map-fg-muted)',
      }}
      className="cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
    >
      {children}
    </button>
  )
}

/**
 * Left-docked panel for Evacuation mode -- search, scenario/direction/corridor filters, and
 * layer toggles (PLAN-evacuation.md §7.2). Phase 4: the search UI here is self-contained rather
 * than extracted from/shared with Map mode's own unified search (the plan's original §7.1
 * "shared search UI" sketch) -- refactoring MapView's ~700-line search block carried real
 * regression risk for zero behaviour change to Map mode, so this ships its own equivalent
 * instead, following the same visual conventions (rounded input, grouped dropdown, checkbox
 * rows) without touching that code. Revisit as a follow-up cleanup if the two ever need to
 * change in lockstep.
 */
export default function EvacuationModePanel({
  evacVisibility,
  onToggleLayer,
  evacFilters,
  onFiltersChange,
  sectors,
  onSelectSector,
  onSelectZone,
  onSelectResult,
  mapVisibility,
  onToggleMapLayer,
  forceCollapsed,
  onExpand,
  onCollapse,
  onWidthChange,
}: {
  evacVisibility: Record<EvacKey, boolean>
  onToggleLayer: (key: EvacKey) => void
  evacFilters: EvacFilters
  onFiltersChange: (filters: EvacFilters) => void
  sectors: SectorSummary[]
  onSelectSector: (sectorNo: number) => void
  onSelectZone: (zone: string, bbox: [number, number, number, number]) => void
  onSelectResult: (layer: string, result: EvacSearchResult) => void
  /** The 3 base toggles' shared state -- Map mode's own `visibility`/`setVisibility`, passed
   *  straight through rather than duplicated (decision #6: these two modes share one on/off
   *  state). `mapVisibility` only ever needs to be read for these 3 keys here. */
  mapVisibility: Record<string, boolean>
  onToggleMapLayer: (key: string) => void
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onWidthChange?: (width: number) => void
}) {
  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { groups, loading, error } = useEvacuationSearch(query)

  const zoneEntries = useMemo<ZoneEntry[]>(() => {
    const byZone = new Map<string, SectorSummary[]>()
    for (const s of sectors) {
      if (!s.zone) continue
      const list = byZone.get(s.zone) ?? []
      list.push(s)
      byZone.set(s.zone, list)
    }
    return Array.from(byZone.entries())
      .map(([zone, members]) => ({
        zone,
        bbox: [
          Math.min(...members.map((m) => m.xmin)),
          Math.min(...members.map((m) => m.ymin)),
          Math.max(...members.map((m) => m.xmax)),
          Math.max(...members.map((m) => m.ymax)),
        ] as [number, number, number, number],
      }))
      .sort((a, b) => a.zone.localeCompare(b.zone))
  }, [sectors])

  const trimmed = query.trim().toLowerCase()
  const matchedSectors =
    trimmed.length > 0
      ? sectors.filter(
          (s) => s.name.toLowerCase().includes(trimmed) || String(s.sector_no).includes(trimmed),
        )
      : []
  const matchedZones =
    trimmed.length > 0 ? zoneEntries.filter((z) => z.zone.toLowerCase().includes(trimmed)) : []

  const flatRows: FlatRow[] = [
    ...matchedSectors.map((sector): FlatRow => ({ kind: 'sector', sector })),
    ...matchedZones.map((entry): FlatRow => ({ kind: 'zone', entry })),
    ...groups.flatMap((g) => g.results.map((result): FlatRow => ({ kind: 'result', layer: g.layer, result }))),
  ]

  function activateRow(row: FlatRow) {
    if (row.kind === 'sector') onSelectSector(row.sector.sector_no)
    else if (row.kind === 'zone') onSelectZone(row.entry.zone, row.entry.bbox)
    else onSelectResult(row.layer, row.result)
    setDropdownOpen(false)
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDropdownOpen(true)
      setHighlightIndex((i) => Math.min(i + 1, flatRows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = flatRows[highlightIndex]
      if (row) activateRow(row)
    } else if (e.key === 'Escape') {
      if (dropdownOpen) {
        e.stopPropagation() // don't also let the mode-level Escape handler fire
        setDropdownOpen(false)
      }
    }
  }

  const filtersActive = !isEvacFiltersEmpty(evacFilters)
  const nonEmptyCorridors: EvacCorridor[] = ['deh_dir', 'sah_dir', 'meer_dir']

  function toggleDirection(direction: EvacDirection) {
    onFiltersChange({
      ...evacFilters,
      direction: evacFilters.direction === direction ? undefined : direction,
    })
  }
  function togglePlan(plan: EvacPlan | 'all') {
    onFiltersChange({ ...evacFilters, plan: plan === 'all' ? undefined : plan })
  }
  function toggleCorridor(corridor: EvacCorridor) {
    const current = evacFilters.corridors ?? []
    const next = current.includes(corridor)
      ? current.filter((c) => c !== corridor)
      : [...current, corridor]
    onFiltersChange({ ...evacFilters, corridors: next.length ? next : undefined })
  }
  function clearAll() {
    onFiltersChange({})
    setQuery('')
  }

  return (
    <Panel
      icon={<EvacuationIcon className="h-full w-full" />}
      title="Evacuation"
      subtitle="Entry/exit · routes · signage"
      side="left"
      entrance="slide"
      forceCollapsed={forceCollapsed}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onRenderedWidthChange={onWidthChange}
      overlayOpen={dropdownOpen}
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--map-fg-faint)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setDropdownOpen(true)
              setHighlightIndex(0)
            }}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={onInputKeyDown}
            placeholder="Search exits, routes, signage, sectors, zones…"
            aria-label="Search evacuation layers, sectors and zones"
            style={{
              borderColor: 'var(--map-border)',
              background: 'var(--map-input-bg)',
              color: 'var(--map-fg)',
            }}
            className="w-full rounded-xl border py-2.5 pl-9 pr-8 text-[14px] placeholder:text-[var(--map-fg-faint)] outline-none transition-shadow focus:border-[var(--map-accent)] focus:ring-2 focus:ring-[var(--map-accent)]/25"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--map-fg-faint)] hover:text-[var(--map-fg-muted)]"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}

          {dropdownOpen && trimmed.length > 0 && (
            <ul
              role="listbox"
              aria-label="Search results"
              style={{ borderColor: 'var(--map-border)', background: 'var(--map-surface)' }}
              className="kumbh-scroll absolute z-10 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border py-1 shadow-lg"
            >
              {loading && flatRows.length === 0 && (
                <li className="relative h-1 overflow-hidden">
                  <div className="absolute inset-y-0 w-1/3 animate-[loading-sweep_1.1s_ease-in-out_infinite] rounded-full bg-[var(--map-accent)]" />
                </li>
              )}
              {error && (
                <li className="px-3 py-2 text-[12px]" style={{ color: 'var(--danger)' }}>
                  {error}
                </li>
              )}
              {!loading && !error && flatRows.length === 0 && (
                <li className="px-3 py-3 text-[12.5px]" style={{ color: 'var(--map-fg-faint)' }}>
                  No evacuation features match &ldquo;{query}&rdquo;
                </li>
              )}
              {matchedSectors.length > 0 && (
                <>
                  <li className="px-3 pt-1.5" style={{ color: 'var(--map-fg-faint)' }}>
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide">
                      Jump to sector
                    </span>
                  </li>
                  {matchedSectors.map((sector) => {
                    const index = flatRows.findIndex(
                      (r) => r.kind === 'sector' && r.sector.sector_no === sector.sector_no,
                    )
                    return (
                      <li key={`sector-${sector.sector_no}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === highlightIndex}
                          onMouseEnter={() => setHighlightIndex(index)}
                          onClick={() => activateRow({ kind: 'sector', sector })}
                          style={{
                            background:
                              index === highlightIndex ? 'var(--map-surface-hover)' : 'transparent',
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12.5px]"
                        >
                          <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-[var(--map-fg-faint)]" />
                          {formatSectorLabel(sector)}
                        </button>
                      </li>
                    )
                  })}
                </>
              )}
              {matchedZones.length > 0 && (
                <>
                  <li className="px-3 pt-1.5" style={{ color: 'var(--map-fg-faint)' }}>
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide">Zones</span>
                  </li>
                  {matchedZones.map((entry) => {
                    const index = flatRows.findIndex(
                      (r) => r.kind === 'zone' && r.entry.zone === entry.zone,
                    )
                    return (
                      <li key={`zone-${entry.zone}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === highlightIndex}
                          onMouseEnter={() => setHighlightIndex(index)}
                          onClick={() => activateRow({ kind: 'zone', entry })}
                          style={{
                            background:
                              index === highlightIndex ? 'var(--map-surface-hover)' : 'transparent',
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12.5px]"
                        >
                          <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-[var(--map-fg-faint)]" />
                          {zoneTitleCase(entry.zone)}
                        </button>
                      </li>
                    )
                  })}
                </>
              )}
              {groups.map((group) => (
                <div key={group.layer}>
                  <li className="px-3 pt-1.5" style={{ color: 'var(--map-fg-faint)' }}>
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide">
                      {EVAC_LAYER_LABELS[group.layer as EvacKey] ?? group.layer}
                    </span>
                  </li>
                  {group.results.map((result) => {
                    const index = flatRows.findIndex(
                      (r) => r.kind === 'result' && r.layer === group.layer && r.result.id === result.id,
                    )
                    return (
                      <li key={`${group.layer}-${result.id}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === highlightIndex}
                          onMouseEnter={() => setHighlightIndex(index)}
                          onClick={() => activateRow({ kind: 'result', layer: group.layer, result })}
                          style={{
                            background:
                              index === highlightIndex ? 'var(--map-surface-hover)' : 'transparent',
                          }}
                          className="flex w-full cursor-pointer flex-col items-start px-3 py-1.5 text-left"
                        >
                          <span className="text-[12.5px]" style={{ color: 'var(--map-fg)' }}>
                            {result.label}
                          </span>
                          {(result.sublabel || result.sectorName) && (
                            <span className="text-[11px]" style={{ color: 'var(--map-fg-faint)' }}>
                              {[result.sublabel, result.sectorName].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </div>
              ))}
            </ul>
          )}
        </div>

        <Reveal index={0}>
          <div>
            <SectionLabel>Scenario</SectionLabel>
            <div className="flex gap-1.5">
              {(['all', 'Normal day', 'Peak day'] as const).map((option) => {
                const active = option === 'all' ? !evacFilters.plan : evacFilters.plan === option
                return (
                  <Chip key={option} active={active} onClick={() => togglePlan(option)}>
                    {option === 'all' ? 'All' : option}
                  </Chip>
                )
              })}
            </div>
          </div>
        </Reveal>

        <Reveal index={1}>
          <div>
            <SectionLabel>Direction</SectionLabel>
            <div className="flex gap-1.5">
              <Chip active={evacFilters.direction === 'Entry'} onClick={() => toggleDirection('Entry')}>
                Entry
              </Chip>
              <Chip active={evacFilters.direction === 'Exit'} onClick={() => toggleDirection('Exit')}>
                Exit
              </Chip>
            </div>
          </div>
        </Reveal>

        <Reveal index={2}>
          <div>
            <SectionLabel>Corridor</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {nonEmptyCorridors.map((corridor) => (
                <Chip
                  key={corridor}
                  active={Boolean(evacFilters.corridors?.includes(corridor))}
                  onClick={() => toggleCorridor(corridor)}
                >
                  {EVAC_CORRIDOR_LABELS[corridor]}
                </Chip>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal index={3}>
          <div>
            <SectionLabel>Evacuation layers</SectionLabel>
            {EVAC_CORE_KEYS.map((key) => (
              <LayerToggleRow
                key={key}
                evacKey={key}
                on={evacVisibility[key]}
                onToggle={() => onToggleLayer(key)}
              />
            ))}
          </div>
        </Reveal>
        <Reveal index={4}>
          <div>
            <SectionLabel>Supporting layers</SectionLabel>
            {EVAC_SUPPORT_KEYS.filter((k) => k !== 'zone_outline').map((key) => (
              <LayerToggleRow
                key={key}
                evacKey={key}
                on={evacVisibility[key]}
                onToggle={() => onToggleLayer(key)}
              />
            ))}
          </div>
        </Reveal>
        <Reveal index={5}>
          <div>
            <SectionLabel>Flood risk</SectionLabel>
            {EVAC_FLOOD_KEYS.map((key) => (
              <LayerToggleRow
                key={key}
                evacKey={key}
                on={evacVisibility[key]}
                onToggle={() => onToggleLayer(key)}
              />
            ))}
          </div>
        </Reveal>
        <Reveal index={6}>
          <div>
            <SectionLabel>Base layers</SectionLabel>
            {BASE_LAYER_ROWS.map(({ key, label, icon }) => (
              <BaseLayerRow
                key={key}
                icon={icon}
                label={label}
                on={mapVisibility[key]}
                onToggle={() => onToggleMapLayer(key)}
              />
            ))}
          </div>
        </Reveal>

        {filtersActive && (
          <button
            type="button"
            onClick={clearAll}
            className="cursor-pointer self-start text-[12.5px] font-semibold underline-offset-2 hover:underline"
            style={{ color: 'var(--map-accent)' }}
          >
            Clear all filters
          </button>
        )}
      </div>
    </Panel>
  )
}
