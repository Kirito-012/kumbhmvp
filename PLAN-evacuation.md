
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
| **2** ✅ | `evacLayers.ts`: core/flood layers, EN/EXT badges, basemap-label dimming, theme swap + image regeneration -- **trimmed scope**, see note | **Done 2026-09-15.** All layers create without error, verified live in both themes (light theme's basemap swap + badge image regeneration confirmed via a `data-theme` toggle, no console errors). **Deliberately deferred/cut**, each flagged in evacLayers.ts's own header comment: traffic-route/direction-signage **arrows** (needs visual verification against real routes the automated browser can't reliably do -- risk of shipping a wrong arrow); **zone outlines/labels** (geometry comes from `/api/evacuation/summary`, Phase 3); the **selected-feature glow's data** (layers exist, empty -- Phase 5 populates); **hover feature-state** (ties to Phase 5's click handling); **sector-plan-fill dimming** (skipped to avoid fighting the existing class-filter opacity effect -- only basemap-label dimming ships this phase). **Found and fixed two bugs while implementing this**: (1) a genuine "Source already exists" crash from the layer-creation guard checking the *last*-added source instead of the first, so a partial re-invocation didn't short-circuit -- fixed by guarding on the first resource created; (2) `emergency_exit` (added in Phase 0) was missing from `APP_SOURCE_IDS`, so a real theme toggle would have deleted it as a stale basemap source -- fixed, along with adding the three new Phase 2 sources to that same list. **Also revised `visibilityForMode`**: the 6 "supporting" POI layers (thematic_gate/junction/bridge/footpath/fh_location/public_service_facilities) now follow `evacVisibility` instead of being force-hidden, reusing Map mode's own `poi-*` layers directly as §5.3 always intended -- Phase 1's version force-hid every `POI_LAYER_DEFS` key with no exception, which would have made those 6 toggles inert. Per-pixel colour verification of individual thin lines/badges was limited by the automated browser's zoom precision; correctness leans on zero style-validation errors (MapLibre throws synchronously on a malformed expression) plus confirmed real data flowing to the reused sources. **⚠️ Correction added in Phase 5:** despite the above, **no evac-\* layer actually existed** for the rest of this phase's testing and all of Phases 3-4's -- `addEvacLayersInner`'s own idempotency guard silently no-op'd every time because of an unrelated classColors.ts issue (see Phase 5's note for the full story). "No console errors" was true but did not mean the layers were there; nothing in this phase's own testing exercised a code path that would have caught the gap (no click handler existed yet to query them). |
| **3** ✅ | `/api/evacuation/search` + `/summary`, `labels.ts` / `filters.ts` + vitest                                                                                                               | **Done 2026-09-15.** `npm test` green (85 tests, 25 new). All 6 example queries verified live against real data: "aiims" → "AIIMS Hospital" / "Institute of National Importance / Tertiary Hospital · 960 beds" (exact plan example); "saharanpur" → "Entry route" / "Normal day · Saharanpur corridor"; "12"/"rishikesh zone" correctly resolve sector/zone context even for rows with a null `sector` column, across every layer. `/api/evacuation/summary`'s overview counts match Phase 0's verified SQL exactly (63/6/93/65/24/2/8/50/122/17/80/19/17); sector-scoped counts/feature lists checked against sector 11. `buildEvacFilters`/`trafficRoutePlanVisible` exist and are tested but not yet wired into any UI or into evacLayers.ts's `setFilter` calls -- that's Phase 4's chips. |
| **4** ✅ | `EvacuationModePanel` (real): search, scenario/direction/corridor chips, layer toggles -- **scope change**, see note | **Done 2026-09-15.** Verified live: typing "aiims" returns the grouped result, clicking it flies to and fits the parcel AND turns the `public_service_facilities` layer on automatically; "12" matches sector 12 by both name and spatial containment, Enter activates the keyboard-highlighted row and flies + sets the right panel's title to "12. SATIDWEEP" with a working "Clear sector" link; chips (scenario/direction) and layer toggle switches all respond to clicks. **Scope change from the original sketch:** built `EvacuationModePanel` with its own self-contained search UI (input, dropdown, grouping, keyboard nav) rather than first extracting Map mode's ~700-line unified search into shared `src/components/map/search/*` components -- that refactor's only payoff was code reuse, but its risk (a visual/behavioural regression in Map mode's most-used control, with no human review of the diff) was disproportionate for an autonomous pass. Map mode's search is completely untouched -- zero lines changed in that code path. Revisit the shared-component extraction later as a low-stakes cleanup if the two ever need to change in lockstep; `EvacuationModePanel.tsx`'s own file comment flags this. Also added `zone` to `/api/sectors` (backward-compatible column addition) so "Jump to zone" can compute a zone's bbox client-side from its member sectors, per §2.4/§7.2. `evacFilters` state (deferred from Phase 1) now lives in MapView and drives the chips, wired all the way through to the map via a new `applyEvacFilters` in evacLayers.ts, called alongside `setEvacLayersVisible` (which now also takes `evacFilters`, since traffic_route's peak/normal layers need both the `traffic_route` on/off toggle AND the plan filter's choice of which to show): direction/corridor now really filter `evac-traffic-route-*`/`evac-entry-exit-line*`/`evac-direction-line`, and the scenario chips show/hide the peak vs normal core layer. Verified live (chip click, no console errors) but **not** pixel-diffed against a route filtering out, for the same automated-browser zoom-precision reason as Phase 2. **One filter is a documented no-op**: the Direction chip has no effect on `entry_exit` (the point badges) -- that layer sits on a clustered geojson source, and a style `setFilter` can't change cluster membership (CONTEXT.md §9 "Clustering"); doing this properly needs the server-side `?remark=` refetch path §6.3 describes, not built. **⚠️ Correction added in Phase 5:** `applyEvacFilters`/`setEvacLayersVisible` were themselves silently no-ops this whole phase too, for the exact same reason as Phase 2's correction above (no evac-\* layers existed yet) -- `applyEvacFilters`'s own `if (!map.getLayer(...)) return` guard absorbed it without an error. The wiring described above was real and has been confirmed working since the Phase 5 fix landed; it just wasn't actually doing anything at the time this phase was written. |
| **5** ✅ | Click branch, popups (`evacPopupContent`), selection highlight -- **steady, not pulsing**, see note | **Done 2026-09-15.** Verified live: clicking a traffic route opens "Entry route / Peak day" with Direction/Plan rows and highlights the exact clicked geometry in yellow; clicking an EXT badge opens "Exit point"; a search result's bbox highlights as a yellow rectangle; clicking bare sector area re-flies via evacFocus; no console errors. Steady highlight, not the plan's pulse-then-settle animation (deferred, same reasoning as Phase 2's arrows -- polish, not core function). **Found and fixed a real Phase-2 bug while building this**: `classColors.ts` had `hfl_area`/`hfl_line` entries in `POLYGON_LAYER_COLORS`/`LINE_LAYER_COLORS` (added "for reference" during Phase 2, commented "not yet a Map-mode toggle") -- but `POI_LAYER_DEFS` in MapView.tsx is *auto-derived* from those maps' keys, so the entries silently made Map mode's own POI loop create a `kumbh.hfl_area` vector source *before* `addEvacLayers` ever ran. `addEvacLayers`'s own idempotency guard (`if (map.getSource('hfl_area')) return`) then saw that source and silently no-op'd on every single call -- meaning **zero evac-\* layers have existed since Phase 2**, despite every Phase 2/3/4 screenshot showing what looked like working map layers (they were seeing Map mode's basemap/POI layers underneath, not evac-\*, and no evac click ever actually hit anything). Caught only now because Phase 5's click handler queries specific `evac-*` layer ids and MapLibre throws synchronously on a query against a nonexistent layer id -- with no click handler before this phase, the missing layers had no code path that would surface the gap. Root-caused via a temporary `window.__debugMap` handle + `getStyle()` inspection (removed before commit) after ruling out Strict Mode/HMR/stale-bundle theories. Fixed by removing the 4 classColors.ts entries entirely (flood risk is Evacuation-only; its colours live in `EVAC_COLORS`) -- this also means flood risk never actually appeared as a stray Map-mode toggle in production, since it required someone to notice and click a niche entry in Map mode's own search panel, but it should be treated as if it had been live since Phase 2 for any review of that work. |
| **6** ✅ | `EvacuationPanel`, `FloatingLegend` branch, phone behaviour, entrance animations                                                                                                         | **Done 2026-09-15.** Verified live in both themes and at 375px: `EvacuationPanel` rebuilt with a real hero tile row (Entry/exit points · Entry/exit routes · Traffic routes · Direction signage · Emergency exits, `AnimatedBar` share-of-max bars via `useEvacuationSummary`, new `/api/evacuation/summary`-backed hook), a "Nearby care" list (hospitals/police/fire, bed counts) when a sector/zone is focused, a static legend of every evac-\* style, and a per-focus "Features in view" list grouped by layer — all `Reveal`-staggered like the Heatmap/Ticket panels. Every care/feature row reuses `selectEvacResult` (via a new `onSelectResult` prop) for the exact same fly-in/highlight/layer-on behaviour as a search result. `EvacuationModePanel` gained the missing "Base layers" section (sector plan/boundaries/names, bound to Map mode's own shared `visibility`/`setVisibility` -- decision #6, dropped from Phase 4's scope-change note) and `Reveal` stagger on its own sections. `FloatingLegend` gained an `evacuation` branch (compact EN/EXT/Emergency/Peak/Normal key, no counts needed) and its prop types were loosened (`insightsData`/`filters`/`heatMetric` now optional) rather than forking into a second component. Verified live: sector 26 (Rishikesh) shows AIIMS Hospital with its bed count, clicking it flies in and highlights; sector/zone focus counts match the overview counts scoped correctly; at 375px each docked panel force-collapses the other exactly like Heatmap/Tickets, nothing overlaps, and the floating legend appears when the left panel is collapsed. **One deliberate scope adjustment**: the hero shows "Entry/exit points" as one combined count rather than a plan-sketch "entry points · exit points" split -- `/api/evacuation/summary`'s counts never aggregated per-direction (only labels.ts's per-row `remark` field carries that), so a true split would need a new query shape for a number nothing else in the mode needs; five real counted layers beats two invented ones. `tsc`/`eslint`/`vitest` (85 tests) clean. |
| **7** ✅ | Polish + a11y (labels, focus order, contrast), CONTEXT §9, final browser verification with screenshots (both themes + mobile)                                                            | **Done 2026-09-15.** `EvacuationModePanel`'s search combobox was the one real a11y gap found: it implements genuine roving-highlight keyboard nav (arrow keys move a `highlightIndex`, Enter activates) but never exposed that to assistive tech. Added `role="combobox"`/`aria-autocomplete="list"`/`aria-expanded`/`aria-controls` on the input and `id`s on every `role="option"` row so `aria-activedescendant` can track the highlighted row — verified live via `aria-activedescendant` updating on ArrowDown and Enter still activating the right row. Also gave the listbox's non-option children (group headers, loading/error/empty states) `role="presentation"` (previously bare `<li>`s inside a `role="listbox"`, invalid per the ARIA listbox pattern) and fixed a pre-existing invalid-HTML nit (a `<div>` wrapping `<li>`s directly inside the `<ul>`, replaced with a `Fragment`). Everything else audited clean: every icon-only button already had `aria-label` (search clear, panel collapse/expand via `Panel.tsx`), every clickable row is a real `<button>` with visible text content (native focusability + accessible name for free), only the search inputs override the default focus outline and both replace it with an explicit `focus:ring-2`, and contrast was already checked visually in both themes during Phase 6. `tsc`/`eslint` clean on every file this session touched; `npm test` 85/85. `npm run lint` itself still can't run in this checkout (pre-existing broken `chalk`/stylish formatter, unrelated to any evacuation code — confirmed via `--format json` against `src/` instead, whose only 10 findings are pre-existing stale `eslint-disable` comments in unrelated files never touched this session). Final live verification covered both themes and 375px mobile (each docked panel force-collapses the other, nothing overlaps, `FloatingLegend`'s evacuation key renders correctly) — no new console errors beyond the same pre-existing benign 404s/HMR noise seen in every earlier phase's testing.                                                                                                                                                                                |

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

