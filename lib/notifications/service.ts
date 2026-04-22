import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail, genericNotificationEmail } from '@/lib/email/mailer'

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

  // Create in-app notification
  await supabase.from('notifications').insert({
    player_id: data.playerId,
    team_id: data.teamId,
    type: data.type,
    title: data.title,
    message: data.message,
    action_url: data.actionUrl,
  })

  // Check preferences and send email if needed
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
          to: player.email,
          subject: `CPL: ${data.title}`,
          html: genericNotificationEmail({
            playerName: player.name,
            title: data.title,
            message: data.message,
            actionUrl: data.actionUrl,
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
// Sends the same notification to every player who has is_admin = true.
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

  await supabase.from('notifications').insert(
    admins.map(a => ({
      player_id: a.id,
      type: data.type,
      title: data.title,
      message: data.message,
      action_url: data.actionUrl,
    }))
  )
}

export async function notifyChallengeReceived(challengeId: string) {
  const supabase = createAdminClient()

  const { data: challenge } = await supabase
    .from('challenges')
    .select('*, challenging_team:teams!challenging_team_id(*, player1:players!player1_id(*), player2:players!player2_id(*)), challenged_team:teams!challenged_team_id(*, player1:players!player1_id(*), player2:players!player2_id(*))')
    .eq('id', challengeId)
    .single()

  if (!challenge) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const acceptUrl = `${appUrl}/challenges/${challengeId}`

  // Notify both players of challenged team
  for (const player of [challenge.challenged_team.player1, challenge.challenged_team.player2]) {
    if (!player) continue

    await createNotification({
      playerId: player.id,
      teamId: challenge.challenged_team_id,
      type: 'challenge_received',
      title: 'Challenge Received!',
      message: `${challenge.challenging_team.name} has challenged your team. Accept by ${new Date(challenge.accept_deadline).toLocaleString()}`,
      actionUrl: acceptUrl,
      sendEmail: true,
    })
  }
}
