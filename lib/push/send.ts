import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── VAPID init (guarded) ─────────────────────────────────────────────────────
// Only configure if both keys are present — prevents a crash at module-load
// time when the env vars aren't set (e.g. during `next build` in CI, or when
// the email-only path is imported from a route that has no VAPID keys).

const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = `mailto:${process.env.SMTP_USER ?? 'admin@cpl.com'}`

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  } catch (err) {
    console.error('[CPL Push] setVapidDetails failed — check VAPID key format:', err)
  }
}

export interface PushPayload {
  title: string
  body:  string
  url?:  string   // deep-link opened when notification tapped
  tag?:  string   // collapses duplicate notifications of same type
  icon?: string
}

/**
 * Send a push notification to one player (all their registered devices).
 * Stale / expired subscriptions (HTTP 404 or 410) are automatically pruned.
 * Never throws — errors are logged and returned as warnings.
 */
export async function sendPushToPlayer(
  playerId: string,
  payload: PushPayload
): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[CPL Push] VAPID keys not configured — push skipped for player', playerId)
    return
  }

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
        // 404 / 410 = subscription is no longer valid — remove it
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await adminClient
            .from('push_subscriptions')
            .delete()
            .eq('id', sub.id)
          console.info('[CPL Push] Pruned stale subscription', sub.id)
        } else {
          console.warn('[CPL Push] Delivery failed for sub', sub.id, err)
        }
        throw err
      }
    })
  )

  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    console.warn(`[CPL Push] ${failed}/${subs.length} deliveries failed for player ${playerId}`)
  }
}

/**
 * Send a push notification to multiple players at once (fire-and-forget).
 */
export async function sendPushToPlayers(
  playerIds: string[],
  payload: PushPayload
): Promise<void> {
  await Promise.allSettled(playerIds.map(id => sendPushToPlayer(id, payload)))
}
