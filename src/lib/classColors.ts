// WCAG relative-luminance check to pick readable text (white vs near-black)
// against an arbitrary solid background colour -- used wherever a class's
// colour becomes a filled pill/background rather than just an accent dot.
export function readableTextOn(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  return luminance > 0.45 ? '#0f172a' : '#ffffff'
}

// A handful of seeded DB colours (ticket statuses/priorities/tags) sit right at
// readableTextOn's black/white threshold -- e.g. the "Resolved" status's #34d399 (luminance
// .496) narrowly resolves to dark text while every sibling status resolves to white, so a row
// of solid-fill status pills reads as an inconsistent mix of black and white labels even though
// each pill individually has fine contrast. This is a display-only fix (the DB value is left
// alone) that swaps a known light/borderline colour for a deliberately deepened shade in the
// same hue family before it ever reaches readableTextOn, so it reliably lands on the same side
// as the rest of the set. Keyed by the DB's exact stored hex; extend as new borderline colours
// turn up rather than trying to auto-darken everything (auto-darkening would shift hues that
// are already fine and don't need it).
const SOLID_FILL_COLOR_OVERRIDES: Record<string, string> = {
  '#34d399': '#047a54', // "Resolved" status -- matches statusSolidStyles.resolved in Badge.tsx
}

/** Resolves a DB-stored colour to the shade that should actually be used for a solid-fill pill
 *  background, applying SOLID_FILL_COLOR_OVERRIDES when the raw colour is a known borderline
 *  case. Pass the *result* of this to readableTextOn, not the raw DB colour, when rendering a
 *  solid fill (dot/tint usages are unaffected and can keep using the raw colour). */
export function solidFillColor(hex: string): string {
  return SOLID_FILL_COLOR_OVERRIDES[hex.toLowerCase()] ?? hex
}

