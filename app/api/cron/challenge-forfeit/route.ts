import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processForfeit } from '@/lib/ladder/engine'
import { logChallengeEvent } from '@/lib/challenges/events'
import { notifyAdmins } from '@/lib/notifications/service'

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const now = new Date()

    // Get active season
    const { data: season } = await adminClient
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .single()

    if (!season) {
      return NextResponse.json({ success: true, message: 'No active season' })
    }

    // Find all pending challenges past their accept_deadline
    const { data: expiredChallenges } = await adminClient
      .from('challenges')
      .select('*')
      .eq('season_id', season.id)
      .eq('status', 'pending')
      .lt('accept_deadline', now.toISOString())
      .order('created_at', { ascending: true }) // oldest first — important for multi-challenge resolution

    if (!expiredChallenges || expiredChallenges.length === 0) {
      return NextResponse.json({ success: true, message: 'No expired challenges', processed: 0 })
    }

    // Group by challenged_team_id
    // Rule: for each challenged team, the OLDEST challenge gets a forfeit;
    //       any additional simultaneous challenges against the same team get dissolved.
    const byTeam = new Map<string, typeof expiredChallenges>()
    for (const challenge of expiredChallenges) {
      const group = byTeam.get(challenge.challenged_team_id) ?? []
      group.push(challenge)
      byTeam.set(challenge.challenged_team_id, group)
    }

    let forfeited = 0
    let dissolved = 0

    for (const [, challenges] of byTeam) {
      // Already ordered oldest-first from the query
      const [oldest, ...rest] = challenges

      // ── 1. Forfeit the oldest challenge ────────────────────────────────
      const result = await processForfeit(oldest.id, oldest.challenged_team_id)

      if (result.success) {
        await adminClient
          .from('challenges')
          .update({ status: 'forfeited', forfeit_by: 'challenged' })
          .eq('id', oldest.id)

        // Fetch team names for notifications
        const { data: challengingTeam } = await adminClient
          .from('teams').select('player1_id, player2_id, name').eq('id', oldest.challenging_team_id).single()
        const { data: challengedTeam } = await adminClient
          .from('teams').select('player1_id, player2_id, name').eq('id', oldest.challenged_team_id).single()

        // Notify the winning (challenging) team
        if (challengingTeam) {
          await adminClient.from('notifications').insert([
            {
              player_id: challengingTeam.player1_id,
              team_id: oldest.challenging_team_id,
              type: 'challenge_forfeited',
              title: 'Challenge Auto-Forfeited — You Win',
              message: `${challengedTeam?.name ?? 'The challenged team'} did not respond to your challenge in time. You have been awarded the forfeit win.`,
              action_url: `/challenges/${oldest.id}`,
              is_read: false,
              email_sent: false,
            },
            {
              player_id: challengingTeam.player2_id,
              team_id: oldest.challenging_team_id,
              type: 'challenge_forfeited',
              title: 'Challenge Auto-Forfeited — You Win',
              message: `${challengedTeam?.name ?? 'The challenged team'} did not respond to your challenge in time. You have been awarded the forfeit win.`,
              action_url: `/challenges/${oldest.id}`,
              is_read: false,
              email_sent: false,
            },
          ])
        }

        // Notify the penalised (challenged) team
        if (challengedTeam) {
          await adminClient.from('notifications').insert([
            {
              player_id: challengedTeam.player1_id,
              team_id: oldest.challenged_team_id,
              type: 'challenge_forfeited',
              title: 'Challenge Auto-Forfeited',
              message: `You did not respond to ${challengingTeam?.name ?? 'a'}'s challenge before the deadline. The forfeit has been applied.`,
              action_url: `/challenges/${oldest.id}`,
              is_read: false,
              email_sent: false,
            },
            {
              player_id: challengedTeam.player2_id,
              team_id: oldest.challenged_team_id,
              type: 'challenge_forfeited',
              title: 'Challenge Auto-Forfeited',
              message: `You did not respond to ${challengingTeam?.name ?? 'a'}'s challenge before the deadline. The forfeit has been applied.`,
              action_url: `/challenges/${oldest.id}`,
              is_read: false,
              email_sent: false,
            },
          ])
        }

        await adminClient.from('audit_log').insert({
          actor_email: 'system',
          action_type: 'challenge_auto_forfeited',
          entity_type: 'challenge',
          entity_id: oldest.id,
          notes: 'Auto-forfeited: challenged team did not respond before accept_deadline',
          created_at: now.toISOString(),
        })

        await logChallengeEvent({
          challengeId: oldest.id,
          eventType: 'auto_forfeit',
          actorRole: 'system',
          data: {
            reason: 'accept_deadline_missed',
            forfeit_by: 'challenged',
            challenging_team_id: oldest.challenging_team_id,
            challenged_team_id: oldest.challenged_team_id,
          },
          timestamp: now.toISOString(),
        })

        // Notify admins
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        await notifyAdmins({
          type: 'challenge_forfeited',
          title: '⏰ Auto-forfeit applied',
          message: `${challengedTeam?.name ?? 'A team'} did not accept ${challengingTeam?.name ?? 'a'}'s challenge (${oldest.challenge_code}) before the deadline. Forfeit has been applied automatically.`,
          actionUrl: `${appUrl}/admin/challenges`,
        })

        forfeited++
      }

      // ── 2. Dissolve any other simultaneous expired challenges against the same team ──
      for (const other of rest) {
        await adminClient
          .from('challenges')
          .update({ status: 'dissolved' })
          .eq('id', other.id)

        // Notify the other challenging teams their challenge was dissolved
        const { data: otherChallengingTeam } = await adminClient
          .from('teams').select('player1_id, player2_id, name').eq('id', other.challenging_team_id).single()
        const { data: challengedTeam } = await adminClient
          .from('teams').select('name').eq('id', other.challenged_team_id).single()

        if (otherChallengingTeam) {
          await adminClient.from('notifications').insert([
            {
              player_id: otherChallengingTeam.player1_id,
              team_id: other.challenging_team_id,
              type: 'challenge_dissolved',
              title: 'Challenge Dissolved',
              message: `Your challenge to ${challengedTeam?.name ?? 'the team'} has been dissolved. They were already forfeited on an earlier challenge from another team.`,
              action_url: `/challenges/${other.id}`,
              is_read: false,
              email_sent: false,
            },
            {
              player_id: otherChallengingTeam.player2_id,
              team_id: other.challenging_team_id,
              type: 'challenge_dissolved',
              title: 'Challenge Dissolved',
              message: `Your challenge to ${challengedTeam?.name ?? 'the team'} has been dissolved. They were already forfeited on an earlier challenge from another team.`,
              action_url: `/challenges/${other.id}`,
              is_read: false,
              email_sent: false,
            },
          ])
        }

        await adminClient.from('audit_log').insert({
          actor_email: 'system',
          action_type: 'challenge_auto_dissolved',
          entity_type: 'challenge',
          entity_id: other.id,
          notes: 'Auto-dissolved: challenged team already forfeited on an earlier simultaneous challenge',
          created_at: now.toISOString(),
        })

        await logChallengeEvent({
          challengeId: other.id,
          eventType: 'dissolved',
          actorRole: 'system',
          data: {
            reason: 'auto_dissolved_sibling_forfeited',
            challenged_team_id: other.challenged_team_id,
          },
          timestamp: now.toISOString(),
        })

        dissolved++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed: ${forfeited} forfeited, ${dissolved} dissolved`,
      forfeited,
      dissolved,
    })
  } catch (err) {
    console.error('Cron challenge-forfeit error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
