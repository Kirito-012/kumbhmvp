'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
export type PriorityBreakdownEntry = { name: string; slug: string; color: string; value: number }

export function PriorityBreakdown({ data: priorityBreakdown }: { data: PriorityBreakdownEntry[] }) {
  const total = priorityBreakdown.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={priorityBreakdown}
              dataKey="value"
              nameKey="name"
              innerRadius={44}
              outerRadius={64}
              paddingAngle={3}
              stroke="none"
            >
              {priorityBreakdown.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: '#101216',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold text-foreground">{total}</span>
          <span className="text-[10px] text-muted">open</span>
        </div>
      </div>

      <div className="flex-1 space-y-2.5">
        {priorityBreakdown.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span className="text-muted-strong">{entry.name}</span>
            </div>
            <span className="font-medium text-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
