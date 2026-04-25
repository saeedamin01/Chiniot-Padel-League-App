import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { addMinutes } from 'date-fns'
import { createNotification, notifyAdmins } from '@/lib/notifications/service'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// ─── POST /api/matches/[id]/dispute ──────────────────────────────────────────
//
// Multi-round dispute flow:
//
//   Round 1: Team A submits → Team B can dispute (non-reporter can dispute)
//   Round 2: Team B disputes → Team A can accept or re-dispute
//   Round 3: Team A re-disputes → Team B can accept or re-dispute
//   Round 4: Team B disputes again → admin resolves (players locked out)
//
// Body: { teamId, set1Challenger, set1Challenged, set2Challenger, set2Challenged,
//         supertiebreakChallenger?, supertiebreakChallenged?, winnerTeamId }

const DISPUTE_WINDOW_MINUTES = 60  // each round after the first gives 60 minutes

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    teamId,
    set1Challenger, set1Challenged,
    set2Challenger, set2Challenged,
    supertiebreakChallenger, supertiebreakChallenged,
    winnerTeamId,
  } = body

  if (!teamId || !winnerTeamId ||
      set1Challenger == null || set1Challenged == null ||
      set2Challenger == null || set2Challenged == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: result, error: resultErr } = await adminClient
    .from('match_results')
    .select(`
      *,
      challenge:challenges(
        id, challenge_code, challenging_team_id, challenged_team_id, season_id,
        season:seasons(*, league_settings(*))
      )
    `)
    .eq('id', params.id)
    .single()

  if (resultErr || !result) {
    return NextResponse.json({ error: 'Match result not found' }, { status: 404 })
  }

  if (result.verified_at || result.auto_verified) {
    return NextResponse.json({ error: 'Result already verified — cannot dispute' }, { status: 400 })
  }
  if (result.dispute_resolved_at) {
    return NextResponse.json({ error: 'Dispute already resolved' }, { status: 400 })
  }
  if (result.dispute_flagged_at) {
    return NextResponse.json({ error: 'This dispute has been escalated to admin — no further player action allowed' }, { status: 400 })
  }

  const challenge = result.challenge as any
  if (!challenge) return NextResponse.json({ error: 'Associated challenge not found' }, { status: 404 })

  const involvedTeamIds = [challenge.challenging_team_id, challenge.challenged_team_id]
  if (!involvedTeamIds.includes(teamId)) {
    return NextResponse.json({ error: 'Your team is not involved in this match' }, { status: 403 })
  }

  // Determine whose turn it is to dispute
  const currentRound: number = result.dispute_round ?? 0
  const pendingTeamId: string | null = result.dispute_pending_team_id ?? null

  if (currentRound === 0) {
    // First dispute — only the non-reporter can file
    if (teamId === result.reported_by_team_id) {
      return NextResponse.json({ error: 'You cannot dispute your own score submission' }, { status: 400 })
    }
  } else {
    // Subsequent rounds — only the pending team can act
    if (pendingTeamId && teamId !== pendingTeamId) {
      return NextResponse.json({ error: 'It is not your turn to dispute' }, { status: 403 })
    }
  }

  // Verify user is actually on the disputing team
  const { data: team } = await adminClient
    .from('teams')
    .select('id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
    .eq('id', teamId)
    .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
    .single()

  if (!team) {
    return NextResponse.json({ error: 'Not authorised to dispute this result' }, { status: 403 })
  }

  const newRound = currentRound + 1
  const nextPendingTeamId = involvedTeamIds.find(id => id !== teamId) ?? null
  const now = new Date()
  const disputeDeadline = addMinutes(now, DISPUTE_WINDOW_MINUTES)

  const disputedScore = {
    set1_challenger:         set1Challenger,
    set1_challenged:         set1Challenged,
    set2_challenger:         set2Challenger,
    set2_challenged:         set2Challenged,
    supertiebreak_challenger: supertiebreakChallenger ?? null,
    supertiebreak_challenged: supertiebreakChallenged ?? null,
    winner_team_id:          winnerTeamId,
  }

  const isEscalation = newRound >= 3  // 3rd dispute → admin

  // Atomic update — ensures no duplicate disputes from rapid clicks
  const { data: updatedRows, error: updateErr } = await adminClient
    .from('match_results')
    .update({
      disputed_score:           disputedScore,
      disputed_at:              now.toISOString(),
      dispute_round:            newRound,
      dispute_pending_team_id:  isEscalation ? null : nextPendingTeamId,
      dispute_deadline:         isEscalation ? null : disputeDeadline.toISOString(),
      ...(isEscalation ? { dispute_flagged_at: now.toISOString() } : {}),
    })
    .eq('id', params.id)
    // Guard: round must still be what we read (prevents race condition)
    .eq('dispute_round', currentRound)
    .select('id')

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ error: 'Dispute already filed — please refresh' }, { status: 409 })
  }

  // Log to challenge timeline
  await logChallengeEvent({
    challengeId: challenge.id,
    eventType:   'result_disputed',
    actorId:     user.id,
    actorRole:   'player',
    data: {
      disputing_team_id:   teamId,
      disputing_team_name: (team as any).name,
      disputed_score:      disputedScore,
      round:               newRound,
      escalated:           isEscalation,
    },
  })

  await adminClient.from('audit_log').insert({
    actor_id:    user.id,
    actor_email: user.email,
    action_type: isEscalation ? 'result_dispute_escalated' : 'result_dispute_filed',
    entity_type: 'match_result',
    entity_id:   params.id,
    new_value:   { disputed_score: disputedScore, round: newRound },
    created_at:  now.toISOString(),
  })

  // Fetch both team names for notifications
  const [{ data: reporterTeam }, { data: disputerTeam }, { data: nextTeam }] = await Promise.all([
    adminClient.from('teams')
      .select('name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
      .eq('id', result.reported_by_team_id).single(),
    adminClient.from('teams')
      .select('name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
      .eq('id', teamId).single(),
    nextPendingTeamId && !isEscalation
      ? adminClient.from('teams')
          .select('name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
          .eq('id', nextPendingTeamId).single()
      : Promise.resolve({ data: null }),
  ])

  const appUrl   = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const chalUrl  = `${appUrl}/challenges/${challenge.id}`

  if (isEscalation) {
    // Round 3+ → notify both teams and admins that admin will resolve
    const bothTeams = [
      { team: reporterTeam,  id: result.reported_by_team_id },
      { team: disputerTeam,  id: teamId },
    ]
    for (const { team: t, id: tid } of bothTeams) {
      if (!t) continue
      for (const player of [(t as any).player1, (t as any).player2]) {
        if (!player) continue
        await createNotification({
          playerId:  player.id,
          teamId:    tid,
          type:      'result_dispute_escalated',
          title:     '⚠️ Dispute Escalated to Admin',
          message:   `After multiple rounds of dispute for the match ${challenge.challenging_team_id === tid ? (reporterTeam as any)?.name : (disputerTeam as any)?.name} vs ${challenge.challenging_team_id !== tid ? (reporterTeam as any)?.name : (disputerTeam as any)?.name}, an admin will now determine the final score.`,
          actionUrl: chalUrl,
          sendEmail: true,
        })
      }
    }

    const appUrlAdmin = `${appUrl}/admin/challenges`
    await notifyAdmins({
      type:      'admin_score_dispute',
      title:     '⚠️ Match Score Disputed — Admin Required',
      message:   `${(reporterTeam as any)?.name ?? 'Team A'} vs ${(disputerTeam as any)?.name ?? 'Team B'} (${challenge.challenge_code}) — maximum disputes reached. Please set the final score.`,
      actionUrl: appUrlAdmin,
    })

  } else {
    // Notify the team that must act next
    if (nextTeam) {
      for (const player of [(nextTeam as any).player1, (nextTeam as any).player2]) {
        if (!player) continue
        await createNotification({
          playerId:  player.id,
          teamId:    nextPendingTeamId!,
          type:      'result_dispute_received',
          title:     `⚠️ Score Disputed (Round ${newRound})`,
          message:   `${(team as any).name} has submitted a different score. You have ${DISPUTE_WINDOW_MINUTES} minutes to accept their version or file a counter-score.`,
          actionUrl: chalUrl,
          sendEmail: true,
        })
      }
    }
    // Confirm to the disputer
    for (const player of [(disputerTeam as any)?.player1, (disputerTeam as any)?.player2]) {
      if (!player) continue
      await createNotification({
        playerId:  player.id,
        teamId,
        type:      'result_dispute_filed',
        title:     '🔄 Dispute Filed',
        message:   `Your counter-score has been sent. The other team has ${DISPUTE_WINDOW_MINUTES} minutes to respond.`,
        actionUrl: chalUrl,
        sendEmail: false,
      })
    }
  }

  return NextResponse.json({ success: true, round: newRound, escalated: isEscalation })
}
