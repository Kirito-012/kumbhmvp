'use client'

import { createContext, useContext, useState } from 'react'

const SidebarContext = createContext<{
  open: boolean
  setOpen: (open: boolean) => void
} | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <SidebarContext.Provider value={{ open, setOpen }}>{children}</SidebarContext.Provider>
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider')
  return ctx
}
