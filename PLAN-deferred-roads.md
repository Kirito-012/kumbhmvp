# Plan: load the deferred road layers from Pending.md

Covers the five layers `Pending.md` deferred. Findings below come from reading the
gdb directly (2026-09-09), and two of them **contradict what Pending.md assumed** —
read the Corrections section before starting.

---

## Corrections to Pending.md's assumptions

**1. `Sector_Tertiary_Road` is a subset of `Tertiary_Road`, not a second dataset.**

```
Tertiary_Road         21,280 unique osm_id
Sector_Tertiary_Road   7,068 unique osm_id
overlap                7,064     only-in-Sector_: 4
```

So it is _not_ "21k+7k = 28k rows". It is 21,284 distinct roads, of which 7,068 are
flagged as falling inside the sector area. Load **one** table with a boolean
`in_sector` column, not two tables. This removes the duplicate-storage problem and
turns "sector roads only" into a filter instead of a second layer.

**2. The volume does not need a new tiling subsystem.** Pending.md says these
"would need its own MVT tiling/zoom-based simplification strategy". The app already
has most of that: `src/app/api/tiles/[layer]/[z]/[x]/[y]/route.ts` is a generic
whitelist-driven `ST_AsMVT` route with a GiST-indexed `&&` bbox filter, and
`load_new_table` creates a `geom_idx` on every table. What is genuinely missing is
only **per-layer zoom gating + simplification**, which is ~10 lines added to that
one route (Phase 2). No new subsystem.

**3. Attribute reality check.** Of 21,284 tertiary roads only **121 have a name**.
`fclass` breakdown: 15,646 residential, 2,431 service, 794 unclassified, 630 track,
548 tertiary, 311 trunk, 255 path, 227 footway, 180 secondary, 72 primary, rest
tiny. This is why it must default OFF and be zoom-gated: it is a nameless texture
layer, not a browsable POI layer.

**4. `Road_Secondary`'s 109 rows are mostly unusable as-is.** Actual name counts:

```
40  (null)                 10  Madhya Marg           4  Exit
21  (blank)                 9  Peak Day Entry        4  Untitled Path
 3  Haridwar Main Road      6  Entry                 3  Peak day exit
 2  Upper Road              2  Peak day Exit         2  Peak day Entry
 1  Peak day entry          1  entry                 1  Peak day & Weekend Entry
```

