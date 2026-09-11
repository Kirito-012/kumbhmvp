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
pnpm install
pnpm dev
```

Then open `http://localhost:3000`.

Seeded login accounts live in [`scripts/seed.ts`](scripts/seed.ts) — three named accounts (admin,
manager, surveyor), each with a fixed plaintext password in that file. Run `pnpm seed` to create them.

> ⚠️ `pnpm seed` **deletes all users** before re-seeding. Never run it against a database with real accounts.

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
- **pnpm** with `node-linker=hoisted` (see §11 — this is load-bearing for deploys)
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

---

## 11. Build and deploy — the Oryx saga

Deploys to **Azure App Service** via `.github/workflows/main_kumbhmela.yml` + [`startup.sh`](startup.sh).

**The core problem:** Azure's Oryx platform runs its own startup script _before_ ours, and unconditionally
extracts `node_modules.tar.gz` into a shared location and replaces the app's `node_modules` with a
symlink to it. That breaks `require('next')`. Setting `ENABLE_ORYX_BUILD=false` did **not** reliably stop
this, because the `oryx-manifest.toml` driving it could linger in `wwwroot` from earlier deploys.

**The working approach — all six parts are load-bearing:**

1. Deploy `.next/standalone` only, not the whole repo (traced paths and shipped files come from one build).
2. Build with `pnpm install --node-linker=hoisted` so traced `.nft.json` paths are portable rather than
   symlinks into `.pnpm`. (`.npmrc` sets this locally too, so local matches CI.)
3. `pnpm prune --prod --ignore-scripts` — the `--ignore-scripts` avoids re-running husky's `prepare`
   script that prune just deleted.
4. Ship node_modules as **`app-node-modules.tar.gz`** — deliberately _not_ `node_modules.tar.gz`, because
   Oryx special-cases that filename. A different name survives untouched.
5. Archive with **`tar -h`** (dereference symlinks). Even under hoisted installs, Next's tracer emits
   `node_modules/next` as a symlink with an absolute build-machine path; plain `tar` ships a dangling link
   and the app dies with `Cannot find module 'next/dist/compiled/cookie'`. The workflow asserts
   post-archive that no symlinks remain.
6. `clean: true` on the deploy action wipes `wwwroot` so stale Oryx manifests can't persist.

`startup.sh` then removes any symlink/stale dir Oryx left, unpacks the tarball, verifies `node_modules/next`
exists, sets `HOSTNAME=0.0.0.0`, and execs **`node server.js`** — not `next start`, and not the `.bin/next`
symlink, which zip round-trips mangle.

> **If you change the build or packaging step, preserve the hoisted install, the `tar -h`, and the
> non-Oryx-recognized archive filename**, or the deploy silently regresses to the symlink-clobbering
> failure mode.

---

## 12. Testing

**Unit — Vitest** (`vitest.config.mts`), scoped to `src/**/*.test.ts(x)`, excludes `e2e/`:

```bash
pnpm test        # one-shot
pnpm test:watch
```

Current tests: `src/lib/questionnaire/general-camping.test.ts`, `src/lib/questionnaire/summarize.test.ts`,
`src/lib/schemas/questionnaire.test.ts`, `src/lib/utils.test.ts`, `src/server/auth/ability.test.ts`.
`mongodb-memory-server` is available for DB-backed tests.

**E2E — Playwright** (`playwright.config.ts`), auto-starts `pnpm dev` on port 3000, chromium only,
2 retries in CI:

```bash
pnpm e2e
```

Only spec is `e2e/auth.spec.ts` (unauthenticated redirect, login form render, invalid-credentials error).

Coverage is thin — the map and ticket flows have no automated tests.

---

## 13. Scripts

| Script                          | What it does                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `copy-maplibre-worker.mjs`      | **postinstall hook.** Copies MapLibre's worker files into `public/` so Turbopack can resolve them. Runs on every install — don't skip it. |
| `seed.ts` (`pnpm seed`)         | Roles, statuses, priorities, types, 3 named accounts, 2 service accounts. **Deletes all users first.**                                    |
| `import-map-tickets.ts`         | One ticket per `kumbh.sector_plan` parcel. Idempotent (skips already-imported `sectorPlanId`). Requires `pnpm seed` first.                |
| `demo-distribute-priorities.ts` | Demo data — reshuffles priorities by weighted random (35/40/18/7%).                                                                       |
| `demo-resolve-by-category.ts`   | Demo data — resolves 30–60% of each category's open tickets. Safe to re-run.                                                              |
| `demo-spread-ticket-dates.ts`   | Demo data — spreads dates over 7 days with an upward trend. Uses `overwriteImmutable: true` to write `createdAt`.                         |
| `load_kumbh_2027.py`            | **The GIS loader.** See below.                                                                                                            |

### Extending `load_kumbh_2027.py`

```bash
python scripts/load_kumbh_2027.py [--dry-run] [--only table1,table2]
```

Reads `POSTGRES_URL` from `.env.local`. Needs `fiona`, `pyproj`, `psycopg2-binary`.

Two spec structures, both pairing a target table with source gdb layer(s) and a
`map_fn(properties, source_layer) -> dict` column mapper:

- **`REPLACE_SPECS`** — table already exists. Old rows are copied to a dated
  `<table>_backup_<date>` table, then truncated and reloaded.
- **`NEW_TABLE_SPECS`** — creates the table if missing (serial PK, GiST index on geom, btree on
  sector-like columns).

Reusable helpers: `force_2d()` (drops Z), `clean()` (normalizes blanks), `backfill_sector_no()`
(post-load spatial join for sector numbers unparseable from free text), `dedupe_tertiary_road()` (the
fold-a-subset-layer-into-a-flag-column pattern).

To add a layer: add an entry to the appropriate spec with a `map_fn`, following the existing
`_<table>_map` pattern.

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

Branch `main`. Recent work (this may be stale — check `git log`):

- Ticket auth and route guards
- Mobile-responsive UI pass
- The Azure/Oryx deploy fixes described in §11
- `tertiary_road` width **and** colour tiering by `fclass` (§9)
- `proxy.ts` canonical redirect scoped to production so localhost dev works
- `Road_Secondary` classified and loaded (12 of 109 rows into `kumbh.road`, 97 duplicates
  dropped via content-hash exclusion) — the gdb load is now fully complete, 67/67 (§10)

Open items:

- Test coverage for map and ticket flows is essentially absent (§12)
- `README.md` is still create-next-app boilerplate
