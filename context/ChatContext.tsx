'use client'

/**
 * context/ChatContext.tsx
 *
 * Tracks the total unread message count across all of the current user's chats.
 * Subscribes to Supabase Realtime on `chat_messages` so the badge stays live.
 *
 * Usage:
 *   // Wrap app/(player)/layout.tsx:
 *   <ChatProvider userId={userId}><...></ChatProvider>
 *
 *   // In any component:
 *   const { totalUnread } = useChat()
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface ChatContextValue {
  totalUnread: number
  /** Force re-fetch (call after marking messages read) */
  refresh: () => void
}

const ChatContext = createContext<ChatContextValue>({
  totalUnread: 0,
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
  const channelRef = useRef<RealtimeChannel | null>(null)

  const fetchUnread = useCallback(async () => {
    if (!userId) return

    // 1. Get all chats this player is in
    const { data: chats } = await supabase
      .from('challenge_chats')
      .select('id')
      .contains('allowed_player_ids', [userId])

    if (!chats?.length) {
      setTotalUnread(0)
      return
    }

    const chatIds = chats.map((c: { id: string }) => c.id)

    // 2. Count messages in those chats that were NOT sent by this user
    //    AND do NOT have this user's id in read_by
    const { count } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .in('chat_id', chatIds)
      .neq('sender_id', userId)
      .not('read_by', 'cs', `{${userId}}`)

    setTotalUnread(count ?? 0)
  }, [supabase, userId])

  useEffect(() => {
    if (!userId) return

    fetchUnread()

    // Subscribe to new messages on all chats — re-fetch count on any insert
    const channel = supabase
      .channel(`chat-unread-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => { fetchUnread() }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        () => { fetchUnread() }
      )
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
    <ChatContext.Provider value={{ totalUnread, refresh: fetchUnread }}>
      {children}
    </ChatContext.Provider>
  )
}
