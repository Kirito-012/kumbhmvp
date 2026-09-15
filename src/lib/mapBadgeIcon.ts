// Shared canvas-drawn "pill badge" icon generator, used by MapView.tsx's own POI signage codes
// (bus stops' "BS", ghat points' "G", fire hydrants' "FH" -- see POI_SIGNAGE_CODES in
// classColors.ts) and by Evacuation mode's EN/EXT entry/exit badges (evacLayers.ts). Extracted
// out of MapView.tsx into this leaf module so both can import the same drawing code without one
// depending on the other -- see PLAN-evacuation.md §6.2 item 9.

/** A stable MapLibre image id for one (text, color) pill -- `map.hasImage()`-checked by callers
 *  before `addImage()`, so re-registering the same badge (e.g. across a theme swap that changes
 *  `color`) never throws "image already exists". */
export function badgeIconId(text: string, color: string): string {
  return `map-badge-${text}-${color.replace('#', '')}`
}

// Rendered at 4x and downscaled via addImage's pixelRatio so the small badge stays crisp. Sizing
// mirrors the panel badge: ~14px tall, ~3px corner radius, minimal horizontal padding around the
// text. Width grows with the text, so "FH"/"EN" and the wider "EXT" all get a snugly-fitted pill
// rather than a fixed box that pads a 2-letter code or clips a 3-letter one.
export function makeBadgeIcon(text: string, color: string): ImageData {
  const scale = 4
  const height = 14 * scale
  const paddingX = 4 * scale
  const radius = 3 * scale
  const fontSize = 9 * scale

  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `700 ${fontSize}px "Noto Sans", sans-serif`
  const textWidth = measure.measureText(text).width
  const width = Math.ceil(textWidth + paddingX * 2)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(radius, 0)
  ctx.arcTo(width, 0, width, height, radius)
  ctx.arcTo(width, height, 0, height, radius)
  ctx.arcTo(0, height, 0, 0, radius)
  ctx.arcTo(0, 0, width, 0, radius)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${fontSize}px "Noto Sans", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, height / 2 + 1)

  return ctx.getImageData(0, 0, width, height)
}

/** A stable MapLibre image id for one chevron (fill, stroke) pair -- same `hasImage()`-before-
 *  `addImage()` pattern as badgeIconId. Both colors are keyed since the stroke changes per theme
 *  independently of the fill (see makeChevronIcon's own comment). */
export function chevronIconId(color: string, strokeColor: string): string {
  return `map-chevron-${color.replace('#', '')}-${strokeColor.replace('#', '')}`
}

/** A solid, rounded-tip arrowhead pointing "up" (0 rotation), for `symbol` layers that set
 *  `icon-rotate` per-feature (PLAN-evacuation.md §6.2 items 5/7 -- traffic-route/direction-signage
 *  arrows). Deliberately not a `symbol-placement: 'line'` chevron-along-the-path (the plan's
 *  original sketch): that draws in the line's own vertex order, which checked-against-real-data
 *  has no reliable relationship to Entry/Exit (see the arrows API route's own comment) -- these
 *  render as a single point per feature instead, with `icon-rotate` driven by a bearing computed
 *  from reliable geometry (distance to the nearest sector), never from vertex order.
 *
 *  A plain isoceles triangle, not a chevron/ribbon shape with a notch cut into its trailing edge
 *  -- an earlier version's notch went deep enough (30% of the shape's height) to visually split
 *  the arrowhead into two thin points, reading as an ugly zigzag/"W" once filled and stroked at
 *  the small sizes this renders at (a user screenshot caught this; the notched version had looked
 *  fine only in code review, never actually viewed rendered on the map). `strokeColor` outlines
 *  the triangle in a basemap-contrasting color (reuses `EVAC_COLORS.emergencyExitCasing` -- white
 *  on the light basemap, near-black on the dark one, same "cut a border against whatever's
 *  underneath" idea as emergency exits' own casing line) so a same-hue fill doesn't disappear
 *  against a same-colored route line underneath it. Stroked first and slightly wider than the
 *  fill's own line width so the outline reads as a clean halo around the shape rather than
 *  bisecting it, then the fill on top keeps the interior a solid block of color. */
export function makeChevronIcon(color: string, strokeColor: string): ImageData {
  const scale = 4
  const size = 14 * scale
  const cx = size / 2
  const tipY = size * 0.1
  const baseY = size * 0.88
  const halfWidth = size * 0.32

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(cx, tipY)
  ctx.lineTo(cx + halfWidth, baseY)
  ctx.quadraticCurveTo(cx, baseY + scale * 0.6, cx - halfWidth, baseY)
  ctx.closePath()

  ctx.lineJoin = 'round'
  ctx.lineWidth = scale * 1.6
  ctx.strokeStyle = strokeColor
  ctx.stroke()

  ctx.fillStyle = color
  ctx.fill()

  return ctx.getImageData(0, 0, size, size)
}
