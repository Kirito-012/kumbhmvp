import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'
import { GIS_PRIVATE_CACHE_HEADERS } from '@/server/http/cache'
import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'
import {
  directionLineLabel,
  emergencyExitLabel,
  entryExitLabel,
  facilityLabel,
  genericLabel,
  locationEntryLabel,
  trafficRouteLabel,
  type LabelPair,
} from '@/lib/evacuation/labels'

export const runtime = 'nodejs'

// Same whitelist shape as /api/evacuation/search (kept separate rather than shared/imported --
// this route needs different columns per layer for the feature-list case, and a single shared
// spec object trying to serve both routes' slightly different needs was harder to read than two
// short, independent ones). Table names are literal, never taken from the request.
const COUNTED_LAYERS: Record<string, string> = {
  entry_exit: 'kumbh.entry_exit',
  entry_exit_line: 'kumbh.entry_exit_line',
  direction_line: 'kumbh.direction_line',
  traffic_route: 'kumbh.traffic_route',
  emergency_exit: 'kumbh.emergency_exit',
  location_entry: 'kumbh.location_entry',
  thematic_gate: 'kumbh.thematic_gate',
  junction: 'kumbh.junction',
  bridge: 'kumbh.bridge',
  footpath: 'kumbh.footpath',
  fh_location: 'kumbh.fh_location',
  public_service_facilities: 'kumbh.public_service_facilities',
  hfl_area: 'kumbh.hfl_area',
  hfl_line: 'kumbh.hfl_line',
}

// (table, columns to select, label(row)) for the per-focus feature list -- a subset of
// COUNTED_LAYERS' keys deliberately excludes hfl_area/hfl_line/footpath (context layers, not
// something a focused sector/zone view needs to list feature-by-feature).
const FEATURE_LIST_LAYERS: Record<
  string,
  { table: string; columns: string[]; label: (row: Record<string, unknown>) => LabelPair }
> = {
  entry_exit: {
    table: 'kumbh.entry_exit',
    columns: ['remark'],
    label: (r) => entryExitLabel(r as Parameters<typeof entryExitLabel>[0], 'point'),
  },
  entry_exit_line: {
    table: 'kumbh.entry_exit_line',
    columns: ['remark'],
    label: (r) => entryExitLabel(r as Parameters<typeof entryExitLabel>[0], 'route'),
  },
  direction_line: {
    table: 'kumbh.direction_line',
    columns: ['remark', 'sector'],
    label: (r) => directionLineLabel(r as Parameters<typeof directionLineLabel>[0]),
  },
  traffic_route: {
    table: 'kumbh.traffic_route',
    columns: ['entry_exit', 'plan', 'deh_dir', 'naj_dir', 'sah_dir', 'meer_dir'],
    label: (r) => trafficRouteLabel(r as Parameters<typeof trafficRouteLabel>[0]),
  },
  emergency_exit: {
    table: 'kumbh.emergency_exit',
    columns: ['sector_name', 'sector_no'],
    label: (r) => emergencyExitLabel(r as Parameters<typeof emergencyExitLabel>[0]),
  },
  location_entry: {
    table: 'kumbh.location_entry',
    columns: ['name'],
    label: (r) => locationEntryLabel(r as Parameters<typeof locationEntryLabel>[0]),
  },
  junction: {
    table: 'kumbh.junction',
    columns: ['name', 'remark'],
    label: (r) => genericLabel(r as Parameters<typeof genericLabel>[0], 'Junction'),
  },
  thematic_gate: {
    table: 'kumbh.thematic_gate',
    columns: ['remark'],
    label: (r) => genericLabel(r as Parameters<typeof genericLabel>[0], 'Thematic gate'),
  },
}

/** Hospitals/police/fire stations -- the "Nearby care" list (PLAN-evacuation.md §7.3). Matches
 *  the `type` values actually present in kumbh.public_service_facilities (checked 2026-09-15). */
const CARE_TYPES = ['Hospital', 'Health Camping', 'Police Station', 'Fire Station']

function areaFilter(
  sectorNo: number | null,
  zone: string | null,
): { sql: string; params: unknown[] } {
  if (sectorNo !== null) {
    return {
      sql: 'EXISTS (SELECT 1 FROM kumbh.sector_boundary b WHERE b.sector_no = $1 AND ST_Intersects(b.geom, t.geom))',
      params: [sectorNo],
    }
  }
  if (zone !== null) {
    return {
      sql: 'EXISTS (SELECT 1 FROM kumbh.sector_boundary b WHERE b.zone = $1 AND ST_Intersects(b.geom, t.geom))',
      params: [zone],
    }
  }
  return { sql: '', params: [] }
}

