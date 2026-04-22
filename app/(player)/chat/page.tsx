'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MessageCircle, Loader2, ChevronRight } from 'lucide-react'
import type { ChallengeChat, ChatMessage } from '@/types'
import { formatDistanceToNow } from 'date-fns'

interface ChatListItem {
  chat: ChallengeChat
  lastMessage: ChatMessage | null
  unreadCount: number
}

export default function ChatListPage() {
  const supabase = createClient()
  const [items, setItems] = useState<ChatListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  const fetchChats = useCallback(async (uid: string) => {
    // Fetch all chats the user is in
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
          challenging_team:teams!challenges_challenging_team_id_fkey ( id, name ),
          challenged_team:teams!challenges_challenged_team_id_fkey ( id, name )
        )
      `)
      .contains('allowed_player_ids', [uid])
      .order('created_at', { ascending: false })

    if (error || !chats) {
      setItems([])
      return
    }

    // For each chat, fetch last message + unread count
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

        return {
          chat: chat as unknown as ChallengeChat,
          lastMessage: lastMsgRes.data as ChatMessage | null,
          unreadCount: unreadRes.count ?? 0,
        }
      })
    )

    // Sort by last message time (most recent first)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-4">
        <h1 className="text-lg font-bold text-white">Match Chats</h1>
        <p className="text-xs text-slate-500 mt-0.5">Coordinate with your opponents</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-800/60 flex items-center justify-center mb-4">
            <MessageCircle className="h-7 w-7 text-slate-500" />
          </div>
          <p className="text-slate-400 font-medium">No chats yet</p>
          <p className="text-slate-500 text-sm mt-1">
            Chat rooms open when a challenge is accepted.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-800/50">
          {items.map(({ chat, lastMessage, unreadCount }) => {
            const challenge = chat.challenge
            const teamA = challenge?.challenging_team?.name ?? '—'
            const teamB = challenge?.challenged_team?.name ?? '—'
            const code = challenge?.challenge_code ?? ''
            const timeAgo = lastMessage
              ? formatDistanceToNow(new Date(lastMessage.created_at), { addSuffix: true })
              : null
            const senderName = (lastMessage?.sender as { id: string; name: string } | null)?.name
            const isOwn = lastMessage?.sender_id === userId

            return (
              <li key={chat.id}>
                <Link
                  href={`/chat/${chat.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-800/40 transition-colors"
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0 w-11 h-11 rounded-full bg-emerald-500/15 flex items-center justify-center">
                    <MessageCircle className="h-5 w-5 text-emerald-400" />
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white truncate">
                        {teamA} vs {teamB}
                      </p>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {timeAgo && (
                          <span className="text-xs text-slate-500">{timeAgo}</span>
                        )}
                        {unreadCount > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="text-xs text-slate-500 truncate">
                        {lastMessage
                          ? <>{isOwn ? 'You' : senderName}: {lastMessage.content}</>
                          : <span className="italic">No messages yet</span>
                        }
                      </p>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{code}</p>
                  </div>

                  <ChevronRight className="flex-shrink-0 h-4 w-4 text-slate-600" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
