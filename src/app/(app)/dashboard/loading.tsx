import { Topbar } from '@/components/layout/Topbar'
import { DashCard } from '@/components/dashboard/DashCard'
import { Skeleton } from '@/components/ui/Skeleton'

export default function DashboardLoading() {
  return (
    <>
      <Topbar
        title="Dashboard"
        description="Here's what's happening across your workspace today"
        primaryAction={{ label: 'New ticket', href: '/tickets/new' }}
      />

      <main className="flex-1 space-y-6 px-4 py-5 sm:px-8 sm:py-7">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
          <div className="min-w-0 space-y-6">
            {/* Work heads: a grid of head tiles */}
            <DashCard className="p-6 sm:p-8">
              <div className="flex items-start gap-3.5">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div>
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="mt-2.5 h-4 w-72 max-w-full" />
                </div>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-[var(--dash-card-border)] p-4">
                    <div className="flex items-start gap-3">
                      <Skeleton className="h-11 w-11 rounded-xl" />
                      <Skeleton className="h-10 flex-1" />
                    </div>
                    <Skeleton className="mt-4 h-8 w-24" />
                    <Skeleton className="mt-3 h-3 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </DashCard>

            {/* Sector map + ranked list */}
            <DashCard>
              <div className="flex items-start gap-3.5 px-6 pt-6">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div>
                  <Skeleton className="h-5 w-56" />
                  <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
                </div>
              </div>
              <div className="grid gap-7 p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <Skeleton className="aspect-[600/465] w-full rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-[3.25rem] w-full rounded-xl" />
                  <Skeleton className="mt-4 h-5 w-64" />
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-[3.75rem] w-full rounded-xl" />
                  ))}
                </div>
              </div>
            </DashCard>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-1">
            {Array.from({ length: 2 }).map((_, i) => (
              <DashCard key={i} className="p-6">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-xl" />
                  <Skeleton className="h-5 w-28" />
                </div>
                <Skeleton className="mt-4 h-11 w-24" />
                <Skeleton className="mt-4 h-4 w-full rounded-full" />
                <div className="mt-4 space-y-2.5">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-8 w-full" />
                  ))}
                </div>
              </DashCard>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Volume chart */}
          <DashCard className="xl:col-span-2">
            <div className="flex items-start gap-3.5 px-6 pt-6">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2.5 h-4 w-64 max-w-full" />
              </div>
            </div>
            <div className="px-3 pb-4 pt-4">
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          </DashCard>

          {/* Priority breakdown */}
          <DashCard>
            <div className="flex items-start gap-3.5 px-6 pt-6">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-2.5 h-4 w-48" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4 px-5 pb-6 pt-5">
              <Skeleton className="h-40 w-40 shrink-0 rounded-full" />
              <div className="min-w-[11rem] flex-1 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            </div>
          </DashCard>
        </div>

        {/* Category breakdown */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/60 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-6 w-14" />
          </div>
          <div className="px-5 pb-5 pt-6">
            <div className="flex min-w-[680px] items-end gap-2.5">
              {Array.from({ length: 11 }).map((_, i) => (
                <div
                  key={i}
                  className="flex min-w-[52px] flex-col"
                  style={{ flexGrow: 1, flexBasis: 0 }}
                >
                  <Skeleton className="h-52 w-full rounded-xl" />
                  <Skeleton className="mx-auto mt-2 h-3 w-4/5" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Recent activity */}
          <DashCard className="xl:col-span-2">
            <div className="flex items-start gap-3.5 px-6 pt-6">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div>
                <Skeleton className="h-5 w-36" />
                <Skeleton className="mt-2.5 h-4 w-24" />
              </div>
            </div>
            <div className="mt-3 divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-6 py-3.5">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-12 shrink-0" />
                </div>
              ))}
            </div>
          </DashCard>

          {/* Workload by assignee */}
          <DashCard>
            <div className="flex items-start gap-3.5 px-6 pt-6">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <div>
                <Skeleton className="h-5 w-44" />
                <Skeleton className="mt-2.5 h-4 w-32" />
              </div>
            </div>
            <div className="space-y-4 px-6 pb-6 pt-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="mb-2 flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
          </DashCard>
        </div>
      </main>
    </>
  )
}
