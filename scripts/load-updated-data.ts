/**
 * Loads the "Updated Data" shapefile drop (data/Updated Data/: Sector_Plan, Dustbins, Sanitation,
 * received 2026-10-06) into the `kumbh` PostGIS schema.
 *
 * Usage:
 *   npx tsx scripts/load-updated-data.ts --analyze               # compare with what's loaded, write nothing
 *   npx tsx scripts/load-updated-data.ts --apply dustbins,sanitation[,sector_plan]
 *
 * Why not scripts/load_kumbh_2027.py: that loader reads the 2027 gdb through fiona/GDAL, which
 * this machine doesn't have, and these are three plain shapefiles. Shapefile parsing here is a
 * small hand-rolled reader (Point and Polygon only -- the only shape types in this drop), and
 * reprojection from UTM 44N (EPSG:32644, every .prj in the drop) to EPSG:4326 happens in PostGIS.
 *
 * Every replaced table is first copied to `kumbh.<table>_backup_<yyyymmdd>` (same convention as
 * load_kumbh_2027.py), so a reload can be rolled back with a plain INSERT ... SELECT.
 *
 * sector_plan is special: Mongo tickets snapshot `location.sectorPlanId` (= kumbh.sector_plan.id)
 * and the map joins tickets to parcels by that id, so a plain TRUNCATE ... RESTART IDENTITY would
 * silently attach every ticket to a different parcel. Instead, a new parcel whose geometry matches
 * an existing one keeps that parcel's id; genuinely new parcels get fresh ids above the current max.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool, type PoolClient } from 'pg'

const SOURCE_DIR = path.resolve(__dirname, '..', 'data', 'Updated Data')
const SOURCE_SRID = 32644

type Row = Record<string, string | number | null>
type Feature = { props: Row; wkt: string | null }

// ---------------------------------------------------------------- shapefile reading

function readDbf(file: string): Row[] {
  const buf = readFileSync(file)
  const n = buf.readUInt32LE(4)
  const headerLen = buf.readUInt16LE(8)
  const recLen = buf.readUInt16LE(10)
  const fields: { name: string; type: string; len: number }[] = []
  for (let off = 32; buf[off] !== 0x0d; off += 32) {
    fields.push({
      name: buf.toString('latin1', off, off + 11).replace(/\0.*$/, ''),
      type: String.fromCharCode(buf[off + 11]),
      len: buf[off + 16],
    })
  }
  const rows: Row[] = []
  for (let i = 0; i < n; i++) {
    const base = headerLen + i * recLen
    if (buf[base] === 0x2a) continue // deleted record
    let o = base + 1
    const row: Row = {}
    for (const f of fields) {
      const raw = buf.toString('utf8', o, o + f.len).trim()
      o += f.len
      if (raw === '') row[f.name] = null
      else if (f.type === 'N' || f.type === 'F') {
        const v = Number(raw)
        row[f.name] = Number.isFinite(v) ? v : null
      } else row[f.name] = raw
    }
    rows.push(row)
  }
  return rows
}

/** Signed area (shoelace); shapefile outer rings are clockwise, i.e. negative here. */
function ringArea(pts: [number, number][]) {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1])
  }
  return a / 2
}

const ringWkt = (pts: [number, number][]) => `(${pts.map(([x, y]) => `${x} ${y}`).join(', ')})`

