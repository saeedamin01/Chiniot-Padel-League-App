'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MessageCircle, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChat } from '@/context/ChatContext'
import { formatDistanceToNow } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatPreview {
  chatId: string
  challengeCode: string
  teamA: string
  teamB: string
  senderName: string
  preview: string
  unreadCount: number
  createdAt: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatBell() {
  const [supabase] = useState(() => createClient())
  const router = useRouter()
  const { totalUnread, refresh } = useChat()

  const [open, setOpen]           = useState(false)
  const [previews, setPreviews]   = useState<ChatPreview[]>([])
  const [loading, setLoading]     = useState(false)
  const [userId, setUserId]       = useState<string | null>(null)

  // Grab the user ID once
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch chat previews when popover opens
  const fetchPreviews = useCallback(async () => {
    if (!userId) return
    setLoading(true)

    // Get chats the user is in
    const { data: chats } = await supabase
      .from('challenge_chats')
      .select(`
        id,
        allowed_player_ids,
        challenge:challenges (
          challenge_code,
          challenging_team:teams!challenges_challenging_team_id_fkey ( name ),
          challenged_team:teams!challenges_challenged_team_id_fkey ( name )
        )
      `)
      .contains('allowed_player_ids', [userId])

    if (!chats?.length) {
      setPreviews([])
      setLoading(false)
      return
    }

    // For each chat, grab the latest unread message
    const results: ChatPreview[] = []

    for (const chat of chats) {
      const { data: unreadMsgs, count } = await supabase
        .from('chat_messages')
        .select(`
          content,
          created_at,
          sender:players!chat_messages_sender_id_fkey ( name )
        `, { count: 'exact' })
        .eq('chat_id', chat.id)
        .neq('sender_id', userId)
        .not('read_by', 'cs', `{${userId}}`)
        .order('created_at', { ascending: false })
        .limit(1)

      if (!count || count === 0) continue  // skip chats with no unread

      const latestMsg = unreadMsgs?.[0]
      const challenge = chat.challenge as unknown as {
        challenge_code: string
        challenging_team?: { name: string } | null
        challenged_team?: { name: string } | null
      } | null

      results.push({
        chatId:        chat.id,
        challengeCode: challenge?.challenge_code ?? '',
        teamA:         challenge?.challenging_team?.name ?? '—',
        teamB:         challenge?.challenged_team?.name ?? '—',
        senderName:    (latestMsg?.sender as unknown as { name: string } | null)?.name ?? 'Someone',
        preview:       latestMsg?.content ?? '',
        unreadCount:   count,
        createdAt:     latestMsg?.created_at ?? '',
      })
    }

    // Most recent unread first
    results.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    setPreviews(results)
    setLoading(false)
  }, [supabase, userId])

  useEffect(() => {
    if (open) fetchPreviews()
  }, [open, fetchPreviews])

  const handleChatClick = (chatId: string) => {
    setOpen(false)
    refresh()  // re-sync unread count after navigating in
    router.push(`/chat/${chatId}`)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          aria-label="Chat"
        >
          <MessageCircle className="h-5 w-5" />
          {totalUnread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {totalUnread > 9 ? '9+' : totalUnread}
            </Badge>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[340px] sm:w-[380px] p-0 overflow-hidden"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white text-sm">Match Chats</h3>
            {totalUnread > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-medium">
                {totalUnread} unread
              </span>
            )}
          </div>
        </div>

        {/* List */}
        <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-700/40">
          {loading ? (
            <div className="py-10 text-center text-slate-500 text-sm">Loading…</div>
          ) : previews.length === 0 ? (
            <div className="py-10 text-center">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 mx-auto mb-3">
                <MessageCircle className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-white">No unread messages</p>
              <p className="text-xs text-slate-500 mt-1">You're all caught up!</p>
            </div>
          ) : (
            previews.map(p => (
              <button
                key={p.chatId}
                onClick={() => handleChatClick(p.chatId)}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors text-left"
              >
                {/* Avatar */}
                <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate">
                      {p.teamA} vs {p.teamB}
                    </p>
                    <span className="flex-shrink-0 text-[10px] text-slate-500">
                      {p.createdAt ? formatDistanceToNow(new Date(p.createdAt), { addSuffix: true }) : ''}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">
                    <span className="font-medium text-slate-300">{p.senderName}:</span>{' '}
                    {p.preview}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-0.5">{p.challengeCode}</p>
                </div>

                {/* Unread badge */}
                {p.unreadCount > 0 && (
                  <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold flex items-center justify-center self-center">
                    {p.unreadCount > 9 ? '9+' : p.unreadCount}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-700/60 bg-slate-900/60">
          <Link
            href="/chat"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            View all chats
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