**61 of 109 rows (56%) have no name at all.** Only 15 rows are real road names
(Madhya Marg 10, Haridwar Main Road 3, Upper Road 2). ~33 are traffic-routing
labels in six different casings ("Peak Day Entry" / "Peak day Entry" / "Peak day
entry" / "entry"). Pending.md's plan of "manually classify 109 rows" is really
"classify 48 named rows and decide what to do with 61 nameless ones".

**5. `Sector_Tertiary_Road` is 3D (has Z values).** `Tertiary_Road` is 2D. The
`geometry(MULTILINESTRING, 4326)` column type rejects 3D input, so the loader must
drop Z. No existing table hits this, so `load_new_table` has never needed it.

---

## Geometry summary

| Layer                  | Geometry               | Rows   | Verdict                      |
| ---------------------- | ---------------------- | ------ | ---------------------------- |
| `Tertiary_Road`        | MultiLineString        | 21,281 | Load (Phase 1–3)             |
| `Sector_Tertiary_Road` | MultiLineString **3D** | 7,068  | Merge in as `in_sector=true` |
| `Road_Secondary`       | MultiLineString        | 109    | Classify then load (Phase 4) |
| `Road_Secondary_Poly`  | MultiPolygon           | 13     | **Skip permanently**         |
| `Road_Poly`            | MultiPolygon           | 1      | **Skip permanently**         |

`Road_Secondary_Poly` has only `SHAPE_Length`/`SHAPE_Area` — no name field at all.
13 anonymous blobs plus 1 more in `Road_Poly`; nothing to label, click, or filter.
Derivable via `ST_Buffer` on the centrelines if ever wanted. Do not load them.

---

# Phase 1 — Loader: `kumbh.tertiary_road`

**File:** `scripts/load_kumbh_2027.py`

### 1a. Drop-Z support in `load_new_table`

`Sector_Tertiary_Road` is 3D. In `load_new_table` (~line 1017), after
`geom = reproject(shape(f["geometry"]))`, force 2D:

```python
def force_2d(geom):
    """Sector_Tertiary_Road is the only 3D source layer in the gdb; the target
    geometry(MULTILINESTRING, 4326) columns reject Z, so drop it on load."""
    if not geom.has_z:
        return geom
    return shapely_transform(lambda x, y, z=None: (x, y), geom)
```

`shapely_transform` is already imported. Call it inside `load_new_table`'s feature
loop. Applying it unconditionally is safe — it is a no-op for every 2D layer.

### 1b. `_tertiary_road_map`

Place it next to the other new-table map fns (after `_sector_point_map`, ~line 637):

```python
def _tertiary_road_map(p, source_layer):
    # OSM-derived base street network (see PLAN-deferred-roads.md). Sector_Tertiary_Road
    # is a strict subset of Tertiary_Road (7,064 of its 7,068 osm_ids also appear in the
    # parent layer), so both load into one table and the subset is expressed as a flag
    # rather than a second table. Only 121 of 21k rows have a name -- fclass is the only
    # reliably-populated descriptive column, so it drives both styling and filtering.
    return {
        "osm_id": clean(p.get("osm_id")),
        "name": clean(p.get("name")),
        "fclass": clean(p.get("fclass")),
        "ref": clean(p.get("ref")),
        "oneway": clean(p.get("oneway")),
        "maxspeed": p.get("maxspeed"),
        "bridge": clean(p.get("bridge")),
        "tunnel": clean(p.get("tunnel")),
        "in_sector": source_layer == "Sector_Tertiary_Road",
        "shape_length": p.get("SHAPE_Length"),
    }
```

### 1c. Spec entry

Append to `NEW_TABLE_SPECS`. **Order matters**: `Tertiary_Road` first, so the dedupe
in 1d keeps the 2D parent geometry and only _flags_ the subset.

```python
(
    "tertiary_road",
    {
        "osm_id": "text",
        "name": "text",
        "fclass": "text",
        "ref": "text",
        "oneway": "text",
        "maxspeed": "integer",
        "bridge": "text",
        "tunnel": "text",
        "in_sector": "boolean",
        "shape_length": "double precision",
    },
    "MULTILINESTRING",
    ["Tertiary_Road", "Sector_Tertiary_Road"],
    _tertiary_road_map,
),
```

### 1d. Dedupe by `osm_id`

Without this the table gets 28,349 rows with 7,064 duplicated geometries. Since
`load_new_table` accumulates `features` across all `layers` before inserting, add a
post-load step (mirroring how `backfill_sector_no` is already a post-load step in
`main()`):

```python
def dedupe_tertiary_road(conn):
    """Sector_Tertiary_Road repeats rows already present in Tertiary_Road; keep the
    parent-layer row and carry the subset membership across as in_sector."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE kumbh.tertiary_road t SET in_sector = true "
            "WHERE t.in_sector = false AND EXISTS ("
            "  SELECT 1 FROM kumbh.tertiary_road d "
            "  WHERE d.osm_id = t.osm_id AND d.in_sector = true)"
        )
        cur.execute(
            "DELETE FROM kumbh.tertiary_road a USING kumbh.tertiary_road b "
            "WHERE a.osm_id = b.osm_id AND a.id > b.id"
        )
        conn.commit()
```

Call it in `main()` right after the `tertiary_road` new-table load. Expected final
count: **21,284 rows**, of which 7,068 have `in_sector = true`.

### 1e. Indexes

`load_new_table` only auto-creates a `sector` btree index, and this table has no
`sector` column. Add explicitly:

```sql
CREATE INDEX IF NOT EXISTS tertiary_road_fclass_idx ON kumbh.tertiary_road (fclass);
CREATE INDEX IF NOT EXISTS tertiary_road_in_sector_idx ON kumbh.tertiary_road (in_sector) WHERE in_sector;
```

The `fclass` one is required — Phase 2's low-zoom filter uses it on every tile request.

### Verify Phase 1

```
python scripts/load_kumbh_2027.py --dry-run --only tertiary_road   # expect 28,349 read
python scripts/load_kumbh_2027.py --only tertiary_road             # expect 21,284 final
```

---

# Phase 2 — Tile route: zoom gating + simplification

**File:** `src/app/api/tiles/[layer]/[z]/[x]/[y]/route.ts`

The only route file needing structural change. Today every entry is
`{ table, columns }` and the SQL is fixed. Add **optional** fields so all 45
existing layers keep working untouched.

### 2a. Widen the whitelist type

```ts
const LAYERS: Record<
  string,
  {
    table: string
    columns: string
    /** Below this zoom the layer returns an empty tile. Bulk reference layers only. */
    minzoom?: number
    /** SQL predicate (authored here, never user input) applied below filterBelowZoom. */
    lowZoomWhere?: string
    /** Below this zoom, apply lowZoomWhere. */
    filterBelowZoom?: number
    /** Simplify geometry in tile units; omit for layers small enough to send whole. */
    simplify?: boolean
  }
> = { ... }
```

### 2b. The entry

```ts
tertiary_road: {
  table: 'kumbh.tertiary_road',
  columns: 'id, osm_id, name, fclass, ref, oneway, maxspeed, bridge, tunnel, in_sector',
  // 21k nameless OSM centrelines: a whole-region tile would be megabytes and
  // illegible. Nothing below z12 (city view); between z12-14 only the arterial
  // classes, which is ~1,100 rows instead of 21k.
  minzoom: 12,
  filterBelowZoom: 15,
  lowZoomWhere:
    "fclass IN ('trunk','primary','secondary','tertiary'," +
    "'trunk_link','primary_link','secondary_link','tertiary_link')",
  simplify: true,
},
```

### 2c. Early-out and SQL changes

Before hitting the pool:

```ts
if (def.minzoom !== undefined && zi < def.minzoom) {
  return new Response(new Uint8Array(), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    },
  })
}
```

Then in the SQL, wrap the geom and append the predicate. `def.lowZoomWhere` is a
literal authored in this file — never a request value — so interpolating it keeps
the existing "never interpolate the layer param" rule intact:

```ts
const extraWhere =
  def.filterBelowZoom !== undefined && def.lowZoomWhere && zi < def.filterBelowZoom
    ? `AND (${def.lowZoomWhere})`
    : ''

// ST_AsMVTGeom already clips to the tile; simplifying in tile-unit space
// afterwards is what actually shrinks the payload for dense line layers.
const geomExpr = def.simplify
  ? `ST_Simplify(ST_AsMVTGeom(ST_Transform(geom, 3857), ST_TileEnvelope($2,$3,$4), 4096, 64, true), 2.0)`
  : `ST_AsMVTGeom(ST_Transform(geom, 3857), ST_TileEnvelope($2,$3,$4), 4096, 64, true)`
```

Splice `${extraWhere}` into the existing `WHERE geom && ...` line. Keep everything
else identical.

**Guard:** `ST_Simplify` can return NULL/empty for very short segments — add
`WHERE geom IS NOT NULL` to the outer `SELECT ST_AsMVT(t, ...) FROM (...) t` if
tiles come back with artifacts.

---

# Phase 3 — Map UI

The layer registry is fully derived from `classColors.ts` (see `POI_LAYER_DEFS`,
`src/components/map/MapView.tsx:516`), and `defaultVisibility()` already defaults
every POI layer to `false` and merges stored prefs over defaults — so a new key is
picked up automatically and starts hidden with no migration. That is most of the work.

### 3a. Register the layer

`src/lib/classColors.ts` — add to **Tier 3** of `LINE_LAYER_COLORS` (it is context
texture, the lowest visual tier):

```ts
// Tier 3 -- terrain/context, near-neutral
tertiary_road: '#8a8f98', // base street network -- deliberately the most neutral
                          // line colour in the palette; 21k reference centrelines
                          // must never compete with the project road network
                          // (ROAD_TYPE_COLORS) drawn above them.
```

and `LINE_LAYER_LABELS`:

```ts
tertiary_road: 'Street network (OSM)',
```

The `(OSM)` suffix matters — it tells the user this is third-party reference data,
not curated project data, which is the exact confusion Pending.md worried about.

### 3b. Light/dark treatment

**The one place the generic POI path is not good enough.** Every other POI line
layer uses a single flat colour in both themes (see the comment at `classColors.ts`
~line 313: "POI colours are already the same in both themes"). A neutral grey at
21k lines does not survive that: `#8a8f98` reads as heavy near-black clutter over
CARTO Positron's white ground, and as mud over Dark Matter.

Add a theme-aware pair next to `SECTOR_BOUNDARY_WIDTH` (`MapView.tsx` ~line 182):

```ts
// The base street network is the only POI line layer dense enough to need a
// per-theme treatment (every other one is a handful of features -- see the note on
// POI colours in classColors.ts). Light mode's Positron basemap is a white ground
// where a mid-grey hairline at 21k features reads as smog, so it goes thinner and
// more transparent; dark mode's Dark Matter ground swallows the same grey, so it
// goes slightly brighter to stay legible at all.
const TERTIARY_ROAD_STYLE = {
  light: { opacity: 0.38, color: '#9aa0a8' },
  dark: { opacity: 0.55, color: '#7f858e' },
} as const
```

In the `byGeomType('line')` loop (~line 1701), special-case it the way `isEntryExit`
already is — an established pattern in that loop:

```ts
const isTertiary = def.key === 'tertiary_road'
```

paint:

```ts
'line-color': isTertiary ? TERTIARY_ROAD_STYLE[readMapTheme()].color : def.color,
'line-opacity': isTertiary ? TERTIARY_ROAD_STYLE[readMapTheme()].opacity : 1,
'line-width': isTertiary
  // Hairline that only becomes a real stroke once zoomed into a street-level
  // view; at z12-14 it is deliberately near-subpixel so it reads as texture
  // rather than as lines competing with the project roads.
  ? ['interpolate', ['linear'], ['zoom'], 12, 0.4, 14, 0.7, 16, 1.2, 18, 2]
  : isEntryExit
    ? ['interpolate', ['linear'], ['zoom'], 4, 14, 9, 10, 14, 4, 18, 2.5]
    : 2,
```

Also set `minzoom: 12` on the added MapLibre layer to match the tile route, so the
client does not request tiles it will get empty responses for.

**Theme swap trap:** the theme-swap effect (~lines 993–1120) re-applies paint on
theme change. Add `tertiary_road`'s colour + opacity there alongside the existing
`SECTOR_COLORS[theme]` handling, or the layer keeps light-mode values after
switching to dark. This is the single easiest thing to miss in this phase.

### 3c. Z-order

Must render **beneath** `road-line` so curated project roads always win. In
`initMap` the POI line loop runs _after_ `road-line` is added, so by default it
would paint on top. Add it with the `beforeId` form —
`map.addLayer(layerSpec, 'road-line')` — or move only this key ahead of the
`road-line` insertion. Verify visually: project roads must stay clearly readable
with the street network on.

### 3d. Popups

The generic POI popup path (`popupHeaderHtml` / `propertyRowsHtml`, ~line 1195)
works with no changes: title falls back to `p.name ?? poiDef.label`, and rows are
derived from whatever the tile sent. Two touch-ups:

- `oneway` / `maxspeed` / `bridge` / `tunnel` title-case acceptably via
  `poiPropertyLabel` ("Oneway", "Maxspeed"). Nicer labels are optional; that
  function is where to special-case them.
- **Drop `osm_id` and `in_sector` from the popup rows.** `osm_id` is an external
  identifier meaningless to an operator; `in_sector` is a filter mechanism, not a
  fact about the road. Filter them the way `id` already is. Keep both in `columns`
  — 3e needs `in_sector`.

Most rows have a null name, so the popup will read "Street network (OSM)" with a
`Fclass: residential` row. That is correct and honest for this data.

### 3e. "Sector streets only" — the payoff for the subset flag

Because `in_sector` is a tile property, this is a MapLibre filter — no second layer,
no extra request:

```ts
map.setFilter('poi-tertiary_road', ['==', ['get', 'in_sector'], true])
```

Wire it to a small checkbox shown in the layer panel **only while `tertiary_road`
is on**, indented under the layer row (same nested treatment the panel already uses
for subclass chevrons). Label: "Only inside sector area". Off by default.

This is the UX answer to Pending.md's open question #2 ("full 21k or a curated
subset?") — ship both and let the user pick; cost is one filter expression.

---

# Phase 4 — `Road_Secondary`: classify, then load

Do **not** auto-classify. 61 of 109 rows have no name; guessing mislabels them.

### 4a. Produce a review artifact first

Write a throwaway script (scratchpad, not committed) dumping all 109 rows as CSV:
`row index, Name, SHAPE_Length, WKT centroid, nearest kumbh.traffic_route name +
distance, nearest kumbh.road road_name + distance`.

The spatial comparison is what resolves the nameless 61 — a row whose geometry sits
within a few metres of an existing `kumbh.traffic_route` feature is a duplicate of
already-loaded data and must be dropped, not loaded under either label.

Heuristic to _pre-fill_ the proposed classification (for a human to confirm, not to
trust):

- name matches `/entry|exit|peak|weekend/i` → `traffic_route`
- real road name (Madhya Marg, Haridwar Main Road, Upper Road) → `road`
- name null/blank → decide by proximity: near an existing traffic_route → **drop
  (duplicate)**; otherwise → `road` with `road_name = NULL`
- "Untitled Path" (4 rows) → treat as blank

### 4b. Get it confirmed

Present the CSV to the user (or whoever produced the gdb) before any write. This is
a genuine blocking checkpoint — Pending.md flagged it as unsafe to auto-decide and
that judgment is correct. Everything in Phases 1–3 is independent and should ship
without waiting on this.

### 4c. Load the confirmed split

`kumbh.road` already supports this: `_road_map` tags `road_class = "Secondary"` for
any layer that is not `ROAD_IN_M`/`Road` (`load_kumbh_2027.py:132`), and `road` is a
`REPLACE_SPECS` entry, so `Road_Secondary` can simply be appended to that spec's
`layers` list once routing/duplicate rows are excluded. Routing rows go to
`kumbh.traffic_route` — note its schema has many int flag columns (`weekend` /
`normal` / `peak_day` / …) that `Road_Secondary` cannot populate; leave them NULL
and set `name` + `entry_exit` from the parsed label.

**Normalise the casing** on load: "Peak Day Entry" / "Peak day Entry" / "Peak day
entry" / "entry" are the same thing in four spellings. Six variants collapse to
`Entry` / `Exit` / `Peak Day Entry` / `Peak Day Exit`.

Since `road` is a replace-spec, re-running rebuilds the whole table — verify the
`road` row count rises by exactly the number of confirmed road-shaped rows.

---

# Phase 5 — Ancillary routes

Add `tertiary_road` to the other whitelists for consistency, **except where it hurts**:

- `src/app/api/poi/locate/route.ts` — add
  `tertiary_road: { table: 'kumbh.tertiary_road', nameColumn: 'name' }`. Safe; only
  the 121 named rows can ever match.
- `src/app/api/poi/points/[layer]/route.ts` — **do not add.** That route serves
  whole layers as GeoJSON for client clustering and is explicitly documented as safe
  only for point tables under ~1,400 rows (`MapView.tsx` ~line 1648). This is a 21k
  line layer; it stays on vector tiles.
- `src/app/api/stats/route.ts` — check whether adding it skews the stats panel
  counts. A 21k reference layer next to 55-row curated layers probably wants excluding.
- `src/app/api/search/route.ts` — optional; 121 named rows add little.

---

# Phase 6 — Update the docs

`Pending.md`: move `Tertiary_Road` / `Sector_Tertiary_Road` from "deferred" to
"loaded", record the subset finding, and record that `Road_Secondary_Poly` /
`Road_Poly` are now **permanently skipped** (reason: 13+1 unnamed polygons,
derivable via `ST_Buffer`). Leave `Road_Secondary` pending until Phase 4 clears its
checkpoint. Update the "65 of 67" accounting line.

---

# Suggested order

1. **Phase 1** (loader) — self-contained, verifiable by row count.
2. **Phase 2** (tile route) — verify by hitting `/api/tiles/tertiary_road/15/…` and
   checking payload size; confirm z11 returns empty.
3. **Phase 3** (UI) — the design-sensitive part; check both themes at z12/14/16/18
   with the layer on **and** with project roads on simultaneously.
4. **Phase 5 + 6** — cleanup.
5. **Phase 4** — independent, gated on human confirmation; do last or in parallel.

# Acceptance checks

- `kumbh.tertiary_road` = 21,284 rows; 7,068 with `in_sector = true`; no duplicate `osm_id`.
- z11 tile empty; z13 tile contains only arterial `fclass`; z16 contains all.
- Layer OFF for both a new user and a returning user with stored prefs.
- Light and dark both legible; project road network clearly on top in both.
- Toggling theme with the layer on keeps the correct per-theme colour (3b's trap).
- No regression in the 45 pre-existing tile layers (they take none of the new fields).
