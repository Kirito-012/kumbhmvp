# CONTEXT.md — TheCraftSync / Kumbh Drishti

> Orientation document for anyone (human or agent) starting fresh on this repo.
> Goal: you should be able to work productively **without** re-reading the whole codebase.
>
> Companion docs: [`AGENTS.md`](AGENTS.md) (standing rules), [`Pending.md`](Pending.md) (deferred GIS layers),
> [`PLAN-deferred-roads.md`](PLAN-deferred-roads.md) (road-layer implementation writeup).
> `README.md` is untouched create-next-app boilerplate — ignore it.

---

## 0. Standing rule (from AGENTS.md)

**This is not the Next.js you know.** The project runs **Next.js 16.2.12**, which has breaking changes
from older versions — APIs, conventions and file structure differ from most training data.
Read the relevant guide in `node_modules/next/dist/docs/` before writing code, and heed deprecation notices.

The most visible example: **`middleware.ts` is now `proxy.ts`.** If you go looking for middleware, it's
[`src/proxy.ts`](src/proxy.ts).

---

## 1. What this product is

A combined **ticketing system + GIS mapping platform** built for the **Kumbh Mela 2027** event in the
Haridwar–Rishikesh region of Uttarakhand, India.

Two halves that share one app:

| Half          | Purpose                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ticketing** | Field issues tracked as tickets. Surveyors file them, upload before/after site photos, and complete structured site-survey questionnaires. Managers/admins assign and resolve. |
| **Mapping**   | A MapLibre GL map rendering ~70 PostGIS tables of event infrastructure — sector plans, roads, ghats, utilities, transport, sanitation — as vector tiles.                       |

The two halves connect: every parcel in the sector plan can have a ticket, and tickets carry a
denormalized snapshot of their map location so the ticket detail page can deep-link back to the map.

Production domain: `kumbhdrishti.thecraftsync.com` (Azure App Service).

---

## 2. Quick start

```bash
npm ci
npm run dev
```

Then open `http://localhost:3000`.

Seeded login accounts live in [`scripts/seed.ts`](scripts/seed.ts) — three named accounts (admin,
manager, surveyor), each with a fixed plaintext password in that file. Run `npm run seed` to create them.

> ⚠️ `npm run seed` **deletes all users** before re-seeding. Never run it against a database with real accounts.

**Gotcha:** editing `src/proxy.ts` tends to wedge the Next dev server — it keeps accepting connections on
port 3000 but stops responding. If `localhost:3000` hangs after touching that file, kill the `next dev`
process chain and restart.

---

## 3. The single most important architectural fact: two databases

This app talks to **two completely separate databases**, and they are never joined at the query level.

|                  | MongoDB (Mongoose)                                                   | PostgreSQL + PostGIS (Supabase)                          |
| ---------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| **Holds**        | Tickets, users, roles, comments, attachments, events, questionnaires | All geospatial data, in a `kumbh` schema (~70 tables)    |
| **Accessed via** | [`src/server/db/connect.ts`](src/server/db/connect.ts)               | [`src/server/db/postgres.ts`](src/server/db/postgres.ts) |
| **Layer**        | Mongoose models in `src/server/db/models/`                           | Raw parameterized SQL, **no ORM**                        |
| **Env var**      | `MONGODB_URI`                                                        | `POSTGRES_URL`                                           |

**How they connect:** `Ticket.location` is a _denormalized snapshot_ (sectorPlanId, lng/lat, classGroup,
etc.) copied from Postgres `kumbh.sector_plan` at import time. It is deliberately **not** a live
cross-database reference — do not treat it as one.

**Connection patterns to preserve:**

- Mongo: `{conn, promise}` cached on `globalThis` so dev HMR doesn't spawn a connection per reload;
  `cache.promise` resets to `null` on failure so a bad connection can't permanently poison retries.
- Postgres: a single `pg.Pool` cached on `globalThis._pgPool`, `max: 15`, 10s idle/connection timeouts.
  **Must** point at Supabase's transaction-mode pooler (**port 6543**), not the direct Postgres port —
  API routes are short-lived serverless functions and a direct connection would exhaust the DB's limit.

---

## 4. Stack and versions

- **Next.js 16.2.12** (App Router, Turbopack), **React 19.2.4**, **TypeScript 5** (strict)
- **Tailwind CSS v4** (`@tailwindcss/postcss`, no `tailwind.config` file)
- **Auth.js v5** (`next-auth@5.0.0-beta.32`), JWT sessions, `bcryptjs`
- **CASL** (`@casl/ability@^7`) for permissions
- **Mongoose 9** / **pg 8** / **MapLibre GL 6.4**
- **Zod 4** for validation, `sanitize-html` for user HTML
- **Cloudinary** for photo storage
- **Recharts** (dashboard), **TanStack Table** (lists), **TipTap** (rich text)
- **npm** — a flat `node_modules` of real files is load-bearing for deploys (see §11)
- Testing: **Vitest 4** (unit), **Playwright 1.62** (e2e)
- Commits: **Conventional Commits**, enforced by commitlint + husky

**UI kit is hand-rolled, not shadcn/ui.** No `components.json`, no shadcn CLI artifacts. Components in
`src/components/ui/` use the same `cva` + `clsx` + `tailwind-merge` pattern shadcn popularized, but were
authored directly. `cn()` lives in `src/lib/utils.ts`.

Path alias: `@/*` → `./src/*`.

---

## 5. Repo map

```
src/
  app/
    (app)/          # Route group: sidebar PINNED (dashboard, tickets, accounts)
    (shell)/        # Route group: sidebar OVERLAY — the full-bleed map at /
    api/            # All API routes (see §8)
    login/ register/
  components/
    map/            # MapView.tsx (~4,700 lines) + StatsPanel, SectorReportDrawer, ...
    tickets/        # Ticket UI incl. questionnaire/ subfolder
    accounts/ auth/ dashboard/ editor/ layout/ ui/
  lib/
    classColors.ts  # The map's entire color system
    questionnaire/  # Survey templates
    schemas/        # Zod validation
  server/
    auth/           # auth.ts, auth.config.ts, ability.ts, session.ts
    actions/        # 'use server' actions
    services/       # Business logic
    db/             # connect.ts, postgres.ts, models/
  proxy.ts          # ← Next 16's renamed middleware
scripts/            # seed, imports, demo data, the Python GIS loader
e2e/                # Playwright
public/             # Basemap style JSONs + copied MapLibre workers
```

---

## 6. Auth and permissions

### The provider-free / full split (important quirk)

There are **two** NextAuth instances, deliberately:

1. [`src/server/auth/auth.config.ts`](src/server/auth/auth.config.ts) — `authConfig`, with `providers: []`.
   Just session strategy, `pages.signIn`, and an `authorized()` callback.
2. [`src/server/auth/auth.ts`](src/server/auth/auth.ts) — the **full** instance: `authConfig` + a
   `Credentials` provider (bcrypt compare against `UserModel`) + `jwt`/`session` callbacks that stamp
   `roleKey`, `roleName`, `grants` onto the token.
3. [`src/proxy.ts`](src/proxy.ts) builds its **own second** provider-free instance purely to decode the
   JWT cookie for route guarding. **Why:** importing the full `auth.ts` here would drag mongoose and
   bcrypt into the middleware bundle.

**Two things in `proxy.ts` will bite you:**

- Its `config.matcher` **must keep excluding `/api/auth`**. If the provider-free instance intercepts
  those routes it tries to dispatch sign-in/callback actions it has no providers for → `UnknownAction`
  errors and login breaks entirely.
