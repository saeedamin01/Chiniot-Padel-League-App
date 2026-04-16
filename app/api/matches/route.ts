import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { addMinutes } from 'date-fns'
import { createNotification } from '@/lib/notifications/service'
import { logChallengeEvent } from '@/lib/challenges/events'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    challengeId,
    reportingTeamId,
    set1Challenger, set1Challenged,
    set2Challenger, set2Challenged,
    supertiebreakChallenger, supertiebreakChallenged,
    matchDate, matchLocation,
    venueId,          // optional — overrides the scheduled venue if the teams played elsewhere
  } = body

  const adminClient = createAdminClient()

  // Verify challenge exists and is scheduled
  const { data: challenge, error: challengeErr } = await adminClient
    .from('challenges')
    .select('*, season:seasons(*, league_settings(*))')
    .eq('id', challengeId)
    .eq('status', 'scheduled')
    .single()

  if (challengeErr || !challenge) {
    return NextResponse.json({ error: 'Challenge not found or not scheduled' }, { status: 400 })
  }

  // Verify user is on reporting team
  const { data: team } = await adminClient
    .from('teams')
    .select('*')
    .eq('id', reportingTeamId)
    .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
    .single()

  if (!team) {
    return NextResponse.json({ error: 'You are not a member of this team' }, { status: 403 })
  }

  // Determine winner based on scores
  let challengerSets = 0
  let challengedSets = 0

  if (set1Challenger > set1Challenged) challengerSets++
  else challengedSets++

  if (set2Challenger > set2Challenged) challengerSets++
  else challengedSets++

  let winnerId: string
  let loserId: string

  if (challengerSets === 2) {
    winnerId = challenge.challenging_team_id
    loserId = challenge.challenged_team_id
  } else if (challengedSets === 2) {
    winnerId = challenge.challenged_team_id
    loserId = challenge.challenging_team_id
  } else {
    // 1-1: need supertiebreak
    if (supertiebreakChallenger > supertiebreakChallenged) {
      winnerId = challenge.challenging_team_id
      loserId = challenge.challenged_team_id
    } else {
      winnerId = challenge.challenged_team_id
      loserId = challenge.challenging_team_id
    }
  }

  const settings = challenge.season?.league_settings
  const verifyMinutes = settings?.result_verify_minutes ?? 30
  const verifyDeadline = addMinutes(new Date(), verifyMinutes).toISOString()

  // Create match result record
  const { data: result, error: resultErr } = await adminClient
    .from('match_results')
    .insert({
      challenge_id: challengeId,
      season_id: challenge.season_id,
      winner_team_id: winnerId,
      loser_team_id: loserId,
      set1_challenger: set1Challenger,
      set1_challenged: set1Challenged,
      set2_challenger: set2Challenger,
      set2_challenged: set2Challenged,
      supertiebreak_challenger: supertiebreakChallenger || null,
      supertiebreak_challenged: supertiebreakChallenged || null,
      reported_by_team_id: reportingTeamId,
      match_date: matchDate,
      match_location: matchLocation,
      verify_deadline: verifyDeadline,
    })
    .select()
    .single()

  if (resultErr) return NextResponse.json({ error: resultErr.message }, { status: 500 })

  // Update challenge status to 'played', and override venue if the teams played elsewhere
  await adminClient
    .from('challenges')
    .update({
      status: 'played',
      ...(venueId ? { venue_id: venueId } : {}),
    })
    .eq('id', challengeId)

  // Log to challenge timeline
  const winnerName = winnerId === challenge.challenging_team_id
    ? (challenge as any).challenging_team?.name ?? 'Challenger'
    : (challenge as any).challenged_team?.name ?? 'Challenged'
  await logChallengeEvent({
    challengeId: challengeId,
    eventType: 'score_entered',
    actorId: user.id,
    actorRole: 'player',
    data: {
      set1: `${set1Challenger}-${set1Challenged}`,
      set2: `${set2Challenger}-${set2Challenged}`,
      supertiebreak: supertiebreakChallenger != null ? `${supertiebreakChallenger}-${supertiebreakChallenged}` : null,
      winner_id: winnerId,
    },
  })

  // Notify opposing team to verify
  const opposingTeamId = reportingTeamId === challenge.challenging_team_id
    ? challenge.challenged_team_id
    : challenge.challenging_team_id

  const { data: opposingTeam } = await adminClient
    .from('teams')
    .select('*, player1:players!player1_id(*), player2:players!player2_id(*)')
    .eq('id', opposingTeamId)
    .single()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (opposingTeam) {
    for (const player of [opposingTeam.player1, opposingTeam.player2]) {
      if (!player) continue
      await createNotification({
        playerId: player.id,
        teamId: opposingTeamId,
        type: 'result_reported',
        title: 'Match Result Reported',
        message: `A result has been submitted for your match. Please verify it within ${verifyMinutes} minutes.`,
        actionUrl: `${appUrl}/challenges/${challengeId}`,
        sendEmail: true,
      })
    }
  }

  return NextResponse.json({ result })
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')
  const limit = parseInt(searchParams.get('limit') || '20')

  const adminClient = createAdminClient()

  let query = adminClient
    .from('match_results')
    .select(`
      *,
      winner_team:teams!winner_team_id(name),
      loser_team:teams!loser_team_id(name),
      challenge:challenges(
        challenge_code,
        challenging_team_id,
        challenged_team_id,
        match_location,
        tier:tiers(name, color)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (teamId) {
    query = query.or(`winner_team_id.eq.${teamId},loser_team_id.eq.${teamId}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ matches: data })
}
