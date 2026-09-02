'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { applyTheme, readStoredTheme, type Theme } from '@/lib/theme'

export function ThemeToggle({ className }: { className?: string }) {
  // Always starts `null` -- a lazy useState initializer runs on the client's first render too
  // (not just the server's), so reading localStorage there would make the client's *first*
  // render disagree with the server's (which has no access to localStorage and must render
  // `null`). Deferring the real value to an effect keeps the first client render identical to
  // the server's, avoiding the hydration mismatch that was corrupting this button's aria-label/
  // title on every load (visible as a "didn't match" hydration warning + React discarding and
  // re-rendering the whole client tree from this boundary, which briefly breaks anything that
  // held state above it in the tree).
  const [theme, setTheme] = useState<Theme | null>(null)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- see the mismatch note above; this is the correction step, not the initial read
  useEffect(() => setTheme(readStoredTheme()), [])

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)
  }

  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === null ? 'Toggle theme' : isLight ? 'Switch to dark mode' : 'Switch to light mode'
      }
      title={
        theme === null ? 'Toggle theme' : isLight ? 'Switch to dark mode' : 'Switch to light mode'
      }
      className={cn(
        'relative inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-overlay hover:text-foreground',
        className,
      )}
    >
      <Sun
        className={cn(
          'absolute h-3.5 w-3.5 transition-all duration-200 ease-out',
          isLight ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-0 opacity-0',
        )}
        strokeWidth={2}
      />
      <Moon
        className={cn(
          'absolute h-3.5 w-3.5 transition-all duration-200 ease-out',
          isLight ? '-rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100',
        )}
        strokeWidth={2}
      />
    </button>
  )
}