- It does a **canonical-domain 308 redirect**: any request whose `Host` isn't
  `kumbhdrishti.thecraftsync.com` is redirected there. This is for Azure's permanent
  `*.azurewebsites.net` hostname. It is gated on `NODE_ENV === 'production'` — **without that gate it
  also redirects `localhost:3000` to production and local development is impossible.**

Session strategy is `'jwt'` (no DB sessions). No `maxAge` override, so NextAuth's 30-day default applies.

### Permission model

Roles store grants as flat `"subject:action"` strings (e.g. `ticket:read:own`).
[`src/server/auth/ability.ts`](src/server/auth/ability.ts) splits on `:` and builds a CASL
`MongoAbility`, so `ability.can('read:all', 'ticket')` works uniformly everywhere.

Authoritative grant list: [`scripts/seed.ts`](scripts/seed.ts).

| Area                  | Admin          | Manager                                                 | Surveyor                     |
| --------------------- | -------------- | ------------------------------------------------------- | ---------------------------- |
| ticket                | all            | read:all, create, update, assign, merge (**no delete**) | read:**own**, create, update |
| comment               | all            | all                                                     | create, update:own           |
| note                  | read, create   | read, create                                            | read, create                 |
| attachment            | create, delete | create, delete                                          | create only                  |
| account               | all            | read, create, update (no delete)                        | read only                    |
| group/team/department | manage         | manage                                                  | —                            |
| report                | view, generate | view, generate                                          | view only                    |
| notice                | manage         | manage                                                  | —                            |
| settings, role        | manage         | —                                                       | —                            |

A `customer` role is referenced as a fallback in types but **is never seeded**.

### Session helpers — [`src/server/auth/session.ts`](src/server/auth/session.ts)

- `getSession()` — `auth()` wrapped in React `cache()` so one render doesn't re-decode the JWT repeatedly.
- `requireUser()` — redirects to `/login` if unauthenticated.
- `requireAbility(grant?)` — redirects to `/dashboard` (not `/login`) if logged in but unauthorized.
- `requireTicketScope()` — **the key scoping primitive.** Groups/Teams/Departments don't exist yet, so a
  Surveyor (`ticket:read:own`) gets `forcedAssigneeId` = their own id, and every ticket-touching action
  re-verifies the ticket's actual `assigneeId` server-side. This is enforced twice: list queries filter
  by it, and the ticket detail page returns `notFound()` (**not** 403) for an out-of-scope ticket, so a
  surveyor can't distinguish "not yours" from "doesn't exist."

### Registration flow

`registerAction()` is public and creates a `status: 'pending'` user. The Zod schema
([`src/lib/schemas/register.ts`](src/lib/schemas/register.ts)) restricts `roleKey` to an enum of
`'manager' | 'surveyor'` and never accepts a raw `roleId` — so a public caller can't target the Admin
role document. Admins then approve/reject via `approveUserAction` / `rejectUserAction`.

`login()` does a pre-check purely to give friendlier errors for pending/rejected accounts. The real
security boundary is inside `authorize()` in `auth.ts`, which independently blocks non-active statuses.
Legacy user docs missing a `status` field are treated as active.

---

## 7. The ticketing domain

### Models (`src/server/db/models/`)

| Model                                    | Notes                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `user.model.ts`                          | `status` (pending/active/rejected), `roleId`, soft-delete via `deletedAt`, notification read-cursor fields |
| `role.model.ts`                          | `key`, `grants[]`, `rank` (lower = more powerful)                                                          |
| `ticket.model.ts`                        | The core entity. `number` (unique, human-facing), SLA timestamps, denormalized `location` snapshot         |
| `counter.model.ts`                       | Atomic sequence generator — `nextSequence('tickets')` via `$inc` + upsert                                  |
| `ticket-comment.model.ts`                | `isInternal` distinguishes note vs comment; `kind` is `comment` or `questionnaire`                         |
| `ticket-attachment.model.ts`             | Cloudinary metadata + `phase: 'before' \| 'after'`                                                         |
| `ticket-event.model.ts`                  | Append-only audit trail, powers the activity timeline                                                      |
| `ticket-questionnaire.model.ts`          | Survey submissions, snapshots `templateKey` + `version`                                                    |
| `ticket-type/-status/-priority.model.ts` | Lookup tables; priority carries `slaHours` / `overdueAfterHours`                                           |
| `tag.model.ts`                           | Labeled tags with `usageCount`                                                                             |

### Ticket numbering

Tickets are addressed by **`number`**, an auto-incrementing integer from the Mongo counter — _not_ the
Mongo `_id`. The detail route is `src/app/(app)/tickets/[number]/page.tsx` and the param is genuinely the
number. Non-integer or missing → `notFound()`.

### Questionnaires

[`src/lib/questionnaire/general-camping.ts`](src/lib/questionnaire/general-camping.ts) defines a
**versioned template** (`GENERAL_CAMPING`, v1, 39 questions across 6 sections, derived from a source
`.docx`). Each question has a stable slug `id` that is persisted forever, plus an `AnswerKind`
(`yes_no | yes_no_na | measurement | dimensions | required_actual | yes_no_measure | text`).

Submissions snapshot `templateKey` + `version`, so editing a template never retroactively reinterprets a
past survey. A submission also writes a plain-text `kind: 'questionnaire'` comment into the thread — the
rich version renders from the questionnaire record, because the HTML sanitizer's allowlist has no
table/div support.

UI flow: `QuestionnaireEntry` → `QuestionnaireForm` → rendered as `QuestionnaireResponseCard` inline in
the comment thread.

### Site photos (Cloudinary)

Direct browser-to-Cloudinary upload — **image bytes never touch the Next server**:

1. Client compresses (`src/lib/image-compress.ts`), calls `signSitePhotoUploadAction(ticketNumber, phase)`.
2. Server mints a signature scoped to folder `tcsticket/tickets/{number}/{phase}`.
3. Client uploads straight to Cloudinary.
4. `saveSitePhotoAction` persists the record — and **re-validates that the returned `public_id` starts
   with the exact folder that was signed.** This is what stops a signed upload being claimed against an
   unrelated ticket. Enforces `MAX_PHOTOS_PER_PHASE = 5`.

Deletion soft-deletes the Mongo doc and makes a best-effort Cloudinary `destroy` (failures swallowed).

### Server actions (`src/server/actions/`)

All `'use server'`. Common pattern: check `requireAbility` / `requireTicketScope` **first**, then
re-verify ownership against `forcedAssigneeId` even when the UI already filtered — defending against
direct action invocation that bypasses page-level checks.

Notable: `updateTicketFieldAction` requires the `assign` grant specifically when the patch includes
`assigneeId`, otherwise just `update`. `updateUserRoleAction` hard-checks `roleKey !== 'admin'` _in
addition to_ the grant, so a Manager can't self-promote.

---

## 8. API surface

All GIS routes use `runtime = 'nodejs'` and `getPool()`; ticket routes use `dbConnect()`.

