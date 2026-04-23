import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processMatchResult } from '@/lib/ladder/engine'
import { logChallengeEvent } from '@/lib/challenges/events'
import { createNotification } from '@/lib/notifications/service'

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

    // Get active season
    const { data: season } = await adminClient
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .single()

    if (!season) {
      return NextResponse.json({ success: true, message: 'No active season' })
    }

    // Step 1: find all match_results past their verify_deadline that haven't been verified
    const { data: pendingResults } = await adminClient
      .from('match_results')
      .select('id, challenge_id, winner_team_id, loser_team_id, verify_deadline')
      .eq('season_id', season.id)
      .is('verified_at', null)
      .eq('auto_verified', false)
      .not('verify_deadline', 'is', null)
      .lt('verify_deadline', now.toISOString())

    if (!pendingResults || pendingResults.length === 0) {
      return NextResponse.json({ success: true, message: 'No pending results', processed: 0 })
    }

    // Step 2: of those, only keep challenges still in result_pending
    // (avoid processing dissolved/forfeited/already-played challenges)
    const challengeIds = pendingResults.map(r => r.challenge_id)
    const { data: resultPendingChallenges } = await adminClient
      .from('challenges')
      .select('id')
      .in('id', challengeIds)
      .eq('status', 'result_pending')

    const resultPendingIds = new Set((resultPendingChallenges || []).map(c => c.id))
    const eligible = pendingResults.filter(r => resultPendingIds.has(r.challenge_id))

    if (eligible.length === 0) {
      return NextResponse.json({ success: true, message: 'No eligible results', processed: 0 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    let processed = 0

    for (const result of eligible) {
      // Process ladder movement — uses challenge_id directly, no embedded object needed
      const processResult = await processMatchResult(
        result.challenge_id,
        result.winner_team_id,
        result.loser_team_id
      )

      if (!processResult.success) continue

      // Mark result verified
      await adminClient
        .from('match_results')
        .update({ verified_at: now.toISOString(), auto_verified: true })
        .eq('id', result.id)

      // Unlock both teams
      await adminClient
        .from('challenges')
        .update({ status: 'played' })
        .eq('id', result.challenge_id)

      await adminClient.from('audit_log').insert({
        actor_email: 'system',
        action_type: 'result_auto_verified',
        entity_type: 'match_result',
        entity_id: result.id,
        notes: 'Result auto-verified due to verification deadline expiration',
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: result.challenge_id,
        eventType: 'result_auto_verified',
        actorRole: 'system',
        data: {
          match_result_id: result.id,
          winner_team_id: result.winner_team_id,
          loser_team_id: result.loser_team_id,
        },
        timestamp: now.toISOString(),
      })

      // Fire-and-forget notifications to all 4 players
      const challengeUrl = `${appUrl}/challenges/${result.challenge_id}`;
      (async () => {
        try {
          const [{ data: winnerTeam }, { data: loserTeam }] = await Promise.all([
            adminClient.from('teams')
              .select('name, player1:players!player1_id(id,name), player2:players!player2_id(id,name)')
              .eq('id', result.winner_team_id).single(),
            adminClient.from('teams')
              .select('name, player1:players!player1_id(id,name), player2:players!player2_id(id,name)')
              .eq('id', result.loser_team_id).single(),
          ])

          const notifs: Promise<unknown>[] = []

          if (winnerTeam) {
            for (const player of [(winnerTeam as any).player1, (winnerTeam as any).player2]) {
              if (!player) continue
              notifs.push(createNotification({
                playerId: player.id,
                teamId: result.winner_team_id,
                type: 'result_verified',
                title: '✅ Match result auto-verified',
                message: `Your win against ${(loserTeam as any)?.name ?? 'the opposing team'} has been confirmed automatically. The ladder has been updated.`,
                actionUrl: challengeUrl,
                sendEmail: true,
              }))
            }
          }

          if (loserTeam) {
            for (const player of [(loserTeam as any).player1, (loserTeam as any).player2]) {
              if (!player) continue
              notifs.push(createNotification({
                playerId: player.id,
                teamId: result.loser_team_id,
                type: 'result_verified',
                title: '✅ Match result auto-verified',
                message: `The result of your match against ${(winnerTeam as any)?.name ?? 'the opposing team'} has been automatically confirmed.`,
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
      message: `Auto-verified ${processed} result(s)`,
      processed,
    })
  } catch (err) {
    console.error('Cron result-verify error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
