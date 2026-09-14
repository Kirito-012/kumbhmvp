# PLAN-evacuation.md — Evacuation mode

> A fourth map mode for crowd-flow and evacuation planning. It looks like the plain map but shows
> only entry/exit points and routes, direction signage, emergency exits, traffic routes, a few
> supporting layers, flood-risk context, and the three base toggles. It has its own search,
> limited to those items.
>
> Companion docs: [`CONTEXT.md`](CONTEXT.md) §9 (map subsystem), §10 (GIS data), §13 (loader);
> [`PLAN-heatmap.md`](PLAN-heatmap.md) (the Insights modes; this plan reuses their structure on purpose).

---

## 1. Decisions (agreed 2026-09-15)

| #   | Decision                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Admin/manager only.** It sits in the same `canUseInsights`-gated `ModeSwitcher`. Surveyors never see it, and a `?mode=evacuation` link opens plain Map mode for them.                                                                                     |
| 2   | **Search finds individual features**, not just layers (e.g. "Saharanpur" finds the route and flies to it). This needs a new whitelisted API route.                                                                                                          |
| 3   | **Traffic-route filters** in the panel: plan scenario, direction, origin corridor (see §2.2 for what the data supports).                                                                                                                                    |
| 4   | **"Jump to sector" stays** in the evacuation search, and **zones** are searchable too (§2.4).                                                                                                                                                               |
| 5   | **Supporting layers included**, off by default: thematic gates, junctions, bridges, footpaths, fire hydrants, public service facilities (hospitals / police / fire stations).                                                                               |
| 6   | **Base toggles (sector plan / boundaries / sector names) share state with Map mode.** Evacuation-layer toggles get their own state so they never leak into Map mode's saved layers.                                                                         |
| 7   | **Nothing that isn't in the data** (assembly areas, safe zones, capacities) is in scope.                                                                                                                                                                    |
| 8   | **The 2027 geodatabase is the source of truth.** The 25 Aug 2026 shapefiles are used only for the three exceptions below, and every row taken from them is marked with `source = 'shp_2026_08_25'`.                                                         |
| 9   | **Exception A: emergency exits.** Load the 24 `Emergency Exit` paths from the 25 Aug `Sector_Plan_Road` into a new `kumbh.emergency_exit` table. Show them in Evacuation mode, and point Map mode's existing "Emergency Exit" road toggle at the new table. |
| 10  | **Exception B: flood risk.** Load `Disastar_Management` (19 HFL areas) and `HFL_Line` (17 lines). They form a "Flood risk" group, **off by default**.                                                                                                       |
| 11  | **Exception C: hospitals.** Keep the 2027 list of 57 public service facilities and add bed/category details where the 25 Aug data has them. Also add the **21 hospitals that exist only in the 25 Aug data**. The 9 substations stay out.                   |
| 12  | **The 15 entry/exit points that exist only in the 25 Aug data are not loaded.** The 2027 data's 63 points are used.                                                                                                                                         |
| 13  | **Entry markers are a green circle badge "EN"; exit markers are a red circle badge "EXT"**, in the same badge style as fire hydrants' "FH". Routes and signage use the same scheme: green = entry, red = exit.                                              |
| 14  | `Kumbh Data/` (the raw source folder, 63 MB) is gitignored. Done.                                                                                                                                                                                           |

---

## 2. Source data

### 2.1 What's in `Kumbh Data/`

| Folder                                                            | Date                   | Role                                                               |
| ----------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `Kumbh_Mela_2027_V1_07_07/…gdb` (67 layers) + `Entry_Exist_l.shp` | Last edited 6 Sep 2026 | **Primary.** Already loaded into `kumbh.*`.                        |
| `Kumbh_Mela_Shape/25_08_2026/` (71 shapefiles)                    | 25 Aug 2026            | Older. Used only for exceptions A/B/C and the sector→zone mapping. |
| `Kumbh_Mela_JSON/` (19 ArcGIS JSON)                               | 25 Aug 2026            | Oldest export, same content as the matching shapefiles. Not used.  |

All sources are in EPSG:32644 and get reprojected to 4326 on load, as today.

### 2.2 Evacuation layers already in PostGIS (from the 2027 data, checked 2026-09-15)

