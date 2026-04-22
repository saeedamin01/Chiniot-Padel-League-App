import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processMatchResult } from '@/lib/ladder/engine'
import { createNotification } from '@/lib/notifications/service'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// ─── POST /api/matches/[id]/dispute/resolve ───────────────────────────────────
//
// Two modes, distinguished by the `mode` field in the request body:
//
// mode = "accept"
//   Called by the original score reporter when they agree with the counter-score.
//   Body: { mode: "accept", teamId }
//   Effect: update match_result scores to the disputed_score, resolve dispute,
//           process ladder, notify both teams.
//
// mode = "admin"
//   Called by an admin to set the definitive final score.
//   Body: { mode: "admin", set1Challenger, set1Challenged, set2Challenger,
//           set2Challenged, supertiebreakChallenger?, supertiebreakChallenged?,
//           winnerTeamId, adminNote? }
//   Effect: same as above but with the admin-provided scores.

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { mode } = body

  if (!['accept', 'admin'].includes(mode)) {
    return NextResponse.json({ error: 'Invalid mode. Use "accept" or "admin".' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Fetch match result (with challenge + season settings)
  const { data: result, error: resultErr } = await adminClient
    .from('match_results')
    .select(`
      *,
      challenge:challenges(
        id, challenge_code, challenging_team_id, challenged_team_id, season_id
      )
    `)
    .eq('id', params.id)
    .single()

  if (resultErr || !result) {
    return NextResponse.json({ error: 'Match result not found' }, { status: 404 })
  }

  if (result.dispute_resolved_at) {
    return NextResponse.json({ error: 'Dispute already resolved' }, { status: 400 })
  }

  if (!result.disputed_score) {
    return NextResponse.json({ error: 'No dispute filed for this result' }, { status: 400 })
  }

  const challenge = result.challenge as any
  if (!challenge) return NextResponse.json({ error: 'Associated challenge not found' }, { status: 404 })

  const now = new Date()
  let finalScores: {
    set1_challenger: number
    set1_challenged: number
    set2_challenger: number
    set2_challenged: number
    supertiebreak_challenger: number | null
    supertiebreak_challenged: number | null
    winner_team_id: string
    loser_team_id: string
  }

  // ── Mode: accept (reporter accepts the counter-score) ─────────────────────
  if (mode === 'accept') {
    const { teamId } = body

    if (!teamId) {
      return NextResponse.json({ error: 'teamId is required for accept mode' }, { status: 400 })
    }

    // Verify caller is the original reporter
    if (teamId !== result.reported_by_team_id) {
      return NextResponse.json({ error: 'Only the original score reporter can accept the counter-score' }, { status: 403 })
    }

    // Verify user is actually on that team
    const { data: team } = await adminClient
      .from('teams')
      .select('id')
      .eq('id', teamId)
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
      .single()

    if (!team) {
      return NextResponse.json({ error: 'Not authorised to resolve this dispute' }, { status: 403 })
    }

    const ds = result.disputed_score as any
    const winnerTeamId = ds.winner_team_id
    const loserTeamId = winnerTeamId === challenge.challenging_team_id
      ? challenge.challenged_team_id
      : challenge.challenging_team_id

    finalScores = {
      set1_challenger: ds.set1_challenger,
      set1_challenged: ds.set1_challenged,
      set2_challenger: ds.set2_challenger,
      set2_challenged: ds.set2_challenged,
      supertiebreak_challenger: ds.supertiebreak_challenger ?? null,
      supertiebreak_challenged: ds.supertiebreak_challenged ?? null,
      winner_team_id: winnerTeamId,
      loser_team_id: loserTeamId,
    }

  // ── Mode: admin (admin sets final score) ──────────────────────────────────
  } else {
    // Verify admin
    const { data: playerData } = await adminClient
      .from('players')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!playerData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const {
      set1Challenger, set1Challenged,
      set2Challenger, set2Challenged,
      supertiebreakChallenger, supertiebreakChallenged,
      winnerTeamId,
    } = body

    if (!winnerTeamId || set1Challenger == null || set1Challenged == null ||
        set2Challenger == null || set2Challenged == null) {
      return NextResponse.json({ error: 'Missing score fields for admin mode' }, { status: 400 })
    }

    const loserTeamId = winnerTeamId === challenge.challenging_team_id
      ? challenge.challenged_team_id
      : challenge.challenging_team_id

    finalScores = {
      set1_challenger: set1Challenger,
      set1_challenged: set1Challenged,
      set2_challenger: set2Challenger,
      set2_challenged: set2Challenged,
      supertiebreak_challenger: supertiebreakChallenger ?? null,
      supertiebreak_challenged: supertiebreakChallenged ?? null,
      winner_team_id: winnerTeamId,
      loser_team_id: loserTeamId,
    }

    // Audit log for admin decision
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'dispute_admin_resolved',
      entity_type: 'match_result',
      entity_id: params.id,
      old_value: {
        original: {
          set1: `${result.set1_challenger}-${result.set1_challenged}`,
          set2: `${result.set2_challenger}-${result.set2_challenged}`,
          winner: result.winner_team_id,
        },
        disputed: result.disputed_score,
      },
      new_value: {
        final: finalScores,
        admin_note: body.adminNote ?? null,
      },
      created_at: now.toISOString(),
    })
  }

  // ── Apply final scores to match_result ────────────────────────────────────
  const { error: updateErr } = await adminClient
    .from('match_results')
    .update({
      winner_team_id: finalScores.winner_team_id,
      loser_team_id: finalScores.loser_team_id,
      set1_challenger: finalScores.set1_challenger,
      set1_challenged: finalScores.set1_challenged,
      set2_challenger: finalScores.set2_challenger,
      set2_challenged: finalScores.set2_challenged,
      supertiebreak_challenger: finalScores.supertiebreak_challenger,
      supertiebreak_challenged: finalScores.supertiebreak_challenged,
      verified_at: now.toISOString(),
      verified_by_team_id: null,          // cleared — resolved via dispute flow
      auto_verified: false,
      dispute_resolved_by: user.id,
      dispute_resolved_at: now.toISOString(),
    })
    .eq('id', params.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // ── Process ladder movement ───────────────────────────────────────────────
  await processMatchResult(
    challenge.id,
    finalScores.winner_team_id,
    finalScores.loser_team_id
  )

  // ── Log to challenge timeline ─────────────────────────────────────────────
  await logChallengeEvent({
    challengeId: challenge.id,
    eventType: 'result_verified',
    actorId: user.id,
    actorRole: mode === 'admin' ? 'admin' : 'player',
    data: {
      resolution_mode: mode,
      final_winner_id: finalScores.winner_team_id,
      set1: `${finalScores.set1_challenger}-${finalScores.set1_challenged}`,
      set2: `${finalScores.set2_challenger}-${finalScores.set2_challenged}`,
      ...(finalScores.supertiebreak_challenger != null
        ? { supertiebreak: `${finalScores.supertiebreak_challenger}-${finalScores.supertiebreak_challenged}` }
        : {}),
      ...(mode === 'admin' && body.adminNote ? { admin_note: body.adminNote } : {}),
    },
  })

  // ── Notify both teams ─────────────────────────────────────────────────────
  const teamIds = [challenge.challenging_team_id, challenge.challenged_team_id]
  const teamDataArr = await Promise.all(
    teamIds.map(tid =>
      adminClient.from('teams')
        .select('id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
        .eq('id', tid).single()
    )
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const challengeUrl = `${appUrl}/challenges/${challenge.id}`

  const winnerName = teamDataArr.find(r => r.data?.id === finalScores.winner_team_id)?.data?.name ?? 'the winning team'

  for (const { data: teamData } of teamDataArr) {
    if (!teamData) continue
    const isWinner = teamData.id === finalScores.winner_team_id
    const resolvedMsg = mode === 'admin'
      ? `An admin has set the final score for challenge ${challenge.challenge_code}.`
      : `Both teams agreed on the final score for challenge ${challenge.challenge_code}.`

    for (const player of [(teamData as any).player1, (teamData as any).player2]) {
      if (!player) continue
      await createNotification({
        playerId: player.id,
        teamId: teamData.id,
        type: 'result_verified',
        title: isWinner ? '✅ Dispute Resolved — You Won!' : '✅ Dispute Resolved',
        message: `${resolvedMsg} ${isWinner ? 'The ladder has been updated with your win.' : `${winnerName} has been recorded as the winner.`}`,
        actionUrl: challengeUrl,
        sendEmail: true,
      })
    }
  }

  return NextResponse.json({ success: true })
}
