'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, ChevronUp, MapPinned, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatSectorName, formatZoneName } from '@/lib/sectorLabel'
import type { SectorMapData, SectorShape } from '@/server/services/sector-map.service'
import type { CategoryBreakdownEntry, CategorySectorOption } from './CategoryBreakdown'

// ── Binning ────────────────────────────────────────────────────────────────────────────────────

/** Ascending upper bounds of up to five classes over the positive values. Ticket counts per sector
 *  are heavily skewed (a handful of sectors hold most of them), so the classes are spaced
 *  geometrically — each upper bound roughly 3x the last — instead of by equal width or equal
 *  membership. Equal-width classes leave nearly every sector in the palest step; quantile classes
 *  lump the busiest half-dozen sectors together even when one has ten times another's tickets. */
function makeBins(values: number[]): number[] {
  const top = Math.max(0, ...values)
  if (top <= 0) return []
  if (top <= 5) return Array.from({ length: top }, (_, i) => i + 1)
  const bins: number[] = []
  for (let k = 1; k < 5; k++) {
    const t = Math.ceil(Math.pow(top, k / 5))
    if (t > (bins[bins.length - 1] ?? 0) && t < top) bins.push(t)
  }
  bins.push(top)
  return bins
}

/** Which of the five ramp steps (1–5) class `i` of `m` classes wears, spread so a sparse
 *  classification still spans pale -> deep instead of bunching at the pale end. */
function rampStep(i: number, m: number): number {
  return m <= 1 ? 4 : Math.round(1 + (i * 4) / (m - 1))
}

function fillFor(open: number, bins: number[]): string {
  if (open <= 0 || bins.length === 0) return 'var(--dash-ramp-0)'
  const i = bins.findIndex((b) => open <= b)
  return `var(--dash-ramp-${rampStep(i === -1 ? bins.length - 1 : i, bins.length)})`
}

// ── Row model ──────────────────────────────────────────────────────────────────────────────────

type SectorStat = {
  sectorNo: number
  name: string
  zone: string | null
  total: number
  done: number
  open: number
}

type IssueStat = { name: string; color: string; total: number; done: number; open: number }

const byOpenDesc = <T extends { open: number; total: number }>(a: T, b: T) =>
  b.open - a.open || b.total - a.total

const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0)

/** Sectors this small (in map units) can't be seen, labelled or clicked as polygons, so they also
 *  get a point marker. */
const isTiny = (s: SectorShape) => s.w < 16 || s.h < 16
const canLabel = (s: SectorShape) => s.w >= 40 && s.h >= 26

const COLLAPSED_ROWS = 6

// ── Component ──────────────────────────────────────────────────────────────────────────────────