function readShp(file: string): (string | null)[] {
  const buf = readFileSync(file)
  const out: (string | null)[] = []
  let off = 100
  while (off < buf.length) {
    const contentBytes = buf.readInt32BE(off + 4) * 2
    const c = off + 8
    const type = buf.readInt32LE(c)
    if (type === 0) out.push(null)
    else if (type === 1) out.push(`POINT(${buf.readDoubleLE(c + 4)} ${buf.readDoubleLE(c + 12)})`)
    else if (type === 5) {
      const numParts = buf.readInt32LE(c + 36)
      const numPoints = buf.readInt32LE(c + 40)
      const parts: number[] = []
      for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(c + 44 + i * 4))
      const p0 = c + 44 + numParts * 4
      const rings: [number, number][][] = parts.map((start, i) => {
        const end = i + 1 < numParts ? parts[i + 1] : numPoints
        const r: [number, number][] = []
        for (let k = start; k < end; k++) {
          r.push([buf.readDoubleLE(p0 + k * 16), buf.readDoubleLE(p0 + k * 16 + 8)])
        }
        return r
      })
      // Clockwise rings start a new polygon; counter-clockwise rings are holes of the last one.
      const polys: [number, number][][][] = []
      for (const r of rings) {
        if (r.length < 4) continue
        if (ringArea(r) < 0 || polys.length === 0) polys.push([r])
        else polys[polys.length - 1].push(r)
      }
      out.push(
        polys.length
          ? `MULTIPOLYGON(${polys.map((p) => `(${p.map(ringWkt).join(', ')})`).join(', ')})`
          : null,
      )
    } else throw new Error(`${file}: unsupported shape type ${type}`)
    off = c + contentBytes
  }
  return out
}

function readLayer(name: string): Feature[] {
  const rows = readDbf(path.join(SOURCE_DIR, `${name}.dbf`))
  const geoms = readShp(path.join(SOURCE_DIR, `${name}.shp`))
  if (rows.length !== geoms.length) {
    throw new Error(`${name}: ${rows.length} dbf rows vs ${geoms.length} shapes`)
  }
  return rows.map((props, i) => ({ props, wkt: geoms[i] }))
}

// ---------------------------------------------------------------- column mapping

const clean = (v: unknown) => {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** "BAIRAGI CAMP-11" / "BAIRAGICAMP-11" / "RANIPUR - 03" -> 11 / 11 / 3. Same rule as the
 *  Python loader's _sector_no_from_name; unparseable names are backfilled spatially. */
const sectorNo = (name: string | null) => {
  const m = name?.match(/-\s*(\d+)\s*$/)
  return m ? Number(m[1]) : null
}

const LAYERS = {
  sector_plan: {
    source: 'Sector_Plan',
    map: (p: Row) => {
      const sector = clean(p.Sector)
      return {
        objectid: p.OBJECTID,
        class: clean(p.Class),
        class_group: clean(p.Class),
        subclass: clean(p.Subclass),
        area_mark: clean(p.Area_Mark),
        plot_no: clean(p.Plot_No),
        block: clean(p.Block),
        sector,
        sector_no: sectorNo(sector),
        remark: clean(p.Remark),
        remark_1: clean(p.Remark_1),
        label: clean(p.Label),
        area: p.Area,
        shape_leng_src: p.SHAPE_Leng,
        shape_area_src: p.SHAPE_Area,
      }
    },
  },
  dustbins: {
    source: 'Dustbins',
    map: (p: Row) => ({ fid: p.OBJECTID, type: clean(p.Type), sector: clean(p.Sector) }),
  },
  sanitation: {
    source: 'Sanitation',
    map: (p: Row) => ({
      fid: p.OBJECTID,
      oid_src: p.OID_,
      name: clean(p.Name),
      folder_path: null,
      class: clean(p.Class),
      subclass: clean(p.Subclass),
      sector: clean(p.Sector),
      remark: clean(p.Remark),
    }),
  },
} as const

type TableName = keyof typeof LAYERS

// ---------------------------------------------------------------- staging

/** Loads a layer into a temp table `stage` (columns as mapped + geom in EPSG:4326). Must run inside
 *  a transaction: the Supabase pooler is transaction-mode, so a temp table only survives within one. */
async function stage(client: PoolClient, table: TableName) {
  const spec = LAYERS[table]
  const features = readLayer(spec.source).filter((f) => f.wkt)
  const rows = features.map((f) => ({ ...spec.map(f.props), __wkt: f.wkt }))
  const cols = Object.keys(rows[0]).filter((c) => c !== '__wkt')

  await client.query(
    `CREATE TEMP TABLE stage ON COMMIT DROP AS SELECT ${cols.join(', ')}, geom FROM kumbh.${table} WITH NO DATA`,
  )
  await client.query(`ALTER TABLE stage ADD COLUMN src_idx int`)
  const BATCH = 300
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const values: unknown[] = []
    const tuples = chunk.map((r, k) => {
      const base = values.length
      for (const c of cols) values.push((r as Record<string, unknown>)[c] ?? null)
      values.push(r.__wkt, i + k)
      const ph = cols.map((_, j) => `$${base + j + 1}`)
      const g = `$${base + cols.length + 1}`
      const geomExpr =
        table === 'sector_plan'
          ? `ST_Multi(ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromText(${g}), ${SOURCE_SRID}), 4326)))`
          : `ST_Transform(ST_SetSRID(ST_GeomFromText(${g}), ${SOURCE_SRID}), 4326)`
      return `(${ph.join(', ')}, ${geomExpr}, $${base + cols.length + 2})`
    })
    await client.query(
      `INSERT INTO stage (${cols.join(', ')}, geom, src_idx) VALUES ${tuples.join(', ')}`,
      values,
    )
  }
  // ST_MakeValid can return a GeometryCollection when a ring degenerates; keep the polygon parts.
  if (table === 'sector_plan') {
    await client.query(
      `UPDATE stage SET geom = ST_Multi(ST_CollectionExtract(geom, 3)) WHERE GeometryType(geom) <> 'MULTIPOLYGON'`,
    )
  }
  return { cols, count: rows.length, skippedNoGeom: readLayer(spec.source).length - rows.length }
}

