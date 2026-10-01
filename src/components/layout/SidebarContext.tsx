'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// How long the pointer may be away from both the hamburger and the sidebar before a hover "peek"
// closes -- long enough to cross the small gap between them without the panel flickering shut.
const PEEK_CLOSE_DELAY_MS = 160

type SidebarState = {
  /** Pinned open: set by clicking the hamburger. Stays until closed explicitly. */
  open: boolean
  setOpen: (open: boolean) => void
  /** Temporarily shown while the pointer hovers the hamburger or the sidebar itself. */
  peeking: boolean
  /** Pointer entered the hamburger/sidebar -- start (or keep) a peek. */
  peekStart: () => void
  /** Pointer left the hamburger/sidebar -- end the peek after a short grace period. */
  peekEnd: () => void
}

const SidebarContext = createContext<SidebarState | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const peekStart = useCallback(() => {
    clearTimer()
    setPeeking(true)
  }, [clearTimer])

  const peekEnd = useCallback(() => {
    clearTimer()
    timer.current = setTimeout(() => setPeeking(false), PEEK_CLOSE_DELAY_MS)
  }, [clearTimer])

  // Pinning or closing always ends any peek so the two states never overlap.
  const setOpen = useCallback(
    (next: boolean) => {
      clearTimer()
      setPeeking(false)
      setOpenState(next)
    },
    [clearTimer],
  )

  useEffect(() => clearTimer, [clearTimer])

  const value = useMemo(
    () => ({ open, setOpen, peeking, peekStart, peekEnd }),
    [open, setOpen, peeking, peekStart, peekEnd],
  )
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}