| Layer                     | Table                             | Rows             | Useful columns                                                                                                                                                              | Notes                                                                                                                                                        |
| ------------------------- | --------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry/exit points         | `kumbh.entry_exit`                | 63               | `remark` = Entry 31 / Exit 32                                                                                                                                               | `sector` is null on every row, so sectors come from a spatial join.                                                                                          |
| Location entries          | `kumbh.location_entry`            | 2                | `name` ("Bairagi Road", "Pantdweep")                                                                                                                                        |                                                                                                                                                              |
| Entry/exit routes         | `kumbh.entry_exit_line`           | 6                | `remark` = Entry 3 / Exit 3                                                                                                                                                 |                                                                                                                                                              |
| Direction signage         | `kumbh.direction_line`            | 93               | `remark` = ENTRY 45 / EXIT 44 / 4 destination signs ("TO DELHI NH 334", …)                                                                                                  | `sector` is mostly null.                                                                                                                                     |
| Traffic routes            | `kumbh.traffic_route`             | 65               | `entry_exit` (Entry 39 / Exit 21 / null 5), `plan` (Peak day 39 / Normal day 20 / null 6), `direction` (3 non-null), `deh_dir` 3 / `naj_dir` 0 / `sah_dir` 8 / `meer_dir` 5 | `name` is null on 33 rows and inconsistent elsewhere. `weekend`/`normal`/`peak_day` are all 0 except one row, so `plan` is the only reliable scenario field. |
| Thematic gates            | `kumbh.thematic_gate`             | 8                | `remark` (gate name)                                                                                                                                                        |                                                                                                                                                              |
| Junctions                 | `kumbh.junction`                  | 50               | `name`, `remark`                                                                                                                                                            |                                                                                                                                                              |
| Bridges                   | `kumbh.bridge`                    | 122              | `type`, `mode`, `is_temporary`                                                                                                                                              |                                                                                                                                                              |
| Footpaths                 | `kumbh.footpath`                  | 74               | `name` (1 named: "Peak Day Entry")                                                                                                                                          |                                                                                                                                                              |
| Fire hydrants             | `kumbh.fh_location`               | 17               | `fh_name`                                                                                                                                                                   |                                                                                                                                                              |
| Public service facilities | `kumbh.public_service_facilities` | 59 (57 + 2 FSTP) | `type` (Hospital 21 / Police 22 / Fire Station 2 / …), `subclass`/`services`/`category`/`bed` all null                                                                      | Exception C fills these in.                                                                                                                                  |

**Filters this supports:** Plan (All / Normal day / Peak day; no Weekend, because that data is empty) ·
Direction (Entry / Exit) · Corridor (Dehradun / Saharanpur / Meerut; chips are driven by counts,
so Najibabad, with 0 routes, is hidden).

### 2.3 New data to load (exceptions A/B/C)

| Target                                                  | Source (25 Aug shapefiles)                             | Rows                 | Mapping                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`kumbh.emergency_exit`** (new, MultiLineString)       | `Sector_Plan_Road.shp` where `Type = 'Emergency Exit'` | 24                   | `road_name` ← Road_Name ("Pathway"), `row_width_m` ← ROW, `sector_name` ← Sector_Nam, `sector_no` parsed from name (existing `_sector_no_from_name`), `source`. Sectors: Bairagi Camp‑11 (12), Sati Dweep‑12 (8), Gauri Shankar‑07 (3), Neeldhara‑09 (1). 23 of 24 run along 2027 Proposed Roads, so they're real paths, just labelled differently in 2027.                                                                 |
| **`kumbh.hfl_area`** (new, MultiPolygon)                | `Disastar_Management.shp`                              | 19                   | `type` ← Type ("HFL Area"), `name` ← Remark (e.g. "KANKHAL-10"; all 19 match 2027 sector names exactly), `sector_no` parsed, `area_m2` ← SHAPE_Area, `source`.                                                                                                                                                                                                                                                              |
| **`kumbh.hfl_line`** (new, MultiLineString)             | `HFL_Line.shp`                                         | 17                   | `name` ← Name ("25 Y RB"), `return_period_years` 25/50/100 parsed, `bank` LB/RB/null parsed, `source`. Lines are 4.7–67 km long.                                                                                                                                                                                                                                                                                            |
| **`kumbh.public_service_facilities`** (enrich + append) | `Public_Service_Facilities.shp`                        | +21 rows, 2 enriched | All 57 rows from 2027 match a 25 Aug row by centroid (≤15 m). Matched rows get `subclass`/`services`/`category`/`bed` copied over when the 2027 value is null. The shapefile-only rows with `Type ∈ {Hospital, Health Camping}` (21) are appended, including AIIMS (960 beds), Mela Hospital, and Harmilap Mission (238 beds). Substations (9) are skipped. A new `source` column is added: `'gdb_2027'` for existing rows. |
| **`kumbh.sector_boundary.zone`** (new column)           | `SECTOR_BOUNDARY_UPDATED.shp` `Zone`                   | 32                   | Joined **by sector name** (all 32 match). 5 zones: Pantdweep 9, Rishikesh 9, Bairagi Camp 8, Gaurishankar 3, Ranipur 3.                                                                                                                                                                                                                                                                                                     |

Not loaded: the separate `Zonal_Boundary.shp` (5 polygons that don't cover all 32 sectors; the per-sector
`Zone` column is complete, so zone outlines are dissolved from sectors instead), the 15 entry/exit points
that exist only in the 25 Aug data, and the substations.

### 2.4 Zones

`zone` on `sector_boundary` powers:

- A **"Zones" search group** ("Rishikesh zone" → fit to the combined extent of its 9 sectors).
- An off-by-default **"Zone outlines"** supporting toggle: `ST_Union` of each zone's sectors, returned by the summary endpoint as GeoJSON (5 features). Drawn as a thick dashed outline with a zone-name label.

---

