const TILE_SIZE = 256

/**
 * Slippy-map zoom for the tiles below — 16, not the 15 the MapLibre version passed as its `zoom`.
 *
 * Those are not the same number. MapLibre's zoom is defined against its own 512px tile grid
 * (`transform._tileSize = 512`), so for a raster source declaring `tileSize: 256` it resolves the
 * tiles to request as `coveringZoomLevel = floor(zoom + log2(512 / 256)) = zoom + 1`. The old
 * component's `zoom: 15` therefore fetched **z16** tiles. Carrying the 15 across verbatim rendered
 * the thumbnail at half the detail over twice the linear extent (~4.1 m/px instead of ~2.1 m/px at
 * this latitude, ~1325m across the frame instead of ~662m).
 */
const ZOOM = 16

/**
 * Size of the tile mosaic, in tiles either side of the centre tile.
 *
 * The marker sits at the frame's centre, so the mosaic has to reach from there to every edge. The
 * point can fall anywhere inside its own tile, so the *guaranteed* reach in each direction is
 * `radius * TILE_SIZE` — not `(radius + 0.5) * TILE_SIZE`. A mosaic with radius r therefore safely
 * covers a frame up to `2 * r * TILE_SIZE` px in that axis:
 *
 *   x: 2 * 1 * 256 = 512px  >  MAX_FRAME_WIDTH (500)
 *   y: 2 * 1 * 256 = 512px  >  500 * 3/4 = 375px, the tallest the frame gets (xl's 4/3 aspect ratio;
 *                             the min-h-48 / xl:min-h-56 floors only bind at widths well under this)
 *
 * Hence 3 wide x 3 tall = 9 tiles, all of which are fetched. Raising `MAX_FRAME_WIDTH`, or adding a
 * taller aspect ratio to the frame's class list, requires bumping the matching radius here or a
 * blank strip appears along that edge.
 */
const TILE_RADIUS_X = 1
const TILE_RADIUS_Y = 1

/**
 * Upper bound on the rendered frame width, which is what makes the mosaic above sufficient.
 *
 * The frame is `w-full` inside a container that is a fixed 360px sidebar column at `xl` (so ~318px
 * in practice, well under this), but single-column and fluid below it — at a ~1279px viewport it
 * would otherwise stretch to ~1175px, far past what any reasonable tile count can cover. Capping it
 * also stops a "location thumbnail" from rendering as a 1175x661 hero image at those widths, which
 * the previous MapLibre version did. No effect at `xl` or on mobile.
 *
 * 500 rather than the arithmetic maximum of 512: at exactly 512 the mosaic's guaranteed reach and
 * the frame's half-width are equal, so a point landing exactly on a tile boundary would put the
 * mosaic edge flush with the frame edge with no slack for sub-pixel rounding of `left: 50%` against
 * a fractional margin. 6px of margin each side costs nothing and removes the knife-edge.
 */
const MAX_FRAME_WIDTH = 500

/** Raster basemap for the thumbnail. Kept as a single constant so the provider is one edit away:
 *  this is OpenStreetMap's public tile server, the same source the previous MapLibre-based version
 *  used, so the thumbnail renders identically. Note that OSM's tile usage policy discourages using
 *  it directly from a deployed application — worth moving to MapTiler (the key is already in the
 *  client bundle for the main map) or a cached proxy, but that is a provider decision, not a
 *  performance one, so it is deliberately left as-is here. */
