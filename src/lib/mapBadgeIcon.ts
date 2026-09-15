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

/** A solid triangle pointing "up" (0 rotation), for `symbol` layers that set `icon-rotate`
 *  per-feature (PLAN-evacuation.md §6.2 items 5/7 -- traffic-route/direction-signage arrows).
 *  Deliberately not a `symbol-placement: 'line'` chevron-along-the-path (the plan's original
 *  sketch): that draws in the line's own vertex order, which checked-against-real-data has no
 *  reliable relationship to Entry/Exit (see the arrows API route's own comment) -- these render
 *  as a single point per feature instead, with `icon-rotate` driven by a bearing computed from
 *  reliable geometry (distance to the nearest sector), never from vertex order.
 *
 *  `strokeColor` outlines the triangle in a basemap-contrasting color (reuses
 *  `EVAC_COLORS.emergencyExitCasing` -- white on the light basemap, near-black on the dark one,
 *  same "cut a border against whatever's underneath" idea as emergency exits' own casing line).
 *  A same-hue fill with no outline all but disappeared against a same-color route line underneath
 *  it at the sizes/zooms this mode actually gets viewed at -- caught only by checking rendered
 *  pixels directly (`queryRenderedFeatures` said the feature was there; a screenshot at normal
 *  zoom couldn't find it) after a user report that signage arrows weren't visible. Canvas size
 *  bumped from 10 to 16 units alongside this so the stroke doesn't eat a big share of a still-tiny
 *  icon at typical `icon-size` values. */
export function makeChevronIcon(color: string, strokeColor: string): ImageData {
  const scale = 4
  const size = 16 * scale

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.moveTo(size / 2, scale)
  ctx.lineTo(size - scale, size - scale)
  ctx.lineTo(size / 2, size * 0.7)
  ctx.lineTo(scale, size - scale)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = scale * 1.25
  ctx.strokeStyle = strokeColor
  ctx.lineJoin = 'round'
  ctx.stroke()

  return ctx.getImageData(0, 0, size, size)
}
