import { Topbar } from '@/components/layout/Topbar'
import { Card, CardHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/dashboard/StatCard'
import { VolumeChart } from '@/components/dashboard/VolumeChart'
import { PriorityBreakdown } from '@/components/dashboard/PriorityBreakdown'
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown'
import { WorkloadByAssignee } from '@/components/dashboard/WorkloadByAssignee'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { DashboardAutoRefresh } from '@/components/dashboard/DashboardAutoRefresh'
import { Inbox, CheckCircle2, UserX, Layers, TrendingUp, AlertTriangle, Users2 } from 'lucide-react'
import { requireTicketScope } from '@/server/auth/session'
import { getDashboardData } from '@/server/services/ticket.service'

export default async function DashboardPage() {
  const { forcedAssigneeId } = await requireTicketScope()
  const data = await getDashboardData(forcedAssigneeId)

  return (
    <>
      <DashboardAutoRefresh />
      <Topbar
        title="Dashboard"
        description="Here's what's happening across your workspace today"
        primaryAction={{ label: 'New ticket', href: '/tickets/new' }}
      />

      <main className="flex-1 space-y-6 px-8 py-6 animate-fade-in">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={forcedAssigneeId ? 'My open tickets' : 'Open tickets'}
            value={data.openTicketsCount}
            icon={<Inbox className="h-4 w-4" />}
            accent="accent"
            href="/tickets?status=open"
          />
          <StatCard
            label="Unassigned"
            value={data.unassignedCount}
            caption={forcedAssigneeId ? undefined : 'Waiting to be assigned'}
            icon={<UserX className="h-4 w-4" />}
            accent="warning"
            href={forcedAssigneeId ? undefined : '/tickets?assignee=unassigned'}
          />
          <StatCard
            label="Resolved today"
            value={data.resolvedTodayCount}
            icon={<CheckCircle2 className="h-4 w-4" />}
            accent="accent"
          />
          <StatCard
            label={forcedAssigneeId ? 'My total tickets' : 'Total tickets'}
            value={data.totalCount}
            icon={<Layers className="h-4 w-4" />}
            accent="violet"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Volume chart */}
          <Card className="xl:col-span-2">
            <CardHeader
              icon={<TrendingUp className="h-4 w-4" />}
              title="Ticket volume"
              subtitle="Created vs. resolved, last 7 days"
              action={
                <div className="flex items-center gap-4 pt-1 text-xs">
                  <span className="flex items-center gap-1.5 text-muted-strong">
                    <span className="h-2 w-2 rounded-full bg-accent-strong" /> Created
                  </span>
                  <span className="flex items-center gap-1.5 text-muted-strong">
                    <span className="h-2 w-2 rounded-full bg-violet" /> Resolved
                  </span>
                </div>
              }
            />
            <div className="px-3 pb-3 pt-2">
              <VolumeChart data={data.ticketVolume} />
            </div>
          </Card>

          {/* Priority breakdown */}
          <Card>
            <CardHeader
              icon={<AlertTriangle className="h-4 w-4" />}
              title="Priority breakdown"
              subtitle="Currently open tickets"
            />
            <div className="px-5 pb-5 pt-4">
              <PriorityBreakdown data={data.priorityBreakdown} />
            </div>
          </Card>
        </div>

        {/* Category breakdown — renders its own fixed-dark panel chrome, no Card wrapper */}
        <CategoryBreakdown data={data.categoryBreakdown} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Recent activity */}
          <Card className="xl:col-span-2">
            <CardHeader
              icon={<Inbox className="h-4 w-4" />}
              title="Recent activity"
              subtitle="Latest updates"
            />
            <div className="mt-3">
              <ActivityFeed items={data.recentActivity} />
            </div>
          </Card>

          {/* Workload by assignee */}
          <Card>
            <CardHeader
              icon={<Users2 className="h-4 w-4" />}
              title="Workload by assignee"
              subtitle="Open tickets per person"
            />
            <div className="px-5 pb-5 pt-4">
              <WorkloadByAssignee data={data.workloadByAssignee} />
            </div>
          </Card>
        </div>
      </main>
    </>
  )
}
