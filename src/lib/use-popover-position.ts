'use client'

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

const GAP = 4
const MARGIN = 8
const MAX_HEIGHT = 256
const MIN_HEIGHT = 120

export type PopoverPosition = { style: CSSProperties; minWidth: number }

/**
 * Computes fixed-position coordinates for a floating menu anchored to `triggerRef`, flipping
 * above the trigger when there isn't enough room below. Meant to be paired with a portal render
 * into document.body — any ancestor with `overflow: auto/hidden` (e.g. the table's horizontal
 * scroll wrapper) would otherwise clip an absolutely-positioned dropdown on the last row/item.
 */
export function usePopoverPosition(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
  align: 'left' | 'right' = 'left',
): PopoverPosition | null {
  const [position, setPosition] = useState<PopoverPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) return

    function compute() {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN
      const spaceAbove = rect.top - MARGIN
      const openUp = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow
      const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, openUp ? spaceAbove : spaceBelow))

      const style: CSSProperties = {
        position: 'fixed',
        maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
        ...(align === 'right' ? { right: window.innerWidth - rect.right } : { left: rect.left }),
      }

      setPosition({ style, minWidth: rect.width })
    }

    compute()
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('scroll', compute, true)
      window.removeEventListener('resize', compute)
    }
  }, [open, triggerRef, align])

  return open ? position : null
}