const TILE_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`

/** Web Mercator: longitude/latitude to absolute pixel coordinates at `zoom`, origin at the
 *  top-left of the world. This is the standard slippy-map projection — the same one MapLibre used
 *  internally to decide which tiles to fetch. */
function project(lng: number, lat: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom
  const sinLat = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
}

/**
 * Small, non-interactive map thumbnail centred on a single point — used on the ticket detail page
 * to show a map-parcel ticket's location.
 *
 * This used to instantiate a real `maplibre-gl` `Map` with `interactive: false` and a single raster
 * source. That pulled the entire MapLibre GL engine — **935 KB raw / 243 KB gzipped** of JS, plus
 * the `maplibre-gl-worker.mjs` + 476 KB `maplibre-gl-shared.mjs` fetches that `setWorkerUrl()`
 * implies, plus a WebGL context — to draw nine static PNGs and a pin. Every ticket in the database
 * carries a `location`, so that cost was paid on *every* ticket detail page view.
 *
 * Positioning the tiles directly costs no JavaScript at all: the component is now plain markup with
 * no hooks, no `'use client'`, and no client bundle, so it renders on the server and ships zero
 * bytes. (It is therefore imported directly rather than through a `next/dynamic` wrapper — there is
 * nothing left to defer.) It renders the same tiles, from the same provider, at the same ground
 * scale as before — see `ZOOM` for why matching that scale means 16 here and not the 15 MapLibre
 * was configured with.
 */
export function TicketLocationMap({ lng, lat }: { lng: number; lat: number }) {
  const { x, y } = project(lng, lat, ZOOM)
  const centreTileX = Math.floor(x / TILE_SIZE)
  const centreTileY = Math.floor(y / TILE_SIZE)

  const mosaicWidth = (TILE_RADIUS_X * 2 + 1) * TILE_SIZE
  const mosaicHeight = (TILE_RADIUS_Y * 2 + 1) * TILE_SIZE

  // Where the point sits inside the mosaic, measured from the mosaic's top-left corner. Offsetting
  // the mosaic by the negative of this puts the point exactly at the frame's centre.
  const pointX = x - (centreTileX - TILE_RADIUS_X) * TILE_SIZE
  const pointY = y - (centreTileY - TILE_RADIUS_Y) * TILE_SIZE

  const tiles: { key: string; url: string; left: number; top: number }[] = []
  for (let dy = -TILE_RADIUS_Y; dy <= TILE_RADIUS_Y; dy++) {
    for (let dx = -TILE_RADIUS_X; dx <= TILE_RADIUS_X; dx++) {
      const tx = centreTileX + dx
      const ty = centreTileY + dy
      tiles.push({
        key: `${tx}/${ty}`,
        url: TILE_URL(ZOOM, tx, ty),
        left: (dx + TILE_RADIUS_X) * TILE_SIZE,
        top: (dy + TILE_RADIUS_Y) * TILE_SIZE,
      })
    }
  }

  return (
    <div
      role="img"
      aria-label={`Ticket location map at ${lat.toFixed(5)}, ${lng.toFixed(5)}`}
      className="relative aspect-[16/10] min-h-48 w-full overflow-hidden rounded-xl border border-border bg-muted/40 sm:aspect-[16/9] xl:aspect-[4/3] xl:min-h-56"
      style={{ maxWidth: MAX_FRAME_WIDTH }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: mosaicWidth,
          height: mosaicHeight,
          marginLeft: -pointX,
          marginTop: -pointY,
        }}
      >
        {tiles.map((tile) => (
          // Plain <img>, not next/image: these are 256px tiles already served at exactly their
          // display size from a cacheable CDN path, so the optimizer would add a round trip through
          // /_next/image for no gain — and it would need tile.openstreetmap.org added to
          // `images.remotePatterns`.
          //
          // No `loading="lazy"`: the browser defers based on each tile's own layout position, which
          // ignores this frame's `overflow-hidden` clip, so it skipped the tiles actually inside the
          // visible box and fetched ones that were clipped away — the thumbnail rendered blank. The
          // mosaic is sized to the frame (see TILE_RADIUS_*), so every tile here is wanted anyway.
          // eslint-disable-next-line @next/next/no-img-element -- deliberate, see comment above
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            aria-hidden="true"
            decoding="async"
            width={TILE_SIZE}
            height={TILE_SIZE}
            className="absolute"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>

      {/* Marker pin, tip on the point: translate(-50%, -100%) puts the bottom-centre of the glyph at
          the frame centre, which is where the mosaic offset above placed the coordinate. */}
      <svg
        viewBox="0 0 24 24"
        className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-full drop-shadow-md"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 22s7-7.03 7-12A7 7 0 0 0 5 10c0 4.97 7 12 7 12z"
          fill="#2563eb"
          stroke="#ffffff"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="10" r="2.5" fill="#ffffff" />
      </svg>

      {/* ODbL attribution. The MapLibre version declared this on the source and then hid it with
          `attributionControl: false`; tiles from OSM require it to be shown. */}
      <span className="absolute bottom-0 right-0 rounded-tl bg-black/45 px-1.5 py-0.5 text-[9px] leading-tight text-white/90">
        © OpenStreetMap
      </span>
    </div>
  )
}
