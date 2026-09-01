// Matches kumbh.sector_plan.class_group buckets produced by the loader
// (Dashboard/scripts/load_kumbh.py) — top classes get their own colour,
// the long tail is bucketed into "Other".
export const CLASS_GROUP_COLORS: Record<string, string> = {
  'Religious Camping': '#e07b39',
  Parking: '#6b7280',
  'Police Camping': '#1d4ed8',
  'Reserved Area': '#a78bfa',
  'Administrative Camping': '#059669',
  Commercial: '#db2777',
  Amenities: '#f59e0b',
  'Health Camping': '#ef4444',
  Road: '#78716c',
  'Existing Development': '#0ea5e9',
  Other: '#cbd5e1',
}

export const ROAD_TYPE_COLORS: Record<string, string> = {
  'Existing Road': '#9ca3af',
  'Proposed Road': '#2563eb',
  'Emergency Exit': '#dc2626',
}

export const ROAD_TYPE_DASH: Record<string, [number, number] | undefined> = {
  'Existing Road': undefined,
  'Proposed Road': [2, 2],
  'Emergency Exit': [1, 1],
}

// Point-of-interest layers loaded from the Aug 2026 JSON drop
// (Dashboard/scripts/load_kumbh_json_layers.py). Each gets one fixed
// marker colour so they read as distinct categories on the map.
export const POINT_LAYER_COLORS: Record<string, string> = {
  amenities: '#f59e0b',
  bus_stop: '#2563eb',
  dustbins: '#65a30d',
  fh_location: '#dc2626',
  kumbh_mela_2027_ghat: '#0ea5e9',
  sanitation: '#7c3aed',
  transformer: '#ea580c',
}

export const POINT_LAYER_LABELS: Record<string, string> = {
  amenities: 'Amenities',
  bus_stop: 'Bus stops',
  dustbins: 'Dustbins',
  fh_location: 'Fire hydrants',
  kumbh_mela_2027_ghat: 'Ghat points (2027)',
  sanitation: 'Sanitation',
  transformer: 'Transformers',
}

export const LINE_LAYER_COLORS: Record<string, string> = {
  bridge: '#78350f',
  trench_line: '#57534e',
}

export const LINE_LAYER_LABELS: Record<string, string> = {
  bridge: 'Bridges',
  trench_line: 'Trench lines',
}

export const POLYGON_LAYER_COLORS: Record<string, string> = {
  ashram: '#db2777',
  bus_terminal: '#2563eb',
  core_parking: '#6b7280',
  ghat_area: '#d97706',
  kumbh_land: '#059669',
  public_service_facilities: '#ef4444',
  river: '#1d4ed8',
}

export const POLYGON_LAYER_LABELS: Record<string, string> = {
  ashram: 'Ashrams',
  bus_terminal: 'Bus terminals',
  core_parking: 'Core parking',
  ghat_area: 'Ghat areas',
  kumbh_land: 'Kumbh land',
  public_service_facilities: 'Public service facilities',
  river: 'River',
}

// Short signage codes shown as an on-map text label for a few POI point
// layers, in place of the usual colour dot -- kept alongside the colour/label
// maps above so every place a POI's dot swatch renders (map markers, the
// Layers panel, the Stats panel) can consistently swap in the same badge.
export const POI_SIGNAGE_CODES: Record<string, string> = {
  bus_stop: 'BS',
  kumbh_mela_2027_ghat: 'G',
  fh_location: 'FH',
}