/** Pairs each staged parcel with the existing parcel it most overlaps, accepting the pair only if
 *  both cover >= 90% of each other (IoU-style) -- robust to re-digitising noise, strict enough
 *  that a split/merged plot counts as a new parcel. One-to-one: an old id is used at most once. */
async function matchParcels(client: PoolClient) {
  await client.query(`ALTER TABLE stage ADD COLUMN match_id int`)
  await client.query(`
    WITH cand AS (
      SELECT s.src_idx, o.id,
             ST_Area(ST_Intersection(s.geom, o.geom)::geography) AS inter,
             ST_Area(s.geom::geography) AS sa, ST_Area(o.geom::geography) AS oa
      FROM stage s JOIN kumbh.sector_plan o ON s.geom && o.geom AND ST_Intersects(s.geom, o.geom)
    ), good AS (
      SELECT src_idx, id, inter / GREATEST(sa, oa) AS score FROM cand
      WHERE sa > 0 AND oa > 0 AND inter / sa >= 0.9 AND inter / oa >= 0.9
    ), ranked AS (
      SELECT src_idx, id, row_number() OVER (PARTITION BY id ORDER BY score DESC) AS r_old,
             row_number() OVER (PARTITION BY src_idx ORDER BY score DESC) AS r_new
      FROM good
    )
    UPDATE stage s SET match_id = r.id FROM ranked r
    WHERE r.src_idx = s.src_idx AND r.r_old = 1 AND r.r_new = 1`)
}

// ---------------------------------------------------------------- commands

