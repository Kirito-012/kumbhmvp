/**
 * Shared Cache-Control values for the GIS read routes.
 *
 * Everything under `kumbh.*` only changes when `scripts/load_kumbh_2027.py` runs — which is a manual,
 * occasional operation — yet each of these routes recomputed its answer from scratch on every request
 * from every user. `/api/stats` alone is 7 PostGIS aggregates including a 45-table `UNION ALL` and
 * `sum(ST_Area(geom::geography))` over `kumbh.sector_plan` plus 15 polygon tables.
 *
 * The values mirror what the tile route (`/api/tiles/...`) already carries and for the same reason:
 * a short browser `max-age` so a reload inside a working session is free, a long shared `s-maxage`
 * for any CDN put in front of the app, and `stale-while-revalidate` so the refresh never blocks a
 * response. `max-age` is kept to 5 minutes rather than the tiles' hour because these payloads carry
 * the counts and totals a user reads as numbers — a fresh GIS load should surface within minutes.
 */
export const GIS_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400',
} as const

/**
 * For GIS-derived responses that are nonetheless gated on a session ability (the Evacuation and
 * Insights routes check `ability.can('read:all', 'ticket')`). `private` keeps a shared cache from
 * ever holding one — a CDN in front of Azure would otherwise be able to serve an admin's response to
 * a Surveyor who is not permitted to see it — while still letting the user's own browser reuse it.
 */
export const GIS_PRIVATE_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
} as const

/**
 * For per-ticket Mongo data behind a map interaction — currently `/api/tickets/by-parcel/[id]`,
 * which the map calls on every parcel click to decide whether that parcel already has a ticket and
 * to fill the popup. Ticket data is mutable and not public, so this is deliberately `private` and
 * short: long enough that clicking back and forth between two parcels, or reopening the same popup,
 * costs nothing, short enough that a status change shows up promptly.
 */
export const TICKET_POPUP_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=30',
} as const

/**
 * For the typed search endpoints (`/api/search`, `/api/evacuation/search`). Both are hit once per
 * debounced keystroke and each miss is a fan-out of parallel queries, so a short window makes
 * backspacing to an already-typed prefix free. `private` because both are session-scoped: the
 * ticket half of `/api/search` is filtered to the caller's own tickets for a Surveyor, and the
 * people half is omitted entirely without `account:read`.
 */
export const SEARCH_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=30',
} as const