## 13. Post-launch fixes (2026-09-15, after Phase 7)

User testing of the shipped mode surfaced 4 bugs, all fixed in the same session:

1. **Layer toggles had no fly-in.** Turning on an Evacuation-layer checkbox just flipped visibility with
   no zoom, unlike Map mode's own `togglePoiLayerFilter` (which flies to the layer's bbox). Fixed with a
   new `toggleEvacLayer` in MapView.tsx, reusing the exact same `/api/poi/locate?layer=...` endpoint (it
   already whitelists every table this mode's layers draw from) and `flyToBbox`, scoped to the focused
   sector when one is set. No zone equivalent — `/api/poi/locate` has no `zone` param.
2. **Selecting a sector showed no highlight/outline.** The `sector-selected-outline`/`-glow` layers'
   filter effect only ever considered Map mode's `selectedSector` or Heatmap/Ticket's `insightSector` —
   Evacuation's `evacFocus` was never wired in, so `highlightedSectorNo` was always `null` in this mode.
   Fixed by adding an `evacFocus`-aware branch to that computation (and to the effect's own deps).
3. **Right-click / clicking empty area didn't clear the selection.** Two separate gaps: (a) the
   `contextmenu` handler only ever handled Map mode's `selectedSectorRef` — Evacuation mode fell through
   to that branch's own early-return and did nothing; (b) the click handler's own "empty area" case
   (step 5) cleared `evacSelection` but never `evacFocus`, so a focused sector/zone stuck around even
   after clicking away from everything. Fixed by adding an evacuation branch to `contextmenu` (clears
   both `evacFocus`/`evacSelection`, gated on a new `evacFocusRef`/`evacSelectionRef` pair mirroring
   `selectedSectorRef` so the once-registered handler can read current state) and by also clearing
   `evacFocus` in the empty-area click branch.
4. **The Legend showed traffic routes/direction signage as blue/violet lines that never actually
   appear.** Both `evac-traffic-route-*` and `evac-direction-line` are colored by direction (green =
   entry, red = exit, via `entryExitColorExpr`/`directionLineColorExpr`) — solid vs. dashed is what
   actually distinguishes peak vs. normal day, not color. `EvacuationPanel`'s Legend and `FloatingLegend`'s
   compact key both used `var(--map-section-blue-fg)`/`-violet-fg` instead, which never appears on the
   map. Fixed by switching those swatches to `EVAC_COLORS.entry[theme]` and adding a one-line caption
   above the Legend list ("Routes and signage are colored green for entry, red for exit — solid vs.
   dashed marks peak vs. normal day") so a single-color swatch per row doesn't read as a red/green
   omission.

All 4 verified live (fly-in confirmed via `/api/poi/locate` network requests; sector highlight and
right-click/empty-click clearing confirmed via direct DOM-dispatched click events against `queryRenderedFeatures`,
since the automated browser's pixel-coordinate clicks proved unreliable for isolating "genuinely empty
area" at a given zoom/pan). `tsc`/`eslint`/`npm test` (85 tests) clean.

## 14. Deferred-item follow-up (2026-09-15) — arrows, pulse highlight, shared search UI

Three items §11's original design called for but every phase deferred (§10's Phase 2/5 notes) or explicitly
decided against (§10's Phase 4 note) were implemented as a follow-up, once the user asked for them directly:

1. **Traffic-route / direction-signage arrows (§6.2 items 5/7).** The original sketch was a
   `symbol-placement: 'line'` chevron following each line's own vertex direction — deferred every phase
   because "arrow direction depends on drawing order in the source file" (§11) and shipping a wrong one is
   worse than none. **Checked against real data before implementing anything**: for both `traffic_route`
   and `direction_line`, comparing each row's start/end vertex distance to its nearest sector centroid
   splits roughly 60/40 either way for both Entry and Exit rows — meaning the stored vertex order has no
   reliable relationship to the row's actual Entry/Exit label at all (surveyors traced these lines in
   whatever order was convenient in the source GIS software). Trusting or reversing that order would have
   pointed a large, undetectable fraction of arrows backwards.

   Shipped instead: a new `/api/evacuation/arrows` route computes, for each row with a resolvable
   Entry/Exit direction, a single point at the line's midpoint and a bearing derived from geometry that
   *is* reliable — the azimuth from that midpoint to (Entry) or from (Exit) its nearest sector's centroid,
   i.e. "into the sector" / "away from the sector". This never depends on vertex order, so it can't inherit
   that unreliability. Rendered as two new `symbol` layers (`evac-traffic-route-arrows`,
   `evac-direction-line-arrows`) on new client-populated geojson sources, using a new chevron icon
   generator (`makeChevronIcon` in `mapBadgeIcon.ts`) colored/rotated per feature (`icon-rotate` bound to
   the computed bearing), shown from z12, filtered by the same `applyEvacFilters` logic as their base
   lines. Verified live in both themes: a green chevron renders at the expected angle next to a sector-12
   route, matching the entry/exit color scheme.
2. **Selected-feature pulse animation (§6.2 item 11).** Phase 5 shipped a steady highlight instead of the
   plan's pulse-then-settle animation ("polish, not core function"). Added: the `evac-selected` effect now
   runs a ~2.4s ease-out rAF loop from an exaggerated peak (glow width 22/opacity 0.85, or point radius
   22/opacity 0.7) down to the original steady values (width 10/opacity 0.5, or radius 12/opacity 0.35),
   cancelled via the effect's own cleanup if a new selection arrives mid-pulse.
3. **Shared search UI (§7.1).** Phase 4 explicitly decided against extracting Map mode's ~700-line unified
   search, judging the regression risk to Map mode's most-used control disproportionate to the payoff for
   an autonomous pass. Re-scoped narrower once asked to do it: three genuinely reusable presentational
   pieces went into `src/components/map/search/` — `SearchInput` (icon + input, with optional combobox
   aria wiring and an optional clear button), `SearchGroupHeader` (icon chip + label + count, optional
   collapse/expand and "select all"), and `SearchResultRow` (icon+label or label+sublabel, extracted from
   Evacuation's own 3x-duplicated result-row markup). Map mode's input and every group header (Jump to
   sector / Sector classes / Roads / POI layers / Base layers) now render through the first two, verified
   byte-identical via before/after screenshots in both themes plus a live toggle-and-filter-chip check;
   the genuinely bespoke pieces (the sector-classes/POI subclass trees, the plain "Jump to sector" rows)
   were deliberately left as Map mode's own code rather than forced into a shared shape that didn't fit,
   keeping the actual regression risk near zero. `EvacuationModePanel` now uses all three components,
   including a real upgrade (icon-chip group headers with counts, where it previously had plain uppercase
   text labels) — verified live with no behavioural change to search, keyboard nav, or fly-in/highlight.

Verified live in both themes; `tsc`/`eslint`/`npm test` (85 tests) clean. A stray "SearchIcon is not
defined" runtime error surfaced mid-session and turned out to be a stale Turbopack chunk cache on a dev
server that had been hot-reloading for the entire multi-hour session — restarting it (not a code change)
resolved it; noted here in case it recurs and looks like a real regression.

## 15. Second deferred-item follow-up (2026-09-15) — zone outlines, hover, dimming, chip counts, popup rows

The remaining 5 items from §11's original design (§10's Phase 2 note, §7.2 item 4, §9's popup spec):

1. **Zone outlines never rendered.** `zone_outline` had an `EvacKey` entry and a default (off), but
   no layers existed for it in `evacLayers.ts` and `EvacuationModePanel` filtered it out of the toggle
   list entirely. Added `evac-zone-outline-line`/`-label` (a `line`+`symbol` pair on a new
   `evac-zone-outline` geojson source, fed by a new `setEvacZonesData` whenever
   `/api/evacuation/summary` resolves -- it already returns all 5 zones' unioned geometry regardless
   of focus), a new `EVAC_COLORS.zoneOutline` (amber, matching this mode's own accent), and un-filtered
   the toggle. Verified live: turning it on shows a dashed amber outline with a "Rishikesh zone" label.
2. **Hover feature-state.** Added real MapLibre feature-state hover (not a filter-swap overlay like
   Map mode's own sector hover -- 5 separate line layers would need 5x the filter bookkeeping for no
   benefit once feature-state is available, and every source here already sets `promoteId: 'id'`).
   `mousemove`/`mouseleave` on the 5 hoverable line layers (traffic routes, entry/exit routes,
   direction signage, emergency exits) toggle `feature-state.hover`, read by each layer's `line-width`
   via a `case` expression. **Hit a real MapLibre validation error while wiring this up**: wrapping
   traffic_route's zoom-interpolated width in `['case', ..., ['+', interpolateExpr, boost], ...]`
   fails style validation ("zoom expression may only be used as input to a top-level step/interpolate
   expression") and silently drops the whole layer -- fixed with a dedicated `trafficRouteWidthExpr`
   that puts the `case` inside each interpolation stop's OUTPUT instead of wrapping the `interpolate`
   itself. Verified live via direct `queryRenderedFeatures`/`getFeatureState` checks: cursor becomes a
   pointer and `hover` flips true/false correctly on enter/leave.
3. **Context dimming (`sector-plan-fill` to ~40% in Evacuation mode).** Discovered while implementing
   this that the wash **couldn't show in Evacuation mode at all**, dimmed or not: `showClassWash`'s
   mode check was hardcoded to `mode === 'map'`, contradicting decision #6/§5.3 ("sector_plan
   ... share Map mode's toggle state") for every mode except Map itself. Fixed by widening that check
   to `mode === 'map' || mode === 'evacuation'` (Heatmap/Ticket are untouched; Evacuation has no class
   filters of its own, so `emphasisActive` is always false there, meaning the toggle alone decides
   it) -- then added `SECTOR_FILL_OPACITY_DIMMED` (a second interpolate expression, each stop
   pre-multiplied by 0.4, **not** a runtime `['*', SECTOR_FILL_OPACITY[theme], 0.4]` -- that hit the
   exact same "zoom expression" validation error as item 2 above) and a shared
   `sectorFillOpacityForMode` picker used by both the theme-swap effect and the class-filter effect
   (so a theme toggle mid-evac-mode can't reset it back to full strength). **Also found and fixed a
   latent "runs before mapReady" gap** in the class-filter effect itself while chasing why the dimmed
   value wasn't applying on a cold `?mode=evacuation` load: its dependency array never included
   `mapReady`, so its only pre-map-ready pass could early-return (layer doesn't exist yet) and never
   re-run if no other dependency happened to change afterward -- invisible before now because every
   value that effect ever wrote to `sector-plan-fill`'s opacity was identical to the layer's creation-
   time value in every mode, so it never mattered whether the effect ran once or many times. Verified
   live via `getPaintProperty`: evacuation mode reads `interpolate(...,0.04,...,0.12)` (dark theme),
   exactly 0.4x Map mode's `0.1`/`0.3`.
4. **Corridor chips had no counts.** Added a `corridors` field to `/api/evacuation/summary` (a
   `count(*) FILTER (WHERE deh_dir = 1)`-style query per corridor, scoped by the same sector/zone
   focus as every other count) and lifted `useEvacuationSummary` from `EvacuationPanel` up to
   `MapView` (passed down as `summary`/`loading`/`error` props) so `EvacuationModePanel`'s Corridor
   chips can read `summary.corridors` from the same fetch instead of a second one. Verified live:
   chips read "Dehradun (3)", "Saharanpur (8)", "Meerut (5)".
5. **Traffic-route popup was missing Sector and Length.** `kumbh.traffic_route` has neither column
   directly, so both are computed in the tiles route: `length_m` via `ST_Length(geom::geography)`
   inline in the column list, `sector_no` via a `LEFT JOIN LATERAL` nearest-sector lookup (same
   technique `/api/evacuation/arrows` already uses for its bearing calculation) -- added a small
   `extraJoin` field to the tiles route's per-layer config to support it generically. Verified live:
   clicking a route now shows "Sector 21" / "Length 10.43 km" alongside the existing Direction/Plan/
   Corridors rows.

All 5 verified live (both themes where relevant); `tsc`/`eslint`/`npm test` (85 tests) clean. Two of
the five (hover, dimming) hit the same class of MapLibre "zoom expression" style-validation error --
worth remembering for any future evac-\* paint property that tries to combine a zoom-interpolated base
value with a runtime math/case wrapper: the wrapper has to live *inside* the interpolation stops, not
around the whole expression.

## 16. Direction-signage arrow visibility fix (2026-09-15)

§15 item 2 built `evac-direction-line-arrows` and confirmed it via `queryRenderedFeatures`, but a user
report ("I want to show the arrows on the signage as well") turned out to mean the arrows genuinely
weren't *visible*, not that they were missing outright -- `queryRenderedFeatures` said the feature was
there; a screenshot at a normal viewing zoom (13-16) couldn't find it on screen. Root cause: the chevron
icon's base canvas was 10 units, and at `icon-size` 0.75/0.9 (direction-line/traffic-route) the rendered
size was ~7-9 logical px -- and with no outline, a same-hue chevron sitting on top of a same-colored
route line (both green for Entry, both red for Exit) was close to invisible at typical zoom. Confirmed
only by jumping the camera directly to a known arrow's coordinates at progressively higher zoom (z19)
until it became visible, then working back down.

Fixed in `mapBadgeIcon.ts`'s `makeChevronIcon`: canvas bumped from 10 to 16 units, and every chevron now
gets a stroke outline in `EVAC_COLORS.emergencyExitCasing` (white on the light basemap, near-black on
the dark one -- the same "cut a border against whatever's underneath" pair emergency exits' own casing
line already uses, not a new color). `chevronIconId`/`ensureChevronImage` now key on the (fill, stroke)
pair together. `icon-size` raised to 1.3 (traffic routes) / 1.1 (direction signage, kept slightly
smaller since its underlying segments are shorter). Verified live in both themes at a normal viewing
zoom (15) with no camera trickery needed: a chevron is now clearly visible mid-route, correctly rotated
and colored, with a crisp contrasting outline. `tsc`/`eslint`/`npm test` (85 tests) clean.

**⚠️ Correction, same day:** §16's fix made the arrows *findable*, but a user screenshot at that same
zoom showed them rendering as an ugly red zigzag/"W" outline, not a clean triangle -- the shape itself
was the remaining problem, not just its size/contrast. The original `makeChevronIcon` drew a chevron
with a notch cut into its trailing edge (a flag/ribbon-tail shape) rather than a plain triangle, and the
notch went deep enough (30% of the shape's height) to visually split the arrowhead into two thin points
once filled and stroked at map scale -- something code review alone never caught, since the shape looks
fine as a standalone SVG-style path description and only reads as broken once actually rendered small
and rotated on the map. Replaced with a plain isoceles triangle (rounded base corners via
`quadraticCurveTo`, stroke drawn first and slightly wider than needed so it reads as a clean halo rather
than bisecting the fill). Verified live in both themes: a solid, crisply-outlined arrowhead, no zigzag.
`tsc`/`eslint`/`npm test` (85 tests) clean.

**⚠️ Second correction, same day:** the "plain triangle with rounded base" fix above still didn't hold
up -- its `quadraticCurveTo` control point sat *outside* the base line (further down/out than the two
base corners), bulging the bottom edge outward into a lopsided blob instead of a clean flat or gently
concave base; the user still called it "weird" and asked for "a professional-looking arrow." Rather than
reason about a third path description in the abstract, built a throwaway test page
(`public/arrow-test.html`, deleted before committing) rendering several candidate shapes side by side at
real map sizes (20-64px) with the browser tool, compared them visually, then ported the best one back --
a sharp tip with the curve's control point pulled *inward* (toward the tip) instead of outward, the
detail that actually makes a shape read as "arrow" rather than "flag" or "blob". This is the third
attempt at this one icon; the lesson for any future map icon that isn't a plain rectangle/circle:
render actual candidates at actual sizes before trusting a path description, rather than iterating
blind and shipping on code review alone. Verified live in both themes at the same location the earlier
screenshots came from: a clean, sharp arrowhead, correctly rotated, no blob. `tsc`/`eslint`/`npm test`
(85 tests) clean.