async function analyze(pool: Pool) {
  for (const table of Object.keys(LAYERS) as TableName[]) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { count, skippedNoGeom } = await stage(client, table)
      const old = await client.query(`SELECT count(*)::int n FROM kumbh.${table}`)
      const invalid = await client.query(
        `SELECT count(*)::int n FROM stage WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom)`,
      )
      console.log(
        `\n== ${table}: ${old.rows[0].n} rows loaded today -> ${count} in the new drop` +
          (skippedNoGeom ? ` (${skippedNoGeom} without geometry, skipped)` : '') +
          `, ${invalid.rows[0].n} invalid/empty geometries`,
      )
      if (table === 'sector_plan') {
        await matchParcels(client)
        const m = await client.query(
          `SELECT count(*) FILTER (WHERE match_id IS NOT NULL)::int matched, count(*) FILTER (WHERE match_id IS NULL)::int fresh FROM stage`,
        )
        const gone = await client.query(
          `SELECT count(*)::int n FROM kumbh.sector_plan o WHERE NOT EXISTS (SELECT 1 FROM stage s WHERE s.match_id = o.id)`,
        )
        const changed = await client.query(
          `SELECT count(*)::int n FROM stage s JOIN kumbh.sector_plan o ON o.id = s.match_id WHERE o.class IS DISTINCT FROM s.class OR o.subclass IS DISTINCT FROM s.subclass`,
        )
        console.log(`   matched to an existing parcel (keeps its id): ${m.rows[0].matched}`)
        console.log(`     ...of which class/subclass changed: ${changed.rows[0].n}`)
        console.log(`   new parcels (new ids): ${m.rows[0].fresh}`)
        console.log(
          `   existing parcels with no match in the new drop (would be removed): ${gone.rows[0].n}`,
        )
        const goneIds = await client.query(
          `SELECT array_agg(id ORDER BY id) ids FROM kumbh.sector_plan o WHERE NOT EXISTS (SELECT 1 FROM stage s WHERE s.match_id = o.id)`,
        )
        console.log(`GONE_IDS ${JSON.stringify(goneIds.rows[0].ids ?? [])}`)
      } else {
        const near = await client.query(
          `SELECT count(*)::int n FROM stage s WHERE EXISTS (SELECT 1 FROM kumbh.${table} o WHERE ST_DWithin(s.geom::geography, o.geom::geography, 1))`,
        )
        console.log(`   points within 1 m of an existing point: ${near.rows[0].n}`)
      }
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
}

function backupName(table: string) {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${table}_backup_${ymd}`
}

async function apply(pool: Pool, tables: TableName[]) {
  for (const table of tables) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { cols, count } = await stage(client, table)
      const bk = backupName(table)
      const exists = await client.query(`SELECT to_regclass($1) AS t`, [`kumbh.${bk}`])
      if (exists.rows[0].t)
        throw new Error(`kumbh.${bk} already exists -- refusing to overwrite a backup`)
      await client.query(`CREATE TABLE kumbh.${bk} AS TABLE kumbh.${table}`)

      if (table === 'sector_plan') {
        await matchParcels(client)
        await client.query(`DELETE FROM kumbh.sector_plan`)
        // Matched parcels keep their id; new ones continue the sequence.
        await client.query(
          `INSERT INTO kumbh.sector_plan (id, ${cols.join(', ')}, geom)
           SELECT match_id, ${cols.join(', ')}, geom FROM stage WHERE match_id IS NOT NULL`,
        )
        await client.query(
          `SELECT setval(pg_get_serial_sequence('kumbh.sector_plan', 'id'),
                         (SELECT max(id) FROM kumbh.${bk}))`,
        )
        await client.query(
          `INSERT INTO kumbh.sector_plan (${cols.join(', ')}, geom)
           SELECT ${cols.join(', ')}, geom FROM stage WHERE match_id IS NULL ORDER BY src_idx`,
        )
        // Names that don't end in "-NN" get their sector number from the boundary they sit in.
        await client.query(`
          UPDATE kumbh.sector_plan p SET sector_no = b.sector_no
          FROM kumbh.sector_boundary b
          WHERE p.sector_no IS NULL AND ST_Intersects(b.geom, ST_PointOnSurface(p.geom))`)
      } else {
        await client.query(`TRUNCATE kumbh.${table} RESTART IDENTITY`)
        await client.query(
          `INSERT INTO kumbh.${table} (${cols.join(', ')}, geom)
           SELECT ${cols.join(', ')}, geom FROM stage ORDER BY src_idx`,
        )
      }
      const n = await client.query(`SELECT count(*)::int n FROM kumbh.${table}`)
      await client.query('COMMIT')
      console.log(`${table}: backed up to kumbh.${bk}, now ${n.rows[0].n} rows (staged ${count})`)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  })
  try {
    if (args[0] === '--analyze') await analyze(pool)
    else if (args[0] === '--apply' && args[1]) {
      const tables = args[1].split(',') as TableName[]
      for (const t of tables) if (!(t in LAYERS)) throw new Error(`Unknown table ${t}`)
      await apply(pool, tables)
    } else {
      console.log('Usage: --analyze | --apply dustbins,sanitation[,sector_plan]')
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
