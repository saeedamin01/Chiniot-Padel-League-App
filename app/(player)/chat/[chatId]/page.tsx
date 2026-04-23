'use client'

import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  FormEvent,
} from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useChat } from '@/context/ChatContext'
import {
  ArrowLeft,
  Loader2,
  Send,
  MessageCircle,
  Calendar,
  Clock,
  MapPin,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import type { ChatMessage, ChallengeChat, ChallengeStatus } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { format, isToday, isYesterday } from 'date-fns'

// ─── Match info types ─────────────────────────────────────────────────────────

interface MatchInfo {
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (isToday(d))     return format(d, 'h:mm a')
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`
  return format(d, 'd MMM, h:mm a')
}

function dateSeparatorLabel(iso: string): string {
  const d = new Date(iso)
  if (isToday(d))     return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'd MMMM yyyy')
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatThreadPage() {
  const params     = useParams()
  const router     = useRouter()
  const chatId     = params.chatId as string
  const supabase   = createClient()
  const { refresh: refreshUnread } = useChat()

  const [userId,    setUserId]    = useState<string | null>(null)
  const [chat,      setChat]      = useState<ChallengeChat | null>(null)
  const [messages,  setMessages]  = useState<ChatMessage[]>([])
  const [loading,   setLoading]   = useState(true)
  const [sending,   setSending]   = useState(false)
  const [content,   setContent]   = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null)
  const [infoOpen,  setInfoOpen]  = useState(false)

  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  // ── Mark messages as read ─────────────────────────────────────────────────
  const markRead = useCallback(async () => {
    await supabase.rpc('mark_chat_messages_read', { p_chat_id: chatId })
    refreshUnread()
  }, [supabase, chatId, refreshUnread])

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      // Fetch chat metadata + full challenge scheduling info
      const { data: chatData, error: chatErr } = await supabase
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
            accept_deadline,
            match_deadline,
            confirmed_time,
            confirmation_deadline,
            slot_1, slot_2, slot_3,
            match_location,
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

      // Extract match info
      const ch = chatData.challenge as any
      if (ch) {
        const venueRaw = Array.isArray(ch.venue) ? ch.venue[0] : ch.venue
        setMatchInfo({
          status:                ch.status ?? null,
          accept_deadline:       ch.accept_deadline ?? null,
          match_deadline:        ch.match_deadline ?? null,
          confirmed_time:        ch.confirmed_time ?? null,
          confirmation_deadline: ch.confirmation_deadline ?? null,
          slot_1:                ch.slot_1 ?? null,
          slot_2:                ch.slot_2 ?? null,
          slot_3:                ch.slot_3 ?? null,
          match_location:        ch.match_location ?? null,
          venue_name:            venueRaw?.name ?? null,
          venue_address:         venueRaw?.address ?? null,
        })
      }

      // Fetch messages
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select(`
          id, chat_id, sender_id, content, read_by, created_at,
          sender:players!chat_messages_sender_id_fkey ( id, name, avatar_url )
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })

      setMessages((msgs ?? []) as unknown as ChatMessage[])
      setLoading(false)

      // Mark all as read
      await supabase.rpc('mark_chat_messages_read', { p_chat_id: chatId })
      refreshUnread()
    }

    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  // ── Scroll on initial load ─────────────────────────────────────────────────
  useEffect(() => {
    if (!loading) scrollToBottom(false)
  }, [loading, scrollToBottom])

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || loading) return

    const channel = supabase
      .channel(`chat-thread-${chatId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'chat_messages',
          filter: `chat_id=eq.${chatId}`,
        },
        async (payload) => {
          // Fetch full message with sender info
          const { data: msg } = await supabase
            .from('chat_messages')
            .select(`
              id, chat_id, sender_id, content, read_by, created_at,
              sender:players!chat_messages_sender_id_fkey ( id, name, avatar_url )
            `)
            .eq('id', payload.new.id)
            .single()

          if (msg) {
            setMessages(prev => {
              // Deduplicate (optimistic + realtime could race)
              if (prev.some(m => m.id === msg.id)) return prev
              return [...prev, msg as unknown as ChatMessage]
            })
            scrollToBottom(true)

            // Mark read if incoming from someone else
            if (msg.sender_id !== userId) {
              await supabase.rpc('mark_chat_messages_read', { p_chat_id: chatId })
              refreshUnread()
            }
          }
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [chatId, userId, loading, supabase, scrollToBottom, refreshUnread])

  // ── Mark read when tab becomes active ─────────────────────────────────────
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

    setSending(true)
    setContent('')

    // Optimistic message
    const optimisticId = `opt-${Date.now()}`
    const optimistic: ChatMessage = {
      id:         optimisticId,
      chat_id:    chatId,
      sender_id:  userId!,
      content:    trimmed,
      read_by:    [userId!],
      created_at: new Date().toISOString(),
      sender: { id: userId!, name: 'You' },
    }
    setMessages(prev => [...prev, optimistic])
    scrollToBottom(true)

    try {
      const res = await fetch(`/api/chat/${chatId}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: trimmed }),
      })

      if (!res.ok) {
        // Roll back optimistic on error
        setMessages(prev => prev.filter(m => m.id !== optimisticId))
        setContent(trimmed)
        const err = await res.json()
        console.error('[Chat] send error', err)
      } else {
        const { message } = await res.json()
        // Replace optimistic with real message
        setMessages(prev =>
          prev.map(m => (m.id === optimisticId ? (message as ChatMessage) : m))
        )
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== optimisticId))
      setContent(trimmed)
      console.error('[Chat] network error', err)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // ── Auto-grow textarea ─────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── Match info bar ────────────────────────────────────────────────────────
  const fmtDt = (iso: string | null | undefined) => {
    if (!iso) return null
    const d = new Date(iso)
    return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  }
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return null
    return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }
  const isUrgent = (iso: string | null | undefined) => {
    if (!iso) return false
    return new Date(iso).getTime() - Date.now() < 24 * 3600 * 1000
  }

  const MatchInfoBar = () => {
    if (!matchInfo) return null
    const { status, accept_deadline, match_deadline, confirmed_time, confirmation_deadline, slot_1, slot_2, slot_3, venue_name, venue_address, match_location } = matchInfo

    const statusMeta: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
      pending:              { label: 'Pending Response', color: 'text-yellow-600 dark:text-yellow-400', icon: <Clock className="h-3.5 w-3.5" /> },
      accepted:             { label: 'Time Set', color: 'text-orange-600 dark:text-orange-400', icon: <Calendar className="h-3.5 w-3.5" /> },
      accepted_open:        { label: 'Time TBD', color: 'text-amber-600 dark:text-amber-400', icon: <Clock className="h-3.5 w-3.5" /> },
      time_pending_confirm: { label: 'Time Proposed', color: 'text-orange-600 dark:text-orange-400', icon: <Calendar className="h-3.5 w-3.5" /> },
      scheduled:            { label: 'Scheduled', color: 'text-emerald-600 dark:text-emerald-400', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
      played:               { label: 'Match Played', color: 'text-blue-600 dark:text-blue-400', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
      forfeited:            { label: 'Forfeited', color: 'text-red-600 dark:text-red-400', icon: <XCircle className="h-3.5 w-3.5" /> },
      dissolved:            { label: 'Dissolved', color: 'text-slate-500', icon: <XCircle className="h-3.5 w-3.5" /> },
    }
    const meta = statusMeta[status] ?? { label: status, color: 'text-slate-500', icon: <Clock className="h-3.5 w-3.5" /> }

    // Pick the single most important deadline to surface in the collapsed bar
    let primaryDeadline: { label: string; value: string | null } | null = null
    if (status === 'pending')              primaryDeadline = { label: 'Accept by', value: accept_deadline }
    else if (status === 'accepted')        primaryDeadline = { label: 'Confirm by', value: confirmation_deadline }
    else if (status === 'time_pending_confirm') primaryDeadline = { label: 'Confirm by', value: confirmation_deadline }
    else if (['accepted_open', 'scheduled'].includes(status)) primaryDeadline = { label: 'Play by', value: match_deadline }

    const slots = [slot_1, slot_2, slot_3].filter(Boolean) as string[]
    const locationLabel = venue_name ?? match_location ?? null

    return (
      <div className="border-b border-slate-200 dark:border-slate-800/60">
        {/* Collapsed summary row */}
        <button
          onClick={() => setInfoOpen(o => !o)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
        >
          <span className={`flex items-center gap-1 text-xs font-semibold ${meta.color}`}>
            {meta.icon}{meta.label}
          </span>
          {primaryDeadline?.value && (
            <span className={`text-xs ml-1 ${isUrgent(primaryDeadline.value) ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
              · {primaryDeadline.label}: {fmtDate(primaryDeadline.value)}
              {isUrgent(primaryDeadline.value) && ' ⚠️'}
            </span>
          )}
          {confirmed_time && ['scheduled', 'accepted', 'time_pending_confirm'].includes(status) && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">· 📅 {fmtDt(confirmed_time)}</span>
          )}
          <span className="ml-auto text-slate-400 dark:text-slate-500 shrink-0">
            {infoOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>

        {/* Expanded details */}
        {infoOpen && (
          <div className="px-4 pb-3 pt-0.5 space-y-2 bg-slate-50 dark:bg-slate-900/40">

            {/* Match time */}
            {confirmed_time && (
              <div className="flex items-start gap-2">
                <Calendar className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">Match Time</p>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{fmtDt(confirmed_time)}</p>
                </div>
              </div>
            )}

            {/* Venue / location */}
            {locationLabel && (
              <div className="flex items-start gap-2">
                <MapPin className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">Venue</p>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{locationLabel}</p>
                  {venue_address && <p className="text-[11px] text-slate-500 dark:text-slate-400">{venue_address}</p>}
                </div>
              </div>
            )}

            {/* Proposed slots (pending only) */}
            {status === 'pending' && slots.length > 0 && (
              <div className="flex items-start gap-2">
                <Clock className="h-3.5 w-3.5 text-yellow-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide mb-1">Proposed Slots</p>
                  {slots.map((s, i) => (
                    <p key={s} className="text-xs text-slate-700 dark:text-slate-300">
                      <span className="text-slate-400 text-[10px] mr-1">Slot {i + 1}</span>{fmtDt(s)}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Deadlines */}
            <div className="flex items-start gap-2">
              <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isUrgent(match_deadline) ? 'text-red-500' : 'text-slate-400 dark:text-slate-500'}`} />
              <div className="space-y-0.5">
                {accept_deadline && status === 'pending' && (
                  <p className={`text-xs ${isUrgent(accept_deadline) ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-400'}`}>
                    Accept by: {fmtDt(accept_deadline)}
                  </p>
                )}
                {confirmation_deadline && ['accepted', 'time_pending_confirm'].includes(status) && (
                  <p className={`text-xs ${isUrgent(confirmation_deadline) ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-400'}`}>
                    Confirm by: {fmtDt(confirmation_deadline)}
                  </p>
                )}
                {match_deadline && !['played', 'forfeited', 'dissolved', 'scheduled'].includes(status) && (
                  <p className={`text-xs ${isUrgent(match_deadline) ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-400'}`}>
                    Play by: {fmtDt(match_deadline)}
                  </p>
                )}
              </div>
            </div>

            {/* Link to full challenge */}
            <Link
              href={`/challenges/${chat!.challenge_id}`}
              className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium mt-0.5"
            >
              View full challenge details →
            </Link>
          </div>
        )}
      </div>
    )
  }

  // ── Read-receipt tick component ───────────────────────────────────────────
  // allPlayerIds = everyone who should be in the chat (from chat.allowed_player_ids)
  const allPlayerIds = (chat?.allowed_player_ids ?? []) as string[]

  const ReadTick = ({ msg }: { msg: ChatMessage }) => {
    const readBy = (msg.read_by ?? []) as string[]
    const isOptimistic = msg.id.startsWith('opt-')
    const otherPlayerIds = allPlayerIds.filter(id => id !== userId)
    const allRead = otherPlayerIds.length > 0 && otherPlayerIds.every(id => readBy.includes(id))

    if (isOptimistic) {
      // Single grey tick — still sending
      return (
        <svg className="inline h-3 w-3 text-slate-400 dark:text-slate-500" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.5 4.5L6.5 11.5L3 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      )
    }

    if (allRead) {
      // Double teal/green tick — everyone read
      return (
        <span className="inline-flex">
          <svg className="h-3 w-4 text-emerald-500" viewBox="0 0 20 16" fill="none">
            <path d="M1 8L5.5 12.5L14 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 8L10.5 12.5L19 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      )
    }

    // Double grey tick — sent but not all read
    return (
      <span className="inline-flex">
        <svg className="h-3 w-4 text-slate-400 dark:text-slate-500" viewBox="0 0 20 16" fill="none">
          <path d="M1 8L5.5 12.5L14 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6 8L10.5 12.5L19 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  if (forbidden || !chat) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col items-center justify-center px-6 text-center gap-4">
        <MessageCircle className="h-10 w-10 text-slate-300 dark:text-slate-600" />
        <p className="text-slate-500 dark:text-slate-400 font-medium">Chat not found</p>
        <Link href="/chat" className="text-sm text-emerald-500 hover:underline">
          ← Back to chats
        </Link>
      </div>
    )
  }

  const challenge = chat.challenge
  const teamA = challenge?.challenging_team?.name ?? '—'
  const teamB = challenge?.challenged_team?.name ?? '—'
  const code  = challenge?.challenge_code ?? ''
  const challengeId = challenge?.id ?? ''

  // Group messages with date separators
  interface MsgGroup {
    date:     string  // YYYY-MM-DD for grouping
    messages: ChatMessage[]
  }
  const groups: MsgGroup[] = []
  for (const msg of messages) {
    const day = msg.created_at.slice(0, 10)
    const last = groups[groups.length - 1]
    if (!last || last.date !== day) {
      groups.push({ date: day, messages: [msg] })
    } else {
      last.messages.push(msg)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-950">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800/60 px-4 py-3 flex items-center gap-3">
        <Link
          href="/chat"
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-slate-500 dark:text-slate-400" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{teamA} vs {teamB}</p>
          <Link
            href={`/challenges/${challengeId}`}
            className="text-xs text-slate-400 dark:text-slate-500 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors"
          >
            {code}
          </Link>
        </div>
      </div>

      {/* ── Match info bar ── */}
      <MatchInfoBar />

      {/* ── Message list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageCircle className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-slate-400 dark:text-slate-500 text-sm">No messages yet.</p>
            <p className="text-slate-300 dark:text-slate-600 text-xs mt-1">Say hi to kick things off!</p>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium px-2">
                {dateSeparatorLabel(group.messages[0].created_at)}
              </span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            </div>

            {group.messages.map((msg, idx) => {
              const isOwn = msg.sender_id === userId
              const sender = msg.sender as { id: string; name: string; avatar_url?: string | null } | null
              const senderName = sender?.name ?? 'Unknown'

              // Show name only for the first in a run from the same sender
              const prevMsg = idx > 0 ? group.messages[idx - 1] : null
              const showName = !isOwn && msg.sender_id !== prevMsg?.sender_id

              return (
                <div
                  key={msg.id}
                  className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-0.5`}
                >
                  <div className={`max-w-[78%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                    {showName && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 ml-1 mb-0.5">{senderName}</p>
                    )}
                    <div
                      className={`
                        px-3 py-2 rounded-2xl text-sm leading-relaxed
                        ${isOwn
                          ? 'bg-emerald-500 dark:bg-emerald-600 text-white rounded-br-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-sm'
                        }
                        ${msg.id.startsWith('opt-') ? 'opacity-70' : 'opacity-100'}
                      `}
                    >
                      {msg.content}
                    </div>
                    <div className={`flex items-center gap-1 mt-0.5 mx-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                      <p className="text-[10px] text-slate-400 dark:text-slate-600">
                        {formatTimestamp(msg.created_at)}
                      </p>
                      {isOwn && <ReadTick msg={msg} />}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar (or closed notice) ── */}
      {matchInfo && ['played', 'forfeited', 'dissolved'].includes(matchInfo.status) ? (
        <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-center gap-2">
          {matchInfo.status === 'played'    && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
          {matchInfo.status === 'forfeited' && <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
          {matchInfo.status === 'dissolved' && <XCircle className="h-4 w-4 text-slate-400 shrink-0" />}
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
            {matchInfo.status === 'played'
              ? 'Match is over — this chat is now read-only'
              : matchInfo.status === 'forfeited'
              ? 'Challenge forfeited — this chat is closed'
              : 'Challenge dissolved — this chat is closed'}
          </p>
        </div>
      ) : (
        <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950 px-3 py-3 pb-safe">
          <form onSubmit={handleSend} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              maxLength={2000}
              disabled={sending}
              className="
                flex-1 resize-none
                bg-white dark:bg-slate-800/70
                border border-slate-300 dark:border-slate-700/60
                rounded-2xl px-4 py-2.5
                text-sm text-slate-900 dark:text-white
                placeholder-slate-400 dark:placeholder-slate-500
                focus:outline-none focus:border-emerald-500/70 dark:focus:border-emerald-500/50
                focus:ring-1 focus:ring-emerald-500/30
                transition-colors max-h-32 overflow-y-auto
                disabled:opacity-60 shadow-sm
              "
              style={{ minHeight: '42px' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`
              }}
            />
            <button
              type="submit"
              disabled={!content.trim() || sending}
              className="
                flex-shrink-0 w-10 h-10 rounded-full bg-emerald-500 hover:bg-emerald-600
                disabled:opacity-40 disabled:cursor-not-allowed
                flex items-center justify-center transition-colors shadow-sm
              "
            >
              {sending
                ? <Loader2 className="h-4 w-4 text-white animate-spin" />
                : <Send className="h-4 w-4 text-white" />
              }
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
