'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MessageCircle, Loader2, ChevronRight, Lock, ChevronDown, ChevronUp } from 'lucide-react'
import type { ChallengeChat, ChatMessage, ChallengeStatus } from '@/types'
import { formatDistanceToNow } from 'date-fns'

// Terminal statuses → chat becomes read-only / archived
const TERMINAL: ChallengeStatus[] = ['played', 'forfeited', 'dissolved']

interface ChatListItem {
  chat: ChallengeChat
  lastMessage: ChatMessage | null
  unreadCount: number
  challengeStatus: ChallengeStatus | null
}

export default function ChatListPage() {
  const supabase = createClient()
  const [items, setItems] = useState<ChatListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)

  const fetchChats = useCallback(async (uid: string) => {
    const { data: chats, error } = await supabase
      .from('challenge_chats')
      .select(`
        id,
        challenge_id,
        allowed_player_ids,
        last_email_sent_at,
        created_at,
        challenge:challenges (
          id,
          challenge_code,
          status,
          challenging_team:teams!challenges_challenging_team_id_fkey ( id, name ),
          challenged_team:teams!challenges_challenged_team_id_fkey ( id, name )
        )
      `)
      .contains('allowed_player_ids', [uid])
      .order('created_at', { ascending: false })

    if (error || !chats) { setItems([]); return }

    const enriched = await Promise.all(
      chats.map(async (chat) => {
        const [lastMsgRes, unreadRes] = await Promise.all([
          supabase
            .from('chat_messages')
            .select('id, chat_id, sender_id, content, read_by, created_at, sender:players!chat_messages_sender_id_fkey(id, name, avatar_url)')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
          supabase
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('chat_id', chat.id)
            .neq('sender_id', uid)
            .not('read_by', 'cs', `{${uid}}`),
        ])

        const challengeRaw = chat.challenge as any
        const status: ChallengeStatus | null = (Array.isArray(challengeRaw) ? challengeRaw[0] : challengeRaw)?.status ?? null

        return {
          chat: chat as unknown as ChallengeChat,
          lastMessage: lastMsgRes.data as ChatMessage | null,
          unreadCount: unreadRes.count ?? 0,
          challengeStatus: status,
        }
      })
    )

    // Sort: most recent message first
    enriched.sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? a.chat.created_at
      const bTime = b.lastMessage?.created_at ?? b.chat.created_at
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    })

    setItems(enriched)
  }, [supabase])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setUserId(user.id)
      await fetchChats(user.id)
      setLoading(false)
    }
    init()
  }, [supabase, fetchChats])

  const activeItems = items.filter(i => !TERMINAL.includes(i.challengeStatus as ChallengeStatus))
  const closedItems = items.filter(i =>  TERMINAL.includes(i.challengeStatus as ChallengeStatus))

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  // ── Chat row ───────────────────────────────────────────────────────────────
  const ChatRow = ({ chat, lastMessage, unreadCount, challengeStatus }: ChatListItem) => {
    const challenge = chat.challenge
    const challengeRaw = Array.isArray(challenge) ? challenge[0] : challenge
    const teamA   = (challengeRaw as any)?.challenging_team?.name ?? '—'
    const teamB   = (challengeRaw as any)?.challenged_team?.name ?? '—'
    const code    = (challengeRaw as any)?.challenge_code ?? ''
    const isClosed = TERMINAL.includes(challengeStatus as ChallengeStatus)
    const timeAgo  = lastMessage
      ? formatDistanceToNow(new Date(lastMessage.created_at), { addSuffix: true })
      : null
    const senderName = (lastMessage?.sender as { id: string; name: string } | null)?.name
    const isOwn = lastMessage?.sender_id === userId

    const closedLabel: Record<string, string> = {
      played:    'Match played',
      forfeited: 'Forfeited',
      dissolved: 'Dissolved',
    }

    return (
      <li>
        <Link
          href={`/chat/${chat.id}`}
          className={`flex items-center gap-3 px-4 py-3.5 transition-colors
            ${isClosed
              ? 'hover:bg-slate-50 dark:hover:bg-slate-800/20'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
        >
          {/* Avatar */}
          <div className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center
            ${isClosed
              ? 'bg-slate-100 dark:bg-slate-800/60'
              : 'bg-emerald-500/15 dark:bg-emerald-500/15'
            }`}
          >
            {isClosed
              ? <Lock className="h-4.5 w-4.5 text-slate-400" />
              : <MessageCircle className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />
            }
          </div>

          {/* Body */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-semibold truncate
                ${isClosed ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                {teamA} vs {teamB}
              </p>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {timeAgo && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">{timeAgo}</span>
                )}
                {unreadCount > 0 && !isClosed && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white dark:text-slate-950 text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                {lastMessage
                  ? <>{isOwn ? 'You' : senderName}: {lastMessage.content}</>
                  : <span className="italic">No messages yet</span>
                }
              </p>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[11px] text-slate-400 dark:text-slate-600">{code}</p>
              {isClosed && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                  {closedLabel[challengeStatus!] ?? 'Closed'}
                </span>
              )}
            </div>
          </div>

          <ChevronRight className="flex-shrink-0 h-4 w-4 text-slate-300 dark:text-slate-600" />
        </Link>
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800/60 px-4 py-4">
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">Match Chats</h1>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Coordinate with your opponents</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center mb-4">
            <MessageCircle className="h-7 w-7 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium">No chats yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
            Chat rooms open when a challenge is accepted.
          </p>
        </div>
      ) : (
        <div>
          {/* ── Active chats ── */}
          {activeItems.length > 0 && (
            <section>
              <div className="px-4 pt-4 pb-1">
                <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                  Active · {activeItems.length}
                </p>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {activeItems.map(item => <ChatRow key={item.chat.id} {...item} />)}
              </ul>
            </section>
          )}

          {/* ── Closed chats ── */}
          {closedItems.length > 0 && (
            <section className="mt-4">
              <button
                onClick={() => setClosedOpen(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors"
              >
                <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex-1 text-left">
                  Closed · {closedItems.length}
                </p>
                {closedOpen
                  ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                  : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                }
              </button>
              {closedOpen && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800/50 opacity-75">
                  {closedItems.map(item => <ChatRow key={item.chat.id} {...item} />)}
                </ul>
              )}
            </section>
          )}

          {/* Empty active state with closed chats present */}
          {activeItems.length === 0 && closedItems.length > 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <MessageCircle className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-3" />
              <p className="text-slate-400 dark:text-slate-500 text-sm">No active chats</p>
              <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">
                All your challenges have concluded.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
