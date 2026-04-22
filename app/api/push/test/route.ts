import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { sendPushToPlayer } from '@/lib/push/send'

export const dynamic = 'force-dynamic'

// ─── POST /api/push/test ──────────────────────────────────────────────────────
//
// Admin-only endpoint that fires a real push notification to verify the
// end-to-end stack (VAPID keys → push server → service worker → device).
//
// Body: {
//   playerId?:  string  — target player (defaults to the calling admin's own ID)
//   title?:     string  — notification title
//   body?:      string  — notification body
// }
//
// Returns: { sent: boolean, subscriptions: number, error?: string }

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin check
    const adminClient = createAdminClient()
    const { data: playerData } = await adminClient
      .from('players')
      .select('is_admin, name')
      .eq('id', user.id)
      .single()

    if (!playerData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const targetPlayerId: string = body.playerId ?? user.id
    const title:   string = body.title ?? '🎾 CPL Test Notification'
    const message: string = body.body  ?? `Test sent by ${playerData.name} at ${new Date().toLocaleTimeString('en-GB')}`

    // Check the target has subscriptions
    const { data: subs, error: subsErr } = await adminClient
      .from('push_subscriptions')
      .select('id, endpoint')
      .eq('player_id', targetPlayerId)

    if (subsErr) {
      return NextResponse.json({ error: subsErr.message }, { status: 500 })
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({
        sent: false,
        subscriptions: 0,
        error: 'No push subscriptions found for this player. They need to enable notifications in the app first.',
      })
    }

    // Check VAPID keys
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return NextResponse.json({
        sent: false,
        subscriptions: subs.length,
        error: 'VAPID keys are not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in your environment.',
      })
    }

    // Fire the test push
    try {
      await sendPushToPlayer(targetPlayerId, {
        title,
        body:  message,
        url:   '/dashboard',
        tag:   'cpl-test',
        icon:  '/icons/icon-192.svg',
      })
    } catch (sendErr) {
      return NextResponse.json({
        sent: false,
        subscriptions: subs.length,
        error: `Push delivery failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
      }, { status: 500 })
    }

    return NextResponse.json({
      sent: true,
      subscriptions: subs.length,
      targetPlayerId,
      title,
      body: message,
    })
  } catch (err) {
    console.error('[CPL Push] /api/push/test error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
