# PLAN — Heatmap & Ticket modes on the map

Branch: `feat/heatmap` (cut from `main` @ `37769dc`).
Status: **Phases 1-7 complete.**

Two new map modes for Admins and Managers, switched from a segmented pill in the top-left control strip:

| Mode        | What the map shows                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Map**     | Today's map, unchanged. Default mode, and the only mode surveyors ever see.                                                                                                                          |
| **Heatmap** | Where the open work is. A free-flowing, translucent green → red density glow over the exact spots with many open tickets, at every zoom, over thin sector boundaries only (revised in Phase 7, §11). |
| **Tickets** | Every parcel coloured by its ticket's status: New blue, Open/Pending amber, Resolved green, Closed slate.                                                                                            |

Both modes share one **Insights panel** (right) and one **mode panel** (left).

---

## 1. Decisions (agreed 2026-09-13)

| #   | Question                        | Decision                                                                                                                     |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | What drives "more red"          | **Open tickets** by default. The mode panel can switch to _% open_, _total_, or _open per hectare_.                          |
| 2   | Heatmap geometry                | **Hybrid.** Sectors are shaded when zoomed out and cross-fade to a MapLibre `heatmap` glow when zoomed in.                   |
| 3   | Ticket-mode colours             | **Blue / Amber / Green / Slate.** New, Open+Pending, Resolved, Closed.                                                       |
| 4   | Existing panels while in a mode | **Swap.** Left becomes the mode panel, right becomes the Insights panel. The Sector Report drawer and POI layers are hidden. |
| 5   | Mode switch UI                  | **Segmented pill** `Map · Heatmap · Tickets` with a sliding indicator. Icons only below `sm`.                                |
| 6   | Surveyors                       | **Never see the switch.** Their map stays exactly as it is today. The APIs return 403 for them too.                          |
| 7   | Panels per mode                 | **One shared Insights panel.** Only its hero block changes with the mode.                                                    |
| 8   | Insights content                | All four: status & progress, category breakdown, priority & 7-day trend, ticket list.                                        |

## 2. What the data looks like today (drove the decisions)

Taken from a read-only aggregation on 2026-09-13:

- **3,612 tickets, all with a `location`, exactly one per parcel.** Because of that, _total tickets per area_
  equals _parcel count per area_. That's why the default metric is **open** tickets.
- **The distribution is very skewed.** Sectors 7 / 5 / 12 / 11 hold 742 / 669 / 625 / 599 tickets, and most
  sectors hold fewer than 60. A linear colour ramp would turn four sectors red and leave the rest looking
  identical. → **Quantile breaks** (§5.1).
- **Only `new` (1,920) and `resolved` (1,692) are in use.** Open, Pending and Closed have zero tickets.
  Ticket mode will look two-toned until the workflow is used. The legend must still list all four states,
  with zero counts dimmed.
- **3 tickets are assigned and 0 have an `slaDueAt`.** The assignee and SLA widgets need proper empty
  states, and neither is a headline stat.
- 10 tickets have `sectorNo: null` (peripheral). They show in the glow heatmap and in Ticket mode, and get
  a "Peripheral" row in the ranked list.

---

## 3. Architecture

### 3.1 New files

```
src/server/services/insights.service.ts          # Mongo aggregation, the only DB-touching code
src/app/api/insights/tickets/route.ts            # GET: compact per-ticket array for the map
src/app/api/insights/sectors/[sectorNo]/route.ts # GET: detail for the Insights panel (incl. "peripheral")

src/lib/insights/statusBuckets.ts                # slug/isResolved → 'new'|'progress'|'resolved'|'closed'
src/lib/insights/heatScale.ts                    # quantile breaks + theme palettes (pure, unit-tested)
src/lib/insights/aggregate.ts                    # filters + per-sector rollups (pure, unit-tested)

src/components/map/insights/ModeSwitcher.tsx     # the segmented pill
src/components/map/insights/InsightsModePanel.tsx# left: metric, legend, filters, ranked sectors
src/components/map/insights/InsightsPanel.tsx    # right: sector / all-sector insights
src/components/map/insights/useTicketInsights.ts # fetch + memoized derived state
src/components/map/insights/insightLayers.ts     # add / show / hide / re-theme MapLibre layers
src/components/map/insights/charts.tsx           # ProgressRing, StackedStatusBar, Sparkline
```

