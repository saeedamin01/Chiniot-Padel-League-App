'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Bell, CheckCheck, Trash2, Settings, Check, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Notification } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d < 7)  return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── Component ──────────────────────────────────────────────────────────────────

export function NotificationBell() {
  // Keep the client stable — createClient() must not run on every render
  const [supabase] = useState(() => createClient())
  const router     = useRouter()

  const [open, setOpen]                   = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount]     = useState(0)
  const [loading, setLoading]             = useState(false)

  // ── Mount: fetch initial count + realtime subscription ───────────────────────
  // Uses a `cancelled` flag so the async never touches state or creates a
  // channel after the cleanup has run (fixes React Strict Mode double-invoke).
  // `supabase.removeChannel()` fully removes the channel from Supabase's
  // internal registry, so the name can safely be reused on re-mount.
  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function setup() {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled || !user) return

      // Initial unread count
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .eq('is_read', false)
      if (!cancelled) setUnreadCount(count ?? 0)

      // Realtime: increment badge on new insert
      if (!cancelled) {
        channel = supabase
          .channel(`notif-count-${user.id}`)
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `player_id=eq.${user.id}`,
          }, () => setUnreadCount(c => c + 1))
          .subscribe()
      }
    }

    setup()

    return () => {
      cancelled = true
      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // supabase is stable (useState initialiser), subscribe once only

  // ── Fetch UNREAD notifications when dropdown opens ───────────────────────────
  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('player_id', user.id)
      .eq('is_read', false)          // unread only
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications(data || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (open) fetchNotifications()
  }, [open, fetchNotifications])

  // ── Actions ───────────────────────────────────────────────────────────────────

  // Mark as read → removes from the dropdown list immediately
  async function dismiss(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    setUnreadCount(c => Math.max(0, c - 1))
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
  }

  // Mark all as read → clears the dropdown
  async function dismissAll() {
    const ids = notifications.map(n => n.id)
    if (!ids.length) return
    setNotifications([])
    setUnreadCount(0)
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', ids)
  }

  // Delete → removes from DB and from list
  async function deleteNotification(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    setUnreadCount(c => Math.max(0, c - 1))
    await supabase.from('notifications').delete().eq('id', id)
  }

  // Click → dismiss + navigate
  async function handleClick(n: Notification) {
    await dismiss(n.id)
    if (n.action_url) {
      setOpen(false)
      router.push(n.action_url)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[360px] sm:w-[400px] p-0 overflow-hidden"
        align="end"
        sideOffset={8}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white text-sm">Notifications</h3>
            {notifications.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-medium">
                {notifications.length}
              </span>
            )}
          </div>
          {notifications.length > 0 && (
            <button
              onClick={dismissAll}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Dismiss all
            </button>
          )}
        </div>

        {/* ── List ── */}
        <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-700/40">
          {loading ? (
            <div className="py-10 text-center text-slate-500 text-sm">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="py-10 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 mx-auto mb-3">
                <CheckCheck className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-white">You're all caught up!</p>
              <p className="text-xs text-slate-500 mt-1">No new notifications</p>
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors cursor-pointer"
                onClick={() => handleClick(n)}
              >
                {/* Unread dot */}
                <div className="mt-1.5 shrink-0">
                  <div className="h-2 w-2 rounded-full bg-emerald-400" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white leading-snug truncate">
                    {n.title}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                    {n.message}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-1">{timeAgo(n.created_at)}</p>
                </div>

                {/* Actions — visible on hover */}
                <div
                  className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={() => dismiss(n.id)}
                    className="p-1 rounded text-slate-500 hover:text-emerald-400 hover:bg-slate-700 transition-colors"
                    title="Dismiss"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteNotification(n.id)}
                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-700/60 bg-slate-900/60">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            href="/notifications?tab=preferences"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            Preferences
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
