import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-overlay-strong', className)}
      aria-hidden
    >
      {/* loading-sweep animates a narrow band from -100% to +300% of ITS OWN width across the
          parent (see TicketsToolbar.tsx's identical use on a w-1/3 bar) -- w-1/3 here matches
          that contract so the sweep travels roughly edge-to-edge of this skeleton block. */}
      <div
        className="absolute inset-y-0 w-1/3 animate-[loading-sweep_1.6s_ease-in-out_infinite]"
        style={{
          background: 'linear-gradient(90deg, transparent, var(--overlay-strong), transparent)',
        }}
      />
    </div>
  )
}