// kumbh.sector_plan.class_group is now the raw "Class" column from the 2027
// gdb drop (scripts/load_kumbh_2027.py) rather than a bucketed value -- there
// are ~25 distinct classes, not the ~10 this map used to cover, so anything
// missing here silently fell through to the flat "Other" grey and (a) looked
// like a rendering bug (half the legend the same colour) and (b) made that
// grey the loudest thing on the map since it's paired with a near-white hex.
//
// Deliberately tiered by operational importance rather than given a uniform
// "give everything its own hue" palette, matching how the fill/outline
// treatment already separates "wash vs identity" (see SECTOR_FILL_OPACITY's
// note in MapView.tsx) -- a flat rainbow of 25 saturated hues would just
// recreate the "clashing sticker sheet" problem at a different opacity.
//
//   Tier 1 -- operationally critical, own vivid/distinct hue. These are the
//   classes someone is actually scanning the map *for* (medical response,
//   security, crowd routing, utilities), so each gets a hue no other class
//   in this file uses, at a saturation that reads as "signal" against the
//   dark basemap.
//   Tier 2 -- present but secondary. Distinct, but desaturated (~35-45%
//   less chroma than Tier 1) so an eye scanning for Tier 1 hues doesn't get
//   snagged on these.
//   Tier 3 -- terrain/context. Cool near-neutral slates differentiated only
//   by lightness, matching the basemap's blue-black cast instead of fighting
//   it. Two exceptions get a faint hue because they have an unambiguous
//   real-world colour that helps orientation at a glance: Green Area (moss)
//   and Waterbody (steel-blue) -- Ghat sits between the two (river-adjacent
//   but built, not water) so it stays neutral.
//
// Parking is Tier 3 by vividness (it shouldn't outshine anything above it)
// but gets its own dedicated slate-blue rather than sharing the plain grey
// used for Road/Pathway/etc -- it's the single largest class on the map by
// area (1042 parcels / ~365ha, see the Stats panel), and sharing a hue with
// terrain would make that much area read as unlabelled backdrop.
export const CLASS_GROUP_COLORS: Record<string, string> = {
  // Tier 1 -- operationally critical
  'Health Camping': '#ef4444',
  'Religious Camping': '#e07b39',
  'Police Camping': '#1d4ed8',
  'Administrative Camping': '#059669',
  Commercial: '#db2777',
  Amenities: '#f59e0b',
  'Reserved Area': '#a78bfa',

  // Tier 2 -- secondary, muted but distinct
  Sanitation: '#0d9488',
  Transport: '#7c6fd6',
  Utilities: '#ca8a04',
  'Media Camping': '#c026d3',
  'Other Camping': '#ea9a5e',
  Recreation: '#65a30d',
  Education: '#0891b2',
  Warehouses: '#a16207',
  'Existing Development': '#0ea5e9',

  // Tier 3 -- terrain/context, near-neutral
  Parking: '#5b6b8c',
  Road: '#6b7280',
  Pathway: '#6b7280',
  'Open Area': '#6b7280',
  'Low Lying Area': '#6b7280',
  'Hold-up Area': '#6b7280',
  'Unavailable Land': '#6b7280',
  Ghat: '#6b7280',
  'Green Area': '#4d7c5f',
  Waterbody: '#3f6b8c',

  Other: '#5b6472',
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
//
// Colours are drawn from the same tiered system as CLASS_GROUP_COLORS above
// (see that constant's comment for the tier rationale), and deliberately
// reuse its exact hex wherever a POI names the same real-world thing as a
// sector-plan class -- e.g. `sanitation` here is the identical teal as
// `Sanitation` there, `amenities` the identical amber as `Amenities` -- so a
// legend colour means the same thing whether you're looking at a filled
// parcel or a point marker. LINE_LAYER_COLORS and POLYGON_LAYER_COLORS below
// follow the same cross-reference rule; grep each hex to see every layer
// (point/line/polygon/class) sharing it.
export const POINT_LAYER_COLORS: Record<string, string> = {
  // Tier 1 -- operationally critical (matches CLASS_GROUP_COLORS' Tier 1
  // hues where the same real-world thing appears there)
  amenities: '#f59e0b', // = CLASS_GROUP_COLORS.Amenities
  fh_location: '#dc2626', // fire hydrants -- safety-critical, own vivid red distinct from Health Camping's #ef4444
  religious_place: '#e07b39', // = CLASS_GROUP_COLORS['Religious Camping']
  thematic_gate: '#e07b39', // crowd-routing signage for religious sites -- same family as religious_place
  // Brighter than a plain "green-600" (#16a34a, the original value here) --
  // entry/exit is a functionally important crowd-flow filter, and the
  // darker tone nearly disappeared against the near-black CARTO Dark Matter
  // dark-mode basemap. Shared by entry_exit/location_entry (points) and
  // entry_exit_line below as a deliberate "green = entry/exit" convention
  // across all three related layers.
  entry_exit: '#22c55e',
  location_entry: '#22c55e',

  // Tier 2 -- secondary, muted but distinct (matches CLASS_GROUP_COLORS'
  // Tier 2 hues for the same overlapping concepts)
  sanitation: '#0d9488', // = CLASS_GROUP_COLORS.Sanitation
  dustbins: '#3ba394', // sanitation-adjacent but a visibly separate shade so it doesn't read as identical to sanitation POIs
  transformer: '#ca8a04', // = CLASS_GROUP_COLORS.Utilities (HT power infrastructure)
  bus_stop: '#7c6fd6', // = CLASS_GROUP_COLORS.Transport
  bus_terminal_point: '#7c6fd6',
  other_transport_point: '#7c6fd6',
  railway_station: '#64748b',
  hotel: '#db2777', // = CLASS_GROUP_COLORS.Commercial (hospitality is a commercial use)
  landmark: '#a78bfa', // = CLASS_GROUP_COLORS['Reserved Area'] family -- notable/reserved point of interest
  ropeway: '#a78bfa',

  // Tier 3 -- terrain/context, near-neutral
  water_point: '#3f6b8c', // = CLASS_GROUP_COLORS.Waterbody
  kumbh_mela_2027_ghat: '#6b7280', // = CLASS_GROUP_COLORS.Ghat
  junction: '#6b7280',
  sector_point: '#6b7280',
  bridge_point: '#6b7280',
  parking: '#5b6b8c', // = CLASS_GROUP_COLORS.Parking
  peripheral_parking: '#5b6b8c',
}

export const POINT_LAYER_LABELS: Record<string, string> = {
  amenities: 'Amenities',
  bus_stop: 'Bus stops',
  dustbins: 'Dustbins',
  fh_location: 'Fire hydrants',
  kumbh_mela_2027_ghat: 'Ghat points (2027)',
  sanitation: 'Sanitation',
  transformer: 'Transformers',
  hotel: 'Hotels',
  railway_station: 'Railway stations',
  religious_place: 'Religious places',
  landmark: 'Landmarks',
  thematic_gate: 'Thematic gates',
  entry_exit: 'Entry / exit points',
  junction: 'Junctions',
  ropeway: 'Ropeway',
  parking: 'Parking (points)',
  peripheral_parking: 'Peripheral parking',
  water_point: 'Water points',
  sector_point: 'Sector points',
  bridge_point: 'Bridges (points)',
  bus_terminal_point: 'Bus terminal (point)',
  location_entry: 'Location entry markers',
  other_transport_point: 'Other transport (point)',
}

// Same tiered, cross-referenced palette as POINT_LAYER_COLORS above -- see
// that constant's comment.
export const LINE_LAYER_COLORS: Record<string, string> = {
  // Tier 1 -- operationally critical
  traffic_route: '#ef4444', // = CLASS_GROUP_COLORS['Health Camping'] -- emergency/priority vehicle routing
  entry_exit_line: '#22c55e', // matches POINT_LAYER_COLORS.entry_exit

  // Tier 2 -- secondary, muted but distinct
  ht_line: '#ca8a04', // = CLASS_GROUP_COLORS.Utilities / POINT_LAYER_COLORS.transformer
  water_line: '#3f6b8c', // = CLASS_GROUP_COLORS.Waterbody
  direction_line: '#7c6fd6', // = CLASS_GROUP_COLORS.Transport (wayfinding signage)
  railway_line: '#64748b', // matches POINT_LAYER_COLORS.railway_station
  bridge: '#a16207', // = CLASS_GROUP_COLORS.Warehouses family -- built infrastructure, distinct from the road/parking neutrals

  // Tier 3 -- terrain/context, near-neutral
  footpath: '#6b7280', // = CLASS_GROUP_COLORS.Pathway
  parking_line: '#5b6b8c', // = CLASS_GROUP_COLORS.Parking
  trench_line: '#6b7280',
  // Base OSM street network (21k+ nameless centrelines, see
  // PLAN-deferred-roads.md) -- Google Maps-style road blue, chosen so the
  // street network is actually visible rather than blending into the
  // basemap, while staying clearly distinct from the project road palette
  // (ROAD_TYPE_COLORS). This entry is a fallback/legend swatch only: MapView
  // special-cases tertiary_road's actual line paint with its own theme-aware
  // color/opacity (TERTIARY_ROAD_STYLE) because, unlike every other POI line
  // layer, one flat colour does not survive at this feature density in both
  // themes -- see the note on POI colours above POLYGON_LAYER_COLORS. Keep
  // this in sync with TERTIARY_ROAD_STYLE.light.color.
  tertiary_road: '#4285f4',
}

export const LINE_LAYER_LABELS: Record<string, string> = {
  bridge: 'Bridges',
  trench_line: 'Trench lines',
  railway_line: 'Railway lines',
  traffic_route: 'Traffic routes',
  ht_line: 'HT power lines',
  water_line: 'Water lines',
  direction_line: 'Direction signage',
  footpath: 'Footpaths',
  parking_line: 'Parking lines',
  entry_exit_line: 'Entry / exit routes',
  // "(OSM)" flags this as third-party base-map street data, not curated
  // project infrastructure -- the exact ambiguity Pending.md wanted avoided.
  tertiary_road: 'Street network (OSM)',
}

// Same tiered, cross-referenced palette as POINT_LAYER_COLORS above -- see
// that constant's comment.
export const POLYGON_LAYER_COLORS: Record<string, string> = {
  // Tier 1 -- operationally critical
  public_service_facilities: '#ef4444', // = CLASS_GROUP_COLORS['Health Camping']
  ashram: '#e07b39', // = CLASS_GROUP_COLORS['Religious Camping'] / POINT_LAYER_COLORS.religious_place
  tentcity: '#e07b39', // pilgrim camping -- same religious-camping family as ashram

  // Tier 2 -- secondary, muted but distinct
  bus_terminal: '#7c6fd6', // = CLASS_GROUP_COLORS.Transport
  other_transport: '#7c6fd6',
  railway_station_area: '#64748b', // matches POINT_LAYER_COLORS.railway_station
  ht_line_buffer: '#ca8a04', // = CLASS_GROUP_COLORS.Utilities / LINE_LAYER_COLORS.ht_line
  ropeway_area: '#a78bfa', // matches POINT_LAYER_COLORS.ropeway
  kumbh_land: '#059669', // = CLASS_GROUP_COLORS['Administrative Camping'] -- designated event-managed land

  // Tier 3 -- terrain/context, near-neutral
  core_parking: '#5b6b8c', // = CLASS_GROUP_COLORS.Parking
  ghat_area: '#6b7280', // = CLASS_GROUP_COLORS.Ghat
  river: '#3f6b8c', // = CLASS_GROUP_COLORS.Waterbody
  dam: '#3f6b8c',
  landuse: '#6b7280',
  uk_district_boundary: '#6b7280',
}

export const POLYGON_LAYER_LABELS: Record<string, string> = {
  ashram: 'Ashrams',
  bus_terminal: 'Bus terminals',
  core_parking: 'Core parking',
  ghat_area: 'Ghat areas',
  kumbh_land: 'Kumbh land',
  public_service_facilities: 'Public service facilities',
  river: 'River',
  railway_station_area: 'Railway station areas',
  tentcity: 'Tent city',
  ht_line_buffer: 'HT line buffer zones',
  landuse: 'Land use',
  dam: 'Dams',
  uk_district_boundary: 'District boundary',
  ropeway_area: 'Ropeway areas',
  other_transport: 'Other transport',
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
