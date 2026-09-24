'use client'

import { useLayoutEffect, useState } from 'react'
import type { Theme } from '@/lib/insights/heatScale'

/**
 * Mirrors MapView's readMapTheme()/theme-swap MutationObserver, but for React-rendered panel
 * content rather than MapLibre paint properties. BUCKET_COLORS' light/dark hexes -- not a
 * `--map-*` CSS variable -- are the source of truth for status colour (PLAN-heatmap.md §6: "reuse
 * BUCKET_COLORS ... don't invent a second palette"), so a parcel's colour on the map and its
 * swatch here always match; this hook is the one place in the panels that needs the theme as a
 * JS value instead of leaving it to the cascade.
 *
 * Initial state is always 'dark', matching the root layout's hardcoded `data-theme="dark"` -- NOT
 * a peek at `document.documentElement`'s actual attribute, even though that would often be "more
 * correct" on first render. THEME_INIT_SCRIPT (src/lib/theme.ts) is a blocking inline script that
 * corrects `data-theme` to the user's real stored preference before the page paints, but it runs
 * before React hydrates, not before this component's initial render -- so a `useState(() => ...)`
 * initializer that reads `document` here sees the ALREADY-CORRECTED attribute during hydration,
 * while the server (no DOM, no localStorage) always rendered assuming dark. For a light-themed
 * visitor that's a real value mismatch (e.g. this hook feeding a badge's `backgroundColor`), not a
 * formatting quirk -- React warns and never patches it up. Starting from the same hardcoded 'dark'
 * both server and client render keeps the first pass identical; `useLayoutEffect` (not `useEffect`)
 * then corrects it synchronously before the browser paints, so a light-themed visitor never even
 * sees the wrong color flash.
 *
 * Lives in its own module rather than charts.tsx (which re-exports it for the panels) because
 * MapView needs it in Map mode, and charts.tsx imports recharts -- ~112 KB gzipped that would ride
 * along into the map route's initial bundle through this one import, defeating the lazy panel
 * boundaries in MapView.
 */
export function useInsightTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('dark')
  useLayoutEffect(() => {
    const root = document.documentElement
    const read = () => setTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}
