import Image from 'next/image'
import { MapPin } from 'lucide-react'

// Static placeholder for now — the map is a pasted reference image (not real data), and the
// stats panel is hardcoded. Once wired up this becomes an interactive map (per-sector
// detection counts, same idea as the DroneSeva sector overlay) and the stats panel gets
// replaced with the real design.
const STATS = [
  { label: 'Busiest sector', value: 'District Golf', detail: '22 objects flagged' },
  { label: 'Most common waste', value: 'Scrap', detail: '31% of all detections' },
  { label: 'Total flagged locations', value: '185', detail: 'across 12 sectors' },
  { label: 'Highest-severity zone', value: 'District Hotel', detail: '31 objects · Tyres' },
]

export function GarbageHeatmap() {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-b-2xl lg:grid-cols-[1fr_280px]">
      <div className="relative aspect-[16/9] border-b border-border bg-[#0a0d12] lg:aspect-auto lg:min-h-[280px] lg:border-b-0 lg:border-r">
        <Image
          src="/dashboard/garbage-heatmap.png"
          alt="Garbage detection heatmap"
          fill
          className="object-cover"
          sizes="(min-width: 1024px) 65vw, 100vw"
          priority={false}
        />

        <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 backdrop-blur-sm">
          <MapPin className="h-3 w-3 text-muted" />
          <span className="text-[11px] font-medium text-muted-strong">Preview — static data</span>
        </div>

        <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 backdrop-blur-sm">
          <span className="text-[10px] text-muted">Low</span>
          <span className="h-1.5 w-16 rounded-full bg-gradient-to-r from-[#3b82f6] via-[#fbbf24] to-[#ef4444]" />
          <span className="text-[10px] text-muted">High</span>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {STATS.map((stat) => (
          <div key={stat.label} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted/70">
              {stat.label}
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted">{stat.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
