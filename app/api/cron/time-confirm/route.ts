import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'
import { createNotification } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

/**
 * Cron: auto-confirm match times whose confirmation_deadline has expired.
 *
 * Targets challenges in 'accepted' or 'time_pending_confirm' status where
 * confirmation_deadline < now. Moves them to 'scheduled' and notifies both teams.
 *
 * Runs every 15 minutes (see vercel.json).
 */
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

    // Find challenges past their confirmation_deadline that are still awaiting confirmation
    const { data: expired } = await adminClient
      .from('challenges')
      .select('*')
      .eq('season_id', season.id)
      .in('status', ['accepted', 'time_pending_confirm'])
      .not('confirmation_deadline', 'is', null)
      .lt('confirmation_deadline', now.toISOString())

    if (!expired || expired.length === 0) {
      return NextResponse.json({ success: true, message: 'No expired confirmations', processed: 0 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    let processed = 0

    for (const challenge of expired) {
      // Move to scheduled
      const { error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'scheduled',
          scheduled_at: now.toISOString(),
          match_date: challenge.confirmed_time,
        })
        .eq('id', challenge.id)

      if (updateError) continue

      await adminClient.from('audit_log').insert({
        actor_email: 'system',
        action_type: 'challenge_auto_confirmed',
        entity_type: 'challenge',
        entity_id: challenge.id,
        notes: 'Match time auto-confirmed: confirmation deadline expired without a dispute',
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: challenge.id,
        eventType: 'time_auto_confirmed',
        actorRole: 'system',
        data: { confirmed_time: challenge.confirmed_time },
        timestamp: now.toISOString(),
      })

      // Fire-and-forget notifications to all 4 players
      const challengeUrl = `${appUrl}/challenges/${challenge.id}`;
      (async () => {
        try {
          const [{ data: challengingTeam }, { data: challengedTeam }] = await Promise.all([
            adminClient.from('teams')
              .select('name, player1:players!player1_id(id,name), player2:players!player2_id(id,name)')
              .eq('id', challenge.challenging_team_id).single(),
            adminClient.from('teams')
              .select('name, player1:players!player1_id(id,name), player2:players!player2_id(id,name)')
              .eq('id', challenge.challenged_team_id).single(),
          ])

          const formattedTime = challenge.confirmed_time
            ? new Date(challenge.confirmed_time).toLocaleString('en-GB', {
                weekday: 'short', day: 'numeric', month: 'short',
                hour: 'numeric', minute: '2-digit', hour12: true,
              })
            : 'the agreed time'

          const notifs: Promise<unknown>[] = []

          for (const [team, teamId] of [
            [challengingTeam, challenge.challenging_team_id],
            [challengedTeam,  challenge.challenged_team_id],
          ] as [any, string][]) {
            if (!team) continue
            for (const player of [team.player1, team.player2]) {
              if (!player) continue
              notifs.push(createNotification({
                playerId: player.id,
                teamId,
                type: 'challenge_scheduled',
                title: '✅ Match time confirmed',
                message: `Your match has been automatically confirmed for ${formattedTime}.`,
                actionUrl: challengeUrl,
                sendEmail: true,
              }))
            }
          }

          await Promise.all(notifs)
        } catch { /* fire-and-forget */ }
      })()

      processed++
    }

    return NextResponse.json({
      success: true,
      message: `Auto-confirmed ${processed} match time(s)`,
      processed,
    })
  } catch (err) {
    console.error('Cron time-confirm error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