`MapView.tsx` is already about 4,800 lines. It gets **only** the wiring: mode state, the gating prop, a
branch in the click handler, visibility overrides, and theme-swap registration. Everything else lives in
the files above.

### 3.2 Gating (server-first)

- `src/app/(shell)/page.tsx` calls `requireTicketScope()` and passes
  `canUseInsights = ability.can('read:all', 'ticket')` to `<MapView>`. `getSession` is `cache()`d, so this
  doesn't decode the JWT again after the layout already did.
- When `canUseInsights` is false, MapView doesn't render `ModeSwitcher`, ignores `?mode=`, and never
  fetches insights.
- **Both API routes enforce this themselves.** They call `getSession()` and return 401 when there is no
  session and 403 when `read:all` on `ticket` is missing, as JSON. They do **not** use `requireAbility()`,
  because a redirect is the wrong response for a `fetch`.

### 3.3 Data contracts

**`GET /api/insights/tickets`** is loaded once when a mode is first entered. After that it refreshes only
when the user asks ("Updated 2 min ago · ↻"). Response: `Cache-Control: private, no-store`.

```ts
{
  generatedAt: string,
  statuses:   { slug, name, bucket, color }[],   // index-addressed below
  priorities: { slug, name, color, order }[],
  classGroups: string[],
  // one tuple per ticket with a location: ~3.6k rows ≈ 30 KB gzipped
  tickets: [number, sectorPlanId, sectorNo|null, statusIdx, priorityIdx, classGroupIdx, lng, lat, createdAtMs, resolvedAtMs|null][]
}
```

The whole ticket set lives on the client, so **filters, metric switches and recolouring are instant** and
never go back to the server.

**`GET /api/insights/sectors/:sectorNo`** (`sectorNo` is an integer or `peripheral`) is fetched when a
sector is selected. It covers what the tuple array doesn't:

```ts
{
  trend7d: { day, created, resolved }[],          // same local-day bucketing as getDashboardData
  assignees: { id, name, open }[],                // top 5, empty-state friendly
  oldestOpen: { number, subject, ageDays } | null,
  medianResolveHours: number | null,
  tickets: { number, subject, statusSlug, prioritySlug, classGroup, sectorPlanId, lng, lat, lastActivityAt }[],
  // ^ open first, then by priority order desc, lastActivityAt desc; capped at 200, `truncated: boolean`
}
```

The service reuses the same patterns as `getDashboardData`: resolve `resolvedIds` up front and avoid
`$lookup`, cast to `ObjectId` before `aggregate()`, and always include `deletedAt: null`. The existing
indexes `{deletedAt, location.sectorNo}` and `{deletedAt, statusId, lastActivityAt}` cover these queries.

### 3.4 Status buckets — `statusBuckets.ts`

Keyed by slug, with a fallback for any slug an admin adds later:

| slug                   | bucket     | light     | dark      |
| ---------------------- | ---------- | --------- | --------- |
| `new`                  | `new`      | `#2563eb` | `#60a5fa` |
| `open`, `pending`      | `progress` | `#d97706` | `#fbbf24` |
| `resolved`             | `resolved` | `#059669` | `#34d399` |
| `closed`               | `closed`   | `#64748b` | `#94a3b8` |
| unknown, `!isResolved` | `progress` |           |           |
| unknown, `isResolved`  | `resolved` |           |           |

_Open_ in the heat metric means any bucket other than `resolved` or `closed`. That matches the
dashboard's `isResolved` semantics.

---

## 4. Mode state and UI shell

### 4.1 State in MapView

```ts
type MapMode = 'map' | 'heatmap' | 'tickets'
const [mode, setMode] = useState<MapMode>('map') // mirrored into modeRef for the once-registered load handler
const [insightSector, setInsightSector] = useState<number | 'peripheral' | null>(null)
```

- `insightSector` is **separate from `selectedSector`**. Leaving a mode puts you back where you were, and
  Map mode's Sector Report drawer never pops open by accident.
