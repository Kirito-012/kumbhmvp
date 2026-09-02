'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export type WorkloadEntry = { id: string; name: string; count: number }

const STAGGER_MS = 60
const RISE_MS = 700

export function WorkloadByAssignee({ data }: { data: WorkloadEntry[] }) {
  const router = useRouter()
  const [active, setActive] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const goToAssignee = (entry: WorkloadEntry) => {
    router.push(`/tickets?assignee=${encodeURIComponent(entry.id)}`)
  }

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        setActive(true)
        observer.disconnect()
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (data.length === 0) {
    return <p className="px-0.5 text-sm text-muted">No open tickets are assigned yet.</p>
  }

  const max = Math.max(1, ...data.map((d) => d.count))

  return (
    <div ref={rootRef} className="space-y-3.5">
      {data.map((d, i) => (
        <div
          key={d.id}
          role="link"
          tabIndex={0}
          aria-label={`View ${d.name}'s open tickets — ${d.count}`}
          onClick={() => goToAssignee(d)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              goToAssignee(d)
            }
          }}
          className="cursor-pointer rounded-md opacity-0 outline-none animate-fade-in focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          style={{ animationDelay: `${i * STAGGER_MS}ms`, animationFillMode: 'both' }}
        >
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium text-muted-strong">{d.name}</span>
            <span className="text-xs text-muted">
              {d.count} open ticket{d.count === 1 ? '' : 's'}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-overlay-strong">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-strong"
              style={{
                width: active ? `${(d.count / max) * 100}%` : '0%',
                transition: `width ${RISE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) ${i * STAGGER_MS}ms`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
