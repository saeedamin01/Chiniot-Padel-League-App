import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processMatchResult } from '@/lib/ladder/engine'
import { logChallengeEvent } from '@/lib/challenges/events'

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

    // Find unverified results past verify_deadline
    const { data: pendingResults } = await adminClient
      .from('match_results')
      .select('*, challenge:challenges(*)')
      .eq('season_id', season.id)
      .is('verified_at', null)
      .eq('auto_verified', false)
      .not('verify_deadline', 'is', null)
      .lt('verify_deadline', now.toISOString())

    if (!pendingResults || pendingResults.length === 0) {
      return NextResponse.json({ success: true, message: 'No pending results', processed: 0 })
    }

    let processed = 0

    for (const result of pendingResults) {
      const challenge = result.challenge

      // Process the match result
      const processResult = await processMatchResult(
        challenge.id,
        result.winner_team_id,
        result.loser_team_id
      )

      if (processResult.success) {
        // Auto-verify the result
        await adminClient
          .from('match_results')
          .update({
            verified_at: now.toISOString(),
            auto_verified: true,
          })
          .eq('id', result.id)

        // Update challenge to played
        await adminClient
          .from('challenges')
          .update({ status: 'played' })
          .eq('id', challenge.id)

        // Get teams for notification
        const { data: winnerTeam } = await adminClient
          .from('teams')
          .select('player1_id, player2_id, name')
          .eq('id', result.winner_team_id)
          .single()

        const { data: loserTeam } = await adminClient
          .from('teams')
          .select('player1_id, player2_id, name')
          .eq('id', result.loser_team_id)
          .single()

        // Notify teams
        if (winnerTeam) {
          await adminClient.from('notifications').insert([
            {
              player_id: winnerTeam.player1_id,
              team_id: result.winner_team_id,
              type: 'result_verified',
              title: 'Match Result Verified',
              message: `Your win against ${loserTeam?.name} has been auto-verified!`,
              is_read: false,
              email_sent: false,
            },
            {
              player_id: winnerTeam.player2_id,
              team_id: result.winner_team_id,
              type: 'result_verified',
              title: 'Match Result Verified',
              message: `Your win against ${loserTeam?.name} has been auto-verified!`,
              is_read: false,
              email_sent: false,
            },
          ])
        }

        if (loserTeam) {
          await adminClient.from('notifications').insert([
            {
              player_id: loserTeam.player1_id,
              team_id: result.loser_team_id,
              type: 'result_verified',
              title: 'Match Result Verified',
              message: `Your loss against ${winnerTeam?.name} has been auto-verified.`,
              is_read: false,
              email_sent: false,
            },
            {
              player_id: loserTeam.player2_id,
              team_id: result.loser_team_id,
              type: 'result_verified',
              title: 'Match Result Verified',
              message: `Your loss against ${winnerTeam?.name} has been auto-verified.`,
              is_read: false,
              email_sent: false,
            },
          ])
        }

        // Log to audit
        await adminClient.from('audit_log').insert({
          actor_email: 'system',
          action_type: 'result_auto_verified',
          entity_type: 'match_result',
          entity_id: result.id,
          notes: 'Result auto-verified due to verification deadline expiration',
          created_at: now.toISOString(),
        })

        await logChallengeEvent({
          challengeId: challenge.id,
          eventType: 'result_auto_verified',
          actorRole: 'system',
          data: {
            match_result_id: result.id,
            winner_team_id: result.winner_team_id,
            loser_team_id: result.loser_team_id,
          },
          timestamp: now.toISOString(),
        })

        processed++
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processed} result(s)`,
      processed,
    })
  } catch (err) {
    console.error('Cron result-verify error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
