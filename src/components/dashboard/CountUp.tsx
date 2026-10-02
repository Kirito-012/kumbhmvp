'use client'

import { useLayoutEffect, useRef } from 'react'

const DURATION_MS = 900

/**
 * A number that counts up to `value` when it first appears, and from the old value to the new one
 * when the dashboard auto-refreshes. The server renders the final figure, so nothing is blank
 * without JavaScript; the count runs by writing the text node directly (no re-render per frame).
 * Reduced-motion users see the final number at once.
 */
export function CountUp({
  value,
  suffix = '',
  delay = 250,
}: {
  value: number
  suffix?: string
  /** ms before the first count starts, so it lines up with the entrance animations. */
  delay?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(0)
  const first = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const show = (n: number) => {
      from.current = n
      // Edit React's own text node in place, so a later React update still finds it.
      if (el.firstChild) el.firstChild.nodeValue = `${Math.round(n).toLocaleString()}${suffix}`
    }
    const start = from.current
    if (start === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      show(value)
      first.current = false
      return
    }

    show(start)
    let raf = 0
    const wait = first.current ? delay : 0
    first.current = false
    const begin = performance.now() + wait
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - begin) / DURATION_MS))
      const eased = 1 - Math.pow(1 - t, 3)
      show(start + (value - start) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, suffix, delay])

  return (
    <span ref={ref} suppressHydrationWarning>
      {`${value.toLocaleString()}${suffix}`}
    </span>
  )
}
