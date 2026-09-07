import type { Feature, FeatureCollection, Point } from 'geojson'

// MapLibre's built-in geojson-source clustering (supercluster) has no "max
// points per cluster" option -- it only groups points within a fixed
// screen-pixel radius per zoom level, so a genuinely dense pocket of points
// (e.g. 157 dustbins along one riverside stretch) still produces one giant
// cluster no matter how tight the radius is tuned. This module replaces it
// with grid-based clustering that recursively subdivides any cell whose
// point count would exceed MAX_CLUSTER_SIZE, guaranteeing every cluster this
// produces is capped -- at the cost of recomputing clusters ourselves
// (in MapView's zoom-driven effect) instead of relying on MapLibre's
// optimized native path.
export const MAX_CLUSTER_SIZE = 20

// Zoom level above which clustering stops entirely and every point renders
// individually, regardless of how close together they are on screen --
// without this, two points within cellPx of each other at ANY zoom (even
// zoomed in past individual sector parcels) would still cluster forever,
// since projecting into zoom-scaled world-pixel space alone never puts a
// hard ceiling on zoom the way supercluster's clusterMaxZoom option does.
// 15 is roughly "individual sector parcels clearly outlined, still able to
// make out streets" -- the zoom level a user zooming in that far clearly
// means "show me every point", not "keep grouping them".
export const CLUSTER_MAX_ZOOM = 15

// Standard Web Mercator world-pixel projection (256px tiles) -- clustering
// happens in this fixed pixel space at a given zoom, matching how
// supercluster itself works internally, rather than needing a live
// map.project() call (which would require recomputing on every pan, not
// just zoom).
function lngLatToWorldPixel(lng: number, lat: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom
  const x = ((lng + 180) / 360) * scale
  const sinLat = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  return [x, y]
}

type ClusterableFeature = Feature<Point>

/**
 * Buckets `features` into a uniform pixel grid at `zoom` (cell size ~=
 * `cellPx`), then recursively quarters any cell holding more than
 * `MAX_CLUSTER_SIZE` points until every resulting cell is under the cap.
 * A cell with exactly one point is emitted as that original point feature,
 * unchanged (so its popup/properties still work normally); 2+ points become
 * one synthetic cluster feature carrying `cluster: true`, `point_count`, and
 * a stable `cluster_id` (a hash of the cell's bounds) for click-to-zoom.
 */
export function clusterPoints(
  features: ClusterableFeature[],
  zoom: number,
  cellPx = 40,
): FeatureCollection<Point> {
  if (zoom >= CLUSTER_MAX_ZOOM) {
    return { type: 'FeatureCollection', features }
  }

  const projected = features.map((f) => ({
    feature: f,
    px: lngLatToWorldPixel(f.geometry.coordinates[0], f.geometry.coordinates[1], zoom),
  }))

  const out: Feature<Point>[] = []

  function bucketAndEmit(
    pts: typeof projected,
    x0: number,
    y0: number,
    size: number,
    depth: number,
  ) {
    if (pts.length === 0) return
    if (pts.length === 1) {
      out.push(pts[0].feature)
      return
    }
    // Depth guard: below ~2.5px cells (points essentially coincident),
    // stop subdividing and just emit an over-cap cluster rather than
    // recursing forever on identical/near-identical coordinates.
    if (pts.length <= MAX_CLUSTER_SIZE || size < 2.5 || depth > 24) {
      const sumX = pts.reduce((s, p) => s + p.px[0], 0)
      const sumY = pts.reduce((s, p) => s + p.px[1], 0)
      const cx = sumX / pts.length
      const cy = sumY / pts.length
      const [lng, lat] = worldPixelToLngLat(cx, cy, zoom)
      out.push({
        type: 'Feature',
        properties: {
          cluster: true,
          cluster_id: `${zoom}:${x0.toFixed(1)}:${y0.toFixed(1)}:${depth}`,
          point_count: pts.length,
          point_count_abbreviated: String(pts.length),
        },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      })
      return
    }

    // Quarter this cell and recurse -- same idea as a quadtree, but only
    // going deeper where a cell is actually over-cap rather than building a
    // full tree up front.
    const half = size / 2
    const quads: (typeof projected)[] = [[], [], [], []]
    for (const p of pts) {
      const qx = p.px[0] < x0 + half ? 0 : 1
      const qy = p.px[1] < y0 + half ? 0 : 1
      quads[qy * 2 + qx].push(p)
    }
    bucketAndEmit(quads[0], x0, y0, half, depth + 1)
    bucketAndEmit(quads[1], x0 + half, y0, half, depth + 1)
    bucketAndEmit(quads[2], x0, y0 + half, half, depth + 1)
    bucketAndEmit(quads[3], x0 + half, y0 + half, half, depth + 1)
  }

  // Top-level grid pass: bucket into cellPx-sized cells first (cheap,
  // avoids running the recursive quarter-split across the whole world),
  // then only recurse into cells that are actually over-cap.
  const cells = new Map<string, typeof projected>()
  for (const p of projected) {
    const cx = Math.floor(p.px[0] / cellPx)
    const cy = Math.floor(p.px[1] / cellPx)
    const key = `${cx}:${cy}`
    const cell = cells.get(key)
    if (cell) cell.push(p)
    else cells.set(key, [p])
  }
  for (const [key, pts] of cells) {
    const [cx, cy] = key.split(':').map(Number)
    bucketAndEmit(pts, cx * cellPx, cy * cellPx, cellPx, 0)
  }

  return { type: 'FeatureCollection', features: out }
}

function worldPixelToLngLat(x: number, y: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom
  const lng = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return [lng, lat]
}