export function SectorMapOverview({
  map,
  sectors,
  categories,
  mine,
}: {
  /** null when the sector outlines couldn't be loaded — the lists still work on their own. */
  map: SectorMapData | null
  sectors: CategorySectorOption[]
  categories: CategoryBreakdownEntry[]
  /** Surveyor scope — the numbers are only that person's tickets, and the copy says so. */
  mine?: boolean
}) {
  const [tab, setTab] = useState<'sectors' | 'issues'>('sectors')
  const [sector, setSector] = useState<number | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)

  /** Opening just grows the list in place (the page scrolls, the map stays put beside it). Closing
   *  would otherwise strand the reader far below the now-shorter section, so once the shorter list
   *  has rendered the effect below scrolls back up to the section's top. */
  const scrollBack = useRef(false)
  const toggleExpanded = () => {
    scrollBack.current = expanded
    setExpanded(!expanded)
  }
  useEffect(() => {
    if (expanded || !scrollBack.current) return
    scrollBack.current = false
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [expanded])

  const optByNo = useMemo(() => new Map(sectors.map((s) => [s.sectorNo, s])), [sectors])
  const shapeByNo = useMemo(() => new Map((map?.sectors ?? []).map((s) => [s.sectorNo, s])), [map])

  /** Every sector (all 32 when the map is present) with its counts under the current issue filter. */
  const stats = useMemo<SectorStat[]>(() => {
    const nos = new Set<number>([...shapeByNo.keys(), ...optByNo.keys()])
    return [...nos]
      .sort((a, b) => a - b)
      .map((no) => {
        const opt = optByNo.get(no)
        const shape = shapeByNo.get(no)
        let total = 0
        let done = 0
        if (opt) {
          if (issue) {
            const c = opt.counts[issue]
            total = c?.[0] ?? 0
            done = c?.[1] ?? 0
          } else {
            for (const [t, d] of Object.values(opt.counts)) {
              total += t
              done += d
            }
          }
        }
        return {
          sectorNo: no,
          name: formatSectorName(opt?.name ?? shape?.name, no),
          zone: formatZoneName(shape?.zone),
          total,
          done,
          open: total - done,
        }
      })
  }, [shapeByNo, optByNo, issue])

  const statByNo = useMemo(() => new Map(stats.map((s) => [s.sectorNo, s])), [stats])
  const rankedSectors = useMemo(() => stats.filter((s) => s.total > 0).sort(byOpenDesc), [stats])

  /** Issues under the current sector filter (all sectors when none is picked). */
  const issues = useMemo<IssueStat[]>(() => {
    const opt = sector != null ? optByNo.get(sector) : null
    return categories
      .map((c) => {
        const total = sector != null ? (opt?.counts[c.name]?.[0] ?? 0) : c.total
        const done = sector != null ? (opt?.counts[c.name]?.[1] ?? 0) : c.completed
        return { name: c.name, color: c.color, total, done, open: total - done }
      })
      .filter((c) => c.total > 0)
      .sort(byOpenDesc)
  }, [categories, optByNo, sector])

  const bins = useMemo(() => makeBins(stats.map((s) => s.open)), [stats])

  const rows = tab === 'sectors' ? rankedSectors : issues
  const maxOpen = Math.max(1, ...rows.map((r) => r.open))
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)

  const pickSector = (no: number) => {
    if (sector === no) {
      setSector(null)
      return
    }
    setSector(no)
    setTab('issues') // the natural next question: what is going on there?
    setExpanded(false)
  }
  const pickIssue = (name: string) => {
    if (issue === name) {
      setIssue(null)
      return
    }
    setIssue(name)
    setTab('sectors') // ...and: where is it?
    setExpanded(false)
  }

  const sectorLabel = sector != null ? (statByNo.get(sector)?.name ?? `Sector ${sector}`) : null

  const viewHref = (() => {
    const p = new URLSearchParams({ status: 'unresolved' })
    if (sector != null) p.set('sector', String(sector))
    if (issue) p.set('class', issue)
    return `/tickets?${p.toString()}`
  })()

  const heading =
    tab === 'sectors'
      ? issue
        ? `Sectors with the most open "${issue}" tickets`
        : 'Sectors with the most open tickets'
      : sectorLabel
        ? `Issues with the most open tickets in ${sectorLabel}`
        : 'Issues with the most open tickets'

  const hovered = hover != null ? statByNo.get(hover) : null
  const hoveredShape = hover != null ? shapeByNo.get(hover) : null
  const selectedShape = sector != null ? shapeByNo.get(sector) : null

  return (
    <section
      ref={sectionRef}
      aria-labelledby="sector-overview-title"
      className="@container scroll-mt-24 rounded-2xl border border-[var(--dash-card-border)] bg-[var(--dash-card)]"
    >
      <div className="flex items-start gap-3.5 px-6 pt-6">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{
            color: 'var(--dash-open)',
            backgroundColor: 'color-mix(in srgb, var(--dash-open) 16%, transparent)',
          }}
          aria-hidden
        >
          <MapPinned className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 id="sector-overview-title" className="text-xl font-semibold text-foreground">
            Where the open tickets are
          </h2>
          <p className="mt-1 text-base leading-snug text-muted-strong">
            {mine ? 'Your open tickets, by area. ' : ''}
            Darker sectors have more open tickets. Click a sector or a row to look closer.
          </p>
        </div>
      </div>

      <div
        className={cn(
          'grid gap-7 p-6',
          map && '@min-[640px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @min-[640px]:items-start',
        )}
      >
        {/* ── Map ─────────────────────────────────────────────────────────────────────────── */}
        {map && (
          // Stays in view beside a long (expanded) list; only where the window is tall enough to hold it.
          <div className="min-w-0 @min-[640px]:[@media(min-height:720px)]:sticky @min-[640px]:[@media(min-height:720px)]:top-24">
            <div className="relative overflow-hidden rounded-xl border border-[var(--dash-card-border)]">
              <svg
                viewBox={`0 0 ${map.width} ${map.height}`}
                className="block h-auto w-full"
                style={{ backgroundColor: 'var(--dash-map-land)' }}
                role="group"
                aria-label="Map of the sectors, shaded by how many tickets are still open. The list beside it gives the same numbers."
              >
                {/* Clicking bare ground clears the selection. */}
                <rect
                  width={map.width}
                  height={map.height}
                  fill="transparent"
                  onClick={() => setSector(null)}
                />
                <path
                  d={map.river}
                  fill="var(--dash-map-water)"
                  fillRule="evenodd"
                  pointerEvents="none"
                />

                {map.sectors.map((s, i) => {
                  const st = statByNo.get(s.sectorNo)
                  return (
                    <path
                      key={s.sectorNo}
                      style={{ ['--i' as string]: i }}
                      d={s.d}
                      fillRule="evenodd"
                      fill={fillFor(st?.open ?? 0, bins)}
                      stroke="var(--dash-map-stroke)"
                      strokeWidth={1}
                      strokeLinejoin="round"
                      className="dash-sector cursor-pointer transition-[fill] duration-200 motion-reduce:transition-none"
                      onPointerEnter={() => setHover(s.sectorNo)}
                      onPointerLeave={() => setHover((h) => (h === s.sectorNo ? null : h))}
                      onClick={() => pickSector(s.sectorNo)}
                    />
                  )
                })}

                {/* Sector numbers on the sectors big enough to carry one. Halo-stroked so the digit
                    stays readable over every step of the ramp. */}
                {map.sectors.filter(canLabel).map((s) => (
                  <text
                    key={s.sectorNo}
                    x={s.cx}
                    y={s.cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      fill: 'var(--foreground)',
                      stroke: 'var(--dash-map-halo)',
                      strokeWidth: 4,
                      paintOrder: 'stroke',
                    }}
                  >
                    {s.sectorNo}
                  </text>
                ))}

                {/* Point markers for sectors too small to see or hit as polygons. Larger hit
                    circle than the dot, per the usual "target > mark" rule. */}
                {[...map.sectors]
                  .filter(isTiny)
                  .sort((a, b) => b.w * b.h - a.w * a.h)
                  .map((s) => {
                    const st = statByNo.get(s.sectorNo)
                    return (
                      <g
                        key={s.sectorNo}
                        className="cursor-pointer"
                        onPointerEnter={() => setHover(s.sectorNo)}
                        onPointerLeave={() => setHover((h) => (h === s.sectorNo ? null : h))}
                        onClick={() => pickSector(s.sectorNo)}
                      >
                        <circle cx={s.cx} cy={s.cy} r={12} fill="transparent" />
                        <circle
                          cx={s.cx}
                          cy={s.cy}
                          r={7.5}
                          fill={fillFor(st?.open ?? 0, bins)}
                          stroke="var(--dash-map-stroke)"
                          strokeWidth={1.5}
                          className="transition-[fill] duration-200 motion-reduce:transition-none"
                        />
                      </g>
                    )
                  })}

                {/* Hover + selection outlines, drawn last so they sit above neighbours. */}
                {hoveredShape && <SectorOutline shape={hoveredShape} />}
                {selectedShape && <SectorOutline shape={selectedShape} strong />}
              </svg>

              {/* Hover card, anchored on the sector so it reads as "about that spot". Driven by the
                  list rows too, so pointing at a row shows where it is. */}
              {hovered && hoveredShape && (
                <div
                  role="status"
                  className="pointer-events-none absolute z-10 w-56 rounded-xl border border-[var(--dash-card-border)] bg-[var(--dash-card)] p-3.5 shadow-lg"
                  style={{
                    left: `${Math.min(80, Math.max(20, (hoveredShape.cx / map.width) * 100))}%`,
                    top: `${(hoveredShape.cy / map.height) * 100}%`,
                    transform:
                      hoveredShape.cy / map.height > 0.42
                        ? 'translate(-50%, calc(-100% - 16px))'
                        : 'translate(-50%, 16px)',
                  }}
                >
                  <p className="text-base font-semibold leading-tight text-foreground">
                    {hovered.name}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-strong">
                    Sector {hovered.sectorNo}
                    {hovered.zone ? ` · ${hovered.zone}` : ''}
                  </p>
                  {hovered.total > 0 ? (
                    <p className="mt-2 text-[15px] leading-snug text-foreground">
                      <span className="font-semibold">{hovered.open.toLocaleString()} open</span>
                      <span className="text-muted-strong">
                        {' '}
                        · {pct(hovered.done, hovered.total)}% of {hovered.total.toLocaleString()}{' '}
                        resolved
                      </span>
                    </p>
                  ) : (
                    <p className="mt-2 text-[15px] text-muted-strong">
                      {issue ? `No "${issue}" tickets here` : 'No tickets here'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Legend — ranges, not just colours, so the shades have a meaning you can read. */}
            <div className="mt-3.5">
              <p className="text-[15px] font-medium text-foreground">
                Open tickets per sector{issue ? ` — ${issue}` : ''}
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                <LegendSwatch color="var(--dash-ramp-0)" label="None" />
                {bins.map((hi, i) => (
                  <LegendSwatch
                    key={hi}
                    color={`var(--dash-ramp-${rampStep(i, bins.length)})`}
                    label={(() => {
                      const lo = i === 0 ? 1 : bins[i - 1] + 1
                      return lo >= hi ? `${hi}` : `${lo}–${hi}`
                    })()}
                  />
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── Ranked list ─────────────────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col">
          <div
            role="group"
            aria-label="Group the list by"
            className="grid grid-cols-2 gap-1 rounded-xl p-1"
            style={{ backgroundColor: 'var(--dash-track)' }}
          >
            {(
              [
                ['sectors', 'By sector'],
                ['issues', 'By issue'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => {
                  setTab(key)
                  setExpanded(false)
                }}
                className={cn(
                  'h-11 rounded-lg text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  tab === key
                    ? 'bg-[var(--dash-card)] text-foreground shadow-sm'
                    : 'text-muted-strong hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {(sector != null || issue) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {sector != null && (
                <FilterChip
                  label={`Sector: ${sectorLabel}`}
                  onClear={() => setSector(null)}
                  clearLabel={`Clear sector ${sectorLabel}`}
                />
              )}
              {issue && (
                <FilterChip
                  label={`Issue: ${issue}`}
                  onClear={() => setIssue(null)}
                  clearLabel={`Clear issue ${issue}`}
                />
              )}
              <Link
                href={viewHref}
                className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-[15px] font-semibold transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                style={{ backgroundColor: 'var(--dash-open)', color: 'var(--dash-card)' }}
              >
                View open tickets
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          )}

          <h3 className="mt-4 text-lg font-semibold leading-snug text-foreground">{heading}</h3>

          {rows.length === 0 ? (
            <p className="mt-3 text-base text-muted-strong">No tickets match this selection yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {visibleRows.map((r, i) =>
                'sectorNo' in r ? (
                  <RankRow
                    key={r.sectorNo}
                    index={i}
                    leading={
                      <span
                        className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-1.5 text-sm font-bold tabular-nums"
                        style={{
                          backgroundColor: 'var(--dash-track)',
                          color: 'var(--foreground)',
                        }}
                        aria-hidden
                      >
                        {r.sectorNo}
                      </span>
                    }
                    title={r.name}
                    sub={`${pct(r.done, r.total)}% resolved${r.zone ? ` · ${r.zone}` : ''}`}
                    open={r.open}
                    max={maxOpen}
                    selected={sector === r.sectorNo}
                    onClick={() => pickSector(r.sectorNo)}
                    onHover={(on) => setHover(on ? r.sectorNo : null)}
                    ariaLabel={`${r.name}, sector ${r.sectorNo}: ${r.open} open tickets, ${pct(r.done, r.total)}% resolved`}
                  />
                ) : (
                  <RankRow
                    key={r.name}
                    index={i}
                    leading={
                      <span
                        className="h-3.5 w-3.5 shrink-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                        aria-hidden
                      />
                    }
                    title={r.name}
                    sub={`${pct(r.done, r.total)}% resolved · ${r.total.toLocaleString()} in total`}
                    open={r.open}
                    max={maxOpen}
                    selected={issue === r.name}
                    onClick={() => pickIssue(r.name)}
                    ariaLabel={`${r.name}: ${r.open} open tickets, ${pct(r.done, r.total)}% resolved`}
                  />
                ),
              )}
            </ul>
          )}

          {rows.length > COLLAPSED_ROWS && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={toggleExpanded}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-[var(--dash-card-border)] text-base font-semibold text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {expanded
                ? 'Show fewer'
                : `Show all ${rows.length} ${tab === 'sectors' ? 'sectors' : 'issues'}`}
              {expanded ? (
                <ChevronUp className="h-5 w-5" aria-hidden />
              ) : (
                <ChevronDown className="h-5 w-5" aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────────

/** Foreground-coloured outline around one sector (a ring for point-marker sectors). Never takes
 *  pointer events, so it can't steal the hover from the shape underneath. */
function SectorOutline({ shape, strong }: { shape: SectorShape; strong?: boolean }) {
  if (isTiny(shape)) {
    return (
      <circle
        cx={shape.cx}
        cy={shape.cy}
        r={10}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth={strong ? 3 : 2}
        pointerEvents="none"
      />
    )
  }
  return (
    <path
      d={shape.d}
      fillRule="evenodd"
      fill="none"
      stroke="var(--foreground)"
      strokeWidth={strong ? 3.5 : 2.25}
      strokeLinejoin="round"
      pointerEvents="none"
    />
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="h-5 w-5 shrink-0 rounded-md border border-[var(--dash-map-stroke)]"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="whitespace-nowrap text-[15px] tabular-nums text-foreground">{label}</span>
    </li>
  )
}

function FilterChip({
  label,
  onClear,
  clearLabel,
}: {
  label: string
  onClear: () => void
  clearLabel: string
}) {
  return (
    <span
      className="inline-flex h-10 max-w-full items-center gap-1 rounded-lg border border-[var(--dash-card-border)] pl-3 text-[15px] font-medium text-foreground"
      style={{ backgroundColor: 'var(--dash-track)' }}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-strong transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </span>
  )
}

function RankRow({
  leading,
  title,
  sub,
  open,
  max,
  selected,
  onClick,
  onHover,
  ariaLabel,
  index,
}: {
  leading: React.ReactNode
  title: string
  sub: string
  open: number
  max: number
  selected: boolean
  onClick: () => void
  onHover?: (on: boolean) => void
  ariaLabel: string
  /** Position in the list — staggers the row's entrance and its bar. */
  index: number
}) {
  return (
    <li className="row-rise" style={{ ['--i' as string]: index, ['--rd' as string]: '0.4s' }}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={ariaLabel}
        onClick={onClick}
        onPointerEnter={() => onHover?.(true)}
        onPointerLeave={() => onHover?.(false)}
        onFocus={() => onHover?.(true)}
        onBlur={() => onHover?.(false)}
        className={cn(
          'flex min-h-[3.75rem] w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          selected ? 'border-[var(--dash-open)]' : 'border-transparent hover:bg-surface-hover',
        )}
        style={
          selected
            ? { backgroundColor: 'color-mix(in srgb, var(--dash-open) 10%, transparent)' }
            : undefined
        }
      >
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-base font-semibold text-foreground">{title}</span>
            <span className="shrink-0 text-base font-semibold tabular-nums text-foreground">
              {open.toLocaleString()}
              <span className="ml-1 text-sm font-medium text-muted-strong">open</span>
            </span>
          </div>
          <div
            className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: 'var(--dash-track)' }}
            aria-hidden
          >
            <div
              className="dash-grow-x h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                ['--i' as string]: index,
                width: `${(open / max) * 100}%`,
                minWidth: open > 0 ? 6 : 0,
                backgroundColor: 'var(--dash-open)',
              }}
            />
          </div>
          <p className="mt-1 truncate text-sm text-muted-strong">{sub}</p>
        </div>
      </button>
    </li>
  )
}
