import { MapPinned } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BrandMarkProps {
  size?: 'sm' | 'md'
  wordmark?: boolean
  className?: string
}

/** Shared brand mark — used on the login/register panels and the sidebar so the
 *  identity can't drift between them. */
export function BrandMark({ size = 'md', wordmark = false, className }: BrandMarkProps) {
  const tile = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5'

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg bg-accent shadow-[0_0_20px_-4px_rgba(16,185,129,0.7)]',
          tile,
        )}
      >
        <MapPinned className={cn(icon, 'text-background')} strokeWidth={2.25} />
      </div>
      {wordmark && (
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Kumbh Drishti</p>
          <p className="text-[11px] text-muted">TheCraftSync</p>
        </div>
      )}
    </div>
  )
}
