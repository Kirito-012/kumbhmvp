// Evacuation mode's filter state and the MapLibre filter-expression builders that apply it to the
// evac-* layers. See PLAN-evacuation.md §5.1 (state), §6.3 (map filters).

import type { FilterSpecification } from 'maplibre-gl'

/** The three corridors with any real `traffic_route` rows -- Najibabad has none (checked
 *  2026-09-15, see PLAN-evacuation.md §2.2), so it's never offered as a chip. */
export type EvacCorridor = 'deh_dir' | 'sah_dir' | 'meer_dir'

export const EVAC_CORRIDOR_LABELS: Record<EvacCorridor, string> = {
  deh_dir: 'Dehradun',
  sah_dir: 'Saharanpur',
  meer_dir: 'Meerut',
}

/** No `weekend`/`normal` chip -- those traffic_route flags are effectively unpopulated (all 0
 *  except one row), so `plan` is the only scenario filter the data actually supports. */
export type EvacPlan = 'Normal day' | 'Peak day'

/** `direction` mirrors the `entry_exit`/`entry_exit_line`/`traffic_route`/`direction_line` values
 *  each table already uses ('Entry'/'Exit', or 'ENTRY'/'EXIT' for direction_line -- normalised by
 *  labels.ts, added in Phase 3). */
export type EvacDirection = 'Entry' | 'Exit'

export type EvacFilters = {
  plan?: EvacPlan
  direction?: EvacDirection
  corridors?: EvacCorridor[]
}

export function isEvacFiltersEmpty(filters: EvacFilters): boolean {
  return !filters.plan && !filters.direction && !(filters.corridors && filters.corridors.length > 0)
}

// --- Map filter builders (PLAN-evacuation.md §6.3) --------------------------------------------
//
// These key by DATA layer (the same keys evacLayers.ts's LAYERS_BY_KEY uses), not by the exact
// evac-* MapLibre layer id -- keeps this module testable with no maplibre-gl runtime, and lets
// the caller (evacLayers.ts) decide which of a data layer's several evac-* layers each filter
// actually applies to.
//
// `direction` and `corridors` become real `setFilter` expressions, ANDed onto each affected
// layer's own base filter. `plan` does NOT -- traffic routes are already split into 2 separate
// layers by plan (evac-traffic-route-peak/-normal, see evacLayers.ts §6.2 item 4, because a
// data-driven line-dasharray isn't reliable in MapLibre 6.4), so a plan selection is a visibility
// choice between those two layers, not a filter -- see trafficRoutePlanVisible below.

/** Layers whose underlying table has a direction-bearing column, and which column/casing. */
const DIRECTION_FIELDS = {
  traffic_route: { field: 'entry_exit', upcase: false },
  entry_exit_line: { field: 'remark', upcase: false },
  entry_exit: { field: 'remark', upcase: false },
  direction_line: { field: 'remark', upcase: true },
} as const

export type EvacFilterableKey = keyof typeof DIRECTION_FIELDS

function directionFilterFor(key: EvacFilterableKey, direction: EvacDirection): FilterSpecification {
  const { field, upcase } = DIRECTION_FIELDS[key]
  const value = upcase ? direction.toUpperCase() : direction
  const getField = upcase ? (['upcase', ['get', field]] as const) : (['get', field] as const)
  return ['==', getField, value] as unknown as FilterSpecification
}

/** `traffic_route`'s own `*_dir` corridor flags -- true if ANY selected corridor's flag is 1.
 *  Only traffic_route has these columns, so this never applies to any other layer. */
export function corridorFilterExpr(corridors: EvacCorridor[]): FilterSpecification | null {
  if (corridors.length === 0) return null
  return ['any', ...corridors.map((c) => ['==', ['get', c], 1])] as unknown as FilterSpecification
}

/** One filter fragment per direction/corridor-bearing data layer, ANDed with `baseFilter` (the
 *  layer's own permanent filter, e.g. traffic_route's plan split, or `null` for a layer with no
 *  base filter of its own). Returns `null` when nothing should be added (both empty), meaning
 *  the caller should leave the layer's existing filter alone. Layers with no entry here
 *  (emergency_exit, hfl_area, hfl_line, the supporting POI layers, ...) have nothing in the data
 *  for these two filters to act on. */
export function buildEvacFilters(
  filters: EvacFilters,
  baseFilters: Partial<Record<EvacFilterableKey, FilterSpecification | null>> = {},
): Partial<Record<EvacFilterableKey, FilterSpecification | null>> {
  const result: Partial<Record<EvacFilterableKey, FilterSpecification | null>> = {}
  const corridorExpr = filters.corridors?.length ? corridorFilterExpr(filters.corridors) : null

  for (const key of Object.keys(DIRECTION_FIELDS) as EvacFilterableKey[]) {
    const parts: FilterSpecification[] = []
    const base = baseFilters[key]
    if (base) parts.push(base)
    if (filters.direction) parts.push(directionFilterFor(key, filters.direction))
    // Corridor flags only exist on traffic_route -- applying them to any other layer's `get`
    // would just always evaluate false there (harmless, but pointless), so it's scoped here.
    if (key === 'traffic_route' && corridorExpr) parts.push(corridorExpr)

    result[key] =
      parts.length === 0 ? (base ?? null) : parts.length === 1 ? parts[0] : (['all', ...parts] as unknown as FilterSpecification)
  }
  return result
}

/** Whether traffic_route's `plan`-split layer (`'Peak day' | 'Normal day'`) should be visible
 *  given the current plan filter -- see this section's own intro comment on why plan is a
 *  visibility choice between 2 layers rather than a filter. `undefined` (no filter selected)
 *  shows both. */
export function trafficRoutePlanVisible(layerPlan: EvacPlan, filters: EvacFilters): boolean {
  return !filters.plan || filters.plan === layerPlan
}
