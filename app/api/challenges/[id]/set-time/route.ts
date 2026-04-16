import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { addHours } from 'date-fns'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// POST /api/challenges/[id]/set-time
//
// Either team can enter the agreed match time when status is 'accepted_open'.
// Whichever team submits the time, the OTHER team must confirm.
// Status: accepted_open → time_pending_confirm
//
// Body: { confirmedTime: ISO string, venueId: string }
// Constraints:
//   - confirmedTime must be before match_deadline
//   - confirmedTime must be on a 30-minute boundary
//   - venueId is required

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { confirmedTime, venueId } = body

    if (!confirmedTime) {
      return NextResponse.json({ error: 'confirmedTime is required' }, { status: 400 })
    }

    if (!venueId) {
      return NextResponse.json({ error: 'venueId is required — please select a venue' }, { status: 400 })
    }

    const confirmedDate = new Date(confirmedTime)
    if (isNaN(confirmedDate.getTime())) {
      return NextResponse.json({ error: 'Invalid confirmedTime' }, { status: 400 })
    }

    // 30-minute boundary check
    if (confirmedDate.getMinutes() % 30 !== 0 || confirmedDate.getSeconds() !== 0) {
      return NextResponse.json(
        { error: 'Time must be on a :00 or :30 boundary (e.g. 18:00 or 18:30)' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('*, season:seasons(*, league_settings(*))')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status !== 'accepted_open') {
      return NextResponse.json(
        { error: 'Challenge is not in accepted_open state — time can only be set after open acceptance' },
        { status: 400 }
      )
    }

    // Verify user belongs to either team — either team can submit the agreed time
    const [{ data: challengingTeam }, { data: challengedTeam }] = await Promise.all([
      adminClient.from('teams').select('*').eq('id', challenge.challenging_team_id).single(),
      adminClient.from('teams').select('*').eq('id', challenge.challenged_team_id).single(),
    ])

    const isOnChallengingTeam = !!(challengingTeam &&
      (challengingTeam.player1_id === user.id || challengingTeam.player2_id === user.id))
    const isOnChallengedTeam = !!(challengedTeam &&
      (challengedTeam.player1_id === user.id || challengedTeam.player2_id === user.id))

    if (!isOnChallengingTeam && !isOnChallengedTeam) {
      return NextResponse.json({ error: 'You must be a member of one of the teams in this challenge' }, { status: 403 })
    }

    // The team that did NOT submit is the one that must confirm
    const submittingTeam = isOnChallengingTeam ? challengingTeam! : challengedTeam!
    const confirmingTeam = isOnChallengingTeam ? challengedTeam! : challengingTeam!

    // Must be before match_deadline
    if (confirmedDate >= new Date(challenge.match_deadline)) {
      return NextResponse.json(
        { error: 'The agreed time must be before the match deadline' },
        { status: 400 }
      )
    }

    const settings = challenge.season?.league_settings
    const confirmationWindowHours = settings?.confirmation_window_hours ?? 12
    const now = new Date()

    const { data: updated, error: updateError } = await adminClient
      .from('challenges')
      .update({
        status: 'time_pending_confirm',
        confirmed_time: confirmedDate.toISOString(),
        venue_id: venueId,
        confirmation_deadline: addHours(now, confirmationWindowHours).toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Notify the OTHER team to confirm
    const formattedTime = confirmedDate.toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })

    if (confirmingTeam) {
      await adminClient.from('notifications').insert([
        {
          player_id: confirmingTeam.player1_id,
          team_id: confirmingTeam.id,
          type: 'challenge_awaiting_confirm',
          title: 'Match Time Set — Please Confirm',
          message: `${submittingTeam.name} entered the agreed match time: ${formattedTime}. Please confirm within ${confirmationWindowHours}h.`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: confirmingTeam.player2_id,
          team_id: confirmingTeam.id,
          type: 'challenge_awaiting_confirm',
          title: 'Match Time Set — Please Confirm',
          message: `${submittingTeam.name} entered the agreed match time: ${formattedTime}. Please confirm within ${confirmationWindowHours}h.`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
      ])
    }

    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'challenge_time_set',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: { status: 'time_pending_confirm', confirmed_time: confirmedDate.toISOString(), venue_id: venueId, submitted_by_team: submittingTeam.id },
      created_at: now.toISOString(),
    })

    await logChallengeEvent({
      challengeId: params.id,
      eventType: 'time_set',
      actorId: user.id,
      actorRole: 'player',
      actorName: submittingTeam.name,
      data: { confirmed_time: confirmedDate.toISOString(), venue_id: venueId, submitted_by_team: submittingTeam.id },
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error setting challenge time:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
