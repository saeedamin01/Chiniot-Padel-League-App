'use client'

import React, {
  useEffect, useState, useRef, useCallback, FormEvent, TouchEvent,
} from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useChat } from '@/context/ChatContext'
import {
  ArrowLeft, Loader2, Send, X, Reply,
  Calendar, Clock, MapPin, Info,
} from 'lucide-react'
import type { ChatMessage, ChallengeChat, ChallengeStatus } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { format, isToday, isYesterday } from 'date-fns'

// ─── Constants ────────────────────────────────────────────────────────────────

const REACTIONS = ['👍', '❤️', '😂', '😮', '🎉']

// ─── Types ────────────────────────────────────────────────────────────────────

interface MatchInfo {
  challengeId: string
  challengeCode: string
  status: ChallengeStatus
  accept_deadline: string | null
  match_deadline: string | null
  confirmed_time: string | null
  confirmation_deadline: string | null
  slot_1: string | null
  slot_2: string | null
  slot_3: string | null
  match_location: string | null
  venue_name: string | null
  venue_address: string | null
  challenging_team_name: string | null
  challenged_team_name: string | null
  challenging_team_id: string | null
  challenged_team_id: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msgTime(iso: string) {
  return format(new Date(iso), 'h:mm a')
}

function dateSeparatorLabel(iso: string) {
  const d = new Date(iso)
  if (isToday(d))     return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'd MMMM yyyy')
}

