import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

// Configure VAPID once at module load
webpush.setVapidDetails(
  `mailto:${process.env.SMTP_USER ?? 'admin@cpl.com'}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export interface PushPayload {
  title: string
  body: string
  url?: string   // deep-link opened when notification tapped
  tag?: string   // collapses duplicate notifications of same type
  icon?: string
}

/**
 * Send a push notification to one player (all their devices).
 * Stale/expired subscriptions are automatically removed.
 */
export async function sendPushToPlayer(playerId: string, payload: PushPayload) {
  const adminClient = createAdminClient()

  const { data: subs } = await adminClient
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('player_id', playerId)

  if (!subs?.length) return

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
      } catch (err: unknown) {
        // 404 / 410 = subscription expired — remove it
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await adminClient.from('push_subscriptions').delete().eq('id', sub.id)
        }
        throw err
      }
    })
  )

  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    console.warn(`Push: ${failed}/${subs.length} deliveries failed for player ${playerId}`)
  }
}

/**
 * Send a push notification to multiple players at once.
 */
export async function sendPushToPlayers(playerIds: string[], payload: PushPayload) {
  await Promise.allSettled(playerIds.map(id => sendPushToPlayer(id, payload)))
}
