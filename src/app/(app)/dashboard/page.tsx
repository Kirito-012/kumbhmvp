import { Topbar } from '@/components/layout/Topbar'
import { DashCard, DashCardHeader } from '@/components/dashboard/DashCard'
import { StatCard } from '@/components/dashboard/StatCard'
import { StatusOverview } from '@/components/dashboard/StatusOverview'
import { SectorMapOverview } from '@/components/dashboard/SectorMapOverview'
import { VolumeChart } from '@/components/dashboard/VolumeChartLazy'
import { PriorityBreakdown } from '@/components/dashboard/PriorityBreakdownLazy'
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown'
import { WorkloadByAssignee } from '@/components/dashboard/WorkloadByAssignee'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { DashboardAutoRefresh } from '@/components/dashboard/DashboardAutoRefresh'
import {
  Inbox,
  CheckCircle2,
  UserX,
  FilePlus2,
  TrendingUp,
  AlertTriangle,
  Users2,
} from 'lucide-react'
import { requireTicketScope } from '@/server/auth/session'
import { getDashboardData } from '@/server/services/ticket.service'
import { getSectorMapData } from '@/server/services/sector-map.service'

/** Sections rise into place one after another (`--i` is the position); see .insight-rise. */
const rise = (i: number) => ({ '--i': i }) as React.CSSProperties

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0)

export default async function DashboardPage() {
  const { forcedAssigneeId } = await requireTicketScope()
  const mine = Boolean(forcedAssigneeId)
  // Independent reads (Mongo vs Postgres), so they run side by side. The map data is cached for the
  // life of the server process and resolves to null — never throws — if Postgres is unreachable.
  const [data, sectorMap] = await Promise.all([
    getDashboardData(forcedAssigneeId),
    getSectorMapData(),
  ])

  const days = data.ticketVolume.map((d) => d.day)
  const createdWeek = data.ticketVolume.reduce((sum, d) => sum + d.created, 0)
  const resolvedWeek = data.ticketVolume.reduce((sum, d) => sum + d.resolved, 0)

  const openPct = Math.round(share(data.openTicketsCount, data.totalCount) * 100)
  const unassignedPct =
    data.unassignedCount === null
      ? null
      : Math.round(share(data.unassignedCount, data.openTicketsCount) * 100)

  return (
    <>
      <DashboardAutoRefresh />
      <Topbar
        title="Dashboard"
        description="Here's what's happening across your workspace today"
        primaryAction={{ label: 'New ticket', href: '/tickets/new' }}
      />

      <main className="flex-1 space-y-6 px-4 py-5 sm:px-8 sm:py-7">
        {/* The lead: how far along everything is, and where each ticket stands. */}
        <div className="insight-rise" style={rise(0)}>
          <StatusOverview data={data.statusBreakdown} mine={mine} />
        </div>

        {/* The four numbers people open the page for, each with a sentence that explains it. */}
        <div
          className="insight-rise grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4"
          style={rise(1)}
        >
          <StatCard
            label={mine ? 'My open tickets' : 'Open tickets'}
            value={data.openTicketsCount}
            caption={`${openPct}% of all tickets still need work`}
            icon={<Inbox className="h-5 w-5" />}
            tone="open"
            meter={share(data.openTicketsCount, data.totalCount)}
            href="/tickets?status=unresolved"
          />
          <StatCard
            label="Unassigned"
            value={data.unassignedCount}
            caption={
              mine || unassignedPct === null
                ? undefined
                : data.openTicketsCount === 0
                  ? 'Nothing is waiting for an owner'
                  : `${unassignedPct}% of open tickets have no owner yet`
            }
            icon={<UserX className="h-5 w-5" />}
            tone="attention"
            meter={
              mine || data.unassignedCount === null
                ? undefined
                : share(data.unassignedCount, data.openTicketsCount)
            }
            href={mine ? undefined : '/tickets?assignee=unassigned'}
          />
          <StatCard
            label="Resolved today"
            value={data.resolvedTodayCount}
            caption={`${resolvedWeek.toLocaleString()} resolved in the last 7 days`}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="done"
            bars={{ values: data.ticketVolume.map((d) => d.resolved), labels: days }}
          />
          <StatCard
            label="Created this week"
            value={createdWeek}
            caption="New tickets raised in the last 7 days"
            icon={<FilePlus2 className="h-5 w-5" />}
            tone="info"
            bars={{ values: data.ticketVolume.map((d) => d.created), labels: days }}
          />
        </div>

        {/* Where the work is — sector map + ranked lists by sector or by issue. */}
        <div className="insight-rise" style={rise(2)}>
          <SectorMapOverview
            map={sectorMap}
            sectors={data.categorySectors}
            categories={data.categoryBreakdown}
            mine={mine}
          />
        </div>

        <div className="insight-rise grid grid-cols-1 gap-6 xl:grid-cols-3" style={rise(3)}>
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
        <div className="insight-rise" style={rise(4)}>
          <CategoryBreakdown data={data.categoryBreakdown} sectors={data.categorySectors} />
        </div>

        <div className="insight-rise grid grid-cols-1 gap-6 xl:grid-cols-3" style={rise(5)}>
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