## 3. Phase 0 — data load ✅ **done 2026-09-15**

Everything goes **through `scripts/load_kumbh_2027.py`**, so a full reload reproduces it and nothing is a one-off SQL fix.
Implemented as built (a couple of details changed from the original sketch — noted inline):

1. **Source paths:** `GDB_PATH`/`ENTRY_EXIST_SHP` used to point at `REPO_ROOT/Kumbh_Mela_2027_V1_07_07/`. Added
   `resolve_source_root()`/`set_source_root()` + a `--source-root` flag (default: `REPO_ROOT/Kumbh Data/` if its gdb
   is present, else the legacy repo-root layout) and a `SHP_2026_08_25_DIR` constant, all as mutable module globals
   resolved once at the top of `main()`. `.gitignore` now has `/Kumbh Data/` (done, see decision #14).
2. **Shapefile specs — a separate `SHP_TABLE_SPECS` list, not `NEW_TABLE_SPECS` extensions.** `NEW_TABLE_SPECS`'
   tuple shape (`table, columns, geom_type, layers, map_fn`) has no room for a different source directory or a
   row-level filter without changing every existing entry, so `SHP_TABLE_SPECS` is its own list of
   `(table, columns, geom_type, shp_filename, map_fn, feature_filter)` tuples, loaded by a new `load_shp_new_table()`
   (mirrors `load_new_table()`: reproject, `force_2d`, GiST index — plus `to_multi()`, since the 25 Aug shapefiles
   store some of these as plain Polygon/LineString rather than the Multi variant the target column needs).
   `emergency_exit`/`hfl_area`/`hfl_line` are its three entries; `emergency_exit`'s `feature_filter` picks out
   `Sector_Plan_Road.shp`'s `Type = 'Emergency Exit'` rows.
3. **Post-load hooks** (the same pattern as `backfill_sector_no` / `dedupe_tertiary_road`), run from `main()` right
   after their table loads:
   - `supplement_public_service_facilities(conn, dry_run)`: matches the older drop's facilities onto the gdb rows by
     nearest centroid (≤20m, in EPSG:32644) and appends the ones the gdb doesn't have. Idempotent: deletes
     `source='shp_2026_08_25'` rows before re-appending. Runs automatically after every `public_service_facilities`
     load (including a bare `--only public_service_facilities`), so the hospitals never silently disappear. In
     `--dry-run`, falls back to matching against _all_ existing rows (unfiltered by `source`) when that column
     doesn't exist yet, since a dry run never reaches the `ALTER TABLE` that adds it.
   - `backfill_sector_zone(conn, dry_run)`: adds `zone text` to `sector_boundary` if missing and fills it by name
     from the older drop's own `SECTOR_BOUNDARY_UPDATED.shp` (all 32 names match exactly).
   - `emergency_exit`'s one row with no parseable trailing `-NN` reuses `backfill_sector_no` (it only assumes
     `sector_no`/`geom` columns, so it works unchanged on this table too) — in the end all 24 rows parsed from
     `Sector_Nam` directly, so this backfilled 0 rows on the actual run.
4. **Dry-run first:** `--dry-run --only emergency_exit,hfl_area,hfl_line,public_service_facilities,sector_boundary` —
   run, output reviewed (24/19/17 rows; 57/59 facilities matched, 21 appended; 32 sectors → 5 zones, matching the
   §2.3 table exactly), **then** the real run. Backed up as usual (`sector_boundary_backup_20260915`,
   `public_service_facilities_backup_20260915`); `emergency_exit`/`hfl_area`/`hfl_line` are new tables, nothing to
   back up. Verified again by direct SQL after: row counts, geometry types/SRID, sector_no/zone/source values all
   correct (see the session transcript for the full query output).
5. **App whitelists:** added `emergency_exit`, `hfl_area`, `hfl_line` to the tiles route's `LAYERS` and
   `/api/poi/locate`'s `LAYERS`, plus `classColors.ts` `LINE_LAYER_COLORS`/`_LABELS`
   (`hfl_line`) and `POLYGON_LAYER_COLORS`/`_LABELS` (`hfl_area`) — labelled "(25 Aug 2026 survey)" and marked in
   comments as **not yet** a Map-mode `POI_LAYER_DEFS` toggle (that's Evacuation mode's job, Phase 2). Added `zone`
   to the `sector_boundary` tile columns. **Deliberately did NOT** add `hfl_area`/`hfl_line` to `/api/stats`'
   `POI_TABLES` — that would render a Stats-panel checkbox with no matching `POI_LAYER_DEFS` visibility key behind
   it (a dead toggle), since flood risk isn't a Map-mode layer at all, only an Evacuation-mode one.
