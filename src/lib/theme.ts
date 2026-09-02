export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'theme'

/** Inlined into `<head>` in the root layout so the theme is applied before
 *  first paint (avoids a flash of the wrong theme). Keep this logic in sync
 *  with `readStoredTheme`/`applyTheme` below -- both must agree on the same
 *  storage key and default. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme) {
  const set = () => document.documentElement.setAttribute('data-theme', theme)

  // startViewTransition snapshots the before/after frames and crossfades those rasters (see the
  // ::view-transition-old/new rule in globals.css) instead of letting every element ease its own
  // color -- animating hundreds of elements from a near-black palette to a near-white one at once
  // made everything pass through the same washed-out gray midpoint together, which read as a
  // dirty, sluggish flash rather than a clean swap. Unsupported browsers fall back to `set()`
  // directly -- still an instant, correct theme change, just without the crossfade polish.
  if (!document.startViewTransition) {
    set()
  } else {
    document.startViewTransition(set)
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // localStorage unavailable (private mode, disabled storage) -- theme
    // still applies for this page view, it just won't persist.
  }
}
