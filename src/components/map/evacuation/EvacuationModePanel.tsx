'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Panel from '@/components/map/Panel'
import {
  EvacuationIcon,
  GridIcon,
  LayersIcon,
  MapPinIcon,
  ParcelIcon,
  TagIcon,
  XIcon,
} from '@/components/map/icons'
import { Reveal } from '@/components/map/insights/charts'
import SearchInput from '@/components/map/search/SearchInput'
import SearchGroupHeader from '@/components/map/search/SearchGroupHeader'
import SearchResultRow from '@/components/map/search/SearchResultRow'
import {
  EVAC_ALL_KEYS,
  EVAC_CORE_KEYS,
  EVAC_FLOOD_KEYS,
  EVAC_LAYER_LABELS,
  EVAC_SHP_SOURCED_KEYS,
  EVAC_SUPPORT_KEYS,
  type EvacKey,
} from '@/lib/evacuation/layers'
import {
  ENTRY_EXIT_CATEGORIES,
  ENTRY_EXIT_CATEGORY_LABELS,
  EVAC_CORRIDOR_LABELS,
  isEvacFiltersEmpty,
  type EntryExitCategory,
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
          style={{ backgroundColor: on ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
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
          style={{ backgroundColor: on ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
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
        backgroundColor: active ? 'var(--map-accent)' : 'var(--map-input-bg)',
        color: active ? 'var(--map-accent-on-fg)' : 'var(--map-fg-muted)',
      }}
      className="cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
    >
      {children}
    </button>
  )
}

/**
 * Left-docked panel for Evacuation mode -- search, scenario/direction/corridor filters, and
 * layer toggles (PLAN-evacuation.md §7.2). The search input, group headers, and result rows use
 * the shared `src/components/map/search/*` components (§7.1/§13's post-launch follow-up) --
 * Map mode's own search still has its own bespoke rendering for the pieces that don't have a
 * clean shared shape (the sector-classes/POI subclass trees, the "Jump to sector" rows), but the
 * input chrome and group-header styling now come from the same components. The keyboard-nav
 * state machine (highlightIndex/flatRows/activateRow) and the actual query matching stay entirely
 * local to this file -- only the presentational leaf pieces moved.
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
  corridorCounts,
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
  /** From the same /api/evacuation/summary fetch EvacuationPanel uses (lifted to MapView) --
   *  null until it resolves, in which case the Corridor chips just show no count yet. */
  corridorCounts: { deh_dir: number; sah_dir: number; meer_dir: number } | null
  forceCollapsed?: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onWidthChange?: (width: number) => void
}) {
  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownContainerRef = useRef<HTMLDivElement>(null)
  const { groups, loading, error } = useEvacuationSearch(query)
  // Same browsable-catalogue pattern as Map mode's own unified search (MapView's
  // searchGroups/collapsedGroups/isGroupCollapsed): the dropdown opens on focus/click even with
  // an empty query and lists every layer catalogue group, collapsed or expanded per this set.
  // "Evacuation layers" (the 6 core, on-by-default keys) starts expanded since it's what most
  // sessions actually touch; the other 3 -- the ~14 mostly-off toggles that made the panel a long
  // scroll (the original complaint) -- start collapsed.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(['Supporting layers', 'Flood risk', 'Base layers']),
  )
  function toggleCollapsedGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  // Closes the dropdown on an outside click -- needed now that it opens on focus/empty-query
  // browse (not just while actively typing a non-empty query), same as MapView's own
  // searchDropdownRef/onPointerDown pair for its unified search.
  useEffect(() => {
    if (!dropdownOpen) return
    function onPointerDown(e: PointerEvent) {
      if (!dropdownContainerRef.current?.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [dropdownOpen])

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

  // Layer catalogue, browsable inside the dropdown exactly like Map mode's own "Sector classes" /
  // "Roads" / "POI layers" groups -- an empty query shows every layer (collapsed per
  // collapsedGroups), a non-empty one narrows each group down to matching labels and force-
  // expands every group that still has a match (same isGroupCollapsed rule MapView uses).
  function matchesLabel(label: string): boolean {
    return trimmed === '' || label.toLowerCase().includes(trimmed)
  }
  const visibleCoreKeys = EVAC_CORE_KEYS.filter((key) => matchesLabel(EVAC_LAYER_LABELS[key]))
  const visibleSupportKeys = EVAC_SUPPORT_KEYS.filter((key) => matchesLabel(EVAC_LAYER_LABELS[key]))
  const visibleFloodKeys = EVAC_FLOOD_KEYS.filter((key) => matchesLabel(EVAC_LAYER_LABELS[key]))
  const visibleBaseLayers = BASE_LAYER_ROWS.filter((b) => matchesLabel(b.label))

  type CatalogGroupName = 'Evacuation layers' | 'Supporting layers' | 'Flood risk' | 'Base layers'
  const catalogGroups: Array<{ group: CatalogGroupName; rows: number }> = []
  if (visibleCoreKeys.length > 0)
    catalogGroups.push({ group: 'Evacuation layers', rows: visibleCoreKeys.length })
  if (visibleSupportKeys.length > 0)
    catalogGroups.push({ group: 'Supporting layers', rows: visibleSupportKeys.length })
  if (visibleFloodKeys.length > 0)
    catalogGroups.push({ group: 'Flood risk', rows: visibleFloodKeys.length })
  if (visibleBaseLayers.length > 0)
    catalogGroups.push({ group: 'Base layers', rows: visibleBaseLayers.length })

  const catalogGroupIcon: Record<CatalogGroupName, typeof ParcelIcon> = {
    'Evacuation layers': EvacuationIcon,
    'Supporting layers': LayersIcon,
    'Flood risk': GridIcon,
    'Base layers': ParcelIcon,
  }
  const catalogGroupTheme: Record<CatalogGroupName, 'blue' | 'teal' | 'amber' | 'violet'> = {
    'Evacuation layers': 'violet',
    'Supporting layers': 'amber',
    'Flood risk': 'blue',
    'Base layers': 'teal',
  }
  function isGroupCollapsed(group: string): boolean {
    // While actively searching, every matching group is always expanded -- collapsedGroups only
    // governs the empty-query browse view. Matches MapView's own isGroupCollapsed exactly.
    return trimmed === '' && collapsedGroups.has(group)
  }
  function selectAllKeys(keys: readonly EvacKey[]) {
    for (const key of keys) if (!evacVisibility[key]) onToggleLayer(key)
  }
  function selectAllBaseLayers() {
    for (const b of BASE_LAYER_ROWS) if (!mapVisibility[b.key]) onToggleMapLayer(b.key)
  }

  // Every layer that's currently ON, across all 4 catalogue groups -- rendered as a removable
  // chip row right under the search box so "what's currently showing on the map" is visible at a
  // glance without opening the dropdown. Includes the 6 core "Evacuation layers" too (on by
  // default): the point is a complete, at-a-glance picture of what's active, not just what the
  // user changed from default.
  const activeLayers: Array<{ key: string; label: string; onToggle: () => void }> = [
    ...EVAC_CORE_KEYS.filter((key) => evacVisibility[key]).map((key) => ({
      key,
      label: EVAC_LAYER_LABELS[key],
      onToggle: () => onToggleLayer(key),
    })),
    ...EVAC_SUPPORT_KEYS.filter((key) => evacVisibility[key]).map((key) => ({
      key,
      label: EVAC_LAYER_LABELS[key],
      onToggle: () => onToggleLayer(key),
    })),
    ...EVAC_FLOOD_KEYS.filter((key) => evacVisibility[key]).map((key) => ({
      key,
      label: EVAC_LAYER_LABELS[key],
      onToggle: () => onToggleLayer(key),
    })),
    ...BASE_LAYER_ROWS.filter((b) => mapVisibility[b.key]).map((b) => ({
      key: b.key,
      label: b.label,
      onToggle: () => onToggleMapLayer(b.key),
    })),
  ]

  const flatRows: FlatRow[] = [
    ...matchedSectors.map((sector): FlatRow => ({ kind: 'sector', sector })),
    ...matchedZones.map((entry): FlatRow => ({ kind: 'zone', entry })),
    ...groups.flatMap((g) =>
      g.results.map((result): FlatRow => ({ kind: 'result', layer: g.layer, result })),
    ),
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
  // "Solo" click behaviour: clicking a category that's already active while more than one is
  // active isolates it (e.g. starting from the all-3-active default, one click narrows to just
  // that category) -- clicking an inactive category instead ADDS it, so a soloed selection can be
  // built back up into a multi-select one click at a time. Clicking the one remaining active
  // category deselects it (shows nothing), same as a plain toggle would.
  function toggleEntryExitCategory(category: EntryExitCategory) {
    const current = evacFilters.entryExitCategories ?? ENTRY_EXIT_CATEGORIES
    const isActive = current.includes(category)
    const next = isActive
      ? current.length > 1
        ? [category]
        : current.filter((c) => c !== category)
      : [...current, category]
    onFiltersChange({ ...evacFilters, entryExitCategories: next })
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
        <div ref={dropdownContainerRef} className="relative">
          <SearchInput
            ref={inputRef}
            value={query}
            onChange={(value) => {
              setQuery(value)
              setDropdownOpen(true)
              setHighlightIndex(0)
            }}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={onInputKeyDown}
            placeholder="What do you want to see?"
            ariaLabel="Search evacuation layers, sectors and zones"
            combobox={{
              expanded: dropdownOpen,
              controls: 'evac-search-listbox',
              activeDescendant:
                dropdownOpen && flatRows[highlightIndex]
                  ? `evac-option-${highlightIndex}`
                  : undefined,
            }}
            onClear={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          />
          {/* Collapsed, the panel is just a placeholder and 3 filter-chip rows below, which
              advertises none of the 15 layers actually behind it. Same "name the catalogue"
              affordance as MapView's own unified search hint line. */}
          {!dropdownOpen && !query && (
            <button
              type="button"
              onClick={() => setDropdownOpen(true)}
              style={{ color: 'var(--map-fg-faint)' }}
              className="mt-1.5 w-full cursor-pointer px-1 text-left text-[11px] hover:text-[var(--map-fg-muted)]"
            >
              {sectors.length} sectors · {EVAC_ALL_KEYS.length + BASE_LAYER_ROWS.length} layers
            </button>
          )}

          {dropdownOpen && (
            <ul
              id="evac-search-listbox"
              role="listbox"
              aria-label="Search results"
              style={{ borderColor: 'var(--map-border)', backgroundColor: 'var(--map-surface)' }}
              className="kumbh-scroll absolute z-10 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border py-1 shadow-lg"
            >
              {loading && flatRows.length === 0 && (
                <li role="presentation" className="relative h-1 overflow-hidden">
                  <div className="absolute inset-y-0 w-1/3 animate-[loading-sweep_1.1s_ease-in-out_infinite] rounded-full bg-[var(--map-accent)]" />
                </li>
              )}
              {error && (
                <li
                  role="presentation"
                  className="px-3 py-2 text-[12px]"
                  style={{ color: 'var(--danger)' }}
                >
                  {error}
                </li>
              )}
              {!loading &&
                !error &&
                trimmed !== '' &&
                flatRows.length === 0 &&
                catalogGroups.length === 0 && (
                  <li
                    role="presentation"
                    className="px-3 py-3 text-[12.5px]"
                    style={{ color: 'var(--map-fg-faint)' }}
                  >
                    No matches for &ldquo;{query}&rdquo;
                  </li>
                )}
              {catalogGroups.map(({ group, rows }) => {
                const collapsed = isGroupCollapsed(group)
                return (
                  <li key={group} role="presentation">
                    <SearchGroupHeader
                      label={group}
                      icon={catalogGroupIcon[group]}
                      theme={catalogGroupTheme[group]}
                      count={rows}
                      collapsed={collapsed}
                      onToggleCollapsed={() => toggleCollapsedGroup(group)}
                      onSelectAll={
                        group === 'Evacuation layers'
                          ? () => selectAllKeys(visibleCoreKeys)
                          : group === 'Supporting layers'
                            ? () => selectAllKeys(visibleSupportKeys)
                            : group === 'Flood risk'
                              ? () => selectAllKeys(visibleFloodKeys)
                              : selectAllBaseLayers
                      }
                    />
                    {!collapsed && group === 'Base layers' && (
                      <ul>
                        {visibleBaseLayers.map((b) => (
                          <li key={b.key} className="px-3">
                            <BaseLayerRow
                              icon={b.icon}
                              label={b.label}
                              on={mapVisibility[b.key]}
                              onToggle={() => onToggleMapLayer(b.key)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                    {!collapsed && group !== 'Base layers' && (
                      <ul>
                        {(group === 'Evacuation layers'
                          ? visibleCoreKeys
                          : group === 'Supporting layers'
                            ? visibleSupportKeys
                            : visibleFloodKeys
                        ).map((key) => (
                          <li key={key} className="px-3">
                            <LayerToggleRow
                              evacKey={key}
                              on={evacVisibility[key]}
                              onToggle={() => onToggleLayer(key)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
              {matchedSectors.length > 0 && (
                <>
                  <li role="presentation">
                    <SearchGroupHeader
                      label="Jump to sector"
                      icon={MapPinIcon}
                      theme="blue"
                      count={matchedSectors.length}
                    />
                  </li>
                  {matchedSectors.map((sector) => {
                    const index = flatRows.findIndex(
                      (r) => r.kind === 'sector' && r.sector.sector_no === sector.sector_no,
                    )
                    return (
                      <li key={`sector-${sector.sector_no}`}>
                        <SearchResultRow
                          id={`evac-option-${index}`}
                          label={formatSectorLabel(sector)}
                          icon={MapPinIcon}
                          highlighted={index === highlightIndex}
                          onMouseEnter={() => setHighlightIndex(index)}
                          onClick={() => activateRow({ kind: 'sector', sector })}
                        />
                      </li>
                    )
                  })}
                </>
              )}
              {matchedZones.length > 0 && (
                <>
                  <li role="presentation">
                    <SearchGroupHeader
                      label="Zones"
                      icon={MapPinIcon}
                      theme="teal"
                      count={matchedZones.length}
                    />
                  </li>
                  {matchedZones.map((entry) => {
                    const index = flatRows.findIndex(
                      (r) => r.kind === 'zone' && r.entry.zone === entry.zone,
                    )
                    return (
                      <li key={`zone-${entry.zone}`}>
                        <SearchResultRow
                          id={`evac-option-${index}`}
                          label={zoneTitleCase(entry.zone)}
                          icon={MapPinIcon}
                          highlighted={index === highlightIndex}
                          onMouseEnter={() => setHighlightIndex(index)}
                          onClick={() => activateRow({ kind: 'zone', entry })}
                        />
                      </li>
                    )
                  })}
                </>
              )}
              {groups.map((group) => (
                <Fragment key={group.layer}>
                  <li role="presentation">
                    <SearchGroupHeader
                      label={EVAC_LAYER_LABELS[group.layer as EvacKey] ?? group.layer}
                      icon={MapPinIcon}
                      theme="violet"
                      count={group.results.length}
                    />
                  </li>
                  {group.results.map((result) => {
                    const index = flatRows.findIndex(
                      (r) =>
                        r.kind === 'result' && r.layer === group.layer && r.result.id === result.id,
                    )
                    return (
                      <li key={`${group.layer}-${result.id}`}>
                        <SearchResultRow
                          id={`evac-option-${index}`}
                          label={result.label}
                          sublabel={
                            [result.sublabel, result.sectorName].filter(Boolean).join(' · ') || null
                          }
                          highlighted={index === highlightIndex}
                          onMouseEnter={() => setHighlightIndex(index)}
                          onClick={() =>
                            activateRow({ kind: 'result', layer: group.layer, result })
                          }
                        />
                      </li>
                    )
                  })}
                </Fragment>
              ))}
            </ul>
          )}
        </div>

        {activeLayers.length > 0 && (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {activeLayers.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={l.onToggle}
                title={`Hide ${l.label}`}
                style={{ backgroundColor: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[11.5px] font-medium transition-colors hover:brightness-95"
              >
                <span className="max-w-[9rem] truncate">{l.label}</span>
                <XIcon className="h-2.5 w-2.5 shrink-0" />
              </button>
            ))}
          </div>
        )}

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
              <Chip
                active={evacFilters.direction === 'Entry'}
                onClick={() => toggleDirection('Entry')}
              >
                Entry
              </Chip>
              <Chip
                active={evacFilters.direction === 'Exit'}
                onClick={() => toggleDirection('Exit')}
              >
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
                  {corridorCounts && ` (${corridorCounts[corridor]})`}
                </Chip>
              ))}
            </div>
          </div>
        </Reveal>

        {evacVisibility.entry_exit && (
          <Reveal index={3}>
            <div>
              <SectionLabel>Entry/exit points</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {ENTRY_EXIT_CATEGORIES.map((category) => (
                  <Chip
                    key={category}
                    active={(evacFilters.entryExitCategories ?? ENTRY_EXIT_CATEGORIES).includes(
                      category,
                    )}
                    onClick={() => toggleEntryExitCategory(category)}
                  >
                    {ENTRY_EXIT_CATEGORY_LABELS[category]}
                    {category !== 'kumbh' && ' (no data yet)'}
                  </Chip>
                ))}
              </div>
            </div>
          </Reveal>
        )}

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
