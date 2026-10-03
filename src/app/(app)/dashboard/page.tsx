import { Topbar } from '@/components/layout/Topbar'
import { DashCard, DashCardHeader } from '@/components/dashboard/DashCard'
import { WorkHeadsOverview } from '@/components/dashboard/WorkHeadsOverview'
import { WorkHeadsHighlights } from '@/components/dashboard/WorkHeadsHighlights'
import { SectorMapOverview } from '@/components/dashboard/SectorMapOverview'
import { VolumeChart } from '@/components/dashboard/VolumeChartLazy'
import { PriorityBreakdown } from '@/components/dashboard/PriorityBreakdownLazy'
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown'
import { WorkloadByAssignee } from '@/components/dashboard/WorkloadByAssignee'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { DashboardAutoRefresh } from '@/components/dashboard/DashboardAutoRefresh'
import { Inbox, TrendingUp, AlertTriangle, Users2 } from 'lucide-react'
import { requireTicketScope } from '@/server/auth/session'
import { getDashboardData } from '@/server/services/ticket.service'
import { getSectorMapData } from '@/server/services/sector-map.service'
import { buildWorkHeadsOverview } from '@/lib/workHeads/overview'

/** Sections rise into place one after another (`--i` is the position); see .insight-rise. */
const rise = (i: number) => ({ '--i': i }) as React.CSSProperties

export default async function DashboardPage() {
  const { forcedAssigneeId } = await requireTicketScope()
  const mine = Boolean(forcedAssigneeId)
  // Independent reads (Mongo vs Postgres), so they run side by side. The map data is cached for the
  // life of the server process and resolves to null — never throws — if Postgres is unreachable.
  const [data, sectorMap] = await Promise.all([
    getDashboardData(forcedAssigneeId),
    getSectorMapData(),
  ])

  const createdWeek = data.ticketVolume.reduce((sum, d) => sum + d.created, 0)
  const resolvedWeek = data.ticketVolume.reduce((sum, d) => sum + d.resolved, 0)

  // DEMO figures (no work-progress store yet): one roll-up over every sector on the map.
  const workHeads = buildWorkHeadsOverview(
    sectorMap?.sectors.map((s) => s.sectorNo) ?? Array.from({ length: 30 }, (_, i) => i + 1),
  )

  return (
    <>
      <DashboardAutoRefresh />
      <Topbar
        title="Dashboard"
        description="Here's what's happening across your workspace today"
        primaryAction={{ label: 'New ticket', href: '/tickets/new' }}
      />

      <main className="flex-1 space-y-6 px-4 py-5 sm:px-8 sm:py-7">
        {/* Two columns on a wide screen: the work heads and the map on the left, the status of all
            tasks and the heads needing attention on the right. Below xl everything stacks. */}
        <div
          className="insight-rise grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start"
          style={rise(0)}
        >
          <div className="min-w-0 space-y-6">
            <WorkHeadsOverview data={workHeads} />

            {/* Where the work is — sector map + ranked lists by sector or by issue. */}
            <SectorMapOverview
              map={sectorMap}
              sectors={data.categorySectors}
              categories={data.categoryBreakdown}
              mine={mine}
            />
          </div>

          <div className="xl:sticky xl:top-24">
            <WorkHeadsHighlights data={workHeads} />
          </div>
        </div>

        <div className="insight-rise grid grid-cols-1 gap-6 xl:grid-cols-3" style={rise(1)}>
          {/* Volume chart */}
          <DashCard className="xl:col-span-2">
            <DashCardHeader
              icon={<TrendingUp className="h-5 w-5" />}
              title="Ticket volume"
              subtitle="New tickets raised and tickets resolved, last 7 days"
              action={
                <ul className="flex flex-col gap-1.5 pt-0.5 text-[15px] sm:items-end">
                  <li className="flex items-center gap-2.5 text-foreground">
                    <span
                      className="h-1 w-6 rounded-full"
                      style={{ backgroundColor: 'var(--dash-status-new)' }}
                      aria-hidden
                    />
                    Created
                    <span className="font-semibold tabular-nums">
                      {createdWeek.toLocaleString()}
                    </span>
                  </li>
                  <li className="flex items-center gap-2.5 text-foreground">
                    <span
                      className="h-1 w-6 rounded-full"
                      style={{ backgroundColor: 'var(--dash-status-resolved)' }}
                      aria-hidden
                    />
                    Resolved
                    <span className="font-semibold tabular-nums">
                      {resolvedWeek.toLocaleString()}
                    </span>
                  </li>
                </ul>
              }
            />
            <div className="px-3 pb-4 pt-4">
              <VolumeChart data={data.ticketVolume} />
            </div>
          </DashCard>

          {/* Priority breakdown */}
          <DashCard>
            <DashCardHeader
              icon={<AlertTriangle className="h-5 w-5" />}
              title="Priority breakdown"
              subtitle="Open tickets, by how urgent they are"
            />
            <div className="px-5 pb-6 pt-5">
              <PriorityBreakdown data={data.priorityBreakdown} />
            </div>
          </DashCard>
        </div>

        {/* Category breakdown — renders its own fixed-dark panel chrome, no Card wrapper */}
        <div className="insight-rise" style={rise(2)}>
          <CategoryBreakdown data={data.categoryBreakdown} sectors={data.categorySectors} />
        </div>

        <div className="insight-rise grid grid-cols-1 gap-6 xl:grid-cols-3" style={rise(3)}>
          {/* Recent activity */}
          <DashCard className="xl:col-span-2">
            <DashCardHeader
              icon={<Inbox className="h-5 w-5" />}
              title="Recent activity"
              subtitle="Latest updates"
            />
            <div className="mt-3">
              <ActivityFeed items={data.recentActivity} />
            </div>
          </DashCard>

          {/* Workload by assignee */}
          <DashCard>
            <DashCardHeader
              icon={<Users2 className="h-5 w-5" />}
              title="Workload by assignee"
              subtitle="Open tickets per person"
            />
            <div className="px-6 pb-6 pt-5">
              <WorkloadByAssignee data={data.workloadByAssignee} />
            </div>
          </DashCard>
        </div>
      </main>
    </>
  )
}
