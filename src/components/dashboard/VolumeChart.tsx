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
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="resolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#9aa1ac', fontSize: 12 }}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#9aa1ac', fontSize: 12 }}
            width={48}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }}
            contentStyle={{
              background: '#101216',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              fontSize: 12,
              boxShadow: '0 8px 24px -6px rgba(0,0,0,0.5)',
            }}
            labelStyle={{ color: '#f4f5f7', fontWeight: 600, marginBottom: 4 }}
          />
          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="#34d399"
            strokeWidth={2}
            fill="url(#created)"
          />
          <Area
            type="monotone"
            dataKey="resolved"
            name="Resolved"
            stroke="#818cf8"
            strokeWidth={2}
            fill="url(#resolved)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
