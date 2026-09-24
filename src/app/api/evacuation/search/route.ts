import { NextRequest } from 'next/server'
import { getPool } from '@/server/db/postgres'
import { SEARCH_CACHE_HEADERS } from '@/server/http/cache'
import { getCurrentUser } from '@/server/auth/session'
import { defineAbilityFor } from '@/server/auth/ability'
import {
  directionLineLabel,
  emergencyExitLabel,
  entryExitLabel,
  facilityLabel,
  genericLabel,
  hflAreaLabel,
  hflLineLabel,
  locationEntryLabel,
  trafficRouteLabel,
  type LabelPair,
} from '@/lib/evacuation/labels'

export const runtime = 'nodejs'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 20

// Whitelist of searchable evacuation layers -- table/columns are literal strings authored here,
// never taken from the request (same rule the tiles/locate routes follow). `textColumns` are
// ILIKE'd directly against the query; `label(row)` turns the raw row into the same {label,
// sublabel} pair labels.ts already builds for popups, so the client never re-derives it. `source`
// is a literal tag for tables loaded entirely from the 25 Aug 2026 shapefile drop (CONTEXT.md
// §10); undefined means "read a `source` column on the row" (public_service_facilities only) or
// "no source concept" (the 2027-only layers).
type SearchLayerSpec = {
  table: string
  textColumns: string[]
  extraColumns?: string[]
  label: (row: Record<string, unknown>) => LabelPair
  source?: 'shp_2026_08_25'
  hasSourceColumn?: boolean
}

