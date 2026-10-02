'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
export type VolumePoint = { day: string; created: number; resolved: number }

// Same hues as the "New" and "Resolved" status colours (see --dash-status-* in globals.css), so
// "created" and "resolved" read as the same things here as on the status banner and the map.
const CREATED = 'var(--dash-status-new)'
const RESOLVED = 'var(--dash-status-resolved)'

// Axis text is 14px in the strong secondary ink — the previous 12px/--muted pairing was the
// smallest, faintest text on the page, which is exactly what gets skipped by tired eyes.
const TICK = { fill: 'var(--muted-strong)', fontSize: 14 }

export function VolumeChart({ data }: { data: VolumePoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="created" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CREATED} stopOpacity={0.2} />
              <stop offset="100%" stopColor={CREATED} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="resolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RESOLVED} stopOpacity={0.2} />
              <stop offset="100%" stopColor={RESOLVED} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border-strong)" />
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={TICK} dy={10} />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={TICK}
            width={52}
            allowDecimals={false}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <Tooltip
            cursor={{ stroke: 'var(--muted-strong)', strokeWidth: 1 }}
            contentStyle={{
              backgroundColor: 'var(--dash-card)',
              border: '1px solid var(--dash-card-border)',
              borderRadius: 12,
              fontSize: 15,
              padding: '10px 14px',
              boxShadow: '0 8px 24px -6px rgba(0,0,0,0.4)',
            }}
            labelStyle={{ color: 'var(--foreground)', fontWeight: 600, marginBottom: 6 }}
            itemStyle={{ color: 'var(--foreground)', padding: '2px 0' }}
          />
          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke={CREATED}
            strokeWidth={3}
            fill="url(#created)"
            activeDot={{ r: 6, stroke: 'var(--dash-card)', strokeWidth: 2 }}
          />
          <Area
            type="monotone"
            dataKey="resolved"
            name="Resolved"
            stroke={RESOLVED}
            strokeWidth={3}
            fill="url(#resolved)"
            activeDot={{ r: 6, stroke: 'var(--dash-card)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
