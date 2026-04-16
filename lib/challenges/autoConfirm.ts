import { createAdminClient } from '@/lib/supabase/admin'

/**
 * If a challenge is in 'accepted' status and the confirmation_deadline has passed,
 * automatically move it to 'scheduled'.
 *
 * Call this whenever a challenge is read server-side so no cron job is needed.
 * Safe to call multiple times — it's a no-op if not applicable.
 */
export async function checkAndAutoConfirm(challengeId: string): Promise<boolean> {
  const supabase = createAdminClient()

  const { data: challenge } = await supabase
    .from('challenges')
    .select('id, status, confirmed_time, confirmation_deadline, challenging_team_id, challenged_team_id')
    .eq('id', challengeId)
    .single()

  if (!challenge) return false
  if (challenge.status !== 'accepted') return false
  if (!challenge.confirmation_deadline) return false

  const now = new Date()
  const deadline = new Date(challenge.confirmation_deadline)
  if (now < deadline) return false

  // Deadline passed — auto-confirm
  const { error } = await supabase
    .from('challenges')
    .update({
      status: 'scheduled',
      scheduled_at: now.toISOString(),
      match_date: challenge.confirmed_time, // keep match_date in sync
    })
    .eq('id', challengeId)
    .eq('status', 'accepted') // guard against race conditions

  if (error) {
    console.error('Auto-confirm failed:', error)
    return false
  }

  // Notify both teams
  const teamIds = [challenge.challenging_team_id, challenge.challenged_team_id]
  for (const teamId of teamIds) {
    const { data: team } = await supabase
      .from('teams')
      .select('player1_id, player2_id')
      .eq('id', teamId)
      .single()

    if (team) {
      const formattedTime = challenge.confirmed_time
        ? new Date(challenge.confirmed_time).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: '2-digit', minute: '2-digit',
          })
        : 'the agreed time'

      await supabase.from('notifications').insert([
        {
          player_id: team.player1_id,
          team_id: teamId,
          type: 'challenge_scheduled',
          title: 'Match Auto-Confirmed',
          message: `Your match for ${formattedTime} has been automatically confirmed.`,
          action_url: `/challenges/${challengeId}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: team.player2_id,
          team_id: teamId,
          type: 'challenge_scheduled',
          title: 'Match Auto-Confirmed',
          message: `Your match for ${formattedTime} has been automatically confirmed.`,
          action_url: `/challenges/${challengeId}`,
          is_read: false,
          email_sent: false,
        },
      ])
    }
  }

  return true
}