const LAYERS: Record<string, SearchLayerSpec> = {
  traffic_route: {
    table: 'kumbh.traffic_route',
    textColumns: ['name', 'entry_exit', 'plan', 'direction'],
    extraColumns: ['entry_exit', 'plan', 'deh_dir', 'naj_dir', 'sah_dir', 'meer_dir'],
    label: (r) => trafficRouteLabel(r as Parameters<typeof trafficRouteLabel>[0]),
  },
  direction_line: {
    table: 'kumbh.direction_line',
    textColumns: ['remark'],
    extraColumns: ['remark', 'sector'],
    label: (r) => directionLineLabel(r as Parameters<typeof directionLineLabel>[0]),
  },
  entry_exit_line: {
    table: 'kumbh.entry_exit_line',
    textColumns: ['remark'],
    extraColumns: ['remark', 'sector'],
    label: (r) => entryExitLabel(r as Parameters<typeof entryExitLabel>[0], 'route'),
  },
  entry_exit: {
    table: 'kumbh.entry_exit',
    textColumns: ['remark'],
    extraColumns: ['remark', 'sector'],
    label: (r) => entryExitLabel(r as Parameters<typeof entryExitLabel>[0], 'point'),
  },
  location_entry: {
    table: 'kumbh.location_entry',
    textColumns: ['name'],
    extraColumns: ['name'],
    label: (r) => locationEntryLabel(r as Parameters<typeof locationEntryLabel>[0]),
  },
  emergency_exit: {
    table: 'kumbh.emergency_exit',
    textColumns: ['road_name', 'sector_name'],
    extraColumns: ['sector_name', 'sector_no'],
    label: (r) => emergencyExitLabel(r as Parameters<typeof emergencyExitLabel>[0]),
    source: 'shp_2026_08_25',
  },
  thematic_gate: {
    table: 'kumbh.thematic_gate',
    textColumns: ['remark'],
    extraColumns: ['remark'],
    label: (r) => genericLabel(r as Parameters<typeof genericLabel>[0], 'Thematic gate'),
  },
  junction: {
    table: 'kumbh.junction',
    textColumns: ['name', 'remark'],
    extraColumns: ['name', 'remark'],
    label: (r) => genericLabel(r as Parameters<typeof genericLabel>[0], 'Junction'),
  },
  bridge: {
    table: 'kumbh.bridge',
    textColumns: ['remark', 'mode', 'type'],
    extraColumns: ['remark'],
    label: (r) => genericLabel(r as Parameters<typeof genericLabel>[0], 'Bridge'),
  },
  fh_location: {
    table: 'kumbh.fh_location',
    textColumns: ['fh_name'],
    extraColumns: ['fh_name'],
    label: (r) => genericLabel(r as Parameters<typeof genericLabel>[0], 'Fire hydrant'),
  },
  public_service_facilities: {
    table: 'kumbh.public_service_facilities',
    textColumns: ['name', 'type', 'subclass', 'category'],
    extraColumns: ['name', 'type', 'category', 'bed'],
    label: (r) => facilityLabel(r as Parameters<typeof facilityLabel>[0]),
    hasSourceColumn: true,
  },
  hfl_area: {
    table: 'kumbh.hfl_area',
    textColumns: ['name', 'type'],
    extraColumns: ['name', 'sector_no'],
    label: (r) => hflAreaLabel(r as Parameters<typeof hflAreaLabel>[0]),
    source: 'shp_2026_08_25',
  },
  hfl_line: {
    table: 'kumbh.hfl_line',
    textColumns: ['name'],
    extraColumns: ['return_period_years', 'bank'],
    label: (r) => hflLineLabel(r as Parameters<typeof hflLineLabel>[0]),
    source: 'shp_2026_08_25',
  },
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const ability = defineAbilityFor(user.grants)
  if (!ability.can('read:all', 'ticket')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rawQuery = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (rawQuery.length < 2 || rawQuery.length > 64) {
    return Response.json({ error: 'q must be 2-64 characters' }, { status: 400 })
  }
  // Escapes ILIKE's own wildcard characters so a literal "%"/"_" in the query is matched
  // literally rather than as a pattern -- the query itself is still passed as a bound parameter
  // (never interpolated into the SQL string), so this is about ILIKE semantics, not injection.
  const escaped = rawQuery.replace(/[\\%_]/g, (c) => `\\${c}`)
  const likeParam = `%${escaped}%`
  // A bare integer query ("12") also matches sector_no directly, not just as a substring of some
  // sector name -- lets "12" find every feature physically inside sector 12 even though none of
  // its own text columns mention the number.
  const sectorNoParam = /^\d+$/.test(rawQuery) ? Number(rawQuery) : null

  const limitParam = Number(req.nextUrl.searchParams.get('limit'))
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT

  const pool = getPool()

  const results = await Promise.all(
    Object.entries(LAYERS).map(async ([layerKey, spec]) => {
      const textCond = spec.textColumns.map((c) => `t.${c} ILIKE $1`).join(' OR ')
      const sourceSelect = spec.source
        ? `'${spec.source}'`
        : spec.hasSourceColumn
          ? 't.source'
          : `'gdb_2027'`
      const extraSelect = (spec.extraColumns ?? []).map((c) => `t.${c}`).join(', ')

      const sql = `
        SELECT t.id,
               ${extraSelect ? extraSelect + ',' : ''}
               s.sector_no AS joined_sector_no, s.name AS sector_name, s.zone AS zone,
               ${sourceSelect} AS source,
               ST_XMin(t.geom) AS xmin, ST_YMin(t.geom) AS ymin,
               ST_XMax(t.geom) AS xmax, ST_YMax(t.geom) AS ymax,
               ST_X(ST_PointOnSurface(t.geom)) AS anchor_lng,
               ST_Y(ST_PointOnSurface(t.geom)) AS anchor_lat
        FROM ${spec.table} t
        LEFT JOIN LATERAL (
          SELECT b.sector_no, b.name, b.zone
          FROM kumbh.sector_boundary b
          WHERE ST_Intersects(b.geom, ST_PointOnSurface(t.geom))
          LIMIT 1
        ) s ON TRUE
        WHERE (${textCond})
           OR s.name ILIKE $1
           OR s.zone ILIKE $1
           ${sectorNoParam !== null ? 'OR s.sector_no = $3' : ''}
        LIMIT $2;
      `
      const params: (string | number)[] = [likeParam, limit]
      if (sectorNoParam !== null) params.push(sectorNoParam)

      const { rows } = await pool.query(sql, params)
      return {
        layer: layerKey,
        total: rows.length,
        results: rows.map((row) => {
          const { label, sublabel } = spec.label(row)
          const bbox =
            row.xmin !== null
              ? [Number(row.xmin), Number(row.ymin), Number(row.xmax), Number(row.ymax)]
              : null
          return {
            id: row.id,
            label,
            sublabel,
            sectorNo: row.joined_sector_no,
            sectorName: row.sector_name,
            zone: row.zone,
            bbox,
            anchor:
              row.anchor_lng !== null ? [Number(row.anchor_lng), Number(row.anchor_lat)] : null,
            source: row.source,
          }
        }),
      }
    }),
  )

  // A short `private` window: search is typed, so backspacing to a prefix already requested (or
  // re-running the same query after a filter change) is common, and each miss is 13 parallel
  // Postgres queries. Never `public` -- like every other route in this mode it is ability-gated.
  return Response.json(
    { groups: results.filter((g) => g.results.length > 0) },
    { headers: SEARCH_CACHE_HEADERS },
  )
}
