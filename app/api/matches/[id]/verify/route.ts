import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processMatchResult } from '@/lib/ladder/engine'
import { createNotification } from '@/lib/notifications/service'
import { logChallengeEvent } from '@/lib/challenges/events'
import { checkLeagueLock } from '@/lib/league/lock'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lockResponse = await checkLeagueLock()
  if (lockResponse) return lockResponse

  const body = await request.json()
  const { action, teamId, disputeReason } = body // action: 'verify' | 'dispute'

  const adminClient = createAdminClient()

  // Get match result
  const { data: result, error: resultErr } = await adminClient
    .from('match_results')
    .select('*, challenge:challenges(*)')
    .eq('id', params.id)
    .single()

  if (resultErr || !result) {
    return NextResponse.json({ error: 'Match result not found' }, { status: 404 })
  }

  if (result.verified_at) {
    return NextResponse.json({ error: 'Result already verified' }, { status: 400 })
  }

  // Verify user is on the verifying team
  const { data: team } = await adminClient
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
    .single()

  if (!team) {
    return NextResponse.json({ error: 'Not authorized to verify this result' }, { status: 403 })
  }

  if (action === 'verify') {
    // Mark as verified
    await adminClient
      .from('match_results')
      .update({
        verified_by_team_id: teamId,
        verified_at: new Date().toISOString(),
        auto_verified: false,
      })
      .eq('id', params.id)

    // Process ladder movement
    await processMatchResult(
      result.challenge_id,
      result.winner_team_id,
      result.loser_team_id
    )

    // Mark challenge as fully played — unlocks both teams for new challenges
    await adminClient
      .from('challenges')
      .update({ status: 'played' })
      .eq('id', result.challenge_id)

    await logChallengeEvent({
      challengeId: result.challenge_id,
      eventType: 'result_verified',
      actorId: user.id,
      actorRole: 'player',
      data: { verifying_team_id: teamId },
    })

    // Respond immediately — notifications are fire-and-forget
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const challengeUrl = `${appUrl}/challenges/${result.challenge_id}`;

    // Fetch both teams then fan-out all 4 notifications in parallel (non-blocking)
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
              title: '✅ Match result verified',
              message: `Your win against ${(loserTeam as any)?.name ?? 'the opposing team'} has been confirmed. The ladder has been updated.`,
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
              title: '✅ Match result confirmed',
              message: `The result of your match against ${(winnerTeam as any)?.name ?? 'the opposing team'} has been confirmed.`,
              actionUrl: challengeUrl,
              sendEmail: true,
            }))
          }
        }

        await Promise.all(notifs)
      } catch { /* fire-and-forget — never blocks response */ }
    })()

    return NextResponse.json({ success: true, message: 'Result verified and ladder updated' })

  } else if (action === 'dispute') {
    // Flag for admin review
    await adminClient
      .from('match_results')
      .update({
        verified_by_team_id: teamId,
        // Keep verified_at null to indicate dispute
      })
      .eq('id', params.id)

    // Log dispute to audit log
    await adminClient.from('audit_log').insert({
      action_type: 'result_dispute',
      entity_type: 'match_result',
      entity_id: params.id,
      notes: disputeReason || 'No reason provided',
    })

    await logChallengeEvent({
      challengeId: result.challenge_id,
      eventType: 'result_disputed',
      actorId: user.id,
      actorRole: 'player',
      data: { reason: disputeReason || null },
    })

    // Notify all admins
    const { data: admins } = await adminClient
      .from('players')
      .select('id, email, name')
      .eq('is_admin', true)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    if (admins) {
      for (const admin of admins) {
        await createNotification({
          playerId: admin.id,
          type: 'admin_dispute',
          title: '⚠️ Match Result Disputed',
          message: `A match result has been disputed. Reason: ${disputeReason || 'None given'}`,
          actionUrl: `${appUrl}/admin/challenges`,
          sendEmail: true,
        })
      }
    }

    return NextResponse.json({ success: true, message: 'Dispute flagged for admin review' })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