6. **Map mode's Emergency Exit toggle:** the existing `road_emergency_exit` key keeps its label, swatch, and exact
   prior look (solid `ROAD_TYPE_COLORS['Emergency Exit']`, 2px — no casing/label/dash added, since those are
   Evacuation-mode-only embellishments per Phase 0's "no other Map-mode change" rule). Its paint moved from a
   `road-line` `type` filter to a new `emergency-exit-line` layer/source, added right after `road-line` in
   `MapView.tsx`'s `load` handler. `applyLayerVisibility`'s `road-line` entry now excludes Emergency Exit from its
   "any road type on" check (that type no longer exists in `kumbh.road`) and a new `['emergency-exit-line',
visibility.road_emergency_exit]` entry was added alongside it. Click handling, the popup header/property-rows
   (including a "Source: 25 Aug 2026 survey" row), and the sector-filter effect's `setFilter` all treat
   `emergency-exit-line` the same as `road-line`. The road stats query now `UNION`s a synthetic `'Emergency Exit'`
   row sourced from `kumbh.emergency_exit` so the Stats panel keeps showing it even though it's gone from
   `kumbh.road`'s own `DISTINCT type` list — verified live: sector 11 (Bairagi Camp) shows 12 segments / 4.1 km,
   matching the SQL exactly. Popups reuse the road popup (`isRoad` now covers both layer ids).
7. **Docs:** `CONTEXT.md` §10 (new "Two source drops" subsection) and §13 (`--source-root`, `SHP_TABLE_SPECS`,
   the three new hooks) updated; §16 "Current state" notes Phase 0 as done.

**Verification:** `tsc --noEmit` and `eslint` clean (no new warnings) on every touched file. Logged into the dev
server as the seeded admin, confirmed: Emergency Exit toggle now appears (was always visible, previously drew
nothing) and can be turned on/off from both the search panel and the Stats panel's road-type rows; the Stats
panel's road-by-type table shows real segment/km numbers for Emergency Exit again; no new console errors or
network failures. Did **not** manage to click-verify the 2px `emergency-exit-line` pixel itself in the automated
browser (too easy to miss at that width) — that code path is a direct, mechanical copy of the already-exercised
`road-line` click/popup handling, just extended to a second layer id everywhere it appears.

---

## 4. Architecture

### 4.1 New files

```
src/components/map/evacuation/
  evacLayers.ts            # add/show/hide/theme evac MapLibre layers, arrow + badge images, filters
  EvacuationModePanel.tsx  # left panel: search, filters, layer toggles
  EvacuationPanel.tsx      # right panel: summary counts, legend, selected-sector/zone feature list
  useEvacuationSearch.ts   # debounced + abortable fetch of /api/evacuation/search
  useEvacuationSummary.ts  # counts per layer / filter chip / sector, zone outlines
src/components/map/search/
  SearchInput.tsx, SearchGroup.tsx, SearchLayerRow.tsx, SearchResultRow.tsx
                           # presentational pieces extracted from MapView's unified search (§7.1)
src/lib/evacuation/
  layers.ts                # EVAC_CORE_KEYS / EVAC_SUPPORT_KEYS / EVAC_FLOOD_KEYS, labels, theme colour pairs
  labels.ts                # traffic-route / facility label normalisation
  filters.ts               # EvacFilters type + MapLibre filter-expression builders
  *.test.ts                # vitest for labels.ts and filters.ts
src/app/api/evacuation/
  search/route.ts
  summary/route.ts
```

### 4.2 Changes to existing files

- `insights/ModeSwitcher.tsx`: `MapMode` gains `'evacuation'`, a 4th segment, and its indicator colour.
- `icons.tsx`: new `EvacuationIcon` (an exit arrow leaving a doorway), same stroke weight and 24-unit grid as the existing icons.
- `globals.css`: `--map-mode-evacuation` for both themes (amber: `#fbbf24` dark / `#d97706` light, distinct from heatmap red and tickets green).
- `MapView.tsx`: mode wiring, `visibilityForMode`, click branch, theme-swap registration, panel slots, keyboard shortcut, Emergency Exit layer (§3.6). The bulk of the logic lives in the new modules.
- `lib/classColors.ts`: `POI_SIGNAGE_CODES` badges and the new layer colours and labels.
- Tiles / locate / stats / points routes: whitelist additions (§3.5, §6.3).
- `scripts/load_kumbh_2027.py`: §3.
- `CONTEXT.md`: §9 new subsection (+ remove the fixed deep-link gotcha), §10, §13.

---

## 5. Mode state and shell

### 5.1 State in MapView

| State                                                                                                       | Persisted                                       | Purpose                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode: 'evacuation'`                                                                                        | URL `?mode=evacuation`                          | Same URL-sync effect as the other modes.                                                                                                                                         |
| `evacVisibility: Record<EvacKey, boolean>`                                                                  | localStorage `tcsticket:mapView:evacVisibility` | Core layers on; supporting and flood layers off. Hydrated after mount like `visibility` to avoid a hydration mismatch. Merged over defaults so keys added later get sane values. |
| `evacFilters: { plan?: 'Normal day' \| 'Peak day'; direction?: 'Entry' \| 'Exit'; corridors?: Corridor[] }` | URL `eplan` / `edir` / `ecorr`                  | So a filtered view can be shared.                                                                                                                                                |
| `evacFocus: { kind: 'sector', sectorNo } \| { kind: 'zone', zone } \| null`                                 | URL `esector` / `ezone`                         | Kept separate from Map mode's `selectedSector`, so the Sector Report drawer never opens here (same reasoning as `insightSector`).                                                |
| `evacSelection: { layer, id, geometry, anchor } \| null`                                                    | —                                               | The highlighted search result or clicked feature.                                                                                                                                |

A ref mirrors each of these for the one-time `load` handler (the `modeRef` / `insightsDataRef` pattern).

### 5.2 ModeSwitcher

- Order: **Map · Heatmap · Tickets · Evacuation**. Appended so existing `1`/`2`/`3` muscle memory still works; `4` selects Evacuation.
- The roving-tabindex code already uses `SEGMENTS.length`, and the indicator uses `activeIndex * 2rem`. Check that the indicator still sits centred on segment 4.
- `Esc` in Evacuation mode steps back one level per press: clear `evacSelection` → clear `evacFocus` → return to Map. Skipped while an input has focus or measure mode is on, as today.

### 5.3 What changes when the mode is on (`visibilityForMode`)

- All road types and POI layers are forced off **except** the evacuation keys, which follow `evacVisibility`. The emergency exit layer counts as an evacuation key. Supporting layers use their normal Map-mode layers, so they look identical.
- `sector_plan` / `sector_boundary` / `sector_names` follow the **user's shared** `visibility` (decision #6). Unlike Heatmap/Tickets, sector names are not forced off.
- Everything goes through the temporary override and is never written to `visibility` or localStorage (PLAN-heatmap §9).
- **Deep-link fix:** add `mapReady` to the mode-visibility effect's dependencies so `?mode=evacuation` (and the existing
  `?mode=heatmap`) work on a cold load. Remove the gotcha from CONTEXT.md.

---

## 6. Map layers — `evacLayers.ts`

Same design as `insightLayers.ts`: **dedicated `evac-*` layers are created once in `load`** (gated on
`canUseInsights`), start hidden, and are toggled by `setEvacLayersVisible(map, on, evacVisibility)`. They reuse existing
tile/geojson **sources**, so Map mode's own styling is never modified.

### 6.1 Visual language

| Meaning                    | Light                                  | Dark                              | Where                                                                                                                                                                          |
| -------------------------- | -------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry                      | `#16a34a`                              | `#22c55e`                         | EN badge, entry routes, entry signage (the existing "green = entry/exit" convention, now entry only)                                                                           |
| Exit                       | `#e11d48`                              | `#fb7185`                         | EXT badge, exit routes, exit signage. Rose-red: clearly "red", but a different hue from fire hydrants' `#dc2626` so "FH" and "EXT" are never confused when both layers are on. |
| Emergency exit             | `#dc2626` core + white casing          | `#f87171` core + `#0b0f19` casing | Keeps Map mode's red dotted look; the casing and label (§6.2) set it apart from exit routes.                                                                                   |
| Flood area                 | `#2563eb` @ 14% fill + 1px 60% outline | `#60a5fa` @ 18% fill              | Translucent. Drawn under everything except the sector wash.                                                                                                                    |
| Flood line                 | `#1d4ed8`                              | `#93c5fd`                         | Dashed; opacity 0.45 / 0.65 / 0.9 for 25 / 50 / 100-year floods.                                                                                                               |
| Unknown / destination sign | `#64748b`                              | `#94a3b8`                         | Neutral slate.                                                                                                                                                                 |

Badge text colour comes from `readableTextOn()`, and every pair is checked for ≥3:1 contrast against its basemap in Phase 7.

### 6.2 Layers (bottom → top, inserted below the POI point layers so markers stay on top)

1. **Context dimming (reversible):** `sector-plan-fill` opacity drops to about 40% of its Map-mode value, and basemap place labels dim via `setBasemapLabelsDimmed`. Both are restored when leaving the mode.
2. **`evac-hfl-area-fill` + `evac-hfl-area-outline`** (flood group, off by default), then **`evac-hfl-line`**.
3. **`evac-zone-outline` + `evac-zone-label`** (supporting, off by default): geojson source from `/api/evacuation/summary`.
4. **`evac-traffic-route-casing` + `evac-traffic-route`:** a road-style casing plus core coloured by `entry_exit`. **Peak day** is a solid core; **Normal day** is dashed. That's two layers split by `plan`, because data-driven `line-dasharray` isn't reliable in MapLibre 6.4. Width grows as you zoom out, like `entry_exit_line`, so routes stay readable at region zoom.
5. **`evac-traffic-route-arrows`:** a `symbol` layer, `symbol-placement: 'line'`, with a chevron image generated on a canvas like `makeBadgeIcon`, one per colour. `symbol-spacing` about 90 px, shown from z12.
   ⚠️ **Arrow direction follows the order each line was drawn in the source GIS file.** Phase 2 spot-checks Entry/Exit routes against the map. If the drawing order isn't consistent, the arrows are dropped (a wrong arrow is worse than none) and that goes in the gotchas.
6. **`evac-entry-exit-line-glow` + `evac-entry-exit-line`:** the existing glow treatment, split into entry/exit colours.
7. **`evac-direction-line` + `evac-direction-arrows`:** a thinner line with chevrons. The 4 destination signs get a line-following `text-field` label from z14.
8. **`evac-emergency-exit-glow` + `-casing` + `evac-emergency-exit`:** a soft red glow that fades as you zoom in, a casing, and a red dotted core, so the 24 short paths stay findable at region zoom. From z15, an "EMERGENCY EXIT" line label.
9. **Entry/exit badges (`evac-entry-exit-badge`):** registered through **`POI_SIGNAGE_CODES` / `makeBadgeIcon`**: a green `EN` circle for Entry, a rose `EXT` circle for Exit, on the existing clustered geojson source with `icon-image` chosen by `remark`. Clusters keep the existing cluster circle and click-to-zoom. The badge renders as a circle like "FH" does. `makeBadgeIcon` is checked for a 3-character label; if "EXT" gets too wide, the circle grows slightly rather than becoming a pill.
10. **`evac-location-entry-badge`:** green `EN` badge with the name label from z15.
11. **`evac-selected-glow` + `evac-selected`:** a geojson source holding the selected feature. A thick accent halo pulses for about 2.4 s via a rAF tween of `line-opacity` / `circle-radius` (cancelled on unmount, mode exit, or a new selection), then stays as a steady outline until cleared.
12. **Hover:** a `feature-state` hover outline on routes and lines, with a pointer cursor, like the existing sector hover.

### 6.3 Filters

`buildEvacFilters(evacFilters)` in `src/lib/evacuation/filters.ts` returns one MapLibre filter per evac layer, applied with `setFilter`.
Plan and direction chips affect only layers that have those fields. Corridor chips apply to traffic routes only (`sah_dir = 1` OR …).
Entry/exit points use a clustered geojson source, and **a style filter can't change cluster counts** (CONTEXT §9),
so the direction filter reuses `refetchClusteredPoiSource` with a server-side `?remark=` parameter (whitelisted for `entry_exit` only in `/api/poi/points/[layer]`).

### 6.4 Theme swap — easy to miss

`applyEvacTheme(map, theme)` is called from **the** theme-swap effect. It re-sets every `evac-*` colour and **regenerates
the chevron and EN/EXT badge images** (`removeImage` + `addImage`), because the images are coloured when created. The same applies to the
new Map-mode `emergency-exit-line`. Checked in both themes in Phase 7.

---

## 7. Panels

Both are `Panel`s with `entrance="slide"`. Sections use `Reveal` with a stagger, and count bars use `AnimatedBar` +
`pillEntranceDelayMs`, the same as the Insights panels. They auto-collapse below `sm`, `expandedDockedPanel` keeps one open at a time on
phones, and widths feed `rightPanelWidthRef` / `applyMapPadding()` so fly-ins stay centred.

### 7.1 Shared search UI (a refactor, not a redesign)

Map mode's unified search is about 700 lines of JSX in `MapView.tsx`. Its **presentational** pieces move into
`src/components/map/search/`: the input with icon, the collapsible group header with count and icon theme, the checkbox layer row with swatch or badge
and count, and a new result row (icon, label, sub-label, sector/zone chip). Map mode's behaviour and markup stay the same,
verified with before/after screenshots in both themes.

### 7.2 Left — `EvacuationModePanel` (title "Evacuation", `EvacuationIcon`)

1. **Search** (pinned). Placeholder: "Search exits, routes, signage, sectors, zones…". Groups:
   - **Jump to sector:** existing client-side matching → `evacFocus` + `flyToSectorNo`.
   - **Zones:** client-side match on the 5 zone names → fit the zone extent + `evacFocus`.
   - **Evacuation layers** (core) · **Supporting layers** · **Flood risk:** layer rows with checkbox, badge/swatch, count.
   - **Places:** results from `/api/evacuation/search`, grouped by layer, 5 per group with a "+N more" expander.
   - Keyboard: `↓`/`↑` move through results, `Enter` opens, `Esc` closes the dropdown (and doesn't leave the mode).
     Loading is a thin bar using the `loading-sweep` keyframes. Empty state: "No evacuation features match '…'". Errors show inline with Retry.
2. **Scenario:** a segmented control (All / Normal day / Peak day) in Heatmap's metric-control style.
3. **Direction:** Entry / Exit chips with the EN/EXT badge colours.
4. **Corridor:** chips for the non-empty corridors, with counts.
5. **Layers:** the full toggle list: core, supporting, then flood risk. Flood rows say "Source: 25 Aug 2026 survey".
6. **Base layers:** the same three rows as Map mode, bound to the **shared** `visibility`.
7. **Clear all** when any filter, focus or selection is active.

### 7.3 Right — `EvacuationPanel` (title "Evacuation overview" / "Sector NN. Name" / "Rishikesh zone")

- **Hero:** entry points · exit points · traffic routes · signage · emergency exits, as a tile row with share bars, reflecting the current filters and focus.
- **Nearby care** (when a sector or zone is in focus): hospitals and police/fire stations inside it, each showing bed count when known. Clicking a row → fly-in.
- **Legend:** small samples of every §6.1/§6.2 style (EN/EXT badges, solid vs dashed, arrows, emergency casing, flood fill/lines).
- **Feature list** (when focused): grouped by layer, each row clickable → the same fly-in + highlight + popup as search.
- When collapsed, `FloatingLegend` gets an `evacuation` branch: a compact EN · EXT · Emergency · Peak/Normal key.

---

## 8. API

Both routes use `runtime = 'nodejs'`, `getPool()`, and parameterised SQL over a **whitelist of table and column names written in the route file**, never
taken from the request. Both are gated on the session plus the grant check behind `canUseInsights`.

### 8.1 `GET /api/evacuation/search?q=&limit=5`

- `q` is trimmed, 2–64 characters, with `%`/`_` escaped. One `ILIKE $1` per whitelisted layer over its searchable columns:
  traffic_route → `name, entry_exit, plan, direction` + corridor words matched against the `*_dir` flags; direction_line → `remark`;
  entry_exit_line/entry_exit → `remark`; location_entry → `name`; emergency_exit → `road_name, sector_name`;
  thematic_gate → `remark`; junction → `name, remark`; bridge → `mode, type`; fh_location → `fh_name`;
  public_service_facilities → `name, type, subclass, category`; hfl_area → `name, type`; hfl_line → `name`.
- **Sector- and zone-aware:** each row gets its sector (and that sector's zone) from a `LEFT JOIN LATERAL` against `kumbh.sector_boundary`
  on `ST_Intersects(boundary, ST_PointOnSurface(feature))`, so "12", "Bairagi" or "Rishikesh zone" match features inside, even when
  the feature's own `sector` column is null.
- Response: `{ groups: [{ layer, total, results: [{ id, label, sublabel, sectorNo, sectorName, zone, bbox, anchor, geometry, source }] }] }`.
  Labels come from `labels.ts` (unit-tested), e.g. "Entry route" · "Peak day · Saharanpur corridor"; "AIIMS Hospital" · "960 beds".
- The client debounces 200 ms and uses `AbortController`, so an old response never replaces a newer query.

### 8.2 `GET /api/evacuation/summary?sector=&zone=`

Counts per layer and per filter chip; the 5 zone outlines (`ST_Union`, simplified) as GeoJSON; and, when focused, the feature
list and care facilities with bbox/anchor. One small query per layer via `Promise.all`, with the same cache headers as `/api/sectors`.

---

## 9. Interaction — click, popup, fly-in

**Click order when `modeRef.current === 'evacuation'`** (a new branch in the `load` click handler):

1. Measure mode (unchanged).
2. Cluster → `easeTo` +3 zoom (unchanged).
3. `evac-*` feature → `evacSelection` + popup. **No fly** for a map click (the feature is already on screen; Ticket mode's rule).
4. Supporting-layer feature → existing POI popup.
5. Bare sector → `evacFocus` + `flyToSectorNo`. Empty area → clear the selection.

**Search result / right-panel row → `openEvacFeature(result)`:**

1. Turn the layer on in `evacVisibility` if needed. If a chip filter would hide the result, clear that filter and show "Filters cleared to show this result".
2. Lines/polygons: `fitBounds(bbox, { padding: fitBoundsMargin(), maxZoom: 16.5, duration: 800 })`.
   Points: `flyTo({ center, zoom: max(current, 16.5), duration: 800 })`. These are the same timings as the existing locate fly-ins and respect the
   persistent `setPadding` centring (commit 13f6298). Sectors reuse `flyToSectorNo`; zones use `fitBounds` over the zone bbox.
3. On the next `moveend`: pulse highlight, then open the popup at `anchor` (`ST_PointOnSurface` from the API).
4. On phones, close the dropdown so the map is visible.

**Popups** use the existing icon-header + labelled-rows HTML. Traffic route: Direction, Plan, Corridors (flags that are set), Sector,
Length. Facility: Type, Category, Beds. Emergency exit / flood rows add a "Source: 25 Aug 2026 survey" footer line.

---

## 10. Phases (one conventional commit each; stop for review after Phases 0, 2 and 4)

| Phase    | Scope                                                                                                                                                                                    | Done when                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** ✅ | Data load (§3): loader `--source-root`, shapefile specs, PSF + zone hooks, dry-run → **review** → real run; whitelists; Map-mode Emergency Exit toggle on the new table; CONTEXT §10/§13 | **Done 2026-09-15.** 24 / 19 / 17 / +21 / 32 rows verified in SQL; Map mode shows emergency exits again with Stats count 24 (12 segs/4.1km on sector 11, checked live); no other Map-mode change; `tsc`/`eslint` clean |
| **1** ✅ | Mode plumbing: `MapMode`, 4th segment, icon, CSS token, `4` shortcut, `Esc` steps, URL params, `evacVisibility` + hydration, `visibilityForMode`, **deep-link fix**, empty panel shells  | **Done 2026-09-15.** Verified live: `4`/`Esc`/ModeSwitcher-click all work, `?mode=evacuation` cold-loads straight into the mode, Map mode's own visibility/localStorage untouched (separate `evacVisibility` store). The "deep-link fix" turned out to be **already fixed** — the mode-visibility effect was already gated on `mapReady`, not `isStyleLoaded()` (CONTEXT.md's gotcha note was stale); updated the doc instead of the code. Created `src/lib/evacuation/layers.ts` (key lists, labels, `EvacFocus`/`EvacSelection` types, palette) and a minimal `filters.ts` (just the `EvacFilters` type) ahead of §4.1's schedule since Phase 1's own state needed them; `evacFilters` state itself is deferred to Phase 3 (nothing consumes it yet). `tsc`/`eslint`/`vitest` clean. |
| **2** ✅ | `evacLayers.ts`: core/flood layers, EN/EXT badges, basemap-label dimming, theme swap + image regeneration -- **trimmed scope**, see note | **Done 2026-09-15.** All layers create without error, verified live in both themes (light theme's basemap swap + badge image regeneration confirmed via a `data-theme` toggle, no console errors). **Deliberately deferred/cut**, each flagged in evacLayers.ts's own header comment: traffic-route/direction-signage **arrows** (needs visual verification against real routes the automated browser can't reliably do -- risk of shipping a wrong arrow); **zone outlines/labels** (geometry comes from `/api/evacuation/summary`, Phase 3); the **selected-feature glow's data** (layers exist, empty -- Phase 5 populates); **hover feature-state** (ties to Phase 5's click handling); **sector-plan-fill dimming** (skipped to avoid fighting the existing class-filter opacity effect -- only basemap-label dimming ships this phase). **Found and fixed two bugs while implementing this**: (1) a genuine "Source already exists" crash from the layer-creation guard checking the *last*-added source instead of the first, so a partial re-invocation didn't short-circuit -- fixed by guarding on the first resource created; (2) `emergency_exit` (added in Phase 0) was missing from `APP_SOURCE_IDS`, so a real theme toggle would have deleted it as a stale basemap source -- fixed, along with adding the three new Phase 2 sources to that same list. **Also revised `visibilityForMode`**: the 6 "supporting" POI layers (thematic_gate/junction/bridge/footpath/fh_location/public_service_facilities) now follow `evacVisibility` instead of being force-hidden, reusing Map mode's own `poi-*` layers directly as §5.3 always intended -- Phase 1's version force-hid every `POI_LAYER_DEFS` key with no exception, which would have made those 6 toggles inert. Per-pixel colour verification of individual thin lines/badges was limited by the automated browser's zoom precision; correctness leans on zero style-validation errors (MapLibre throws synchronously on a malformed expression) plus confirmed real data flowing to the reused sources. |
| **3**    | `/api/evacuation/search` + `/summary`, `labels.ts` / `filters.ts` + vitest                                                                                                               | `npm test` green; "saharanpur", "12", "rishikesh zone", "hospital", "exit", "aiims" return sensible grouped results                                                                                                    |
| **4**    | Search UI extraction + `EvacuationModePanel`                                                                                                                                             | Map-mode search looks the same before/after; evac search, chips and toggles work by keyboard                                                                                                                           |
| **5**    | Click branch, popups, `openEvacFeature` fly-in + pulse highlight                                                                                                                         | Every result type flies, highlights and opens its popup; stale-response and rapid-click cases behave                                                                                                                   |
| **6**    | `EvacuationPanel`, `FloatingLegend` branch, phone behaviour, entrance animations                                                                                                         | Panels slide and cascade like Insights; at 375 px one panel at a time, nothing overlaps                                                                                                                                |
| **7**    | Polish + a11y (labels, focus order, contrast), CONTEXT §9, final browser verification with screenshots (both themes + mobile)                                                            | `npm run lint`, `tsc`, `npm test` clean                                                                                                                                                                                |

---

## 11. Risks and gotchas

- **Phase 0 writes to the shared Supabase DB.** Dry-run output gets reviewed first; replaced tables are backed up by the loader.
- **Mixed-source data:** the exception rows must always carry `source`, and the UI says so, so 25 Aug data is never mistaken for 2027 data.
- **PSF reloads:** the supplement hook must run after any gdb reload of `public_service_facilities`, or the 21 hospitals disappear silently.
- **Arrow direction** depends on drawing order in the source file (§6.2 item 5).
- **Theme swap:** every `evac-*` paint property, the new Map-mode emergency layer, _and_ the generated images must be registered (§6.4).
- **Clustered sources ignore style filters** for counts, so the direction filter refetches server-side (§6.3).
- **Override, never persist** (PLAN-heatmap §9).
- **MapView size:** new logic lives in `evacuation/` and `lib/evacuation/`; MapView only gains wiring.
- **Search refactor regression:** before/after screenshots of Map mode are required.
- **Traffic route names are messy**, so labels always come from `labels.ts`.

## 12. Out of scope

Assembly areas / safe zones / capacities, live crowd density, routing ("nearest exit from here"), printable evacuation sheets,
surveyor access, the 15 entry/exit points and 9 substations that exist only in the 25 Aug data, and `Zonal_Boundary.shp`.