| Route                                   | Purpose                                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/[...nextauth]`               | Auth.js handler                                                                                                                               |
| `/api/search`                           | Topbar global search. Returns `{tickets, people}`, surveyor-scoped; people only if caller has `account:read`                                  |
| `/api/sectors`                          | All sector boundaries + centroid + bbox                                                                                                       |
| `/api/stats`                            | Big aggregate endpoint powering StatsPanel — class/subclass breakdowns, road stats, per-sector rollups, POI counts over a ~44-table whitelist |
| `/api/sector-plan/locate`               | bbox + up to 200 centroids for zoom-to-fit                                                                                                    |
| `/api/sector-plan/report`               | Sector Report drawer data                                                                                                                     |
| `/api/poi/locate`                       | Same locate pattern, for a whitelisted POI table map                                                                                          |
| `/api/poi/points/[layer]`               | Full GeoJSON for the 7 small point layers (client-side clustering)                                                                            |
| `/api/tiles/[layer]/[z]/[x]/[y]`        | MVT vector tiles — see §9                                                                                                                     |
| `/api/tickets/by-parcel/[sectorPlanId]` | Does this map parcel already have a ticket?                                                                                                   |
| `/api/evacuation/search`                | Evacuation mode's search (PLAN-evacuation.md §8.1) — sector/zone-aware, labels via `src/lib/evacuation/labels.ts`. Gated on `read:all`/`ticket`, same as `/api/insights/*`. |
| `/api/evacuation/summary`                | Per-layer counts, zone outlines, and (with `?sector=`/`?zone=`) a focused feature list + nearby care facilities (§8.2). Same gating.           |
| `/api/v1/tickets` (POST)                | **External integration** — see below                                                                                                          |

### `/api/v1/tickets` — the DroneSeva integration

Not a session endpoint. Authenticates by shared secret header **`x-api-key`** against
`INTEGRATION_API_KEY` (503 if unconfigured, 401 on mismatch). Creates a `garbage-detection` ticket
attributed to the seeded service account `droneseva-bot@thecraftsync.local`, with `source: 'api'`.
Body is validated by `createIntegrationTicketSchema`, which explicitly restricts `sourceUrl` to
`http(s)` to block `javascript:` scheme injection. Issue HTML is sanitized before storage.

---

## 9. The map subsystem

The map is the largest and most intricate part of the codebase. Its heart is
[`src/components/map/MapView.tsx`](src/components/map/MapView.tsx) (~4,700 lines).

### Tile pipeline — [`src/app/api/tiles/[layer]/[z]/[x]/[y]/route.ts`](src/app/api/tiles/%5Blayer%5D/%5Bz%5D/%5Bx%5D/%5By%5D/route.ts)

One route serves MVT tiles for **all ~44 vector layers**, driven by a `LAYERS` whitelist object. The
whitelist exists specifically so the `layer` URL param is **never interpolated into SQL** — only literal
`table`/`columns` values authored in that file reach the query.

Entry shape:

```ts
{ table, columns, minzoom?, lowZoomWhere?, filterBelowZoom?, simplify? }
```

The four optional fields exist **only for `tertiary_road`** — every other layer is cheap enough raw.

- `minzoom` — below this, return an empty MVT **without touching the DB pool at all**
- `filterBelowZoom` + `lowZoomWhere` — paired; splice a literal SQL predicate below a zoom threshold
- `simplify` — `ST_Simplify(..., 2.0)` in tile-pixel units

Geometry is native EPSG:4326, transformed to 3857, encoded by `ST_AsMVTGeom` at extent 4096 with a
64-unit buffer. The bbox filter uses the GiST-indexed `&&` operator against a tile envelope reprojected
back to 4326 with margin, so features straddling tile edges aren't dropped.
`WHERE t.geom IS NOT NULL` guards against `ST_Simplify` collapsing short segments to null.

Cache headers: `public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400`.

### MapView render order

Bottom → top, inside `map.on('load')`:

`basemap-dim-scrim` → `river` fill → `sector-plan-hit-target` (invisible always-clickable twin, so clicks
work even when the sector plan layer is hidden) → `sector-plan-fill` + `sector-plan-class-outline` →
filter glow/outline → peripheral outline → `road-line` → `sector-boundary-line` → POI layers via
`byGeomType('polygon')`, then `('line')`, then `('point')` → measure layers.

The three `byGeomType` passes are ordered so area POIs paint before point markers, not over them.

### The "wash + hairline" pattern

Both `sector-plan-fill` and POI polygons use a **faint zoom-interpolated wash fill** plus a **separate
dedicated hairline `line` layer** carrying all the class identity. Rationale (documented in code): a
saturated fill plus same-hue `fill-outline-color` on hundreds of adjacent parcels drowned the basemap
roads and turned the 25-colour palette into noise. `fill-outline-color` can't take a width, opacity or
zoom curve — a real `line` layer can. Reuse this pattern for any new dense polygon layer.

### Two special-cased layers

**`entry_exit_line`** — gets an extra wide, soft, semi-transparent `-glow` layer underneath that fades
out as you zoom _in_. These are short real-world segments (tens to hundreds of metres) that would
otherwise be an invisible speck at region zoom. Its core width scales _up as you zoom out_, the reverse
of the usual pattern.

**`tertiary_road`** (the 21k-row OSM street network) — rendered as a Google-Maps-style **casing + core**
pair: `poi-tertiary_road-casing` (pale border) painted beneath `poi-tertiary_road` (solid core), both
inserted with `beforeId: 'road-line'` so the curated project road network always wins visually.

Both widths **and** the core colour are tiered three ways by the OSM `fclass` property:

| Tier    | fclass values                                     | Dark      | Light     |
| ------- | ------------------------------------------------- | --------- | --------- |
| highway | `trunk`, `primary` (+`_link`)                     | `#8fbfff` | `#1967d2` |
| main    | `secondary`, `tertiary` (+`_link`)                | `#6ea8fe` | `#4285f4` |
| lane    | everything else (residential/service/track/path…) | `#4a6da5` | `#8fb4f0` |

Constants: `TERTIARY_ROAD_STYLE`, `TERTIARY_ROAD_CORE_WIDTH`, `TERTIARY_ROAD_CASING_WIDTH`,
`tertiaryRoadColorExpr(theme)`. The mid tier deliberately keeps the previous flat values in both themes,
so only the two extremes moved apart. Each theme moves in whichever direction gains contrast against its
own ground.

### Clustering

Only the **7 point layers** (each under ~1,400 rows) use MapLibre `geojson` sources fed by
`/api/poi/points/[layer]`, reclustered client-side by `clusterPoints()` in
[`src/lib/poiClustering.ts`](src/lib/poiClustering.ts) on every `zoomend`.

Why not MapLibre's built-in `cluster: true`? Supercluster has no hard per-cluster size cap, so a dense
pocket (150+ dustbins) still forms one giant useless cluster. `clusterPoints` recursively subdivides any
group over its max size. Line and polygon POI layers always stay on vector tiles.

Note: MapLibre clusters a geojson source's _raw_ data before any style filter runs, which is why
`/api/poi/points/[layer]` supports server-side `?subclass=` filtering — a style filter alone can't shrink
a cluster's `point_count`.

### Theme handling — easiest thing to get wrong

`readMapTheme()` reads `data-theme` off `document.documentElement`. Basemaps are **vendored style JSONs**
in `public/` (MapTiler Bright for light, CARTO Dark Matter for dark), fetched and merged into the map's
style object rather than applied via `setStyle()` — so the app's own sources and layers survive a theme swap.

**There is a dedicated theme-swap effect that re-applies every theme-dependent paint property in place.**
If you add a new theme-aware layer and forget to register it there, it will silently keep whichever
theme's colours it was created with. `PLAN-deferred-roads.md` calls this out as the single easiest thing
to miss.

### Colour system — [`src/lib/classColors.ts`](src/lib/classColors.ts)

`CLASS_GROUP_COLORS` maps ~25 `sector_plan.class_group` values to hex, tiered by **operational
importance** rather than as a flat rainbow:

- **Tier 1** (critical) — Health/Religious/Police/Administrative Camping, Commercial, Amenities,
  Reserved Area. Each gets its own vivid hue no other class shares.
- **Tier 2** (secondary) — Sanitation, Transport, Utilities, Media/Other Camping, Recreation, Education,
  Warehouses, Existing Development. Distinct hues at ~35–45% less chroma.
- **Tier 3** (terrain/context) — Road, Pathway, Open Area etc., near-neutral slates. Exceptions:
  Green Area (moss) and Waterbody (steel-blue) keep a faint real-world hue, and **Parking** gets its own
  slate-blue because it's the single largest class by area.

`CLASS_GROUP_COLORS_DARK` (in MapView, not this file) reuses the same hue families pushed brighter.

The POI palettes (`POINT_`/`LINE_`/`POLYGON_LAYER_COLORS`) deliberately **cross-reference exact hex
values** with `CLASS_GROUP_COLORS` wherever a POI names the same real-world thing, so a legend swatch
means the same thing everywhere.

`POI_SIGNAGE_CODES` (`bus_stop`→BS, `kumbh_mela_2027_ghat`→G, `fh_location`→FH) render a text badge in
place of the usual dot. `readableTextOn()` picks black/white text by WCAG luminance, with a manual
override table for DB colours sitting right at the contrast threshold.

### Other MapView features

- **Measure mode** — click to commit points, live rubber-band preview, right-click to undo onto a redo
  stack. Haversine distances per-segment and total. Custom dot markers, not MapLibre's default pin.
- **Click resolution order** — measure mode → cluster (zooms +3) → POI → parcel/road → bare sector.
- **Layer visibility** — seeded to SSR-safe defaults, then hydrated from `localStorage` post-mount to
  avoid hydration mismatch, and mirrored into a ref for the once-registered `load` handler.

### Insights (Heatmap/Ticket mode) — admin & manager only, see `PLAN-heatmap.md`

`ModeSwitcher` (top-left control strip, gated on `canUseInsights`) swaps `MapView` between three modes:
Map (the default subsystem above), Heatmap, and Tickets (sectors coloured by status-bucket feature-state).
It's an icon-only `role="radiogroup"` of three equal-width `role="radio"` squares (no text labels, just
`aria-label`/`title`) with a roving tabindex — arrow keys/Home/End move focus **and** selection between
segments, Enter/Space activates the focused one; only the checked segment is a tab stop. Keyboard
shortcuts `1`/`2`/`3` jump straight to Map/Heatmap/Tickets and `Esc` clears `insightSector` and returns to
Map, all registered on `document.keydown` and skipped while an input/textarea/select has focus or while
measure mode is active (measure mode owns `Esc` for exiting itself).

**Heatmap mode (Phase 7 revision, `PLAN-heatmap.md` §11)** shows only sector boundaries plus an actual
MapLibre `heatmap`-type layer (`insight-heat` in `insightLayers.ts`) — a translucent, non-polygon glow
concentrated on ticket density, not a flat per-sector fill. Sector fill/labels, POIs, and other Map-mode
layers are hidden by default; basemap place-name labels are dimmed to ~50% opacity (not hidden) via
`setBasemapLabelsDimmed`, so the map stays legible under the glow. `HeatMetric` is just
`'total' | 'pctOpen'` (`src/lib/insights/aggregate.ts`) — Total glows/ranks every ticket, % open re-uses
the same open-tickets-only glow but ranks the sector list by percentage; there's no per-sector-polygon
metric anymore. Above z15.5 individual ticket dots (`insight-heat-points`) fade in and become clickable —
the click handler resolves `class_group_idx`/`status_idx`/`priority_idx` off the clicked GeoJSON feature
(via an `insightsDataRef` mirror, since the map's one-time `load` handler closure can't see fresh React
state) and shows a popup styled like the plain-map parcel popup (icon header + labelled property rows for
a single ticket, or a compact per-ticket block for a cluster). The colour ramp is a fixed 5-stop
green→red (`HEAT_PALETTE` in `src/lib/insights/heatScale.ts`, same ramp for both themes) surfaced as a
single CSS gradient bar (`heatGradientCss`) in both `InsightsModePanel`'s legend and `FloatingLegend`.
`computeQuantileBreaks`/`colorForValue` (same file) are Ticket mode's, not Heatmap's, colouring logic now.

A `?mode=heatmap`/`?mode=tickets`/`?mode=evacuation` deep link cold-loads correctly — the
mode-visibility effect is gated on `mapReady` (a state flip at the end of `initMap`'s `load` handler), not
`map.isStyleLoaded()`, specifically so it re-runs once on mount even when `mode` is already non-`'map'`
before the style finishes loading. (An earlier revision of this doc flagged the `isStyleLoaded()` version
of this bug as open; it had already been fixed by the time PLAN-evacuation.md's Phase 1 checked, so this
note now just explains why the `mapReady` gate exists rather than warning about it.)

Data contract is a client-side split (`PLAN-heatmap.md §3.3`): a bulk ticket-tuple array
(`useTicketInsights`) fetched once per `active` transition and filtered/rolled-up locally
(`rollupBySector`/`matchesFilters` in `src/lib/insights/aggregate.ts`) drives the sector list, legend and
map paint; a separate on-demand fetch (`useSectorInsights`, keyed on `sector:nonce` to dedupe redundant
re-fetches) hits `/api/insights/sectors/:sectorNo` (`:sectorNo` is `all`/`peripheral`/a number) for the
richer per-sector detail (trend, assignees, oldest-open, median-resolve-time, ticket rows) shown in
`InsightsPanel`. `InsightsModePanel` (left, metric/legend/filters/ranked sectors) and `InsightsPanel`
(right, hero/status/categories/priority+trend/assignees/tickets) are both `Panel`s and both auto-collapse
below `sm` like every other docked panel.

A compact **floating legend** (`FloatingLegend`, module-private to `MapView.tsx`) appears bottom-left,
on any viewport, whenever `InsightsModePanel` is collapsed (tracked via its `onWidthChange` →
`Panel`'s `onRenderedWidthChange`, which reports 0 when collapsed) so the map's colours always have a key
even with the panel tucked away. It deliberately recomputes its own small rollup from
`insightsData`/`filters`/`heatMetric` rather than reaching into the paint effects' internal refs.

### Evacuation mode — `PLAN-evacuation.md` (complete, Phases 0-7)

A 4th `ModeSwitcher` segment (amber, `--map-mode-evacuation`, key `4`), for crowd-flow/evacuation
planning: entry/exit points and routes, direction signage, emergency exits, traffic routes, plus
off-by-default supporting layers (thematic gates, junctions, bridges, footpaths, fire hydrants, public
service facilities, zone outlines) and flood risk (`hfl_area`/`hfl_line`). See §10's "Two source drops" for
where the emergency-exit/flood/hospital data actually comes from.

Its own layer-visibility store (`EvacKey` in `src/lib/evacuation/layers.ts`, defaults in
`defaultEvacVisibility()`) is deliberately **separate** from Map mode's `visibility` — persisted under its
own `localStorage` key (`tcsticket:mapView:evacVisibility`) — except `sector_plan`/`sector_boundary`/
`sector_names`, which keep following the shared `visibility` in this mode (unlike Heatmap/Ticket, which
force sector labels off and Heatmap alone also forces the sector layers themselves off). The 6
"supporting" POI layers (thematic gates, junctions, bridges, footpaths, fire hydrants, public service
facilities) reuse Map mode's own `poi-*` layers directly, following `evacVisibility` instead of
`visibility` while this mode is active — every other `POI_LAYER_DEFS` key (including ones this mode also
draws, like `traffic_route`/`entry_exit`) stays hidden, since those get their own dedicated `evac-*`
layers instead (see `evacLayers.ts`) so the two visual languages never mix.
`Esc` in this mode steps back one level per press (clear the selected feature, then the focused
sector/zone, then leave the mode) rather than exiting in one press like Heatmap/Ticket do.

**Map layers (`evacLayers.ts`, Phase 2):** created once in `initMap`'s `load` handler (gated on
`canUseInsights`), reusing the `traffic_route`/`entry_exit_line`/`direction_line`/`entry_exit`/
`location_entry` sources MapView's own POI-layer loop already creates, plus `emergency_exit` (Phase 0)
and two new vector sources for `hfl_area`/`hfl_line`. Entry is green, exit is rose (a different green/red
split from Map mode's single "green = entry or exit" convention, since this mode's whole point is telling
them apart), emergency exits keep Map mode's red, flood risk is translucent blue. EN/EXT point badges
reuse the same canvas-drawn pill-icon generator as Map mode's "BS"/"G"/"FH" signage codes, extracted to
`src/lib/mapBadgeIcon.ts` so both can share it. **Not yet implemented** (see the phase table in
PLAN-evacuation.md for why): traffic-route/direction-signage arrows, zone outlines/labels, the
selected-feature highlight's data (Phase 5), hover feature-state (Phase 5), and dimming
`sector-plan-fill` itself (only basemap labels dim so far).

**Gotcha this phase caught and fixed:** `emergency_exit` (Phase 0's own source) was missing from
`APP_SOURCE_IDS`, the whitelist the basemap theme-swap effect uses to tell "one of our own sources" apart
from "belongs to the vendored basemap" — same bug `INSIGHT_HEAT_SOURCE`/`INSIGHT_SECTOR_LABEL_SOURCE`
already had comments warning about, missed the first time. A real theme toggle would have deleted it as a
stale basemap source. Fixed alongside adding evacLayers.ts's own three new sources to the same list.

**Search + summary APIs (Phase 3):** `/api/evacuation/search` and `/api/evacuation/summary` (§8 table)
are sector- **and zone-aware** — each result's sector/zone comes from a `LEFT JOIN LATERAL` against
`sector_boundary` on `ST_Intersects(boundary, ST_PointOnSurface(feature))`, so a query like "12" or
"rishikesh zone" finds features spatially inside that area even when the feature's own `sector` column
is null (most of them are — see §2.2 above). Every label shown anywhere (search results, and eventually
popups) comes from `src/lib/evacuation/labels.ts`, never a raw column value — `traffic_route.name` in
particular is null on half the rows and inconsistently cased on the rest, so its label is always built
from the structured `entry_exit`/`plan`/corridor-flag columns instead. `src/lib/evacuation/filters.ts`
has the `EvacFilters` type plus `buildEvacFilters`/`trafficRoutePlanVisible` (unit-tested).

**`EvacuationModePanel` (real, Phase 4):** search (`useEvacuationSearch`, 200ms debounce +
`AbortController`), scenario/direction/corridor filter chips, and interactive layer toggles.
**Deliberately not** built by extracting Map mode's ~700-line unified search into the shared
`src/components/map/search/*` components the plan originally sketched — that refactor's only payoff
was code reuse, and its risk (a regression in Map mode's most-used control, unreviewed) wasn't worth it
for an autonomous pass. `EvacuationModePanel` has its own self-contained search UI instead, following
the same visual conventions; Map mode's own search code is completely untouched.

Filter chips are wired all the way to the map: `evacLayers.ts`'s `applyEvacFilters` applies direction/
corridor as real `setFilter` calls (ANDed onto traffic_route's permanent peak/normal split), and
`setEvacLayersVisible` now also takes `evacFilters` so the scenario chip can show/hide the peak vs
normal traffic-route layer without fighting the `traffic_route` on/off toggle (two independent
booleans on the same pair of layers). **One filter is a known no-op:** Direction has no effect on
`entry_exit`'s point badges, since that layer sits on a clustered geojson source and a style filter
can't change cluster membership (see "Clustering" above) — doing this right needs a server-side
`?remark=` refetch, not built yet.

**`EvacuationPanel` (real, Phase 6):** a hero tile row (Entry/exit points · Entry/exit routes ·
Traffic routes · Direction signage · Emergency exits — five real `/api/evacuation/summary` counts,
each as an `AnimatedBar` share-of-max bar, fed by a new `useEvacuationSummary` hook that refetches on
`evacFocus` change), a "Nearby care" list (hospitals/police/fire, with bed counts already formatted
server-side by `facilityLabel`) shown only when a sector/zone is focused, a static legend of every
evac-\* style (EN/EXT badges, solid vs dashed route lines, emergency casing, flood fill/lines), and a
per-focus "Features in view" list grouped by layer. Every care/feature row reuses `selectEvacResult`
(now also passed to `EvacuationPanel` as `onSelectResult`) for the same fly-in/highlight/layer-on
behaviour a search result gets — a summary-API feature (`id`/`label`/`sublabel`/`bbox`/`anchor`, no
sector/zone/source fields) is adapted into `EvacSearchResult`'s shape by a small `asSearchResult`
helper rather than widening the summary API to match search's response shape. All sections use
`Reveal`/`pillEntranceDelayMs` from `insights/charts.tsx`, same cascade as Heatmap/Ticket panels.
One deliberate scope note: the hero shows one combined "Entry/exit points" count rather than a
separate entry/exit split — `kumbh.entry_exit` only carries direction per-row (`remark`), and
`/api/evacuation/summary`'s `COUNTED_LAYERS` never aggregates by direction, so a true split needs a
new query shape nothing else in the mode needs.

`EvacuationModePanel` also gained a "Base layers" section this phase (sector plan/boundaries/names,
bound to Map mode's own shared `visibility`/`setVisibility` via new `mapVisibility`/`onToggleMapLayer`
props) — decision #6 always required this, but Phase 4's self-contained-search scope change dropped it
by omission; and `Reveal` stagger on its own filter/layer sections, matching the right panel.

`FloatingLegend` (module-private in MapView.tsx) gained a 3rd `mode === 'evacuation'` branch — a
compact EN/EXT/Emergency/Peak/Normal key with no counts (this mode has no per-mode rollup the way
Heatmap/Ticket do) — shown via a new `evacModeCollapsed` state tracking `EvacuationModePanel`'s own
`onWidthChange` (mirroring `insightsModeCollapsed`). Rather than fork a second legend component, its
`insightsData`/`filters`/`heatMetric` props were loosened to optional (with an early `if (!insightsData
|| !filters) return null` guard before the ticket-mode branch that needs them) so one component still
serves all three modes.

**Click handling + popups (Phase 5):** a new mode-specific branch in `initMap`'s click handler (mirroring
Heatmap/Ticket's own self-contained branches) checks entry/exit clusters (+3 zoom, same as every other
clustered POI layer), then the evac-\* layers themselves (popup via a new `evacPopupContent`/
`showEvacPopup` in MapView.tsx, using `src/lib/evacuation/labels.ts`'s pure label functions directly
client-side -- no server round-trip, since the clicked feature's own vector-tile properties are exactly
the row shape those functions expect), then falls back to the same `poiLayerIds` check Map mode uses
(safe because every *other* POI layer stays hidden while this mode is active) for the 6 supporting
layers, and finally bare-sector (`evacFocus` + fly) vs. empty-area (clear selection). A clicked feature's
exact geometry, or a search result's bbox-as-rectangle (results never carry full geometry, to keep that
API response light), populates the `evac-selected` geojson source via a dedicated effect keyed on
`evacSelection`, showing a **steady** highlight outline -- not the plan's pulse-then-settle animation,
which is deferred polish.

**A real bug from Phase 2, only caught here:** `classColors.ts` briefly had `hfl_area`/`hfl_line` entries
in `POLYGON_LAYER_COLORS`/`LINE_LAYER_COLORS` (added during Phase 2, commented "not yet a Map-mode
toggle") -- but `POI_LAYER_DEFS` in MapView.tsx is *auto-derived* from those maps' keys (see §9's own POI
section), so the entries silently made Map mode's generic POI loop create a `kumbh.hfl_area` vector
source of its own before `addEvacLayers` ever ran. `addEvacLayers`'s own idempotency guard then saw that
source and silently returned, every time, meaning **no evac-\* layer existed at all** for the whole of
Phases 2-4 despite no console error ever appearing -- nothing in that testing exercised a code path that
would query an evac-\* layer id and surface the gap. Fixed by removing the 4 classColors.ts entries
entirely (flood risk is Evacuation-mode-only; its colours live in `EVAC_COLORS`,
`src/lib/evacuation/layers.ts`). If either map ever needs a flood-risk-adjacent entry again, remember
that adding one there is equivalent to adding a Map-mode toggle, not a private reference value.

**Phase 6/7 (final polish):** see "`EvacuationPanel` (real, Phase 6)" above for the right panel's hero/
nearby-care/legend/feature-list content and the `FloatingLegend` evacuation branch. Phase 7's one real
a11y fix: `EvacuationModePanel`'s search implements genuine roving-highlight keyboard nav (arrow keys
move a `highlightIndex`, Enter activates) but never exposed that to assistive tech — the input now
carries `role="combobox"`/`aria-expanded`/`aria-controls`/`aria-activedescendant`, and every
`role="option"` row has a matching `id`. The listbox's non-option children (group headers, loading/
error/empty states) got `role="presentation"` to keep the tree valid. Both modes' panels, the shared
search UI, and every layer toggle are covered; nothing else in the mode needed an a11y change.

**Post-launch fixes (same day):** user testing surfaced 4 real bugs, all fixed — see
`PLAN-evacuation.md` §13 for the full writeup. In short: layer toggles now fly-in like Map mode's own
`togglePoiLayerFilter` (`toggleEvacLayer`, reusing `/api/poi/locate`); a focused sector now actually
highlights (`sector-selected-outline`/`-glow`'s filter effect gained an `evacFocus` branch it never had);
right-click and clicking empty area now clear `evacFocus`/`evacSelection` (new `evacFocusRef`/
`evacSelectionRef` mirroring `selectedSectorRef`, plus the empty-area click branch clearing `evacFocus`
too, not just `evacSelection`); and the Legend/`FloatingLegend` traffic-route/direction-signage swatches
were corrected from an invented blue/violet to the actual rendered green/red direction colors.

**Deferred-item follow-up (same day):** 3 more items from the original design, previously deferred or
explicitly decided against, were implemented on request — see `PLAN-evacuation.md` §14. Traffic-route/
direction-signage **arrows**: real data showed the source geometry's vertex order has no reliable
relationship to Entry/Exit (checked via a nearest-sector-centroid distance comparison before writing any
code — roughly 60/40 either way), so arrows are a new `/api/evacuation/arrows`-fed bearing computed from
each route's midpoint to/from its nearest sector centroid instead of following the line itself, rendered
as rotated chevron `symbol` layers. The selected-feature highlight now **pulses then settles** (~2.4s
ease-out rAF) instead of a steady outline. And a **shared search UI** (`src/components/map/search/`:
`SearchInput`/`SearchGroupHeader`/`SearchResultRow`) now backs both Map mode's input/group-headers and
Evacuation's whole dropdown — narrower than the original "extract everything" sketch (the bespoke
sector-classes/POI subclass trees stayed put in MapView.tsx) to keep the regression risk Phase 4 flagged
near zero, verified via live before/after checks in both themes.

---

## 10. The geospatial data

Source: `Kumbh_Mela_2027_V1_07_07.gdb`, an ArcGIS File Geodatabase with **67 layers**, loaded by
[`scripts/load_kumbh_2027.py`](scripts/load_kumbh_2027.py) into the `kumbh` schema. Source CRS is
UTM 44N (EPSG:32644); everything is reprojected to EPSG:4326 on load.

As of 2026-09-11: **67 of 67 loaded** (57 source layers → 72 tables, some merged) — nothing remains deferred.

- **`Road_Secondary` (109 rows), loaded 2026-09-11:** classified by length-coverage against already-loaded
  `kumbh.traffic_route`/`kumbh.road` geometry (planar, EPSG:32644, union of nearby reference geometry —
  centroid distance was tried first and rejected as too weak). The distribution was cleanly bimodal, so a
  human reviewed a generated CSV rather than trusting the heuristic outright: **97 of 109 rows were
  duplicates of already-loaded geometry and were dropped**; the 12 survivors (11 unnamed segments +
  "Haridwar Main Road") were appended to `kumbh.road` (`road_class='Secondary'`, 752 → 764 rows). The drop
  list is content-hash-keyed (`ROAD_SECONDARY_DUPLICATE_HASHES` in `load_kumbh_2027.py`, keyed on
  `geom_content_hash()` — post-reprojection vertices, not source row index) so a re-exported/reordered gdb
  can't silently invalidate it; a geometry change makes every hash stop matching and the loader raises
  loudly instead of re-admitting duplicates. `PLAN-deferred-roads.md` Phase 4 has the full writeup.
- **Permanently skipped:** `Road_Secondary_Poly` (13), `Road_Poly` (1) — unnamed polygon blobs,
  reproducible via `ST_Buffer` if ever needed.
- Also skipped: superseded plan versions, ArcGIS scratch/annotation layers, and layers with 0 features.

### The `tertiary_road` story

`Sector_Tertiary_Road` turned out **not** to be a second dataset — it's a near-total _subset_ of
`Tertiary_Road` (7,064 of 7,068 osm_ids overlap). Both load into **one** table `kumbh.tertiary_road`
(21,284 rows post-dedup) with a boolean `in_sector` column instead of two tables.

It was also the only **3D** layer in the gdb, which is why the loader has `force_2d()`.

Only 121 of 21,284 rows have a `name`; `fclass` is the reliable descriptive column. Breakdown:
15,646 residential, 2,431 service, 794 unclassified, 630 track, 548 tertiary, 311 trunk, 255 path,
227 footway, 180 secondary, 72 primary.

The layer **defaults off**, is **deliberately excluded from `/api/stats`'s `POI_TABLES`** (at 21k rows it
would dominate a features-sorted list 15–70× over every curated layer — it gets a standalone
`tertiaryRoadCount` footer stat instead), and has an "Only inside sector area" checkbox that applies a
plain MapLibre `setFilter` on `in_sector` — no second layer or request, since it's already a tile property.

Its label is **"Street network (OSM)"** to flag it as third-party reference data, not curated project
infrastructure.

### Two source drops, and why a few tables mix them (`source` column)

`scripts/load_kumbh_2027.py` reads from a `Kumbh Data/` folder at the repo root (gitignored, not
committed — see `--source-root` below) that actually holds **two** drops:

- `Kumbh_Mela_2027_V1_07_07/…gdb` (edited 2026-09-06) — **the source of truth for everything.**
- `Kumbh_Mela_Shape/25_08_2026/` — an **older** shapefile export, kept only because the 2027 gdb
  dropped or never had three things (see `SHP_TABLE_SPECS`/`supplement_public_service_facilities` in
  the loader, and `PLAN-evacuation.md` §2-§3 for the full investigation):
  - **`kumbh.emergency_exit`** (new table, 24 rows) — the 2027 road reload relabelled these 24 paths
    (in sectors 7/9/11/12) as plain `Proposed Road`; the label survives only in the older drop, even
    though 23 of the 24 paths' vertices coincide with a `Proposed Road` row in `kumbh.road`. Map mode's
    "Emergency Exit" toggle now draws from this table (its own `emergency-exit-line` MapLibre layer) —
    it used to be a `type='Emergency Exit'` filter on `road-line`, which is why the toggle existed but
    drew nothing between the 2026-09-06 reload and this table's introduction.
  - **`kumbh.hfl_area`** (19 rows) / **`kumbh.hfl_line`** (17 rows) — flood-risk polygons/lines (High
    Flood Level) with no 2027 gdb equivalent at all.
  - **21 rows appended to `kumbh.public_service_facilities`** — Hospital/Health Camping facilities
    (AIIMS, Mela Hospital, Harmilap Mission, …) the 2027 gdb doesn't carry, plus `subclass`/`services`/
    `category`/`bed` backfilled on the 57 gdb rows where the older drop has them (2027's own columns
    are all null). `supplement_public_service_facilities` does this and re-runs automatically after any
    reload of that table, since a plain gdb reload truncates it back to null/57.
  - `kumbh.sector_boundary.zone` (32 rows, 5 zones) is also backfilled from the older drop's
    `SECTOR_BOUNDARY_UPDATED.shp`, which carries a `Zone` column the 2027 layer doesn't — matched by
    sector **name** (all 32 match exactly, no spatial join needed).

  Every row actually sourced from the older drop carries `source = 'shp_2026_08_25'` (`'gdb_2027'`
  otherwise, on tables that have the column at all) so the app can flag it as such — see the
  "Source: 25 Aug 2026 survey" popup row for `emergency-exit-line`/`kumbh.hfl_*`.

  **Do not casually pull anything else from the older drop.** These four exceptions were individually
  verified (row counts, name/geometry matching) against the 2027 data — the 2027 gdb is authoritative
  for everything not listed above, including its own 15-point-smaller `entry_exit` (63 vs. the older
  drop's 78) and its `Public_Service_Facilities`/`FSTP` type set.

---

## 11. Build and deploy — the Oryx saga

Deploys to **Azure App Service** via `.github/workflows/main_kumbhmela.yml` + [`startup.sh`](startup.sh).

**The core problem:** Azure's Oryx platform runs its own startup script _before_ ours, and unconditionally
extracts `node_modules.tar.gz` into a shared location and replaces the app's `node_modules` with a
symlink to it. That breaks `require('next')`. Setting `ENABLE_ORYX_BUILD=false` did **not** reliably stop
this, because the `oryx-manifest.toml` driving it could linger in `wwwroot` from earlier deploys.

**The working approach — all six parts are load-bearing:**

1. Deploy `.next/standalone` only, not the whole repo (traced paths and shipped files come from one build).
2. Install with **`npm ci`**. npm produces a genuinely flat `node_modules` of real directories; a package
   needing a different version of a transitive dep gets its own nested copy. Nothing is a symlink into a
   content store, so the tree the build resolves against _is_ the tree that ships.

   This replaced pnpm, which was the root cause of a long run of production crashes. Next bakes resolved
   dependency paths into `.next/**/*.nft.json` at build time; under pnpm those pointed into
   `.pnpm/<pkg>@<ver>/node_modules/<pkg>`, so the shipped tree had to be reshaped afterwards to match.
   Every package the reshaping missed crashed the server at runtime — one at a time, in load order, which
   is why fixing `@swc/helpers` just surfaced `bson` next. `node-linker=hoisted` was not enough: it
   flattens the top level but keeps the `.pnpm` store, and the tracer still emitted stubs pointing into it.

3. Dependencies are **pinned to exact versions** in `package.json`, with `overrides` pinning transitive
   ones. This was how the migration kept behaviour identical — see §11.1.
4. Ship node_modules as **`app-node-modules.tar.gz`** — deliberately _not_ `node_modules.tar.gz`, because
   Oryx special-cases that filename. A different name survives untouched.
5. Archive with **`tar -h`** (dereference symlinks). Next externalizes some server packages under
   `.next/node_modules/<pkg>-<hash>` as symlinks with absolute build-machine paths; plain `tar` ships a
   dangling link and the app dies with `Cannot find module`. The workflow asserts post-archive that no
   symlinks remain and that no `.pnpm` path survived.
6. `clean: true` on the deploy action wipes `wwwroot` so stale Oryx manifests can't persist.

`startup.sh` then removes any symlink/stale dir Oryx left, unpacks the tarball, verifies `node_modules/next`
exists, sets `HOSTNAME=0.0.0.0`, and execs **`node server.js`** — not `next start`, and not the `.bin/next`
symlink, which zip round-trips mangle.

> **If you change the build or packaging step, preserve `npm ci`, the `tar -h`, and the
> non-Oryx-recognized archive filename**, or the deploy silently regresses to the symlink-clobbering
> failure mode.

### 11.1 Why dependencies are pinned

`package.json` pins every direct dependency to an exact version and carries a large `overrides` block
pinning transitive ones. This is deliberate: the pins were chosen to reproduce exactly what pnpm had
resolved, so the pnpm-to-npm migration could not change application behaviour. Resolution was verified
package-by-package against the previous tree.

Two cases need the `overrides` block and will break if it is trimmed:

- **`@tiptap/*`** — all 28 packages are pinned to one version. Left alone, npm floats `starter-kit` to a
  newer release that pulls a _second_ copy of `@tiptap/core`; the two copies' types are structurally
  incompatible and the build fails typechecking.
- **`mongoose > mongodb`** — pinned to the 7.x line mongoose expects. Do **not** also pin `bson`
  globally: the top-level `mongodb@6` needs `bson@6` while mongoose's `mongodb@7` needs `bson@7`, and a
  global pin collapses them into one wrong copy.

When bumping a dependency, update the pin (and any related override) rather than loosening it to a range.

### 11.2 The smoke test is the real gate

The workflow boots the packaged artifact and asserts HTTP 200 before uploading it. Note that HTTP checks
alone are **not** sufficient: there is no database in CI, so any route touching one fails on
`ECONNREFUSED` _before_ it ever imports mongoose. That is precisely how a missing `bson` shipped green.

So the step also runs [`scripts/verify-standalone-artifact.mjs`](scripts/verify-standalone-artifact.mjs),
which `require()`s each externalized package in `.next/node_modules/` directly — no database needed — and
fails on a missing transitive file. Keep that check if you touch the smoke test.

---

## 12. Testing

**Unit — Vitest** (`vitest.config.mts`), scoped to `src/**/*.test.ts(x)`, excludes `e2e/`:

```bash
npm test         # one-shot
npm run test:watch
```

Current tests: `src/lib/questionnaire/general-camping.test.ts`, `src/lib/questionnaire/summarize.test.ts`,
`src/lib/schemas/questionnaire.test.ts`, `src/lib/utils.test.ts`, `src/server/auth/ability.test.ts`.
`mongodb-memory-server` is available for DB-backed tests.

**E2E — Playwright** (`playwright.config.ts`), auto-starts `npm run dev` on port 3000, chromium only,
2 retries in CI:

```bash
npm run e2e
```

Only spec is `e2e/auth.spec.ts` (unauthenticated redirect, login form render, invalid-credentials error).

Coverage is thin — the map and ticket flows have no automated tests.

---

## 13. Scripts

| Script                          | What it does                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `copy-maplibre-worker.mjs`      | **postinstall hook.** Copies MapLibre's worker files into `public/` so Turbopack can resolve them. Runs on every install — don't skip it. |
| `seed.ts` (`npm run seed`)      | Roles, statuses, priorities, types, 3 named accounts, 2 service accounts. **Deletes all users first.**                                    |
| `import-map-tickets.ts`         | One ticket per `kumbh.sector_plan` parcel. Idempotent (skips already-imported `sectorPlanId`). Requires `npm run seed` first.             |
| `demo-distribute-priorities.ts` | Demo data — reshuffles priorities by weighted random (35/40/18/7%).                                                                       |
| `demo-resolve-by-category.ts`   | Demo data — resolves 30–60% of each category's open tickets. Safe to re-run.                                                              |
| `demo-spread-ticket-dates.ts`   | Demo data — spreads dates over 7 days with an upward trend. Uses `overwriteImmutable: true` to write `createdAt`.                         |
| `load_kumbh_2027.py`            | **The GIS loader.** See below.                                                                                                            |

### Extending `load_kumbh_2027.py`

```bash
python scripts/load_kumbh_2027.py [--dry-run] [--only table1,table2] [--source-root PATH]
```

Reads `POSTGRES_URL` from `.env.local`. Needs `fiona`, `pyproj`, `psycopg2-binary`, `shapely`.
`--source-root` defaults to `Kumbh Data/` at the repo root (gitignored — see §10's "Two source drops"
for what lives in there and why); falls back to the legacy repo-root layout if that's not present.

Three spec structures, all pairing a target table with one or more source layers/files and a
`map_fn(properties, source_layer) -> dict` column mapper:

- **`REPLACE_SPECS`** — table already exists, sourced from the gdb. Old rows are copied to a dated
  `<table>_backup_<date>` table, then truncated and reloaded.
- **`NEW_TABLE_SPECS`** — creates the table if missing (serial PK, GiST index on geom, btree on
  sector-like columns), sourced from the gdb.
- **`SHP_TABLE_SPECS`** — like `NEW_TABLE_SPECS`, but reads one standalone shapefile from the older
  25 Aug 2026 drop (`SHP_2026_08_25_DIR`) via `load_shp_new_table`, with an optional row-level
  `feature_filter`. Only used for the three exceptions in §10's "Two source drops" — don't add a
  layer here unless it's a genuine gap in the 2027 gdb, verified the way those three were
  (`PLAN-evacuation.md` §2-§3).

Reusable helpers: `force_2d()` (drops Z), `to_multi()` (promotes a bare Polygon/LineString to Multi* --
needed for shapefile sources, which aren't always the Multi variant a target column is declared as),
`clean()` (normalizes blanks), `backfill_sector_no()` (post-load spatial join for sector numbers
unparseable from free text — reusable on any table with `sector_no`/`geom`), `dedupe_tertiary_road()`
(the fold-a-subset-layer-into-a-flag-column pattern), `backfill_sector_zone()` (name-join `zone` from
the older drop onto `sector_boundary`), `supplement_public_service_facilities()` (centroid-matches the
older drop's facilities onto the gdb rows and appends the ones the gdb doesn't have — idempotent, and
re-run automatically after every reload of that table since a plain reload truncates its enrichment
away).

To add a gdb layer: add an entry to `REPLACE_SPECS`/`NEW_TABLE_SPECS` with a `map_fn`, following the
existing `_<table>_map` pattern. `SOURCE_TAG_2027`/`SOURCE_TAG_SHP` are the two values a table's
`source` column (where present) can hold.

---

## 14. Environment variables

| Var                                                  | Purpose                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `MONGODB_URI`                                        | MongoDB connection string                                                  |
| `POSTGRES_URL`                                       | Postgres/PostGIS — **must be the port-6543 pooler**                        |
| `AUTH_SECRET`                                        | Auth.js session secret                                                     |
| `AUTH_TRUST_HOST`                                    | Trust proxied Host headers (needed behind Azure)                           |
| `AUTH_URL`                                           | Canonical public origin; pins callback URLs / cookie domain                |
| `INTEGRATION_API_KEY`                                | Shared secret for `POST /api/v1/tickets`                                   |
| `DRONESEVA_PORTAL_ORIGIN`                            | Origin for "View in DroneSeva" links                                       |
| `NEXT_PUBLIC_MAPTILER_KEY`                           | MapTiler key for the light basemap (client-bundled)                        |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | Photo upload signing (server-only)                                         |
| `LOG_LEVEL`                                          | pino level                                                                 |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`           | In `.env.example`, but `seed.ts` now hardcodes accounts — likely vestigial |

