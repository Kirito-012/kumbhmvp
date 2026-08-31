export type WorkloadEntry = { name: string; count: number }

export function WorkloadByAssignee({ data }: { data: WorkloadEntry[] }) {
  if (data.length === 0) {
    return <p className="px-0.5 text-sm text-muted">No open tickets are assigned yet.</p>
  }

  const max = Math.max(...data.map((d) => d.count))

  return (
    <div className="space-y-3.5">
      {data.map((d) => (
        <div key={d.name}>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium text-muted-strong">{d.name}</span>
            <span className="text-xs text-muted">
              {d.count} open ticket{d.count === 1 ? '' : 's'}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
