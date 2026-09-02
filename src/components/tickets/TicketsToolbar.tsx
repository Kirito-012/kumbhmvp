'use client'

import { useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, SlidersHorizontal, ChevronDown, X } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { statusSolidStyles } from '@/components/ui/Badge'
import { CLASS_GROUP_COLORS } from '@/lib/classColors'
import { cn } from '@/lib/utils'
import type { Status } from '@/lib/mock-data'

type StatusCount = { slug: string; name: string; count: number }
type PriorityOption = { slug: string; name: string; color: string }
type SectorOption = { sectorNo: number; name: string | null }
type AssigneeOption = { id: string; name: string }

export function TicketsToolbar({
  statusCounts,
  total,
  priorities,
  classGroups,
  sectors,
  assignees,
}: {
  statusCounts: StatusCount[]
  total: number
  priorities: PriorityOption[]
  classGroups: string[]
  sectors: SectorOption[]
  /** Only non-empty for Admin/Manager (see canAssign in tickets/page.tsx) -- a Surveyor is always
   *  forced to their own tickets server-side, so filtering *other* people's tickets isn't a
   *  choice they have regardless of what this list contains. */
  assignees: AssigneeOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  const activeStatus = searchParams.get('status') ?? ''
  const activePriority = searchParams.get('priority') ?? ''
  const activeClass = searchParams.get('class') ?? ''
  const activeSector = searchParams.get('sector') ?? ''
  const activeAssignee = searchParams.get('assignee') ?? ''
  const activeSort = searchParams.get('sort') ?? 'lastActivityAt'
  const activeDir = searchParams.get('dir') ?? 'desc'

  // Starts open if a hidden-by-default filter is already applied (e.g. a shared/deep link, or a
  // "People" global-search result landing here with ?assignee=<id>), so it's never silently
  // hidden behind a collapsed panel.
  const [advancedOpen, setAdvancedOpen] = useState(
    () => activePriority !== '' || activeAssignee !== '',
  )

  const hasActiveFilters = Boolean(
    activeStatus ||
    activePriority ||
    activeClass ||
    activeSector ||
    activeAssignee ||
    searchParams.get('q'),
  )

  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete('page') // any filter change resets pagination
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  function clearAll() {
    setSearch('')
    startTransition(() => router.push(pathname))
  }

  return (
    <div className="relative">
      {/* Filter/sort changes are full server navigations (router.push), which can take a beat
          on a slow connection -- without this the toolbar just sits inert with no feedback that
          anything happened. A thin top-edge bar (not a full overlay) keeps the existing filters
          visible and interactive while the new result set loads. */}
      <div
        className={cn(
          'pointer-events-none absolute -top-1 left-0 h-0.5 w-full overflow-hidden rounded-full bg-transparent transition-opacity duration-150',
          isPending ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden
      >
        <div className="h-full w-1/3 animate-[loading-sweep_1.1s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => pushParams({ status: null })}
          className={cn(
            'inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
            activeStatus === ''
              ? 'bg-overlay-strong text-foreground'
              : 'text-muted hover:bg-overlay hover:text-muted-strong',
          )}
        >
          All
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[11px]',
              activeStatus === ''
                ? 'bg-accent-soft text-accent-strong'
                : 'bg-overlay-strong text-muted',
            )}
          >
            {total}
          </span>
        </button>
        {statusCounts.map((s) => {
          const isActive = activeStatus === s.slug
          const solid = statusSolidStyles[s.slug as Status] as string | undefined
          return (
            <button
              key={s.slug}
              type="button"
              onClick={() => pushParams({ status: s.slug })}
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
                isActive
                  ? (solid ?? 'bg-overlay-strong text-foreground')
                  : 'text-muted hover:bg-overlay hover:text-muted-strong',
              )}
            >
              {s.name}
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[11px]',
                  isActive ? 'bg-black/15 text-white' : 'bg-overlay-strong text-muted',
                  isActive && s.slug === 'closed' && 'bg-overlay text-foreground',
                )}
              >
                {s.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
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
            className="h-9 w-full rounded-lg border border-border bg-overlay pl-9 pr-3 text-sm text-foreground placeholder:text-muted/70 outline-none transition-colors focus:border-accent/40 focus:bg-overlay-strong"
          />
        </form>

        {classGroups.length > 0 && (
          <div className="w-56">
            <SearchableSelect
              value={activeClass}
              onChange={(v) => pushParams({ class: v || null })}
              placeholder="All classes"
              emptyLabel="All classes"
              options={classGroups.map((c) => ({
                value: c,
                label: c,
                color: CLASS_GROUP_COLORS[c],
              }))}
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

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className={cn(
            'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors',
            advancedOpen || activePriority || activeAssignee
              ? 'border-accent/40 bg-accent-soft text-accent-strong'
              : 'border-border-strong bg-overlay text-muted-strong hover:bg-overlay-strong hover:text-foreground',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
          Advanced filters
          {(activePriority || activeAssignee) && (
            <span className="h-1.5 w-1.5 rounded-full bg-accent-strong" aria-hidden />
          )}
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')}
          />
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors hover:bg-overlay hover:text-danger"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            Clear all
          </button>
        )}
      </div>

      {/* Grid-rows 0fr->1fr (not height/max-height) animates smoothly without the content
          reflow/jank those cause, and lets the hidden fields skip tab order via inert. Margin
          animates alongside so collapsed state leaves zero gap under the main row instead of a
          dead space-y gap sitting above an invisible 0fr track. */}
      <div
        className="grid transition-[grid-template-rows,margin-top] duration-200 ease-out"
        style={{ gridTemplateRows: advancedOpen ? '1fr' : '0fr', marginTop: advancedOpen ? 14 : 0 }}
      >
        <div className="flex flex-wrap items-center gap-2.5 overflow-hidden" inert={!advancedOpen}>
          <Select
            variant="pill"
            value={activePriority}
            onChange={(v) => pushParams({ priority: v || null })}
            placeholder="All priorities"
            options={[
              { value: '', label: 'All priorities' },
              ...priorities.map((p) => ({ value: p.slug, label: p.name, color: p.color })),
            ]}
          />

          {assignees.length > 0 && (
            <div className="w-56">
              <SearchableSelect
                value={activeAssignee}
                onChange={(v) => pushParams({ assignee: v || null })}
                placeholder="All assignees"
                emptyLabel="All assignees"
                options={assignees.map((a) => ({ value: a.id, label: a.name }))}
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
    </div>
  )
}
