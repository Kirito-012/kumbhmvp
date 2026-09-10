'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from '@/components/map/icons'

export default function Panel({
  icon,
  title,
  subtitle,
  side,
  children,
  defaultCollapsed = false,
  resizable = false,
  defaultWidth = 288,
  minWidth = 260,
  maxWidth = 560,
  overlayOpen = false,
  onRenderedWidthChange,
  forceCollapsed = false,
  onExpand,
  onCollapse,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  side: 'left' | 'right'
  children: ReactNode
  defaultCollapsed?: boolean
  /** Lets the user drag the panel's inner edge to resize it. */
  resizable?: boolean
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  /** Set while a child combobox/dropdown is open -- lifts the content area's
   *  overflow clipping so the dropdown's menu isn't cut off/squashed inside
   *  the panel's own scroll container. */
  overlayOpen?: boolean
  /** Reports the panel's current on-screen width (0 while collapsed) so a
   *  parent positioning something else around it -- e.g. the map's
   *  fitBounds/flyTo padding, which needs to know how much of the viewport
   *  this panel actually occludes right now -- doesn't have to guess a
   *  fixed constant that drifts wrong the moment the panel is resized or
   *  collapsed. Fires on mount, on every collapse/expand, and on every
   *  resize-drag frame. */
  onRenderedWidthChange?: (width: number) => void
  /** When true, forces this panel closed regardless of its own state -- used on phone-width
   *  viewports so opening one docked panel (left search / right Stats) auto-closes the other:
   *  both go full-bleed width when expanded there (see the max-sm:w-[...] class below), so two
   *  expanded at once would stack directly on top of each other with no way to reach the one
   *  underneath. Desktop/tablet never sets this -- the two panels dock side-by-side there and
   *  can coexist open. */
  forceCollapsed?: boolean
  /** Fires when the user expands this panel (not on mount, not on forced collapse) -- the
   *  sibling panel's forceCollapsed above is driven from this. */
  onExpand?: () => void
  /** Fires when the user collapses this panel by their own action (never on a *forced*
   *  collapse, which didn't originate from this panel). The caller uses this to clear
   *  whichever "which panel is expanded" tracker is driving the sibling's forceCollapsed --
   *  without it, that tracker would stay pointed at this panel forever after its first
   *  expansion, permanently hiding the sibling even once this panel is closed again. */
  onCollapse?: () => void
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [width, setWidth] = useState(defaultWidth)
  const [dragging, setDragging] = useState(false)
  const dragState = useRef({ startX: 0, startWidth: defaultWidth })
  const effectiveCollapsed = collapsed || forceCollapsed

  // On a phone-width viewport the panel is forced to ~full width (see the max-sm:w-[...] class
  // below) -- staying open there by default would cover almost the entire map on first load,
  // which is fine for the Stats panel (already opts into defaultCollapsed) but not for the left
  // search panel, which never did. This can't be decided during the initial render -- the server
  // has no viewport to check, so `useState(defaultCollapsed)` above has to match the server's
  // guess-free render to avoid a hydration mismatch -- so it's corrected once, immediately after
  // mount, purely from the actual viewport. The condition is folded into a single expression
  // (rather than an early-return `if` before the setState call) because the lint rule below
  // otherwise flags *any* conditional path to a setState in an effect as "derivable during
  // render", even when — as here — the condition genuinely isn't renderable server-side.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed((current) => current || (!defaultCollapsed && window.innerWidth < 640))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onRenderedWidthChange?.(effectiveCollapsed ? 0 : width)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onRenderedWidthChange is expected to be a stable setter identity from the caller, not a dep that should re-fire this
  }, [effectiveCollapsed, width])

  function startDrag(e: React.PointerEvent) {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: width }
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      const delta = ev.clientX - dragState.current.startX
      // Right-docked panel's inner edge is its left border: dragging it
      // left (negative delta) grows the panel. Left-docked is the mirror.
      const signedDelta = side === 'right' ? -delta : delta
      const clampedMax = Math.min(maxWidth, window.innerWidth - 24)
      const next = Math.min(
        clampedMax,
        Math.max(minWidth, dragState.current.startWidth + signedDelta),
      )
      setWidth(next)
    }
    function onUp() {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function toggleCollapsed() {
    // While forceCollapsed (the sibling docked panel is open on a phone), any tap here means
    // "open me" -- never "collapse further" -- so this sets collapsed to false outright and
    // tells the parent to force-collapse the sibling via onExpand, rather than toggling
    // `collapsed` (which, since it may already be false underneath the forced closure, would
    // otherwise flip it to true and do the opposite of what the tap asked for). This branch can
    // only ever be an expand, so onCollapse never fires from it.
    if (forceCollapsed) {
      onExpand?.()
      setCollapsed(false)
      return
    }
    if (collapsed) onExpand?.()
    else onCollapse?.()
    setCollapsed((v) => !v)
  }

  return (
    <div
      style={{
        // Below `sm` the panel is always full-bleed width (the max-sm:w-[calc(100vw-24px)]!
        // class below wins), so the drag-resized pixel width only needs to actually apply at
        // sm+ -- but inline styles can't be media-gated, so it's simplest to just always set it
        // and let the higher-specificity `!` mobile override win under 640px regardless.
        ...(resizable ? { width } : undefined),
        background: 'var(--map-panel-bg)',
        borderColor: 'var(--map-panel-border)',
        boxShadow: `0 8px 30px var(--map-panel-shadow)`,
        color: 'var(--map-fg)',
      }}
      className={`absolute ${side === 'left' ? 'top-16 left-3 max-h-[calc(100dvh-76px)]' : 'top-3 right-3 max-h-[calc(100dvh-24px)]'} z-20
        ${
          // forceCollapsed on a phone means the *sibling* panel is currently expanded there --
          // an expanded panel goes full-bleed width AND close to full height (max-h above), so
          // this panel's own collapsed pill would sit directly underneath it regardless of the
          // top-16-vs-top-3 vertical offset that keeps two *collapsed* pills apart. Hiding it
          // outright while forced closed is simpler and more correct than trying to find a
          // gap for it to peek out of: the only way back to it is collapsing the sibling first,
          // which is the intended one-panel-open-at-a-time flow on a phone anyway.
          forceCollapsed
            ? 'max-sm:hidden'
            : effectiveCollapsed
              ? 'max-sm:w-36!'
              : 'max-sm:w-[calc(100vw-24px)]!'
        } ${resizable ? '' : 'w-72'} max-w-[calc(100vw-24px)]
        rounded-2xl border
        backdrop-blur-md
        flex flex-col
        ${dragging ? '' : 'transition-[opacity,transform] duration-200 ease-out'}
        animate-[panel-in_220ms_ease-out]`}
    >
      {resizable && (
        <div
          onPointerDown={startDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${title} panel`}
          className={`group absolute inset-y-0 ${side === 'right' ? '-left-1.5' : '-right-1.5'} z-20 hidden w-3 cursor-col-resize items-center justify-center touch-none sm:flex`}
        >
          <span
            className="h-10 w-1 rounded-full transition-colors"
            style={{ background: dragging ? 'var(--map-accent)' : 'var(--map-switch-track)' }}
          />
        </div>
      )}

      <div
        onClick={toggleCollapsed}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggleCollapsed()
          }
        }}
        aria-label={effectiveCollapsed ? `Expand ${title} panel` : `Collapse ${title} panel`}
        aria-expanded={!effectiveCollapsed}
        style={{ borderColor: 'var(--map-panel-border)' }}
        className="flex items-center gap-2 px-3.5 py-3 border-b shrink-0 cursor-pointer select-none"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--map-accent-bg)', color: 'var(--map-accent-fg)' }}
        >
          <span className="h-4 w-4">{icon}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-[13px] font-semibold leading-tight"
            style={{ color: 'var(--map-fg)' }}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              // Hidden while collapsed on a phone -- the collapsed pill is only ~144px wide
              // there (max-sm:w-36 above), not enough room for a subtitle alongside the title
              // without truncating it to nothing useful.
              className={`truncate text-[11px] leading-tight ${effectiveCollapsed ? 'max-sm:hidden' : ''}`}
              style={{ color: 'var(--map-fg-faint)' }}
            >
              {subtitle}
            </p>
          )}
        </div>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ color: 'var(--map-fg-faint)' }}
        >
          <ChevronDownIcon
            className={`h-4 w-4 transition-transform duration-200 ${effectiveCollapsed ? '-rotate-90' : ''}`}
          />
        </span>
      </div>

      {!effectiveCollapsed && (
        <div
          className={`min-h-0 flex-1 px-3.5 py-3 kumbh-scroll ${overlayOpen ? 'overflow-visible' : 'overflow-y-auto'}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
