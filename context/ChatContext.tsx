'use client'

/**
 * context/ChatContext.tsx
 *
 * Tracks total unread count AND per-challenge-chat unread counts.
 * Subscribes to Supabase Realtime on chat_messages for live updates.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface ChatContextValue {
  totalUnread: number
  /** unreadByChallengeId[challengeId] = unread count for that challenge's chat */
  unreadByChallengeId: Record<string, number>
  /** Force re-fetch (call after marking messages read) */
  refresh: () => void
}

const ChatContext = createContext<ChatContextValue>({
  totalUnread: 0,
  unreadByChallengeId: {},
  refresh: () => {},
})

export function useChat(): ChatContextValue {
  return useContext(ChatContext)
}

export function ChatProvider({
  children,
  userId,
}: {
  children: React.ReactNode
  userId: string
}) {
  const supabase = createClient()
  const [totalUnread, setTotalUnread] = useState(0)
  const [unreadByChallengeId, setUnreadByChallengeId] = useState<Record<string, number>>({})
  const channelRef = useRef<RealtimeChannel | null>(null)

  const fetchUnread = useCallback(async () => {
    if (!userId) return

    // 1. Get all chats this player is in (with challenge_id)
    const { data: chats } = await supabase
      .from('challenge_chats')
      .select('id, challenge_id')
      .contains('allowed_player_ids', [userId])

    if (!chats?.length) {
      setTotalUnread(0)
      setUnreadByChallengeId({})
      return
    }

    const chatIds = chats.map((c: { id: string }) => c.id)

    // 2. Fetch all unread messages (not sent by user, not read by user)
    const { data: unreadMessages } = await supabase
      .from('chat_messages')
      .select('id, chat_id')
      .in('chat_id', chatIds)
      .neq('sender_id', userId)
      .not('read_by', 'cs', `{${userId}}`)

    const total = unreadMessages?.length ?? 0
    setTotalUnread(total)

    // 3. Build per-challenge map
    const chatToChallenge: Record<string, string> = {}
    for (const c of chats) {
      chatToChallenge[c.id] = c.challenge_id
    }

    const byChallengeId: Record<string, number> = {}
    for (const msg of (unreadMessages ?? [])) {
      const challengeId = chatToChallenge[msg.chat_id]
      if (challengeId) {
        byChallengeId[challengeId] = (byChallengeId[challengeId] ?? 0) + 1
      }
    }
    setUnreadByChallengeId(byChallengeId)

  }, [supabase, userId])

  useEffect(() => {
    if (!userId) return

    fetchUnread()

    const channel = supabase
      .channel(`chat-unread-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => fetchUnread())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, () => fetchUnread())
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [userId, fetchUnread, supabase])

  return (
    <ChatContext.Provider value={{ totalUnread, unreadByChallengeId, refresh: fetchUnread }}>
      {children}
    </ChatContext.Provider>
  )
}