---

## 15. Security notes worth knowing

- **`scripts/seed.ts` contains plaintext passwords** for the three named accounts, committed to the repo.
  Fine for a demo/staging deployment; rotate before anything resembling real production use.
- **`.env.local` holds live MongoDB and Supabase credentials.** It is not committed, but be careful not to
  paste its contents into logs, issues, or chat.
- Good patterns already in place, don't regress them: layer-name whitelists instead of SQL interpolation;
  Cloudinary folder-prefix re-validation; `sourceUrl` scheme restriction; server-side re-verification of
  ticket ownership in every action.

---

## 16. Current state

Branch `feat/heatmap` (not yet merged to `main`). Recent work (this may be stale — check `git log`):

- Heatmap/Ticket mode (`PLAN-heatmap.md`), Phases 1–6 committed; Phase 7 (density-heatmap revision,
  see §9) implemented on the branch but not yet committed as of this writing
- Ticket auth and route guards
- Mobile-responsive UI pass
- The Azure/Oryx deploy fixes described in §11
- `tertiary_road` width **and** colour tiering by `fclass` (§9)
- `proxy.ts` canonical redirect scoped to production so localhost dev works
- `Road_Secondary` classified and loaded (12 of 109 rows into `kumbh.road`, 97 duplicates
  dropped via content-hash exclusion) — the gdb load is now fully complete, 67/67 (§10)
- Evacuation mode (`PLAN-evacuation.md`) Phase 0 committed: `kumbh.emergency_exit`/`hfl_area`/
  `hfl_line` loaded from the older 25 Aug 2026 shapefile drop, `public_service_facilities` enriched
  with 21 extra hospitals, `sector_boundary.zone` backfilled — see §10's "Two source drops". Map
  mode's Emergency Exit toggle now draws real data again (its own `emergency-exit-line` layer/source,
  not a `road-line` filter).
- Evacuation mode (`PLAN-evacuation.md`) **complete, all 8 phases (0-7) committed**: mode plumbing, map
  layers (only genuinely live as of Phase 5 -- see §9's classColors.ts bug writeup), search/summary APIs,
  a real `EvacuationModePanel` (including a "Base layers" section) and `EvacuationPanel` (hero tiles,
  nearby care, legend, feature list), click/popup/selection-highlight handling, a `FloatingLegend`
  evacuation branch, and a Phase 7 a11y pass on the search combobox — §9's "Evacuation mode" subsection.
  Verified live in both themes and at 375px; `tsc`/`eslint`/`npm test` (85 tests) clean.

Open items:

- Test coverage for map and ticket flows is essentially absent (§12)
- `README.md` is still create-next-app boilerplate
