// Evacuation mode's filter state and (from Phase 3) the MapLibre filter-expression builders that
// apply it to the evac-* layers. See PLAN-evacuation.md §5.1 (state), §6.3 (map filters).

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
