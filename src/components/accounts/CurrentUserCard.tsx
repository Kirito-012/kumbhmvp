import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { ROLE_COLOR } from '@/components/accounts/AccountsTable'
import { cn, initialsFor, timeAgo } from '@/lib/utils'

export function CurrentUserCard({
  fullname,
  email,
  roleName,
  isActive,
  createdAt,
}: {
  fullname: string
  email: string
  roleName: string
  isActive: boolean
  createdAt: string
}) {
  const color = ROLE_COLOR[roleName] ?? '#3f3f46'

  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar person={{ name: fullname, initials: initialsFor(fullname), color }} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground">{fullname}</p>
              <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong">
                You
              </span>
            </div>
            <p className="text-xs text-muted">{email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {roleName}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium',
              isActive ? 'text-accent-strong' : 'text-muted',
            )}
          >
            <span
              className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-accent-strong' : 'bg-muted')}
            />
            {isActive ? 'Active' : 'Deactivated'}
          </span>
          <span className="text-xs text-muted">Joined {timeAgo(createdAt)}</span>
        </div>
      </div>
    </Card>
  )
}
