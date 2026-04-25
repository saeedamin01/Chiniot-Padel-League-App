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

    // Step 1: find all match_results past their verify_deadline that haven't been verified.
    // Skip disputed results — those require the reporter to accept/reject the counter-score
    // before anything can be auto-verified.
    const { data: pendingResults } = await adminClient
      .from('match_results')
      .select('id, challenge_id, winner_team_id, loser_team_id, verify_deadline')
      .eq('season_id', season.id)
      .is('verified_at', null)
      .eq('auto_verified', false)
      .not('verify_deadline', 'is', null)
      .lt('verify_deadline', now.toISOString())
      .is('disputed_at', null)   // ← never auto-verify a disputed result

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

    // ── Step 3: auto-approve disputed results whose dispute_deadline has expired ──
    // When the pending team hasn't acted within 60 minutes, approve the current
    // disputed_score as the final result (whichever team last filed a counter-score wins).
    const { data: expiredDisputes } = await adminClient
      .from('match_results')
      .select('id, challenge_id, disputed_score, dispute_round')
      .eq('season_id', season.id)
      .is('verified_at', null)
      .eq('auto_verified', false)
      .not('disputed_at', 'is', null)
      .not('dispute_deadline', 'is', null)
      .lt('dispute_deadline', now.toISOString())
      .is('dispute_flagged_at', null)   // skip escalated ones (admin resolves those)
      .is('dispute_resolved_at', null)

    let disputeAutoApproved = 0

    for (const dr of (expiredDisputes ?? [])) {
      const ds = dr.disputed_score as any
      if (!ds?.winner_team_id) continue

      const winnerTeamId = ds.winner_team_id
      const { data: challengeRow } = await adminClient
        .from('challenges')
        .select('id, challenging_team_id, challenged_team_id, status')
        .eq('id', dr.challenge_id)
        .single()

      if (!challengeRow || challengeRow.status !== 'result_pending') continue

      const loserTeamId = winnerTeamId === challengeRow.challenging_team_id
        ? challengeRow.challenged_team_id
        : challengeRow.challenging_team_id

      // Apply the disputed_score as the final result
      await adminClient.from('match_results').update({
        winner_team_id:           winnerTeamId,
        loser_team_id:            loserTeamId,
        set1_challenger:          ds.set1_challenger,
        set1_challenged:          ds.set1_challenged,
        set2_challenger:          ds.set2_challenger,
        set2_challenged:          ds.set2_challenged,
        supertiebreak_challenger: ds.supertiebreak_challenger ?? null,
        supertiebreak_challenged: ds.supertiebreak_challenged ?? null,
        verified_at:              now.toISOString(),
        auto_verified:            true,
        dispute_resolved_at:      now.toISOString(),
        dispute_pending_team_id:  null,
        dispute_deadline:         null,
      }).eq('id', dr.id)

      await processMatchResult(dr.challenge_id, winnerTeamId, loserTeamId)

      await adminClient.from('challenges').update({ status: 'played' }).eq('id', dr.challenge_id)

      await adminClient.from('audit_log').insert({
        actor_email: 'system',
        action_type: 'dispute_auto_approved',
        entity_type: 'match_result',
        entity_id:   dr.id,
        notes:       `Round ${dr.dispute_round} dispute auto-approved after deadline expiry`,
        created_at:  now.toISOString(),
      })

      disputeAutoApproved++
    }

    return NextResponse.json({
      success: true,
      message: `Auto-verified ${processed} result(s), auto-approved ${disputeAutoApproved} dispute(s)`,
      processed,
      disputeAutoApproved,
    })
  } catch (err) {
    console.error('Cron result-verify error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