- Mode and sector are mirrored to the URL (`?mode=heatmap&isector=7`) with `router.replace`, so a view
  can be shared or reloaded. The last mode is **not** kept in localStorage, so every visit starts on the
  plain map.
- Keyboard shortcuts: `1`/`2`/`3` switch modes, and `Esc` clears `insightSector`, then returns to Map.
  They are ignored while an input has focus or measure mode is active.

### 4.2 ModeSwitcher

- Sits in the existing `fixed left-16 top-4` flex row, **after** the measure button, so it reads as one
  control strip: `☰ │ 📏 │ [Map · Heatmap · Tickets]`.
- It uses the same glass treatment as the other buttons: `--map-panel-bg`, `--map-panel-border`,
  `backdrop-blur-md`, `shadow-lg`, `h-10`, `rounded-lg`. Inside is a `role="radiogroup"` with an absolutely
  positioned indicator that slides (`transform`, 220 ms, `ease-out`). The active segment tint follows the
  mode: accent blue for Map, red-600 for Heatmap, emerald for Tickets.
- Icons: Map = `LayersIcon` (existing), Heatmap = a new `FlameIcon`, Tickets = a new `TicketIcon`, drawn in
  the same 1.5 px stroke style as `icons.tsx`.
- **Width budget.** The row's `max-w` math (see the long comment above it) keeps it clear of the Stats
  pill. Labels are hidden below `lg`. Below `sm` the pill is icons only (3 × 36 px). This needs checking
  against measured DOM rects, as the comment warns.

### 4.3 What changes when a mode is on

| Element                              | In Heatmap / Tickets                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left `Panel` (search + base toggles) | Replaced by `InsightsModePanel`. Same `Panel` shell, same position.                                                                               |
| `StatsPanel`                         | Replaced by `InsightsPanel`. Same right-docked, resizable shell.                                                                                  |
| `SectorReportDrawer`                 | Not rendered.                                                                                                                                     |
| POI layers, clusters, road layers    | Hidden via a **temporary visibility override**. The stored `visibility` and localStorage are untouched, so Map mode comes back exactly as it was. |
| `sector-plan-fill` / class outline   | Heatmap: hidden. Tickets: replaced by the ticket-status fill.                                                                                     |
| `basemap-dim-scrim`                  | Stronger, so the data layer stands out.                                                                                                           |
| `sector-boundary-line`               | Kept, slightly heavier. It's the frame the heat is read against.                                                                                  |
| Measure tool                         | Still works. It already takes clicks first.                                                                                                       |
| Open parcel popup                    | Closed when the mode changes.                                                                                                                     |

The phone behaviour of `forceCollapsed` (only one docked panel open at a time) carries over unchanged by
feeding the new panels the same `expandedDockedPanel` tracker.

---

## 5. Map layers — `insightLayers.ts`

