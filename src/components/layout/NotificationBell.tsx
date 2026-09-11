'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Bell, CheckCheck, Ticket as TicketIcon, UserPlus } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { usePopoverPosition } from '@/lib/use-popover-position'
import {
  getNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/actions/notification.actions'
import type { NotificationItem } from '@/server/services/notification.service'

const POLL_INTERVAL_MS = 30_000
const MENU_MIN_WIDTH = 360

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const position = usePopoverPosition(triggerRef, open, 'right')

  const refresh = useCallback(async () => {
    try {
      const data = await getNotificationsAction()
      setItems(data.items)
      setUnreadCount(data.unreadCount)
    } finally {
      setLoaded(true)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR/hydration guard before the portal can touch document.body, same pattern as ui/Select.tsx
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function handleMarkAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })))
    setUnreadCount(0)
    startTransition(async () => {
      await markAllNotificationsReadAction()
    })
  }

  function handleItemClick(item: NotificationItem) {
    setOpen(false)
    if (item.read) return
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true } : i)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    startTransition(async () => {
      await markNotificationReadAction(item.id)
    })
  }

  // The popover math in usePopoverPosition anchors `right` to the bell icon's own (tiny) width,
  // then this component forces a much wider MENU_MIN_WIDTH on top of it -- fine on desktop, but on
  // a narrow phone viewport the fixed 360px width pushes the panel's left edge off-screen. Clamp
  // the width to the viewport and pull `right` in to match, so the panel never extends past the
  // screen edges.
  const POPOVER_MARGIN = 8
  const menuWidth =
    position && typeof window !== 'undefined'
      ? Math.min(
          Math.max(position.minWidth, MENU_MIN_WIDTH),
          window.innerWidth - POPOVER_MARGIN * 2,
        )
      : undefined
  const menuStyle =
    position && menuWidth !== undefined
      ? {
          ...position.style,
          right: Math.min(
            Number(position.style.right ?? 0),
            window.innerWidth - POPOVER_MARGIN - menuWidth,
          ),
        }
      : position?.style

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-strong transition-colors hover:bg-overlay-strong hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {loaded && unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-background shadow-[0_0_6px_1px_rgba(16,185,129,0.8)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {mounted &&
        open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            style={{ ...menuStyle, width: menuWidth }}
            className="z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-background-elevated shadow-lg"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <button
                type="button"
                disabled={isPending || unreadCount === 0}
                onClick={handleMarkAllRead}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-strong transition-colors hover:bg-overlay-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all as read
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                  <Bell className="h-5 w-5 text-muted" />
                  <p className="text-sm text-muted">
                    {loaded ? "You're all caught up." : 'Loading…'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {items.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => handleItemClick(item)}
                      className="group flex items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-overlay"
                    >
                      <div
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                          item.type === 'account'
                            ? 'bg-warning/15 text-warning'
                            : 'bg-overlay-strong text-muted-strong',
                        )}
                      >
                        {item.type === 'account' ? (
                          <UserPlus className="h-3.5 w-3.5" />
                        ) : (
                          <TicketIcon className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">
                          {item.title}
                        </p>
                        <p className="truncate text-xs text-muted">{item.subtitle}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                        <span className="text-[11px] text-muted">{timeAgo(item.createdAt)}</span>
                        {!item.read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
