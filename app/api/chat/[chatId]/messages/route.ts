/**
 * POST /api/chat/[chatId]/messages
 *
 * Send a message to a challenge chat.
 * - Validates the caller is a member of the chat (allowed_player_ids).
 * - Inserts the message.
 * - Fires push immediately to all other members.
 * - Fires email if the chat-level throttle allows (max 1 email/hour per chat).
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { sendPushEvent } from '@/lib/push/notify'
import { sendEventEmail } from '@/lib/email/events'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { chatId: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { content, reply_to_message_id } = body
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400 })
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: 'Message too long (max 2000 characters)' }, { status: 400 })
    }

    const chatId = params.chatId
    const adminClient = createAdminClient()

    // ── Fetch chat row + related challenge info ──────────────────────────────
    const { data: chat, error: chatErr } = await adminClient
      .from('challenge_chats')
      .select(`
        id,
        allowed_player_ids,
        last_email_sent_at,
        challenge:challenges (
          id,
          challenge_code,
          challenging_team:teams!challenges_challenging_team_id_fkey ( id, name ),
          challenged_team:teams!challenges_challenged_team_id_fkey ( id, name )
        )
      `)
      .eq('id', chatId)
      .single()

    if (chatErr || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Verify caller is a member
    if (!(chat.allowed_player_ids as string[]).includes(user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── Insert message ────────────────────────────────────────────────────────
    const insertData: Record<string, unknown> = {
      chat_id:   chatId,
      sender_id: user.id,
      content:   content.trim(),
      read_by:   [user.id],  // sender has already "read" their own message
    }
    if (reply_to_message_id) insertData.reply_to_message_id = reply_to_message_id

    const { data: message, error: insertErr } = await adminClient
      .from('chat_messages')
      .insert(insertData)
      .select(`
        id,
        chat_id,
        sender_id,
        content,
        read_by,
        reactions,
        reply_to_message_id,
        created_at,
        sender:players!chat_messages_sender_id_fkey ( id, name, avatar_url )
      `)
      .single()

    if (insertErr || !message) {
      console.error('[Chat] insert error', insertErr)
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    // ── Fire push + email to the other members ────────────────────────────────
    const otherPlayerIds = (chat.allowed_player_ids as string[]).filter(id => id !== user.id)

    if (otherPlayerIds.length > 0) {
      const challenge = (chat.challenge as unknown) as {
        id: string
        challenge_code: string
        challenging_team?: { id: string; name: string } | null
        challenged_team?: { id: string; name: string } | null
      } | null

      const challengeCode = challenge?.challenge_code ?? ''
      const teamA = challenge?.challenging_team?.name ?? ''
      const teamB = challenge?.challenged_team?.name ?? ''
      const senderName = ((message.sender as unknown) as { id: string; name: string } | null)?.name ?? 'Someone'
      const messagePreview = content.trim().slice(0, 120)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const chatUrl = `${appUrl}/chat/${chatId}`

      // Push — always immediate
      sendPushEvent('chat_message', otherPlayerIds, {
        senderName,
        messagePreview,
        challengingTeamName: teamA,
        challengedTeamName: teamB,
        challengeCode,
        chatId,
      }).catch(err => console.warn('[Chat] push failed:', err))

      // Email — throttled to once per hour per chat
      const shouldEmail = (() => {
        if (!chat.last_email_sent_at) return true
        const lastSent = new Date(chat.last_email_sent_at as string).getTime()
        return Date.now() - lastSent > 60 * 60 * 1000  // 1 hour
      })()

      if (shouldEmail) {
        // Update throttle timestamp first (fire-and-forget the email itself)
        void Promise.resolve(
          adminClient
            .from('challenge_chats')
            .update({ last_email_sent_at: new Date().toISOString() })
            .eq('id', chatId)
        ).then(() =>
          sendEventEmail('chat_message', otherPlayerIds, {
            senderName,
            messagePreview,
            challengeCode,
            teamA,
            teamB,
            chatUrl,
          }).catch((err: unknown) => console.warn('[Chat] email failed:', err))
        ).catch((err: unknown) => console.warn('[Chat] throttle update failed:', err))
      }
    }

    return NextResponse.json({ message }, { status: 201 })

  } catch (err) {
    console.error('[Chat] POST /messages error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