All of these are added once, inside the existing `load` handler, with `visibility: 'none'`. Switching modes
only calls `setLayoutProperty` and `setPaintProperty`, so layers are never torn down and rebuilt.
Every colour-bearing layer is **registered in the theme-swap effect** (CONTEXT §9: "the single easiest
thing to miss"). `insightLayers.ts` exports `applyInsightTheme(map, theme, state)`, and the theme effect
calls it.

### 5.1 Heatmap — sector shading (zoom ≤ ~13.5)

- `insight-sector-fill`: a `fill` on the existing `sector_boundary` source with
  `fill-color: ['match', ['get','sector_no'], 7, '#b91c1c', 5, '#dc2626', …, NO_DATA]`, rebuilt whenever
  filters or the metric change. There are only 32 sectors, so a `match` is simpler than feature-state and
  gets `fill-color-transition: 300ms` for free.
- `fill-opacity` interpolates by zoom: `0.72 @ z10 → 0.55 @ z13 → 0 @ z14.5`. It fades out as the glow
  fades in.
- `insight-sector-outline` is a `line` in a darker shade of each sector's own fill colour. This is the
  "wash + hairline" pattern from CONTEXT §9.
- `insight-sector-selected` is a 2.5 px white-over-dark double stroke on `insightSector`.
- **Scale.** `heatScale.ts` computes **5 quantile classes** over the non-zero sector values, removes
  duplicate breaks (small datasets collapse), and gives zero its own neutral **"No open tickets"** swatch
  instead of the palest red. The legend shows the real break values (`1–9 · 10–27 · 28–43 · 44–299 · 300+`),
  so the scale is honest even though it isn't linear.
- **Palettes** (sequential, tested for 3:1 contrast against each basemap):
  - light: `#fef3c7 → #fdba74 → #f97316 → #dc2626 → #991b1b`
  - dark: `#78350f → #c2410c → #ea580c → #f87171 → #fecaca`. In dark mode, _brighter = hotter_, which
    reads correctly on Dark Matter.
  - no data: light `#e2e8f0` @ 0.5, dark `#334155` @ 0.5.
- Sector labels: an `insight-sector-label` symbol layer on the sector centroids already in `sectors` state,
  showing `S7` and the metric value (`389 open`). It uses a halo in the theme's panel colour and is hidden
  below z11 so the labels don't collide.

### 5.2 Heatmap — glow (zoom ≥ ~13)

- A GeoJSON source `insight-tickets` built from the filtered tuples. Open tickets only, unless the metric
  is _total_.
- `insight-heat`: a MapLibre `heatmap` layer.
  - `heatmap-weight` by priority: Low 0.6, Normal 1, High 1.6, Critical 2.4.
  - `heatmap-radius` interpolated `12 @ z13 → 28 @ z16`. `heatmap-intensity` rises with zoom.
  - `heatmap-color` uses the same ramp as §5.1 so both zoom levels read as one scale, starting from a
    fully transparent stop.
  - `heatmap-opacity` goes `0 @ z13 → 0.85 @ z14.5`, the reverse of the sector fill.
- `insight-heat-points`: small circles at z ≥ 16 so single tickets can be clicked when zoomed right in.

### 5.3 Ticket mode — parcel status fill

- The `sector_plan` source already uses `promoteId: 'id'`, so **feature-state** is the right tool.
  `setFeatureState({source:'sector_plan', sourceLayer:'sector_plan', id: sectorPlanId}, {bucket})` is called
  once per ticket in a single `requestAnimationFrame` batch whenever the data or filters change. MapLibre
  keeps feature state for features in tiles that haven't loaded yet.
- `insight-ticket-fill`: `fill-color: ['match', ['feature-state','bucket'], 'new', BLUE, 'progress', AMBER, 'resolved', GREEN, 'closed', SLATE, 'transparent']`.
  Opacity is `0.55` at region zoom and `0.35` when zoomed in, so the basemap stays readable.
- `insight-ticket-outline`: a same-hue hairline that becomes more opaque with zoom.
- A parcel whose ticket is filtered out gets `bucket: 'muted'`, drawn as a faint slate wash instead of
  disappearing, so the plan layout never breaks up.
- Sector labels (same layer as §5.1) switch to `S7 · 52% resolved`.

### 5.4 Click handling

MapView's `click` handler gets a **mode branch placed after measure and before clusters/POIs**:

1. Heatmap, zoomed out: a hit on `insight-sector-fill` → `setInsightSector(n)` and `fitBounds` to the
   sector's bbox (already in `sectors`), padded by the panel widths already tracked in refs.
2. Heatmap, zoomed in, or Ticket mode: a hit on a parcel or heat point selects its **sector** in Insights,
   highlights the ticket's row in the list, and opens the existing parcel popup. `/api/tickets/by-parcel`
   already provides the status chip, so nothing new is needed there.
3. Empty map area → `setInsightSector(null)`, which puts Insights back on the all-sector overview.

Hover: cursor becomes a pointer, and a floating tooltip shows `Sector 7 · 389 open · 52% resolved`. It
reuses the `mapNotice` chip styling.

---

## 6. Panels

Design language matches the current panels exactly: the `Panel` shell, `--map-*` tokens, 13 px semibold
titles, 11 px faint subtitles, `rounded-2xl` glass, `tabular-nums` on every number, 200 ms transitions.
The UI details go through the **`ui-ux-pro-max`** skill at the start of Phase 5 for a typography and
spacing review.

### 6.1 Left — `InsightsModePanel`

Title `Heatmap` or `Ticket status`, subtitle `Admin & manager view`.

1. **Metric** (Heatmap only): a 4-way segmented control, _Open · % open · Total · Per ha_.
2. **Legend**: quantile swatches with break labels in Heatmap, or four status swatches with live counts in
   Tickets. Zero-count rows are dimmed.
3. **Filters** (chips, multi-select, with a "Clear" link when any is active):
   Status · Priority · Category (class group, with the existing `CLASS_GROUP_COLORS` dots) · Created
   (Any / 24 h / 7 d / 30 d).
4. **Ranked sectors**: all sectors sorted by the current metric, each row showing a colour chip, the name,
   the metric value and a thin inline bar. Clicking a row selects the sector and flies to it. The selected
   row is sticky-highlighted. "Peripheral" is the last row.
5. Footer: `Updated 2 min ago · ↻ Refresh`.

### 6.2 Right — `InsightsPanel`

The collapsed pill reads `Insights · All sectors` or `Insights · Sector 7`. With no sector selected it
shows the **workspace overview**, with the same blocks computed over all tickets.

1. **Hero** (depends on mode)
   - Heatmap: a large `389` **open**, a rank badge `#1 of 32 sectors`, and a comparison line
     `3.4× the sector median`.
   - Tickets: a **ProgressRing** with `52% resolved` in the centre, and a 4-segment **StackedStatusBar**
     below it.
2. **Status & progress**: four stat tiles (New · In progress · Resolved · Closed), each with its bucket
   colour, count and share. Median time to resolve. Oldest open ticket, with a link.
3. **Categories**: rows per class group, sorted by open count, each with a `CLASS_GROUP_COLORS` dot and an
   open/resolved split bar. Clicking a row toggles it in the Category filter, which recolours the map.
4. **Priority & trend**: a horizontal bar per priority (open only), and a 7-day **created vs resolved**
   sparkline in Recharts, which is already used in `dashboard/VolumeChart.tsx`.
5. **Assignees**: the top 5 by open count. The empty state reads _"No tickets assigned in this sector
   yet"_, which is currently the common case.
6. **Tickets**: a virtualised-light list, shown open first, with at most 200 rows and a "Showing 200 of
   389 — open in ticket list →" link to `/tickets?sector=7&status=open`. The ticket list already
   supports these params, and `status=open` already means "not resolved". Each row shows `#1234` · subject (truncated) · status chip · priority dot, plus
   two actions: **Locate** (fly to parcel + pulse) and **Open** (the ticket page).

States: skeleton shimmer while `/sectors/:n` loads, an inline error with retry, and when filters exclude
everything, _"No tickets match these filters"_ plus a Clear button.

### 6.3 Phones (< `sm`)

- The switch is icons only. The left panel starts collapsed. The Insights panel opens as the existing
  full-width docked panel, so the `forceCollapsed` sibling logic is unchanged.
- A compact **floating legend** (a single row of swatches, bottom-left, above the attribution) appears
  whenever the left panel is collapsed, on any viewport, so the colours always have a key.

---

## 7. Phases

Each phase ends in a working, committable state.

| Phase                     | Scope                                                                                                                                                                                                             | Done when                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ **1. Data**            | `statusBuckets`, `insights.service`, both API routes with the 401/403 checks, unit tests                                                                                                                          | `curl` as a manager returns data; as a surveyor returns 403; tests pass                                                                                                 |
| ✅ **2. Shell**           | `canUseInsights` prop, `ModeSwitcher`, mode/URL state, panel swap with placeholder panels, visibility override                                                                                                    | Switching modes swaps panels and hides POIs; Map mode returns to exactly its prior state; surveyor sees no switch                                                       |
| ✅ **3. Heatmap**         | `heatScale`, `aggregate`, sector fill/outline/labels, glow + points, zoom crossfade, click/hover, theme registration                                                                                              | Heat reads correctly in both themes at z10 and z15; theme toggle mid-mode recolours without a reload                                                                    |
| ✅ **4. Tickets**         | Feature-state fill/outline, muted parcels, labels, parcel click → sector + popup                                                                                                                                  | Every parcel is coloured; filter changes recolour in under 100 ms; theme toggle works                                                                                   |
| ✅ **5. Panels**          | `InsightsModePanel`, `InsightsPanel`, charts, the sector detail fetch, all states; ui-ux-pro-max review                                                                                                           | All four content blocks are real; loading, empty and error states verified                                                                                              |
| ✅ **6. Polish**          | Phone layout + width budget, keyboard shortcuts, a11y pass, `CONTEXT.md` §9 update                                                                                                                                | Verified at 375 / 768 / 1440 px in both themes; no console errors                                                                                                       |
| ✅ **7. Density heatmap** | Icon-only mode switch; drop sector shading/labels for a true all-zoom density glow; dimmed basemap labels; Open/All/% open metric; gradient legend; ticket dots + popup; theme-swap source fix (full spec in §11) | Glow sits on the actual ticket clusters at z10, z13 and z16 in both themes, map names stay readable through it, theme toggle keeps the glow, Map/Ticket modes unchanged |

## 8. Testing

- **Vitest (pure):** `heatScale` (duplicate breaks, all-zero, single sector, skewed data like today's),
  `aggregate` (every filter combination, peripheral handling, all four metrics), `statusBuckets` (unknown
  slug fallback).
- **Vitest + `mongodb-memory-server`:** `insights.service` covers `deletedAt` exclusion, resolved-id
  matching, and 7-day local-day bucketing.
- **Route tests:** 401 without a session, 403 for a surveyor, 200 for a manager.
- **Browser verification** (preview tools) for every phase that renders: both themes, the three
  breakpoints, mode round-trips, and deep links (`/?mode=tickets&isector=7`).

## 9. Risks and gotchas

- **Theme swap.** Every new colour-bearing layer must go through `applyInsightTheme`. Checked by toggling
  theme while in each mode.
- **The `load` handler closes over stale state.** Read `modeRef` and `insightSectorRef` there, never
  `mode`, the same way `measuringRef` is handled.
- **The top strip width** is cramped on phones (see the measure-row comment). Verify with measured rects,
  not by eye.
- **Visibility override vs stored visibility.** The override must never go through `setVisibility`, or it
  gets written to localStorage and the user's Map-mode layers are lost.
- **Feature-state volume.** About 3.6k `setFeatureState` calls on each filter change is fine. Batch them in
  one frame and diff against the previous buckets so only changed parcels are touched.
- **`sectorNo: null` parcels** already get the orange dashed peripheral outline. Make sure the ticket fill
  sits under it, not over it.
- **Today's data is two statuses only.** Don't tune the visual balance only on this; check with a seeded
  mix as well. `scripts/demo-resolve-by-category.ts` already exists, and could get a small `--spread-statuses` option.

## 10. Out of scope (possible follow-ups)

- A time slider or playback of how the heat changed over the event.
- Priority-weighted or SLA-overdue heat metrics. Add them once `slaDueAt` is actually populated.
- A read-only, scoped version for surveyors. Explicitly declined for now.
- Exporting a sector's insights as PDF or CSV.

---

## 11. Phase 7 — Density heatmap revision (agreed 2026-09-13)

Feedback after Phases 1-6: the Heatmap painted whole sectors as flat colour blocks (and at region zoom
they were stuck on the grey "no data" swatch), the glow was invisible below z13, and too much else was
on the map. **Supersedes §5.1, §5.2 and the Heatmap half of §5.4 and §6.1's legend.** Ticket mode is
untouched.

### 11.1 Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mode switch shows **icons only** (Map / Heatmap / Tickets), with tooltip and `aria-label` kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | Heatmap shows **only** thin sector boundaries + the density glow (+ the selected-sector outline). No sector fill, no sector labels, no POIs/roads/parcels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3   | The glow is a real **point-density heatmap** at every zoom: soft, flowing, no polygon edges, hottest exactly where open tickets cluster. Green → yellow → orange → red, like Maptive.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4   | Everything stays **translucent**: the basemap, its roads and place names must remain readable through the hottest red.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | **Basemap labels and icons dim to 50%** while in Heatmap mode (kept, not hidden); restored on exit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | ~~Metric switch becomes Open / All / % open~~ — **revised 2026-09-13: switch is just Total / % open** (two buttons, no separate "Open" button). `HeatMetric = 'total' \| 'pctOpen'`. **% open is sector-wise only**: it ranks/colours the sector list exactly as today, it can't be drawn as a density — selecting it leaves the glow on open-ticket density (reusing `buildHeatFeatureCollection`'s existing `metric !== 'total'` → open-tickets-only filter, so no new glow-filtering logic is needed). Selecting Total switches both the glow and the list to every ticket. Default `heatMetric` state becomes `'total'`. **Per ha is removed.** |
| 7   | At street zoom (z ≥ 16) individual **ticket dots** fade in; clicking one opens a small popup listing the tickets there with links to `/tickets/{number}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 8   | The purple (light) / orange (dark) **selected-sector outline stays**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 11.2 Mode switch — `ModeSwitcher.tsx`

- Remove the `<span className="hidden lg:inline">{label}</span>`.
- Buttons become fixed equal squares (`h-8 w-8`, no horizontal padding) so the sliding indicator's
  `100 / SEGMENTS.length %` width lines up exactly. Keep `aria-label`, `title`, roving tabindex and arrow keys.
- Re-measure the top control strip at 375 px (§9 "top strip width") — it only gets narrower, but check.

### 11.3 Map layers — `insightLayers.ts`

**Remove:** `updateInsightSectorPaint`, `sectorColorExpr` (Heatmap use), `INSIGHT_HEAT_ZOOM_CROSSOVER`, the
per-sector `fill-color`/`line-color` match expressions and every zoom fade-to-0 on sector layers.

| Layer                     | New behaviour                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insight-sector-fill`     | Kept only as an **invisible hit target** (`fill-opacity: 0`, still queryable) for sector click + hover cursor.                                            |
| `insight-sector-outline`  | One neutral hairline at every zoom: light `rgba(71,85,105,0.55)`, dark `rgba(203,213,225,0.45)`, ~1.2 px. Theme-swapped in `applyInsightTheme`.           |
| `insight-sector-label`    | Hidden in Heatmap (`setInsightLabelVisible` only for Ticket mode).                                                                                        |
| `insight-sector-selected` | Unchanged.                                                                                                                                                |
| `insight-heat`            | Visible at **all** zooms (see 11.4). Moved **below the first basemap symbol layer** so place names paint on top of the glow.                              |
| `insight-heat-points`     | `minzoom` 15.5, fading in 15.5 → 16, radius 4, red with white/dark stroke. Features gain `number`, `status_idx`, `priority_idx` properties for the popup. |

### 11.4 Glow tuning (starting values — tune live against real data)

- `heatmap-weight`: existing priority weight (0.6 / 1 / 1.6 / 2.4).
- `heatmap-radius`: exponential with zoom so a hotspot covers roughly the same ground area at every zoom,
  e.g. `['interpolate', ['exponential', 2], ['zoom'], 10, 8, 13, 28, 16, 90]`.
- `heatmap-intensity`: low zoomed out so sectors 7/5/11/12 (600-740 tickets each) don't fuse into one red
  blob, higher zoomed in so a single busy parcel still reads: e.g. `10 → 0.15, 13 → 0.5, 16 → 1.2`.
- `heatmap-color` (alpha baked into each stop, so the red core is still see-through):
  `0 transparent · 0.15 green α≈0.30 · 0.35 lime α≈0.45 · 0.55 yellow α≈0.55 · 0.75 orange α≈0.65 · 1 red α≈0.72`.
- `heatmap-opacity`: ~0.85 overall, easing to ~0.6 at z16 once ticket dots take over.
- Same ramp in both themes to start; `applyInsightTheme` stays the single place to diverge if dark needs it.
- **Acceptance:** at z10 the busiest sectors show distinct red cores, not a single merged blob; at z13
  individual clusters inside a sector separate; at z16 the glow sits under the dots; place names are
  legible over the reddest spot in both themes.

### 11.5 Basemap label dimming — new helper in `insightLayers.ts`

`setBasemapLabelsDimmed(map, dimmed, isAppSource)`:

- Targets every `symbol` layer whose source is **not** an app source (same `APP_SOURCE_IDS` test
  `syncBasemap` already uses — no hardcoded MapTiler/CARTO ids).
- On dim, caches each layer's original `text-opacity` / `icon-opacity`, then sets 50% of it:
  a number (or unset = 1) → `× 0.5`; a zoom `interpolate`/`step` → halve each numeric stop output (a
  zoom expression can't be wrapped in `['*', …]`); anything else → `0.5`.
- On restore, writes the cached originals back.
- Called from the mode-visibility effect, **and again at the end of `syncBasemap`** (cache cleared first,
  since the theme swap replaces every basemap layer) — the §9 theme-swap gotcha applies here too.

### 11.6 Theme-swap bug to fix in this phase

`APP_SOURCE_IDS` (MapView.tsx) doesn't include `insight-tickets`, so `syncBasemap` treats the heat source
as a basemap source and **deletes it and both heat layers on every theme toggle** — invisible until now
only because the glow was hidden below z13. Add `INSIGHT_HEAT_SOURCE` to the set, and re-run the
`insight-heat` "move below basemap labels" step after the swap re-adds the basemap.

### 11.7 MapView wiring

- **Paint effect** (`[insightsData, mode, insightFilters, heatMetric]`): drop rollups/breaks/`updateInsightSectorPaint`
  and `insightPaintRef`; it only rebuilds the heat GeoJSON (`metric === 'total'` → all tickets, else open).
  Remove the `insightPaintRef` re-apply from `syncBasemap`.
- **Click (Heatmap branch)**, no crossover any more:
  1. ticket-dot hit → `setInsightSector(sector)` + ticket popup (reuse `popupRef`; up to 5 tickets under
     the cursor, "+N more"; each row = status dot, `#number`, status, priority, link to `/tickets/{number}`);
  2. else `insight-sector-fill` hit → select that sector, and `fitBounds` only when current zoom < 13
     (clicking while already zoomed in shouldn't jump the camera);
  3. else → `setInsightSector(null)`.
- Close the ticket popup on leaving Heatmap mode.
- Visibility effect: `setInsightLabelVisible(map, mode === 'tickets')`; `setBasemapLabelsDimmed(map, mode === 'heatmap', …)`.

### 11.8 Metric + legend — `aggregate.ts`, `heatScale.ts`, `InsightsModePanel.tsx`, `FloatingLegend`

- `HeatMetric = 'total' | 'pctOpen'` (revised decision #6 above — no separate `'open'` value at all,
  `'perHectare'` removed too); remove the `open`/`perHectare` cases from `heatValueForSector` and its tests.
  `buildHeatFeatureCollection`'s existing `metric !== 'total'` check already means "open tickets only" for
  whatever isn't `'total'`, so `pctOpen` gets open-ticket density on the map for free.
- Switch: `Total · % open` (2-column grid, was 4). Default `heatMetric` state changes from `'open'` to
  `'total'`. The sector list ranking/bars keep using `heatValueForSector` exactly as now, so % open stays
  sector-wise.
- `HEAT_PALETTE` (list dots/bars only) becomes solid green → red stops matching the glow ramp, so list and
  map agree. `colorForValue` / quantile breaks unchanged.
- Legend (panel + floating): replace the stepped `buildLegend` rows with one gradient bar built from the
  glow ramp, labelled "Fewer" … "More tickets" (map is showing all tickets when Total is selected). Under
  % open add a one-line note: "Map shows open-ticket density · list ranked by % open". Delete `buildLegend`
  if nothing else uses it.
- `FloatingLegend`'s heatmap branch no longer needs rollups/sectors.

### 11.9 Verification + commit

- `npx tsc --noEmit`, `npx eslint`, `npx vitest run --pool=threads`.
- Browser (Admin): Heatmap at z10 / z13 / z16 in light and dark; only boundaries + glow (+ dimmed basemap
  names) visible; names readable over the hottest spot; each metric and filter updates the glow instantly;
  sector click selects (and flies only when zoomed out); dot click popup + link; **theme toggle mid-mode
  keeps the glow**; leave Heatmap → basemap labels back to full strength, Map-mode layers exactly as before;
  Ticket mode unchanged; icon switch keyboard-operable; 375 px strip fits. Surveyor still sees no switch.
- One commit: `feat(insights): replace sector shading with a density heatmap (phase 7)`. Update this
  plan's Status line and mark row 7 ✅.
