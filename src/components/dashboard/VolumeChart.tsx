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

export function VolumeChart({ data }: { data: VolumePoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="created" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-strong)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="resolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--violet)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--violet)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 12 }}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 12 }}
            width={48}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 10,
              fontSize: 12,
              boxShadow: '0 8px 24px -6px rgba(0,0,0,0.5)',
            }}
            labelStyle={{ color: 'var(--foreground)', fontWeight: 600, marginBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="var(--accent-strong)"
            strokeWidth={2}
            fill="url(#created)"
          />
          <Area
            type="monotone"
            dataKey="resolved"
            name="Resolved"
            stroke="var(--violet)"
            strokeWidth={2}
            fill="url(#resolved)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
