'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { BUCKET_COLORS, type StatusBucket } from '@/lib/insights/statusBuckets'
import type { Theme } from '@/lib/insights/heatScale'

// Building blocks shared by the Work Done tab's two live-ticket views (Insights and Tickets), so
// they read as one product: the same card chrome, status palette, and motion helpers.

/** Resolved first (the "done" run), then the unresolved buckets from furthest-along to least. */
export const STACK_ORDER: StatusBucket[] = ['resolved', 'pending', 'open', 'new']

/** Unresolved hues are softened so the green "done" run reads as the progress, not one of four. */
export const statusOpacity = (b: StatusBucket, theme: Theme) =>
  b === 'resolved' ? 1 : theme === 'dark' ? 0.62 : 0.7

/** Text-safe green for "done" copy: the bright map green fails contrast on a light card. */
export const doneTextColor = (theme: Theme) =>
  theme === 'dark' ? BUCKET_COLORS.resolved.dark : '#15803d'

/** Sets a CSS custom property inline (staggers, per-element durations). */
export const cssVar = (name: string, value: string | number) => ({ [name]: value }) as CSSProperties

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 0 -> 1 on an ease-out curve over `ms` (after `delay`), driven by rAF so a sweep and the figure
 * counting beside it stay in lockstep. Starts at 1 when not animating or when the user prefers
 * reduced motion, so those users never depend on a frame tick to see the final state.
 */
export function useTween(animate: boolean, ms: number, delay = 0) {
  const [t, setT] = useState(() => (animate && !prefersReducedMotion() ? 0 : 1))
  useEffect(() => {
    if (!animate || prefersReducedMotion()) return
    const start = performance.now() + delay
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / ms))
      setT(1 - Math.pow(1 - p, 3))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, ms, delay])
  return t
}

/**
 * Eases a displayed number toward `target`. The first run (mount) can have its own duration and
 * delay -- or, with `intro` false, simply start at the target. Later changes glide from wherever
 * the figure is now, so switching between two values never restarts from zero. Reduced motion
 * jumps straight to the target (on the next frame, to keep state updates out of the effect body).
 */
export function useTweenTo(
  target: number,
  {
    intro,
    introMs,
    introDelay,
    ms,
  }: { intro: boolean; introMs: number; introDelay: number; ms: number },
) {
  const [value, setValue] = useState(() => (intro && !prefersReducedMotion() ? 0 : target))
  const valueRef = useRef(value)
  // Cleared once the entrance has actually finished (not merely started), so React Strict Mode's
  // mount -> cleanup -> mount in dev still plays the entrance with its own timing.
  const introPending = useRef(true)
  // The target the entrance was heading for. Strict Mode re-runs the effect with the same target
  // and must still get the entrance; a different target means the user acted before it finished,
  // and that change glides at the normal pace instead of waiting out the entrance's delay.
  const introTarget = useRef<number | null>(null)
  useEffect(() => {
    if (introTarget.current === null) introTarget.current = target
    else if (introTarget.current !== target) introPending.current = false
    const from = valueRef.current
    if (from === target) {
      introPending.current = false
      return
    }
    const reduced = prefersReducedMotion()
    const first = introPending.current
    const duration = reduced ? 0 : first ? introMs : ms
    const start = performance.now() + (first && !reduced ? introDelay : 0)
    let raf = 0
    const tick = (now: number) => {
      const p = duration === 0 ? 1 : Math.min(1, Math.max(0, (now - start) / duration))
      const v = from + (target - from) * (1 - Math.pow(1 - p, 3))
      valueRef.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
      else introPending.current = false
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, introMs, introDelay, ms])
  return value
}

/** "6 d" / "12 h" -- hours, switching to days past two days. */
export function formatDuration(hours: number) {
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`
  const days = hours / 24
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} d`
}

/** False for the first painted frame, then true -- lets CSS transitions animate from empty. */
export function useGrown(animate: boolean) {
  const [grown, setGrown] = useState(() => !animate || prefersReducedMotion())
  useEffect(() => {
    if (!animate || prefersReducedMotion()) return
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [animate])
  return grown
}

export function Card({
  title,
  subtitle,
  index,
  rise,
  className = '',
  aside,
  children,
}: {
  title: string
  subtitle: ReactNode
  /** Position in the entrance sequence. */
  index: number
  /** Play the entrance (off for revisits and when a skeleton with the same chrome was showing). */
  rise: boolean
  className?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      className={`${rise ? 'insight-rise ' : ''}flex min-w-0 flex-col rounded-xl border p-4 ${className}`}
      style={{
        ...cssVar('--i', index),
        backgroundColor: 'var(--map-surface-alt)',
        borderColor: 'var(--map-border)',
      }}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--map-fg)' }}>
            {title}
          </h3>
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--map-fg-muted)' }}>
            {subtitle}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function Dot({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color, opacity }}
      aria-hidden="true"
    />
  )
}

export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
      >
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-[14px] font-semibold" style={{ color: 'var(--map-fg)' }}>
          Couldn’t load this sector’s tickets
        </p>
        <p className="mt-0.5 text-[12px]" style={{ color: 'var(--map-fg-muted)' }} title={message}>
          Check your connection and try again.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="cursor-pointer rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors hover:bg-[var(--map-surface-hover)]"
        style={{ borderColor: 'var(--map-border)', color: 'var(--map-fg)' }}
      >
        Try again
      </button>
    </div>
  )
}
