import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, genericNotificationEmail } from '@/lib/email/mailer'
import { sendPushToPlayer } from '@/lib/push/send'

export async function createNotification(data: {
  playerId: string
  teamId?: string
  type: string
  title: string
  message: string
  actionUrl?: string
  sendEmail?: boolean
  emailData?: Record<string, string>
}) {
  const supabase = createAdminClient()

  // ── In-app notification ──────────────────────────────────────────────────
  await supabase.from('notifications').insert({
    player_id: data.playerId,
    team_id:   data.teamId,
    type:      data.type,
    title:     data.title,
    message:   data.message,
    action_url: data.actionUrl,
  })

  // ── Push notification (always attempted; guarded inside sendPushToPlayer) ─
  sendPushToPlayer(data.playerId, {
    title: data.title,
    body:  data.message,
    url:   data.actionUrl,
    tag:   `${data.type}-${data.playerId}`,
    icon:  '/icons/icon-192.svg',
  }).catch(err => console.warn('[CPL Push] createNotification push failed:', err))

  // ── Email (optional, respects per-player preferences) ────────────────────
  if (data.sendEmail) {
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('player_id', data.playerId)
      .single()

    const { data: player } = await supabase
      .from('players')
      .select('email, name')
      .eq('id', data.playerId)
      .single()

    if (player && prefs) {
      const prefKey = `${data.type}_email` as keyof typeof prefs
      if (prefs[prefKey] !== false) {
        await sendEmail({
          to:      player.email as string,
          subject: `CPL: ${data.title}`,
          html:    genericNotificationEmail({
            playerName: player.name as string,
            title:      data.title,
            message:    data.message,
            actionUrl:  data.actionUrl,
          })
        })

        await supabase
          .from('notifications')
          .update({ email_sent: true, email_sent_at: new Date().toISOString() })
          .eq('player_id', data.playerId)
          .eq('type', data.type)
          .order('created_at', { ascending: false })
          .limit(1)
      }
    }
  }
}

// ── Notify all admin players ──────────────────────────────────────────────────
// Sends the same notification (in-app + push) to every player with is_admin = true.
export async function notifyAdmins(data: {
  type: string
  title: string
  message: string
  actionUrl?: string
}) {
  const supabase = createAdminClient()
  const { data: admins } = await supabase
    .from('players')
    .select('id')
    .eq('is_admin', true)

  if (!admins || admins.length === 0) return

  // Batch insert in-app notifications
  await supabase.from('notifications').insert(
    admins.map(a => ({
      player_id:  a.id,
      type:       data.type,
      title:      data.title,
      message:    data.message,
      action_url: data.actionUrl,
    }))
  )

  // Push to each admin (fire-and-forget)
  for (const admin of admins) {
    sendPushToPlayer(admin.id, {
      title: data.title,
      body:  data.message,
      url:   data.actionUrl,
      tag:   `${data.type}-admin`,
      icon:  '/icons/icon-192.svg',
    }).catch(() => {})
  }
}

export async function notifyChallengeReceived(challengeId: string) {
  const supabase = createAdminClient()

  const { data: challenge } = await supabase
    .from('challenges')
    .select(`
      *,
      challenging_team:teams!challenging_team_id(
        *, player1:players!player1_id(*), player2:players!player2_id(*)
      ),
      challenged_team:teams!challenged_team_id(
        *, player1:players!player1_id(*), player2:players!player2_id(*)
      )
    `)
    .eq('id', challengeId)
    .single()

  if (!challenge) return

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const acceptUrl = `${appUrl}/challenges/${challengeId}`

  const ct = challenge.challenging_team as any
  const cd = challenge.challenged_team  as any

  for (const player of [cd.player1, cd.player2]) {
    if (!player) continue
    await createNotification({
      playerId:  player.id,
      teamId:    challenge.challenged_team_id,
      type:      'challenge_received',
      title:     'Challenge Received!',
      message:   `${ct.name} has challenged your team. Accept by ${new Date(challenge.accept_deadline).toLocaleString()}`,
      actionUrl: acceptUrl,
      sendEmail: true,
    })
  }
}
