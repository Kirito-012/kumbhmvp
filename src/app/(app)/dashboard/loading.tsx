import { Topbar } from '@/components/layout/Topbar'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

export default function DashboardLoading() {
  return (
    <>
      <Topbar
        title="Dashboard"
        description="Here's what's happening across your workspace today"
        primaryAction={{ label: 'New ticket', href: '/tickets/new' }}
      />

      <main className="flex-1 space-y-6 px-8 py-6">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-surface/60 p-5 backdrop-blur-sm"
            >
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Volume chart */}
          <Card className="xl:col-span-2">
            <div className="flex items-start justify-between gap-4 px-5 pt-5">
              <div className="flex items-start gap-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-2 h-3 w-36" />
                </div>
              </div>
            </div>
            <div className="px-3 pb-3 pt-6">
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          </Card>

          {/* Priority breakdown */}
          <Card>
            <div className="flex items-start gap-3 px-5 pt-5">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            </div>
            <div className="flex items-center gap-6 px-5 pb-5 pt-4">
              <Skeleton className="h-36 w-36 shrink-0 rounded-full" />
              <div className="flex-1 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-8" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Category breakdown */}
        <div className="rounded-2xl border border-border bg-surface/60 backdrop-blur-sm">
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
          <Card className="xl:col-span-2">
            <div className="flex items-start gap-3 px-5 pt-5">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <div>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-2 h-3 w-20" />
              </div>
            </div>
            <div className="mt-3 divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-3 w-10 shrink-0" />
                </div>
              ))}
            </div>
          </Card>

          {/* Workload by assignee */}
          <Card>
            <div className="flex items-start gap-3 px-5 pt-5">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <div>
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-3 w-24" />
              </div>
            </div>
            <div className="space-y-3.5 px-5 pb-5 pt-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </main>
    </>
  )
}
