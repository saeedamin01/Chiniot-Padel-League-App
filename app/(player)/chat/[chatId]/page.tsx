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
} from 'lucide-react'
import type { ChatMessage, ChallengeChat } from '@/types'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { format, isToday, isYesterday } from 'date-fns'

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

  const [userId,   setUserId]   = useState<string | null>(null)
  const [chat,     setChat]     = useState<ChallengeChat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading,  setLoading]  = useState(true)
  const [sending,  setSending]  = useState(false)
  const [content,  setContent]  = useState('')
  const [forbidden, setForbidden] = useState(false)

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

      // Fetch chat metadata
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
            challenging_team:teams!challenges_challenging_team_id_fkey ( id, name ),
            challenged_team:teams!challenges_challenged_team_id_fkey ( id, name )
          )
        `)
        .eq('id', chatId)
        .single()

      if (chatErr || !chatData) { setLoading(false); return }
      if (!(chatData.allowed_player_ids as string[]).includes(user.id)) {
        setForbidden(true); setLoading(false); return
      }

      setChat(chatData as unknown as ChallengeChat)

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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  if (forbidden || !chat) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-6 text-center gap-4">
        <MessageCircle className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400 font-medium">Chat not found</p>
        <Link href="/chat" className="text-sm text-emerald-400 hover:underline">
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
    <div className="flex flex-col h-screen bg-slate-950">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800/60 px-4 py-3 flex items-center gap-3">
        <Link
          href="/chat"
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-800/60 transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-slate-400" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{teamA} vs {teamB}</p>
          <Link
            href={`/challenges/${challengeId}`}
            className="text-xs text-slate-500 hover:text-emerald-400 transition-colors"
          >
            {code}
          </Link>
        </div>
      </div>

      {/* ── Message list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageCircle className="h-8 w-8 text-slate-600 mb-3" />
            <p className="text-slate-500 text-sm">No messages yet.</p>
            <p className="text-slate-600 text-xs mt-1">Say hi to kick things off!</p>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.date}>
            {/* Date separator */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-xs text-slate-500 font-medium px-2">
                {dateSeparatorLabel(group.messages[0].created_at)}
              </span>
              <div className="flex-1 h-px bg-slate-800" />
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
                      <p className="text-xs text-slate-500 ml-1 mb-0.5">{senderName}</p>
                    )}
                    <div
                      className={`
                        px-3 py-2 rounded-2xl text-sm leading-relaxed
                        ${isOwn
                          ? 'bg-emerald-600 text-white rounded-br-sm'
                          : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                        }
                        ${msg.id.startsWith('opt-') ? 'opacity-70' : 'opacity-100'}
                      `}
                    >
                      {msg.content}
                    </div>
                    <p className="text-[10px] text-slate-600 mt-0.5 mx-1">
                      {formatTimestamp(msg.created_at)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="flex-shrink-0 border-t border-slate-800/60 bg-slate-950 px-3 py-3 pb-safe">
        <form
          onSubmit={handleSend}
          className="flex items-end gap-2"
        >
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
              flex-1 resize-none bg-slate-800/70 border border-slate-700/60
              rounded-2xl px-4 py-2.5 text-sm text-white placeholder-slate-500
              focus:outline-none focus:border-emerald-500/50 focus:bg-slate-800
              transition-colors max-h-32 overflow-y-auto
              disabled:opacity-60
            "
            style={{ minHeight: '42px' }}
            onInput={(e) => {
              // Auto-grow
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
              flex items-center justify-center transition-colors
            "
          >
            {sending
              ? <Loader2 className="h-4 w-4 text-slate-950 animate-spin" />
              : <Send className="h-4 w-4 text-slate-950" />
            }
          </button>
        </form>
      </div>
    </div>
  )
}
