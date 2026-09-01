'use client'

import { useRef, useState, type ReactNode } from 'react'
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
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [width, setWidth] = useState(defaultWidth)
  const [dragging, setDragging] = useState(false)
  const dragState = useRef({ startX: 0, startWidth: defaultWidth })

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

  return (
    <div
      style={resizable ? { width } : undefined}
      className={`absolute ${side === 'left' ? 'top-16 left-3 max-h-[calc(100vh-76px)]' : 'top-3 right-3 max-h-[calc(100vh-24px)]'} z-20
        ${resizable ? '' : 'w-72'} max-w-[calc(100vw-24px)]
        rounded-2xl border border-slate-900/8 bg-white/92 shadow-[0_8px_30px_rgba(15,23,42,0.14)]
        backdrop-blur-md
        text-slate-900
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
          className={`group absolute inset-y-0 ${side === 'right' ? '-left-1.5' : '-right-1.5'} z-20 flex w-3 cursor-col-resize items-center justify-center touch-none`}
        >
          <span
            className={`h-10 w-1 rounded-full transition-colors ${dragging ? 'bg-blue-500' : 'bg-slate-300 group-hover:bg-blue-400'}`}
          />
        </div>
      )}

      <div
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed((v) => !v)
          }
        }}
        aria-label={collapsed ? `Expand ${title} panel` : `Collapse ${title} panel`}
        aria-expanded={!collapsed}
        className="flex items-center gap-2 px-3.5 py-3 border-b border-slate-900/8 shrink-0 cursor-pointer select-none"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-700">
          <span className="h-4 w-4">{icon}</span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold leading-tight text-slate-900">
            {title}
          </h2>
          {subtitle && (
            <p className="truncate text-[11px] leading-tight text-slate-500">{subtitle}</p>
          )}
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500">
          <ChevronDownIcon
            className={`h-4 w-4 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
          />
        </span>
      </div>

      {!collapsed && (
        <div
          className={`min-h-0 flex-1 px-3.5 py-3 kumbh-scroll ${overlayOpen ? 'overflow-visible' : 'overflow-y-auto'}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