function fmtDt(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function statusLabel(s: ChallengeStatus) {
  const map: Partial<Record<ChallengeStatus, string>> = {
    pending: 'Pending acceptance',
    accepted: 'Accepted — confirming time',
    accepted_open: 'Accepted — entering time',
    time_pending_confirm: 'Time proposed — awaiting confirmation',
    revision_proposed: 'Revision proposed',
    reschedule_requested: 'Reschedule requested',
    reschedule_pending_admin: 'Reschedule with admin',
    scheduled: 'Scheduled',
    result_pending: 'Awaiting result verification',
    played: 'Match completed',
    forfeited: 'Forfeited',
    dissolved: 'Dissolved',
  }
  return map[s] ?? s
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs'
  return (
    <div className={`${sz} rounded-full bg-emerald-600 flex items-center justify-center text-white font-semibold shrink-0`}>
      {initials(name)}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChatThreadPage() {
  const params   = useParams()
  const router   = useRouter()
  const chatId   = params.chatId as string
  const supabase = createClient()
  const { refresh: refreshUnread } = useChat()

  const [userId,     setUserId]     = useState<string | null>(null)
  const [chat,       setChat]       = useState<ChallengeChat | null>(null)
  const [messages,   setMessages]   = useState<ChatMessage[]>([])
  const [loading,    setLoading]    = useState(true)
  const [sending,    setSending]    = useState(false)
  const [content,    setContent]    = useState('')
  const [forbidden,  setForbidden]  = useState(false)
  const [matchInfo,  setMatchInfo]  = useState<MatchInfo | null>(null)
  const [activeTab,  setActiveTab]  = useState<'chat' | 'details'>('chat')

  // Reply state
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)

  // Reaction picker: messageId whose picker is open
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)

  // Player name map for "Seen by" display
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({})

  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Swipe-to-reply tracking
  const swipeStartX   = useRef<number>(0)
  const swipeStartY   = useRef<number>(0)
  const swipingMsg    = useRef<string | null>(null)
  const swipeTriggered = useRef(false)
  const [swipeOffset, setSwipeOffset] = useState<Record<string, number>>({})

  // Long-press tracking
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Scroll helpers ─────────────────────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  // ── Mark read ──────────────────────────────────────────────────────────────
  const markRead = useCallback(async () => {
    await supabase.rpc('mark_chat_messages_read', { p_chat_id: chatId })
    refreshUnread()
  }, [supabase, chatId, refreshUnread])

  // ── Load chat + messages ───────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const { data: chatData, error: chatErr } = await supabase
        .from('challenge_chats')
        .select(`
          id, challenge_id, allowed_player_ids, last_email_sent_at, created_at,
          challenge:challenges (
            id, challenge_code, status,
            accept_deadline, match_deadline, confirmed_time, confirmation_deadline,
            slot_1, slot_2, slot_3, match_location,
            challenging_team_id, challenged_team_id,
            challenging_team:teams!challenges_challenging_team_id_fkey ( id, name ),
            challenged_team:teams!challenges_challenged_team_id_fkey ( id, name ),
            venue:venues!challenges_venue_id_fkey ( id, name, address )
          )
        `)
        .eq('id', chatId)
        .single()

      if (chatErr || !chatData) { setLoading(false); return }
      if (!(chatData.allowed_player_ids as string[]).includes(user.id)) {
        setForbidden(true); setLoading(false); return
      }

      setChat(chatData as unknown as ChallengeChat)

      const ch = chatData.challenge as any
      if (ch) {
        const venueRaw = Array.isArray(ch.venue) ? ch.venue[0] : ch.venue
        const cTeam = Array.isArray(ch.challenging_team) ? ch.challenging_team[0] : ch.challenging_team
        const dTeam = Array.isArray(ch.challenged_team)  ? ch.challenged_team[0]  : ch.challenged_team
        setMatchInfo({
          challengeId:            ch.id,
          challengeCode:          ch.challenge_code ?? '',
          status:                 ch.status,
          accept_deadline:        ch.accept_deadline ?? null,
          match_deadline:         ch.match_deadline ?? null,
          confirmed_time:         ch.confirmed_time ?? null,
          confirmation_deadline:  ch.confirmation_deadline ?? null,
          slot_1:                 ch.slot_1 ?? null,
          slot_2:                 ch.slot_2 ?? null,
          slot_3:                 ch.slot_3 ?? null,
          match_location:         ch.match_location ?? null,
          venue_name:             venueRaw?.name ?? null,
          venue_address:          venueRaw?.address ?? null,
          challenging_team_name:  cTeam?.name ?? null,
          challenged_team_name:   dTeam?.name ?? null,
          challenging_team_id:    ch.challenging_team_id ?? null,
          challenged_team_id:     ch.challenged_team_id ?? null,
        })
      }

      // Fetch messages with reply-to content
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select(`
          id, chat_id, sender_id, content, read_by, reactions,
          reply_to_message_id, created_at,
          sender:players!chat_messages_sender_id_fkey ( id, name, avatar_url )
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })

      const msgsArr = (msgs ?? []) as unknown as ChatMessage[]

      // Build a lookup of message content for reply previews
      const msgMap: Record<string, ChatMessage> = {}
      for (const m of msgsArr) msgMap[m.id] = m

      // Attach reply_to inline
      const enriched = msgsArr.map(m => {
        if (!m.reply_to_message_id) return m
        const parent = msgMap[m.reply_to_message_id]
        return { ...m, reply_to: parent ? { id: parent.id, content: parent.content, sender: parent.sender ?? null } : null }
      })

      setMessages(enriched)
      setLoading(false)

      // Build player name map for "Seen by" — use admin client via API route isn't
      // available here, so we fetch via the user's session (RLS allows reading players)
      const playerIds = chatData.allowed_player_ids as string[]
      const { data: players } = await supabase
        .from('players')
        .select('id, name')
        .in('id', playerIds)

      const map: Record<string, string> = {}
      if (players) {
        for (const p of players) map[p.id] = p.name.split(' ')[0]
      }
      // Always include current user in the map
      map[user.id] = 'You'
      setPlayerNames(map)

      // Mark read and then refresh messages so read_by reflects current state
      await supabase.rpc('mark_chat_messages_read', { p_chat_id: chatId })
      refreshUnread()

      // Re-fetch messages so read_by includes the current user
      const { data: freshMsgs } = await supabase
        .from('chat_messages')
        .select(`
          id, chat_id, sender_id, content, read_by, reactions,
          reply_to_message_id, created_at,
          sender:players!chat_messages_sender_id_fkey ( id, name, avatar_url )
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })

      if (freshMsgs) {
        const freshArr = freshMsgs as unknown as ChatMessage[]
        const freshMap: Record<string, ChatMessage> = {}
        for (const m of freshArr) freshMap[m.id] = m
        setMessages(freshArr.map(m => {
          if (!m.reply_to_message_id) return m
          const parent = freshMap[m.reply_to_message_id]
          return { ...m, reply_to: parent ? { id: parent.id, content: parent.content, sender: parent.sender ?? null } : null }
        }))
      }
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  useEffect(() => {
    if (!loading) scrollToBottom(false)
  }, [loading, scrollToBottom])

  // ── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || loading) return

    const channel = supabase
      .channel(`chat-thread-${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `chat_id=eq.${chatId}`,
      }, async (payload) => {
        const { data: msg } = await supabase
          .from('chat_messages')
          .select(`
            id, chat_id, sender_id, content, read_by, reactions,
            reply_to_message_id, created_at,
            sender:players!chat_messages_sender_id_fkey ( id, name, avatar_url )
          `)
          .eq('id', payload.new.id)
          .single()

        if (msg) {
          const typedMsg = msg as unknown as ChatMessage
          setMessages(prev => {
            if (prev.some(m => m.id === typedMsg.id)) return prev
            // Attach reply_to if needed
            let enriched = typedMsg
            if (typedMsg.reply_to_message_id) {
              const parent = prev.find(m => m.id === typedMsg.reply_to_message_id)
              if (parent) enriched = { ...typedMsg, reply_to: { id: parent.id, content: parent.content, sender: parent.sender ?? null } }
            }
            return [...prev, enriched]
          })
          scrollToBottom(true)
          if (msg.sender_id !== userId) {
            await supabase.rpc('mark_chat_messages_read', { p_chat_id: chatId })
            refreshUnread()
          }
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chat_messages',
        filter: `chat_id=eq.${chatId}`,
      }, (payload) => {
        // Update reactions and read_by in place
        setMessages(prev => prev.map(m =>
          m.id === payload.new.id
            ? { ...m, reactions: payload.new.reactions, read_by: payload.new.read_by }
            : m
        ))
      })
      .subscribe()

    channelRef.current = channel
    return () => {
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null }
    }
  }, [chatId, userId, loading, supabase, scrollToBottom, refreshUnread])

  useEffect(() => {
    const handleFocus = () => markRead()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [markRead])

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault()
    const trimmed = content.trim()
    if (!trimmed || sending) return

    const replyingTo = replyTo
    setSending(true)
    setContent('')
    setReplyTo(null)

    const optimisticId = `opt-${Date.now()}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      chat_id: chatId,
      sender_id: userId!,
      content: trimmed,
      read_by: [userId!],
      reactions: {},
      reply_to_message_id: replyingTo?.id ?? null,
      reply_to: replyingTo ? { id: replyingTo.id, content: replyingTo.content, sender: replyingTo.sender ?? null } : null,
      created_at: new Date().toISOString(),
      sender: { id: userId!, name: 'You' },
    }
    setMessages(prev => [...prev, optimistic])
    scrollToBottom(true)

    try {
      const body: Record<string, string> = { content: trimmed }
      if (replyingTo) body.reply_to_message_id = replyingTo.id

      const res = await fetch(`/api/chat/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== optimisticId))
        setContent(trimmed)
        setReplyTo(replyingTo)
      } else {
        const { message } = await res.json()
        setMessages(prev => prev.map(m => m.id === optimisticId ? (message as ChatMessage) : m))
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimisticId))
      setContent(trimmed)
      setReplyTo(replyingTo)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // ── React to message ───────────────────────────────────────────────────────
  const handleReact = async (messageId: string, emoji: string) => {
    setReactionPickerFor(null)
    // Optimistic update
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m
      const r: Record<string, string[]> = { ...(m.reactions ?? {}) }
      const existing = r[emoji] ?? []
      if (existing.includes(userId!)) {
        r[emoji] = existing.filter(id => id !== userId!)
        if (r[emoji].length === 0) delete r[emoji]
      } else {
        r[emoji] = [...existing, userId!]
      }
      return { ...m, reactions: r }
    }))

    await fetch(`/api/chat/${chatId}/messages/${messageId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    })
  }

  // ── Touch handlers for swipe-to-reply ─────────────────────────────────────
  const onTouchStart = (e: TouchEvent<HTMLDivElement>, msgId: string) => {
    swipeStartX.current   = e.touches[0].clientX
    swipeStartY.current   = e.touches[0].clientY
    swipingMsg.current    = msgId
    swipeTriggered.current = false

    // Long-press → reaction picker
    longPressTimer.current = setTimeout(() => {
      setReactionPickerFor(msgId)
      swipingMsg.current = null
    }, 500)
  }

  const onTouchMove = (e: TouchEvent<HTMLDivElement>, msgId: string) => {
    if (swipingMsg.current !== msgId) return
    const dx = e.touches[0].clientX - swipeStartX.current
    const dy = e.touches[0].clientY - swipeStartY.current

    // If mostly vertical, cancel swipe (let page scroll)
    if (Math.abs(dy) > Math.abs(dx) * 1.2) {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
      swipingMsg.current = null
      setSwipeOffset({})
      return
    }

    // Cancel long-press if user is swiping
    if (longPressTimer.current && Math.abs(dx) > 5) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }

    // Right swipe only, up to 60px
    if (dx > 0 && dx < 80) {
      e.preventDefault()
      setSwipeOffset(prev => ({ ...prev, [msgId]: dx }))
      if (dx > 50 && !swipeTriggered.current) {
        swipeTriggered.current = true
        const msg = messages.find(m => m.id === msgId)
        if (msg) setReplyTo(msg)
        // Haptic if supported
        if ('vibrate' in navigator) navigator.vibrate(30)
      }
    }
  }

  const onTouchEnd = (msgId: string) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
    setSwipeOffset(prev => {
      const next = { ...prev }
      delete next[msgId]
      return next
    })
    swipingMsg.current = null
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') setReplyTo(null)
  }

  // ── "Seen by" logic ────────────────────────────────────────────────────────
  // For a sent message, show who has read it (excluding the sender)
  const seenBy = (msg: ChatMessage): string[] => {
    if (msg.sender_id !== userId) return []
    return (msg.read_by ?? []).filter(id => id !== userId).map(id => playerNames[id]).filter(Boolean)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (forbidden) return (
    <div className="flex flex-col items-center justify-center h-screen gap-3">
      <p className="text-slate-400">You don't have access to this chat.</p>
      <button onClick={() => router.back()} className="text-emerald-500 text-sm">← Go back</button>
    </div>
  )

  const challengeRef = matchInfo ? `/challenges/${matchInfo.challengeId}` : '#'
  const allPlayerIds = (chat?.allowed_player_ids as string[] | undefined) ?? []
  const isClosed = matchInfo ? ['played', 'forfeited', 'dissolved'].includes(matchInfo.status) : false

  return (
    // Fixed positioning escapes pwa-main padding so the chat fills exactly the
    // space between the sticky navbar and the fixed bottom nav.
    <div
      className="fixed left-0 right-0 flex flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden"
      style={{
        top:    'calc(3.5rem + env(safe-area-inset-top, 0px))',
        bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
      }}
    >

      {/* ── Fixed header ── */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/50 z-10">
        {/* Top row */}
        <div className="flex items-center gap-3 px-3 py-2.5 pwa-header-inner">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </button>

          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="h-4 w-40 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            ) : (
              <>
                <p className="font-semibold text-sm text-slate-900 dark:text-white truncate leading-tight">
                  {matchInfo?.challenging_team_name ?? '…'} vs {matchInfo?.challenged_team_name ?? '…'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                  {matchInfo?.challengeCode} · {matchInfo ? statusLabel(matchInfo.status) : ''}
                </p>
              </>
            )}
          </div>

          <button
            onClick={() => setActiveTab(t => t === 'details' ? 'chat' : 'details')}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors shrink-0 ${
              activeTab === 'details'
                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            <Info className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-slate-100 dark:border-slate-700/30">
          {(['chat', 'details'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-semibold capitalize transition-colors border-b-2 ${
                activeTab === tab
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {tab === 'chat' ? 'Chat' : 'Match Info'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Details tab ── */}
      {activeTab === 'details' && matchInfo && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/50">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Challenge</p>
              <p className="font-bold text-lg text-slate-900 dark:text-white mt-0.5">{matchInfo.challengeCode}</p>
              <span className="inline-block mt-1 text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 font-medium">
                {statusLabel(matchInfo.status)}
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700/30">
              {/* Teams */}
              <div className="px-4 py-3">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Teams</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-center">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{matchInfo.challenging_team_name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Challenger</p>
                  </div>
                  <div className="text-slate-400 font-bold text-sm">vs</div>
                  <div className="flex-1 text-center">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{matchInfo.challenged_team_name}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Challenged</p>
                  </div>
                </div>
              </div>

              {/* Match time */}
              {matchInfo.confirmed_time && (
                <div className="px-4 py-3 flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Match time</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">{fmtDt(matchInfo.confirmed_time)}</p>
                  </div>
                </div>
              )}

              {/* Proposed slots */}
              {!matchInfo.confirmed_time && (matchInfo.slot_1 || matchInfo.slot_2 || matchInfo.slot_3) && (
                <div className="px-4 py-3">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Proposed slots</p>
                  <div className="space-y-1.5">
                    {[matchInfo.slot_1, matchInfo.slot_2, matchInfo.slot_3].filter(Boolean).map((slot, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="text-slate-700 dark:text-slate-300">{fmtDt(slot)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Venue / location */}
              {(matchInfo.venue_name || matchInfo.match_location) && (
                <div className="px-4 py-3 flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Venue</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                      {matchInfo.venue_name ?? matchInfo.match_location}
                    </p>
                    {matchInfo.venue_address && (
                      <p className="text-xs text-slate-400 mt-0.5">{matchInfo.venue_address}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Deadlines */}
              {matchInfo.match_deadline && (
                <div className="px-4 py-3 flex items-start gap-3">
                  <Clock className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Match deadline</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{fmtDt(matchInfo.match_deadline)}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700/30">
              <a href={challengeRef} className="text-xs text-emerald-600 dark:text-emerald-400 font-medium hover:underline">
                View full challenge details →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Chat tab ── */}
      {activeTab === 'chat' && (
        <>
          {/* Message list */}
          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-0.5"
            style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            onClick={() => reactionPickerFor && setReactionPickerFor(null)}
          >
            {loading && (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            )}

            {!loading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <p className="text-slate-400 dark:text-slate-500 text-sm">No messages yet</p>
                <p className="text-slate-300 dark:text-slate-600 text-xs">Be the first to say something</p>
              </div>
            )}

            {messages.map((msg, idx) => {
              const isMine = msg.sender_id === userId
              const prevMsg = idx > 0 ? messages[idx - 1] : null
              const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null

              // Date separator
              const showDateSep = !prevMsg || dateSeparatorLabel(msg.created_at) !== dateSeparatorLabel(prevMsg.created_at)

              // Group consecutive messages from same sender (within 2 min)
              const isGrouped = !showDateSep && prevMsg?.sender_id === msg.sender_id &&
                new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 120_000
              const isLastInGroup = !nextMsg || nextMsg.sender_id !== msg.sender_id ||
                new Date(nextMsg.created_at).getTime() - new Date(msg.created_at).getTime() >= 120_000

              const seenNames = seenBy(msg)
              const reactions = msg.reactions ?? {}
              const hasReactions = Object.keys(reactions).length > 0
              const xOffset = swipeOffset[msg.id] ?? 0

              return (
                <div key={msg.id}>
                  {/* Date separator */}
                  {showDateSep && (
                    <div className="flex items-center justify-center py-3">
                      <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                        {dateSeparatorLabel(msg.created_at)}
                      </span>
                    </div>
                  )}

                  {/* Message row */}
                  <div
                    className={`flex items-end gap-1.5 ${isMine ? 'flex-row-reverse' : 'flex-row'} ${isGrouped ? 'mt-0.5' : 'mt-2'}`}
                    style={{ transform: `translateX(${isMine ? -xOffset : xOffset}px)`, transition: xOffset === 0 ? 'transform 0.2s ease' : 'none' }}
                    onTouchStart={e => onTouchStart(e, msg.id)}
                    onTouchMove={e => onTouchMove(e, msg.id)}
                    onTouchEnd={() => onTouchEnd(msg.id)}
                  >
                    {/* Avatar (received, last in group) */}
                    {!isMine && (
                      <div className="w-7 shrink-0 self-end mb-0.5">
                        {isLastInGroup ? (
                          <Avatar name={msg.sender?.name ?? '?'} />
                        ) : null}
                      </div>
                    )}

                    {/* Bubble + reactions + seen */}
                    <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>

                      {/* Sender name (received, first in group) */}
                      {!isMine && !isGrouped && (
                        <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 ml-1 mb-0.5">
                          {msg.sender?.name ?? '?'}
                        </p>
                      )}

                      {/* Bubble */}
                      <div
                        className={`relative rounded-2xl px-3 py-2 ${
                          isMine
                            ? 'bg-emerald-600 text-white rounded-br-sm'
                            : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700/50 rounded-bl-sm'
                        } ${!isLastInGroup ? (isMine ? 'rounded-br-2xl' : 'rounded-bl-2xl') : ''}`}
                        onDoubleClick={() => setReplyTo(msg)}
                      >
                        {/* Reply quote */}
                        {msg.reply_to && (
                          <div className={`text-[10px] rounded-lg px-2 py-1 mb-1.5 ${
                            isMine
                              ? 'bg-emerald-700/50 border-l-2 border-white/40'
                              : 'bg-slate-100 dark:bg-slate-700/50 border-l-2 border-emerald-500'
                          }`}>
                            <p className={`font-semibold mb-0.5 ${isMine ? 'text-white/80' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {msg.reply_to.sender?.id === userId ? 'You' : (msg.reply_to.sender?.name ?? '?')}
                            </p>
                            <p className={`truncate ${isMine ? 'text-white/70' : 'text-slate-500 dark:text-slate-400'}`}>
                              {msg.reply_to.content}
                            </p>
                          </div>
                        )}

                        {/* Message text */}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>

                        {/* Time */}
                        <p className={`text-[10px] mt-0.5 ${isMine ? 'text-white/60' : 'text-slate-400 dark:text-slate-500'} text-right`}>
                          {msgTime(msg.created_at)}
                        </p>
                      </div>

                      {/* Reactions */}
                      {hasReactions && (
                        <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                          {Object.entries(reactions).filter(([, ids]) => ids.length > 0).map(([emoji, ids]) => (
                            <button
                              key={emoji}
                              onClick={() => handleReact(msg.id, emoji)}
                              className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${
                                ids.includes(userId ?? '')
                                  ? 'bg-emerald-100 border-emerald-300 dark:bg-emerald-500/20 dark:border-emerald-500/40'
                                  : 'bg-white border-slate-200 dark:bg-slate-800 dark:border-slate-700/50 hover:bg-slate-50'
                              }`}
                            >
                              <span>{emoji}</span>
                              {ids.length > 1 && <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300">{ids.length}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Reaction picker */}
                      {reactionPickerFor === msg.id && (
                        <div className={`flex gap-1.5 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-full px-3 py-2 shadow-lg ${isMine ? 'self-end' : 'self-start'}`}>
                          {REACTIONS.map(emoji => (
                            <button key={emoji} onClick={() => handleReact(msg.id, emoji)} className="text-lg hover:scale-125 transition-transform active:scale-110">
                              {emoji}
                            </button>
                          ))}
                          <button onClick={() => setReactionPickerFor(null)} className="text-slate-400 hover:text-slate-600 ml-1">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Seen by */}
                      {isMine && seenNames.length > 0 && isLastInGroup && (
                        <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 mr-0.5">
                          Seen by {seenNames.join(', ')}
                        </p>
                      )}
                    </div>

                    {/* Swipe reply indicator */}
                    {xOffset > 20 && (
                      <div className={`self-center ${isMine ? 'mr-1' : 'ml-1'} text-emerald-500 opacity-${Math.min(100, Math.round(xOffset * 2))}`}>
                        <Reply className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} className="h-1" />
          </div>

          {/* ── Reply preview bar ── */}
          {replyTo && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700/50">
              <div className="flex-1 min-w-0 border-l-2 border-emerald-500 pl-2">
                <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {replyTo.sender_id === userId ? 'Replying to yourself' : `Replying to ${replyTo.sender?.name ?? '?'}`}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 truncate">{replyTo.content}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-slate-600 shrink-0 p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── Input bar / closed banner ── */}
          {isClosed ? (
            <div className="shrink-0 px-4 py-3 bg-slate-100 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700/50 text-center">
              <p className="text-xs text-slate-400 dark:text-slate-500">
                This conversation has ended · {matchInfo ? statusLabel(matchInfo.status) : ''}
              </p>
            </div>
          ) : (
            <div className="shrink-0 px-3 py-2.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700/50">
              <form onSubmit={handleSend} className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message…"
                  rows={1}
                  className="flex-1 resize-none rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 max-h-32 leading-snug"
                  style={{ scrollbarWidth: 'none' } as React.CSSProperties}
                />
                <button
                  type="submit"
                  disabled={!content.trim() || sending}
                  className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors shrink-0"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Send className="h-4 w-4 text-white" />}
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  )
}
