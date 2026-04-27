import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processForfeit } from '@/lib/ladder/engine'
import { logChallengeEvent } from '@/lib/challenges/events'
import { createNotification, notifyAdmins } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const now = new Date()

    const { data: season } = await adminClient
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .single()

    if (!season) {
      return NextResponse.json({ success: true, message: 'No active season' })
    }

    // Find the OLDEST expired pending challenge per challenged team.
    // We only need one per team — once we have it, we dissolve everything else to that team.
    const { data: expiredChallenges } = await adminClient
      .from('challenges')
      .select('*')
      .eq('season_id', season.id)
      .eq('status', 'pending')
      .lt('accept_deadline', now.toISOString())
      .order('created_at', { ascending: true }) // oldest first

    if (!expiredChallenges || expiredChallenges.length === 0) {
      return NextResponse.json({ success: true, message: 'No expired challenges', processed: 0 })
    }

    // One forfeit per challenged team — take the oldest expired challenge for each
    const oldestPerTeam = new Map<string, typeof expiredChallenges[0]>()
    for (const c of expiredChallenges) {
      if (!oldestPerTeam.has(c.challenged_team_id)) {
        oldestPerTeam.set(c.challenged_team_id, c)
      }
    }

    let forfeited = 0
    let dissolved = 0

    for (const [challengedTeamId, oldest] of oldestPerTeam) {
      // ── 1. Forfeit the oldest challenge ────────────────────────────────────
      const result = await processForfeit(oldest.id, challengedTeamId)

      if (!result.success) continue

      await adminClient
        .from('challenges')
        .update({ status: 'forfeited', forfeit_by: 'challenged' })
        .eq('id', oldest.id)

      const [{ data: challengingTeam }, { data: challengedTeam }] = await Promise.all([
        adminClient.from('teams').select('player1_id, player2_id, name').eq('id', oldest.challenging_team_id).single(),
        adminClient.from('teams').select('player1_id, player2_id, name').eq('id', challengedTeamId).single(),
      ])

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
            team_id: challengedTeamId,
            type: 'challenge_forfeited',
            title: 'Challenge Auto-Forfeited',
            message: `You did not respond to ${challengingTeam?.name ?? 'a'}'s challenge before the deadline. The forfeit has been applied.`,
            action_url: `/challenges/${oldest.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: challengedTeam.player2_id,
            team_id: challengedTeamId,
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
          challenged_team_id: challengedTeamId,
        },
        timestamp: now.toISOString(),
      })

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      await notifyAdmins({
        type: 'challenge_forfeited',
        title: '⏰ Auto-forfeit applied',
        message: `${challengedTeam?.name ?? 'A team'} did not accept ${challengingTeam?.name ?? 'a'}'s challenge (${oldest.challenge_code}) before the deadline. Forfeit has been applied automatically.`,
        actionUrl: `${appUrl}/admin/challenges`,
      })

      forfeited++

      // ── 2. Dissolve ALL other pending challenges to this team ───────────────
      // This includes both expired and not-yet-expired ones — once a forfeit is
      // applied, ALL remaining challengers are notified and their challenges closed.
      const { data: remainingChallenges } = await adminClient
        .from('challenges')
        .select('id, challenging_team_id')
        .eq('season_id', season.id)
        .eq('status', 'pending')
        .eq('challenged_team_id', challengedTeamId)
        .neq('id', oldest.id)

      for (const other of (remainingChallenges || [])) {
        await adminClient
          .from('challenges')
          .update({
            status: 'dissolved',
            dissolved_reason: `${challengedTeam?.name ?? 'The challenged team'} was auto-forfeited on an earlier challenge. All other pending challenges have been dissolved.`,
          })
          .eq('id', other.id)

        const { data: otherChallengingTeam } = await adminClient
          .from('teams').select('player1_id, player2_id, name').eq('id', other.challenging_team_id).single()

        if (otherChallengingTeam) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
          for (const playerId of [otherChallengingTeam.player1_id, otherChallengingTeam.player2_id].filter(Boolean)) {
            await createNotification({
              playerId,
              teamId: other.challenging_team_id,
              type: 'challenge_dissolved',
              title: '❌ Challenge Dissolved',
              message: `Your challenge to ${challengedTeam?.name ?? 'the team'} was dissolved — they were auto-forfeited on an earlier challenge.`,
              actionUrl: `${appUrl}/challenges/${other.id}`,
              sendEmail: true,
            })
          }
        }

        await adminClient.from('audit_log').insert({
          actor_email: 'system',
          action_type: 'challenge_auto_dissolved',
          entity_type: 'challenge',
          entity_id: other.id,
          notes: 'Auto-dissolved: challenged team already auto-forfeited on an earlier challenge',
          created_at: now.toISOString(),
        })

        await logChallengeEvent({
          challengeId: other.id,
          eventType: 'dissolved',
          actorRole: 'system',
          data: {
            reason: `${challengedTeam?.name ?? 'The challenged team'} was auto-forfeited on an earlier challenge — all remaining pending challenges were dissolved.`,
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
