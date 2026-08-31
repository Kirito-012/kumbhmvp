'use client'

import { useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'

type StatusCount = { slug: string; name: string; count: number }
type PriorityOption = { slug: string; name: string }
type SectorOption = { sectorNo: number; name: string | null }

export function TicketsToolbar({
  statusCounts,
  total,
  priorities,
  classGroups,
  sectors,
}: {
  statusCounts: StatusCount[]
  total: number
  priorities: PriorityOption[]
  classGroups: string[]
  sectors: SectorOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  const activeStatus = searchParams.get('status') ?? ''
  const activePriority = searchParams.get('priority') ?? ''
  const activeClass = searchParams.get('class') ?? ''
  const activeSector = searchParams.get('sector') ?? ''
  const activeSort = searchParams.get('sort') ?? 'lastActivityAt'
  const activeDir = searchParams.get('dir') ?? 'desc'

  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete('page') // any filter change resets pagination
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => pushParams({ status: null })}
          className={cn(
            'inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
            activeStatus === ''
              ? 'bg-white/[0.08] text-foreground'
              : 'text-muted hover:bg-white/[0.04] hover:text-muted-strong',
          )}
        >
          All
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[11px]',
              activeStatus === ''
                ? 'bg-accent-soft text-accent-strong'
                : 'bg-white/[0.05] text-muted',
            )}
          >
            {total}
          </span>
        </button>
        {statusCounts.map((s) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => pushParams({ status: s.slug })}
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
              activeStatus === s.slug
                ? 'bg-white/[0.08] text-foreground'
                : 'text-muted hover:bg-white/[0.04] hover:text-muted-strong',
            )}
          >
            {s.name}
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[11px]',
                activeStatus === s.slug
                  ? 'bg-accent-soft text-accent-strong'
                  : 'bg-white/[0.05] text-muted',
              )}
            >
              {s.count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <form
          className="relative min-w-[240px] flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            pushParams({ q: search || null })
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by subject or description…"
            className="h-9 w-full rounded-lg border border-border bg-white/[0.03] pl-9 pr-3 text-sm text-foreground placeholder:text-muted/70 outline-none transition-colors focus:border-accent/40 focus:bg-white/[0.05]"
          />
        </form>

        <div className="w-40">
          <Select
            variant="ghost"
            value={activePriority}
            onChange={(v) => pushParams({ priority: v || null })}
            placeholder="All priorities"
            options={[
              { value: '', label: 'All priorities' },
              ...priorities.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />
        </div>

        {classGroups.length > 0 && (
          <div className="w-56">
            <Select
              variant="field"
              value={activeClass}
              onChange={(v) => pushParams({ class: v || null })}
              placeholder="All classes"
              options={[
                { value: '', label: 'All classes' },
                ...classGroups.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
        )}

        {sectors.length > 0 && (
          <div className="w-64">
            <Select
              variant="field"
              value={activeSector}
              onChange={(v) => pushParams({ sector: v || null })}
              placeholder="All sectors"
              options={[
                { value: '', label: 'All sectors' },
                ...sectors.map((s) => ({
                  value: String(s.sectorNo),
                  label: s.name ? `${s.sectorNo}. ${s.name}` : `Sector ${s.sectorNo}`,
                })),
              ]}
            />
          </div>
        )}

        <div className="w-56">
          <Select
            variant="ghost"
            value={`${activeSort}:${activeDir}`}
            onChange={(v) => {
              const [sort, dir] = v.split(':')
              pushParams({ sort, dir })
            }}
            options={[
              { value: 'lastActivityAt:desc', label: 'Sort: Last updated' },
              { value: 'createdAt:desc', label: 'Sort: Newest' },
              { value: 'createdAt:asc', label: 'Sort: Oldest' },
              { value: 'number:desc', label: 'Sort: Ticket # (high–low)' },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
