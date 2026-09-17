// Turns a raw evacuation-layer row (as returned by the tiles/locate routes or
// /api/evacuation/search) into a human-readable {label, sublabel} pair -- see
// PLAN-evacuation.md §8.1. Traffic route names are especially messy (null on half the rows,
// inconsistent case on the rest -- see CONTEXT.md §10/PLAN-evacuation.md §2.2), so nothing in the
// search UI or a popup shows a raw column value directly; everything goes through one of these.

export type LabelPair = { label: string; sublabel: string | null }

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

/** 'Entry'/'Exit' (entry_exit, entry_exit_line, traffic_route's entry_exit column) or
 *  'ENTRY'/'EXIT' (direction_line's own remark, which is upper-cased) -- normalised to the same
 *  title-case word either way, so a label never shows shouting-case text. */
function normalizeDirection(raw: string | null | undefined): 'Entry' | 'Exit' | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  if (upper === 'ENTRY') return 'Entry'
  if (upper === 'EXIT') return 'Exit'
  return null
}

const CORRIDOR_FLAG_LABELS: [flag: 'deh_dir' | 'naj_dir' | 'sah_dir' | 'meer_dir', name: string][] = [
  ['deh_dir', 'Dehradun'],
  ['naj_dir', 'Najibabad'],
  ['sah_dir', 'Saharanpur'],
  ['meer_dir', 'Meerut'],
]

/** kumbh.traffic_route -- name is null on ~half the rows and inconsistent case on the rest
 *  ("Entry"/"entry"/"Peak day Entry"/...), so the label is always *built* from the structured
 *  entry_exit/plan/corridor columns, never the raw name -- see PLAN-evacuation.md §2.2/§8.1's
 *  "Entry route" / "Peak day · Saharanpur corridor" example. */
export function trafficRouteLabel(row: {
  entry_exit?: string | null
  plan?: string | null
  deh_dir?: number | null
  naj_dir?: number | null
  sah_dir?: number | null
  meer_dir?: number | null
}): LabelPair {
  const direction = normalizeDirection(row.entry_exit)
  const label = direction ? `${direction} route` : 'Traffic route'
  const corridors = CORRIDOR_FLAG_LABELS.filter(([flag]) => row[flag] === 1).map(([, name]) => name)
  const parts = [row.plan ? row.plan : null, corridors.length ? `${corridors.join('/')} corridor` : null]
    .filter((p): p is string => Boolean(p))
  return { label, sublabel: parts.length ? parts.join(' · ') : null }
}

/** kumbh.direction_line -- remark is 'ENTRY'/'EXIT' for the 89 wayfinding signs, or free-text
 *  destination text ("TO DELHI NH 334", "HARIDWAR NH334") for the 4 destination signs. */
export function directionLineLabel(row: { remark?: string | null; sector?: string | null }): LabelPair {
  const direction = normalizeDirection(row.remark)
  if (direction) return { label: `${direction} signage`, sublabel: row.sector ?? null }
  const text = row.remark?.trim()
  return { label: text ? titleCase(text) : 'Direction signage', sublabel: row.sector ?? null }
}

/** kumbh.entry_exit / kumbh.entry_exit_line -- remark is a plain 'Entry'/'Exit'. */
export function entryExitLabel(
  row: { remark?: string | null; sector?: string | null },
  kind: 'point' | 'route',
): LabelPair {
  const direction = normalizeDirection(row.remark)
  const noun = kind === 'point' ? 'point' : 'route'
  return {
    label: direction ? `${direction} ${noun}` : `Entry/exit ${noun}`,
    sublabel: row.sector ?? null,
  }
}

/** kumbh.location_entry -- just a name, no direction. */
export function locationEntryLabel(row: { name?: string | null }): LabelPair {
  return { label: row.name?.trim() || 'Location entry', sublabel: null }
}

/** kumbh.emergency_exit -- road_name is always "Pathway" (see CONTEXT.md §10), so the sector is
 *  the only thing that actually distinguishes one row from another in a list. */
export function emergencyExitLabel(row: {
  sector_name?: string | null
  sector_no?: number | null
}): LabelPair {
  const sector = row.sector_name ?? (row.sector_no != null ? `Sector ${row.sector_no}` : null)
  return { label: 'Emergency exit', sublabel: sector }
}

/** kumbh.public_service_facilities -- e.g. "AIIMS Hospital" / "960 beds", "CHC Bahadrabad" /
 *  "Community Health Centre". See PLAN-evacuation.md §8.1. */
export function facilityLabel(row: {
  name?: string | null
  type?: string | null
  category?: string | null
  bed?: string | null
}): LabelPair {
  const label = row.name?.trim() || row.type || 'Facility'
  const parts = [row.category, row.bed ? `${row.bed} beds` : null].filter(
    (p): p is string => Boolean(p),
  )
  return { label, sublabel: parts.length ? parts.join(' · ') : (row.type ?? null) }
}

/** kumbh.hfl_area -- name is a sector name like "KANKHAL-10", already shouting-case. */
export function hflAreaLabel(row: { name?: string | null; sector_no?: number | null }): LabelPair {
  const raw = row.name?.trim()
  const label = raw ? titleCase(raw.replace(/-\d+$/, '')) : 'Flood risk area'
  return { label: `${label} flood risk area`, sublabel: row.sector_no != null ? `Sector ${row.sector_no}` : null }
}

/** kumbh.hfl_line -- name is e.g. "25 Y RB"; return_period_years/bank are already parsed out at
 *  load time (see scripts/load_kumbh_2027.py's _parse_hfl_line_name). */
const BANK_LABELS: Record<string, string> = { LB: 'left bank', RB: 'right bank' }
export function hflLineLabel(row: {
  return_period_years?: number | null
  bank?: string | null
}): LabelPair {
  const years = row.return_period_years
  const label = years ? `${years}-year flood line` : 'Flood line'
  return { label, sublabel: row.bank ? BANK_LABELS[row.bank] : null }
}

/** Plain name+remark layers with nothing more structured to say -- thematic_gate/junction/bridge/
 *  fh_location and anything else this simple. */
export function genericLabel(
  row: { name?: string | null; remark?: string | null; fh_name?: string | null },
  fallback: string,
): LabelPair {
  const label = row.name?.trim() || row.fh_name?.trim() || row.remark?.trim() || fallback
  const sublabel = row.name && row.remark ? row.remark : null
  return { label, sublabel }
}
