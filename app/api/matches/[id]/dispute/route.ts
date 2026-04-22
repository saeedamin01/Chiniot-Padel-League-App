import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { addMinutes } from 'date-fns'
import { createNotification } from '@/lib/notifications/service'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// ─── POST /api/matches/[id]/dispute ──────────────────────────────────────────
//
// Called by the non-reporting team when they disagree with a submitted score.
// Body: { teamId, set1Challenger, set1Challenged, set2Challenger, set2Challenged,
//         supertiebreakChallenger?, supertiebreakChallenged?, winnerTeamId }
//
// Effect:
//   • Stores the counter-score in match_results.disputed_score (JSONB)
//   • Sets match_results.disputed_at = now
//   • Notifies both teams
//   • Notifies admins if dispute_window_minutes = 0 (immediate escalation)
//
// The original reporter then has dispute_window_minutes to accept (see /resolve).

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

  // Fetch match result (with challenge + season settings)
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

  if (result.disputed_at) {
    return NextResponse.json({ error: 'A dispute has already been filed for this result' }, { status: 400 })
  }

  if (result.dispute_resolved_at) {
    return NextResponse.json({ error: 'Dispute already resolved' }, { status: 400 })
  }

  // Confirm the disputing team is the non-reporting team on this challenge
  const challenge = result.challenge as any
  if (!challenge) return NextResponse.json({ error: 'Associated challenge not found' }, { status: 404 })

  const involvedTeamIds = [challenge.challenging_team_id, challenge.challenged_team_id]
  if (!involvedTeamIds.includes(teamId)) {
    return NextResponse.json({ error: 'Your team is not involved in this match' }, { status: 403 })
  }
  if (teamId === result.reported_by_team_id) {
    return NextResponse.json({ error: 'You cannot dispute your own score submission' }, { status: 400 })
  }

  // Verify user is on the disputing team
  const { data: team } = await adminClient
    .from('teams')
    .select('id, name')
    .eq('id', teamId)
    .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
    .single()

  if (!team) {
    return NextResponse.json({ error: 'Not authorised to dispute this result' }, { status: 403 })
  }

  const settings = (challenge.season as any)?.league_settings
  const disputeWindowMinutes: number = settings?.dispute_window_minutes ?? 30

  const disputedScore = {
    set1_challenger: set1Challenger,
    set1_challenged: set1Challenged,
    set2_challenger: set2Challenger,
    set2_challenged: set2Challenged,
    supertiebreak_challenger: supertiebreakChallenger ?? null,
    supertiebreak_challenged: supertiebreakChallenged ?? null,
    winner_team_id: winnerTeamId,
  }

  const now = new Date()

  // Compute the flag deadline (reporter has this many minutes to accept or we escalate)
  const flagDeadline = addMinutes(now, disputeWindowMinutes)

  const { error: updateErr } = await adminClient
    .from('match_results')
    .update({
      disputed_score: disputedScore,
      disputed_at: now.toISOString(),
    })
    .eq('id', params.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Log to challenge timeline
  await logChallengeEvent({
    challengeId: challenge.id,
    eventType: 'result_disputed',
    actorId: user.id,
    actorRole: 'player',
    data: {
      disputing_team_id: teamId,
      disputing_team_name: (team as any).name,
      disputed_score: disputedScore,
    },
  })

  // Audit log
  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    actor_email: user.email,
    action_type: 'result_dispute_filed',
    entity_type: 'match_result',
    entity_id: params.id,
    old_value: {
      set1: `${result.set1_challenger}-${result.set1_challenged}`,
      set2: `${result.set2_challenger}-${result.set2_challenged}`,
      winner_team_id: result.winner_team_id,
    },
    new_value: {
      disputed_score: disputedScore,
    },
    created_at: now.toISOString(),
  })

  // Fetch team names for notifications
  const [{ data: reporterTeam }, { data: disputerTeam }] = await Promise.all([
    adminClient.from('teams')
      .select('name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
      .eq('id', result.reported_by_team_id).single(),
    adminClient.from('teams')
      .select('name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
      .eq('id', teamId).single(),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const challengeUrl = `${appUrl}/challenges/${challenge.id}`

  // Notify original reporter: they have the dispute window to accept or escalate
  if (reporterTeam) {
    const windowMsg = disputeWindowMinutes > 0
      ? ` You have ${disputeWindowMinutes} minute${disputeWindowMinutes !== 1 ? 's' : ''} to accept their version, otherwise an admin will be notified.`
      : ' An admin has been notified to review.'

    for (const player of [(reporterTeam as any).player1, (reporterTeam as any).player2]) {
      if (!player) continue
      await createNotification({
        playerId: player.id,
        teamId: result.reported_by_team_id,
        type: 'result_dispute_received',
        title: '⚠️ Score Disputed',
        message: `${(disputerTeam as any)?.name ?? 'The opposing team'} disagrees with your submitted score and has entered their version.${windowMsg}`,
        actionUrl: challengeUrl,
        sendEmail: true,
      })
    }
  }

  // Notify the disputing team: confirmation their dispute was filed
  if (disputerTeam) {
    for (const player of [(disputerTeam as any).player1, (disputerTeam as any).player2]) {
      if (!player) continue
      await createNotification({
        playerId: player.id,
        teamId: teamId,
        type: 'result_dispute_filed',
        title: '🔄 Dispute Filed',
        message: `Your counter-score has been sent to ${(reporterTeam as any)?.name ?? 'the other team'} for review.`,
        actionUrl: challengeUrl,
        sendEmail: false,
      })
    }
  }

  // If window is 0, immediately flag and notify admins
  if (disputeWindowMinutes === 0) {
    await adminClient
      .from('match_results')
      .update({ dispute_flagged_at: now.toISOString() })
      .eq('id', params.id)

    const { data: admins } = await adminClient
      .from('players')
      .select('id')
      .eq('is_admin', true)

    if (admins) {
      for (const admin of admins) {
        await createNotification({
          playerId: admin.id,
          type: 'admin_score_dispute',
          title: '⚠️ Match Score Disputed',
          message: `${(disputerTeam as any)?.name ?? 'A team'} disputes the score reported by ${(reporterTeam as any)?.name ?? 'the opposing team'} for challenge ${challenge.challenge_code}.`,
          actionUrl: `${appUrl}/admin/challenges?filter=disputed`,
          sendEmail: true,
        })
      }
    }
  }

  return NextResponse.json({ success: true, flagDeadline: flagDeadline.toISOString() })
}
