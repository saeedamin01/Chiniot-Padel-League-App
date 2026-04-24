/**
 * POST /api/chat/[chatId]/messages/[messageId]/react
 *
 * Toggle an emoji reaction on a message.
 * Body: { emoji: string }
 * - If the user has already reacted with that emoji, removes it.
 * - Otherwise adds it.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '🎉']

export async function POST(
  request: NextRequest,
  { params }: { params: { chatId: string; messageId: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { emoji } = await request.json()
    if (!emoji || !ALLOWED_REACTIONS.includes(emoji)) {
      return NextResponse.json({ error: 'Invalid reaction' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify user is in this chat
    const { data: chat } = await adminClient
      .from('challenge_chats')
      .select('allowed_player_ids')
      .eq('id', params.chatId)
      .single()

    if (!chat || !(chat.allowed_player_ids as string[]).includes(user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch current reactions
    const { data: msg } = await adminClient
      .from('chat_messages')
      .select('reactions')
      .eq('id', params.messageId)
      .eq('chat_id', params.chatId)
      .single()

    if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

    const reactions: Record<string, string[]> = (msg.reactions as Record<string, string[]>) ?? {}

    // Toggle: remove if already present, add if not
    const existing = reactions[emoji] ?? []
    if (existing.includes(user.id)) {
      reactions[emoji] = existing.filter(id => id !== user.id)
      if (reactions[emoji].length === 0) delete reactions[emoji]
    } else {
      reactions[emoji] = [...existing, user.id]
    }

    const { data: updated } = await adminClient
      .from('chat_messages')
      .update({ reactions })
      .eq('id', params.messageId)
      .select('id, reactions')
      .single()

    return NextResponse.json({ reactions: updated?.reactions ?? reactions })

  } catch (err) {
    console.error('[Chat] react error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
