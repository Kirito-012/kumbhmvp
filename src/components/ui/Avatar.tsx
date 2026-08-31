import { cn } from '@/lib/utils'
import type { Person } from '@/lib/mock-data'

export function Avatar({
  person,
  size = 'md',
  className,
}: {
  person: Person
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-10 w-10 text-sm',
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-background',
        sizes[size],
        className,
      )}
      style={{ backgroundColor: person.color }}
      title={person.name}
    >
      {person.initials}
    </span>
  )
}

export function AvatarStack({ people, max = 4 }: { people: Person[]; max?: number }) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length

  return (
    <div className="flex items-center -space-x-2">
      {shown.map((p, i) => (
        <Avatar key={i} person={p} size="sm" />
      ))}
      {rest > 0 && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[10px] font-medium text-muted ring-2 ring-background">
          +{rest}
        </span>
      )}
    </div>
  )
}
