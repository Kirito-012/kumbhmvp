'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SectorTrendDay } from '@/lib/insights/types'

// recharts lives only in this module, which SectorOverview loads with next/dynamic (ssr: false) so
// ~100 KB of chart code never rides along with the map's initial bundle. Styling mirrors the
// dashboard's VolumeChart, on the map's --map-* tokens. Fills its (relatively positioned) parent.

const tooltipStyle = {
  backgroundColor: 'var(--map-popup-bg)',
  border: '1px solid var(--map-popup-border)',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 8px 24px -6px rgba(0,0,0,0.35)',
}
const tooltipLabelStyle = { color: 'var(--map-popup-heading)', fontWeight: 600, marginBottom: 4 }
const tick = { fill: 'var(--map-fg-muted)', fontSize: 12 }

// Two lines and nothing else: seven whole-number counts read exactly as that with straight
// segments (a smoothed curve would imply values between the days), and no area fill means neither
// series looks like the "main" one. No per-day dots either -- recharts paints them at their final
// spots while the line is still drawing in. The plot-area insets (margin top/right 8, y-axis 28
// wide, x-axis band 30 tall) are mirrored by ChartPlaceholder in SectorOverview. Short and
// ease-out so the lines are drawn by the time the rest of the view has settled.
const DRAW_MS = 700

export function TicketVolumeChart({
  data,
  createdColor,
  resolvedColor,
  animate,
  begin = 0,
}: {
  data: SectorTrendDay[]
  createdColor: string
  resolvedColor: string
  /** Draw the lines in. Off when the user is just returning to the view. */
  animate: boolean
  /** Delay (ms) before drawing, so it starts as its card becomes visible. */
  begin?: number
}) {
  const last = data.length - 1
  const active = animate ? ('auto' as const) : false
  return (
    <div className="absolute inset-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--map-border)" />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={tick}
            dy={6}
            // The window always ends today (insights.service builds it from startOfToday).
            tickFormatter={(v: string, i: number) => (i === last ? 'Today' : v)}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={tick}
            width={28}
            allowDecimals={false}
            tickCount={4}
            domain={[0, (max: number) => Math.max(4, Math.ceil(max * 1.15))]}
          />
          <Tooltip
            cursor={{ stroke: 'var(--map-border)', strokeWidth: 1 }}
            contentStyle={tooltipStyle}
            labelStyle={tooltipLabelStyle}
          />
          <Line
            type="linear"
            dataKey="created"
            name="Created"
            stroke={createdColor}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={active}
            animationBegin={begin}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
          />
          <Line
            type="linear"
            dataKey="resolved"
            name="Resolved"
            stroke={resolvedColor}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={active}
            animationBegin={begin + 90}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
