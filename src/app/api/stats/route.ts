import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'
import { GIS_CACHE_HEADERS } from '@/server/http/cache'

export const runtime = 'nodejs'

// POI layers loaded from the Aug 2026 JSON drop (scripts/load_kumbh_json_layers.py).
// Most don't carry a reliable numeric sector_no, so per-sector counts are
// computed spatially (ST_Intersects against sector_boundary) rather than by
// joining on an attribute column.
const POI_TABLES = [
  'amenities',
  'ashram',
  'bridge',
  'bus_stop',
  'bus_terminal',
  'core_parking',
  'dustbins',
  'fh_location',
  'ghat_area',
  'kumbh_mela_2027_ghat',
  'kumbh_land',
  'public_service_facilities',
  'river',
  'sanitation',
  'transformer',
  'trench_line',
  // Added with the 2027 gdb refresh (load_kumbh_2027.py).
  'hotel',
  'railway_line',
  'railway_station',
  'railway_station_area',
  'traffic_route',
  'tentcity',
  'ht_line',
  'ht_line_buffer',
  'water_line',
  'water_point',
  'landuse',
  'dam',
  'uk_district_boundary',
  'religious_place',
  'landmark',
  'thematic_gate',
  'entry_exit',
  'entry_exit_line',
  'junction',
  'direction_line',
  'footpath',
  'ropeway',
  'parking',
  'parking_line',
  'peripheral_parking',
  'sector_point',
  'ropeway_area',
  'bridge_point',
  'bus_terminal_point',
  'location_entry',
  'other_transport',
  'other_transport_point',
  // kumbh.tertiary_road (21k+ OSM street centrelines, see
  // PLAN-deferred-roads.md) is deliberately NOT included here. poiByLayer is
  // sorted ORDER BY features DESC and rendered as a flat list in the Stats
  // panel -- at 21,284 rows it would sit at the very top, 15-70x every other
  // layer, and bury the curated project data the panel exists to summarize.
  // It's still fully queryable/toggleable via the tiles route and the layer
  // panel; it just doesn't get a Stats panel row.
] as const

// Subset of POI_TABLES whose geometry is a polygon (matches
// POLYGON_LAYER_COLORS in src/lib/classColors.ts) -- only these get an
// ST_Area computation in poiByLayer below. Point tables have no meaningful
// area, and ST_Area on a point/linestring geometry errors, so the hectares
// column is left null for every other table rather than attempted.
const POI_POLYGON_TABLES = new Set([
  'ashram',
  'bus_terminal',
  'core_parking',
  'ghat_area',
  'kumbh_land',
  'public_service_facilities',
  'river',
  'railway_station_area',
  'tentcity',
  'ht_line_buffer',
  'landuse',
  'dam',
  'uk_district_boundary',
  'ropeway_area',
  'other_transport',
])

// Subset of POI_TABLES with a categorical "subclass" column, and its exact
// name per table (ashram spells it sub_class). Every other POI_TABLES entry
// has no such column and stays a flat single-row layer with no chevron.
const POI_SUBCLASS_TABLES: Record<string, string> = {
  amenities: 'subclass',
  ashram: 'sub_class',
  public_service_facilities: 'subclass',
  sanitation: 'subclass',
  tentcity: 'subclass',
  parking: 'subclass',
  sector_point: 'subclass',
}

/** Cached responses, keyed by sector (`'all'` or the number). Every query below reads `kumbh.*`,
 *  which only changes when `scripts/load_kumbh_2027.py` runs, yet this is the slowest endpoint in
 *  the app -- ~0.47s warm against a ~0.10s single-query floor, because three of its seven queries
 *  run `sum(ST_Area(geom::geography))` over the whole of `kumbh.sector_plan`, a per-row spheroid
 *  cast plus geodesic area. It is hit on every cold map load (StatsPanel mounts with Map mode and
 *  fetches immediately, even while collapsed) and again on every sector click.
 *
 *  Same reasoning and the same never-cache-a-rejection discipline as `getZoneOutlines` in
 *  /api/evacuation/summary. Bounded because the key space is one entry per sector: at 32 sectors
 *  plus the unfiltered view the cap is never reached in practice, but an unbounded Map keyed off a
 *  request parameter is how a slow leak starts. Oldest-first eviction, which for this access
 *  pattern is close enough to LRU and needs no bookkeeping. */
const STATS_TTL_MS = 5 * 60 * 1000
const STATS_CACHE_MAX = 40
const statsCache = new Map<string, { at: number; value: Promise<StatsResponse> }>()

type StatsResponse = {
  byClass: unknown[]
  bySubclass: unknown[]
  roadByType: unknown[]
  perSector: unknown[]
  poiByLayer: unknown[]
  poiBySubclass: unknown[]
  tertiaryRoadCount: number
}