type ZoneOutline = { zone: string; geojson: unknown; bbox: [number, number, number, number] }

/** Process-lifetime memo of the zone outlines. The query takes no parameters and depends on nothing
 *  in the request -- it is `ST_Union` + `ST_SimplifyPreserveTopology` over all 32 rows of
 *  `kumbh.sector_boundary`, the single most expensive statement this route runs -- yet it was
 *  recomputed on every request, including every sector/zone focus change while the user pans around.
 *  `kumbh.sector_boundary` only changes when `scripts/load_kumbh_2027.py` runs, which means a process
 *  restart in every deployment shape this app has (Azure App Service runs `node server.js`; the
 *  loader runs against the database out-of-band, so the TTL below is what bounds staleness if it is
 *  ever run against a live instance). Cached as the finished response shape so a hit costs nothing at
 *  all, and as a promise so N concurrent cold requests still issue exactly one query. */
const ZONE_OUTLINES_TTL_MS = 60 * 60 * 1000
let zoneOutlinesCache: { at: number; value: Promise<ZoneOutline[]> } | null = null

function getZoneOutlines(pool: ReturnType<typeof getPool>): Promise<ZoneOutline[]> {
  if (zoneOutlinesCache && Date.now() - zoneOutlinesCache.at < ZONE_OUTLINES_TTL_MS) {
    return zoneOutlinesCache.value
  }
  const value = pool
    .query(
      `
    SELECT zone,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Union(geom), 0.0005)) AS geojson,
           ST_XMin(ST_Extent(geom)) AS xmin, ST_YMin(ST_Extent(geom)) AS ymin,
           ST_XMax(ST_Extent(geom)) AS xmax, ST_YMax(ST_Extent(geom)) AS ymax
    FROM kumbh.sector_boundary
    WHERE zone IS NOT NULL
    GROUP BY zone
    ORDER BY zone;
  `,
    )
    .then((result) =>
      result.rows.map((row) => ({
        zone: row.zone as string,
        geojson: JSON.parse(row.geojson),
        bbox: [Number(row.xmin), Number(row.ymin), Number(row.xmax), Number(row.ymax)] as [
          number,
          number,
          number,
          number,
        ],
      })),
    )
    .catch((err) => {
      // Never cache a failure -- otherwise one transient pool timeout would blank the zone outlines
      // for a full hour. Same reasoning as connect.ts resetting its cached promise on failure.
      zoneOutlinesCache = null
      throw err
    })
  zoneOutlinesCache = { at: Date.now(), value }
  return value
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const ability = defineAbilityFor(user.grants)
  if (!ability.can('read:all', 'ticket')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sectorParam = req.nextUrl.searchParams.get('sector')
  const sectorNo =
    sectorParam !== null && Number.isInteger(Number(sectorParam)) ? Number(sectorParam) : null
  const zone = sectorNo === null ? req.nextUrl.searchParams.get('zone') : null
  const { sql: areaSql, params: areaParams } = areaFilter(sectorNo, zone)
  const whereClause = areaSql ? `WHERE ${areaSql}` : ''

  const pool = getPool()

  // One UNION ALL rather than 14 separate `count(*)` queries. Each layer's count is independent, so
  // the old shape was a Promise.all of 14 round-trips -- and since the focused case below adds 8 more
  // plus the corridor and zone queries, a single focused request could ask for up to 25 connections
  // from a pool whose max is 15 (src/server/db/postgres.ts), pushing the tail onto the 10s
  // connectionTimeoutMillis queue and making concurrent tile requests wait behind it. Same shape
  // /api/stats' POI branch already uses.
  //
  // Both the layer key and the table name are literals authored in COUNTED_LAYERS above -- nothing
  // here is interpolated from the request, which is the documented SQL-injection boundary for every
  // GIS route (CONTEXT.md §8/§15). `whereClause`/`areaParams` are the same for every branch, so the
  // one `$1` placeholder is shared across them.
  const countsSql = Object.entries(COUNTED_LAYERS)
    .map(([key, table]) => `SELECT '${key}' AS layer, count(*) AS n FROM ${table} t ${whereClause}`)
    .join(' UNION ALL ')
  const countsPromise = pool.query<{ layer: string; n: string }>(countsSql, areaParams)

  // Per-corridor traffic_route counts for the Corridor filter chips (PLAN-evacuation.md §7.2 item
  // 4 -- "chips for the non-empty corridors, with counts"). naj_dir excluded: it's never offered
  // as a chip (§2.2 -- Najibabad has 0 routes region-wide).
  const corridorCountsPromise = pool.query<{ deh_dir: string; sah_dir: string; meer_dir: string }>(
    `
    SELECT count(*) FILTER (WHERE deh_dir = 1) AS deh_dir,
           count(*) FILTER (WHERE sah_dir = 1) AS sah_dir,
           count(*) FILTER (WHERE meer_dir = 1) AS meer_dir
    FROM kumbh.traffic_route t
    ${whereClause};
  `,
    areaParams,
  )

  // Zone outlines (§8.2) -- always returned, regardless of focus, since the "Zone outlines"
  // supporting layer can be toggled independently of any sector/zone being focused.
  const zonesPromise = getZoneOutlines(pool)

  const focusPromise =
    sectorNo !== null || zone !== null
      ? Promise.all([
          Promise.all(
            Object.entries(FEATURE_LIST_LAYERS).map(async ([key, spec]) => {
              const cols = spec.columns.map((c) => `t.${c}`).join(', ')
              const { rows } = await pool.query(
                `
              SELECT t.id, ${cols ? cols + ',' : ''}
                     ST_XMin(t.geom) AS xmin, ST_YMin(t.geom) AS ymin,
                     ST_XMax(t.geom) AS xmax, ST_YMax(t.geom) AS ymax,
                     ST_X(ST_PointOnSurface(t.geom)) AS anchor_lng,
                     ST_Y(ST_PointOnSurface(t.geom)) AS anchor_lat
              FROM ${spec.table} t
              ${whereClause}
              LIMIT 100;
            `,
                areaParams,
              )
              return {
                layer: key,
                features: rows.map((row) => {
                  const { label, sublabel } = spec.label(row)
                  return {
                    id: row.id,
                    label,
                    sublabel,
                    bbox:
                      row.xmin !== null
                        ? [Number(row.xmin), Number(row.ymin), Number(row.xmax), Number(row.ymax)]
                        : null,
                    anchor:
                      row.anchor_lng !== null
                        ? [Number(row.anchor_lng), Number(row.anchor_lat)]
                        : null,
                  }
                }),
              }
            }),
          ),
          pool.query(
            `
          SELECT t.id, t.name, t.type, t.category, t.bed,
                 ST_X(ST_PointOnSurface(t.geom)) AS anchor_lng,
                 ST_Y(ST_PointOnSurface(t.geom)) AS anchor_lat
          FROM kumbh.public_service_facilities t
          WHERE t.type = ANY($${areaParams.length + 1})
            ${areaSql ? `AND ${areaSql}` : ''}
          LIMIT 50;
        `,
            [...areaParams, CARE_TYPES],
          ),
        ])
      : null

  const [countsResult, corridorCountsResult, zones, focusResult] = await Promise.all([
    countsPromise,
    corridorCountsPromise,
    zonesPromise,
    focusPromise,
  ])

  const counts = Object.fromEntries(countsResult.rows.map((row) => [row.layer, Number(row.n)]))
  const corridorRow = corridorCountsResult.rows[0]
  const corridors = {
    deh_dir: Number(corridorRow.deh_dir),
    sah_dir: Number(corridorRow.sah_dir),
    meer_dir: Number(corridorRow.meer_dir),
  }
  const focus = focusResult
    ? {
        sectorNo,
        zone,
        layers: focusResult[0],
        care: focusResult[1].rows.map((row) => {
          const { label, sublabel } = facilityLabel(row)
          return {
            id: row.id,
            label,
            sublabel,
            anchor:
              row.anchor_lng !== null ? [Number(row.anchor_lng), Number(row.anchor_lat)] : null,
          }
        }),
      }
    : null

  // `private`, not `public`: this response is gated on `ability.can('read:all', 'ticket')` above, so
  // a shared cache in front of the app could otherwise hand an admin's copy to a Surveyor who is not
  // permitted to see it. The browser's own reuse -- the part that actually helps here, since the
  // panels refetch on every focus change -- is unaffected.
  return Response.json({ counts, corridors, zones, focus }, { headers: GIS_PRIVATE_CACHE_HEADERS })
}