export async function GET(req: NextRequest) {
  const sectorParam = req.nextUrl.searchParams.get('sector')
  const sectorNo =
    sectorParam !== null && Number.isInteger(Number(sectorParam)) ? Number(sectorParam) : null

  const cacheKey = sectorNo === null ? 'all' : String(sectorNo)
  const cached = statsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < STATS_TTL_MS) {
    return Response.json(await cached.value, { headers: GIS_CACHE_HEADERS })
  }
  const pending = computeStats(sectorNo).catch((err) => {
    statsCache.delete(cacheKey)
    throw err
  })
  if (statsCache.size >= STATS_CACHE_MAX) {
    const oldest = statsCache.keys().next()
    if (!oldest.done) statsCache.delete(oldest.value)
  }
  statsCache.set(cacheKey, { at: Date.now(), value: pending })
  return Response.json(await pending, { headers: GIS_CACHE_HEADERS })
}

async function computeStats(sectorNo: number | null): Promise<StatsResponse> {
  const pool = getPool()

  // A literal predicate built from whether a sector was given, rather than the
  // `$1::int IS NULL OR sector_no = $1` form these queries used to share. That form is not
  // sargable -- the planner cannot use the sector_no index through it -- so `?sector=12` scanned
  // every row of a 30k-row table to return ~1/32 of it, and measured only ~32% faster than the
  // unfiltered query despite touching a fraction of the data. `$1` is still a bound parameter
  // wherever it appears; only the *shape* of the clause varies, never a value from the request.
  const sectorParams = sectorNo === null ? [] : [sectorNo]
  /** `WHERE sector_no = $1` / `` for a table with its own sector_no column. */
  const sectorWhere = (col = 'sector_no') => (sectorNo === null ? '' : `WHERE ${col} = $1`)
  /** Spatial variant, for the POI tables with no reliable sector_no column. */
  const sectorIntersects = (table: string) =>
    sectorNo === null
      ? ''
      : `WHERE EXISTS (
        SELECT 1 FROM kumbh.sector_boundary b
        WHERE b.sector_no = $1 AND ST_Intersects(b.geom, kumbh.${table}.geom)
      )`
  const sectorIntersectsAnd = (table: string) =>
    sectorNo === null
      ? ''
      : `AND EXISTS (
          SELECT 1 FROM kumbh.sector_boundary b
          WHERE b.sector_no = $1 AND ST_Intersects(b.geom, kumbh.${table}.geom)
        )`

  const poiByLayerSql = POI_TABLES.map((t) => {
    const hectaresExpr = POI_POLYGON_TABLES.has(t)
      ? `round((sum(ST_Area(geom::geography)) / 10000)::numeric, 1)`
      : `null`
    return `SELECT '${t}' AS layer, count(*) AS features, ${hectaresExpr} AS hectares FROM kumbh.${t}
      ${sectorIntersects(t)}`
  }).join('\n      UNION ALL\n      ')

  // Same "cross-join every known value so a 0-count one still shows" contract
  // as bySubclass, but scoped via ST_Intersects like poiByLayerSql above
  // since these tables have no reliable sector_no column. Only the 4 tables
  // in POI_SUBCLASS_TABLES get rows here -- every other POI layer has no
  // categorical column to group by and stays a flat single-row layer.
  const poiBySubclassSql = Object.entries(POI_SUBCLASS_TABLES)
    .map(
      ([t, col]) => `
    SELECT g.layer, g.subclass, coalesce(s.features, 0) AS features
    FROM (SELECT DISTINCT '${t}' AS layer, ${col} AS subclass FROM kumbh.${t} WHERE ${col} IS NOT NULL) g
    LEFT JOIN (
      SELECT ${col} AS subclass, count(*) AS features
      FROM kumbh.${t}
      WHERE ${col} IS NOT NULL
        ${sectorIntersectsAnd(t)}
      GROUP BY ${col}
    ) s ON s.subclass = g.subclass`,
    )
    .join('\n    UNION ALL\n    ')

  const [subclassRaw, roadByType, perSector, poiByLayer, poiBySubclass, tertiaryRoad] =
    await Promise.all([
      // One (class_group, subclass) pass, unrounded -- byClass is rolled up from it below. This
      // used to be two queries whose only difference was the GROUP BY, meaning `sector_plan`'s
      // geodesic area was computed twice per request over exactly the same rows. Still cross-joins
      // every known (class_group, subclass) pair against the current sector filter, rather than a
      // plain GROUP BY on the filtered rows, so a pair with zero features in this sector comes back
      // as a 0 row instead of silently disappearing -- the same "always show every known value"
      // contract as poiByLayer below. Rounding moves to Node so the class total is the rounded sum
      // of exact sub-class areas, not a sum of already-rounded ones.
      pool.query(
        `
      SELECT g.class_group, g.subclass,
             coalesce(s.features, 0) AS features,
             coalesce(s.hectares, 0) AS hectares
      FROM (SELECT DISTINCT class_group, subclass FROM kumbh.sector_plan) g
      LEFT JOIN (
        SELECT class_group, subclass, count(*) AS features,
               sum(ST_Area(geom::geography)) / 10000 AS hectares
        FROM kumbh.sector_plan
        ${sectorWhere()}
        GROUP BY class_group, subclass
      )
      -- IS NOT DISTINCT FROM, not =: sector_plan rows with a NULL subclass are a real group (the
      -- DISTINCT above emits a (class_group, NULL) pair for them), and NULL = NULL is NULL, so a
      -- plain equality join left every such group joined to nothing and reported as 0 features.
      -- That was invisible while byClass was its own query counting them separately; now that
      -- byClass is rolled up from these rows, an unmatched NULL group would silently drop them from
      -- the class total too (Reserved Area measured 107 instead of 109). Both consumers already
      -- expect and handle a null subclass -- see MapView.tsx's search-panel comment on it.
      s ON s.class_group = g.class_group AND s.subclass IS NOT DISTINCT FROM g.subclass
      -- g.subclass breaks ties so the row order is stable across requests. Without it the order
      -- among equal feature counts is whatever the plan happens to emit, which means the Stats
      -- panel's sub-class rows can reshuffle between two identical reloads.
      ORDER BY g.class_group, coalesce(s.features, 0) DESC, g.subclass;
      `,
        sectorParams,
      ),
      pool.query(
        `
      -- 'Emergency Exit' no longer occurs as a kumbh.road row (the 2027 gdb reload
      -- dropped the label -- see PLAN-evacuation.md §2.1/§3); it's unioned in here from
      -- kumbh.emergency_exit (loaded from the 25 Aug 2026 shapefile) so this row keeps
      -- showing real counts instead of silently going to 0.
      SELECT g.type,
             coalesce(s.segments, 0) AS segments,
             coalesce(s.metres, 0) AS metres
      FROM (
        SELECT DISTINCT type FROM kumbh.road
        UNION SELECT 'Emergency Exit'
      ) g
      LEFT JOIN (
        SELECT type, count(*) AS segments,
               round((sum(ST_Length(geom::geography)))::numeric, 0) AS metres
        FROM kumbh.road
        ${sectorWhere()}
        GROUP BY type
        UNION ALL
        SELECT 'Emergency Exit', count(*),
               round((sum(ST_Length(geom::geography)))::numeric, 0)
        FROM kumbh.emergency_exit
        ${sectorWhere()}
      ) s ON s.type = g.type
      ORDER BY coalesce(s.metres, 0) DESC;
      `,
        sectorParams,
      ),
      pool.query(
        `
      SELECT b.sector_no, b.name,
             round(b.area_hac::numeric, 1) AS boundary_hectares,
             count(p.id) AS plan_features,
             round((coalesce(sum(ST_Area(p.geom::geography)), 0) / 10000)::numeric, 1) AS plan_hectares
      FROM kumbh.sector_boundary b
      LEFT JOIN kumbh.sector_plan p ON p.sector_no = b.sector_no
      ${sectorWhere('b.sector_no')}
      GROUP BY b.sector_no, b.name, b.area_hac
      ORDER BY b.sector_no;
      `,
        sectorParams,
      ),
      pool.query(
        `
      ${poiByLayerSql}
      ORDER BY features DESC;
      `,
        sectorParams,
      ),
      pool.query(
        `
      ${poiBySubclassSql}
      ORDER BY layer, features DESC;
      `,
        sectorParams,
      ),
      // kumbh.tertiary_road (21k+ OSM street centrelines) stays out of
      // poiByLayerSql/POI_TABLES on purpose (see that comment above) -- it
      // would dominate a features-sorted list. It still gets a single count
      // here, surfaced as a standalone footer note rather than a ranked row
      // (see StatsPanel), so the layer is acknowledged without burying the
      // curated data the rest of this panel exists to summarize.
      pool.query(
        `
      SELECT count(*) AS features
      FROM kumbh.tertiary_road
      ${sectorIntersects('tertiary_road')};
      `,
        sectorParams,
      ),
    ])

  // Both shapes come out of the one query above. `hectares` is emitted as a 1-decimal string to
  // match what `round(..., 1)::numeric` used to serialise as -- the Stats panel renders it straight
  // into the table, so the wire format has to stay identical.
  // `round(..., 1)::numeric` serialised an exact zero as "0", not "0.0", and the panels render this
  // string straight into their tables -- so zero keeps its old spelling.
  const hectares = (n: number) => (n === 0 ? '0' : n.toFixed(1))
  const bySubclass = subclassRaw.rows.map((r) => ({
    class_group: r.class_group,
    subclass: r.subclass,
    features: r.features,
    hectares: hectares(Number(r.hectares)),
  }))

  const classTotals = new Map<string, { features: number; hectares: number }>()
  for (const r of subclassRaw.rows) {
    const acc = classTotals.get(r.class_group) ?? { features: 0, hectares: 0 }
    acc.features += Number(r.features)
    acc.hectares += Number(r.hectares)
    classTotals.set(r.class_group, acc)
  }
  // Sorted by class_group, matching the ORDER BY the dedicated byClass query used to carry.
  const byClass = [...classTotals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([class_group, t]) => ({
      class_group,
      features: String(t.features),
      hectares: hectares(t.hectares),
    }))

  return {
    byClass,
    bySubclass,
    roadByType: roadByType.rows,
    perSector: perSector.rows,
    poiByLayer: poiByLayer.rows,
    poiBySubclass: poiBySubclass.rows,
    tertiaryRoadCount: Number(tertiaryRoad.rows[0]?.features ?? 0),
  }
}
