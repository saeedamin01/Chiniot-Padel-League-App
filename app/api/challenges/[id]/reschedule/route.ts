import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'
import { checkLeagueLock } from '@/lib/league/lock'

export const dynamic = 'force-dynamic'

// POST /api/challenges/[id]/reschedule
//
// Either team on a SCHEDULED challenge can propose a new time and/or venue.
// Requires admin approval after the other team confirms.
//
// Status: scheduled → reschedule_requested
//
// Body: { proposedTime: ISO string, proposedVenueId?: string, reason?: string }
// Constraints:
//   - proposedTime must be on a 30-minute boundary
//   - proposedTime must be before match_deadline

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

    const lockResponse = await checkLeagueLock()
    if (lockResponse) return lockResponse

    const body = await request.json()
    const { proposedTime, proposedVenueId, reason } = body

    if (!proposedTime) {
      return NextResponse.json({ error: 'proposedTime is required' }, { status: 400 })
    }

    const proposedDate = new Date(proposedTime)
    if (isNaN(proposedDate.getTime())) {
      return NextResponse.json({ error: 'Invalid proposedTime' }, { status: 400 })
    }

    if (proposedDate.getMinutes() % 30 !== 0 || proposedDate.getSeconds() !== 0) {
      return NextResponse.json(
        { error: 'Proposed time must be on a :00 or :30 boundary (e.g. 18:00 or 18:30)' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('*')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status !== 'scheduled') {
      return NextResponse.json(
        { error: 'Reschedule can only be requested for scheduled matches' },
        { status: 400 }
      )
    }

    // Must be before match_deadline
    if (proposedDate >= new Date(challenge.match_deadline)) {
      return NextResponse.json(
        { error: 'Proposed time must be before the match deadline' },
        { status: 400 }
      )
    }

    // Verify user is on one of the two teams
    const { data: challengingTeam } = await adminClient
      .from('teams').select('*').eq('id', challenge.challenging_team_id).single()
    const { data: challengedTeam } = await adminClient
      .from('teams').select('*').eq('id', challenge.challenged_team_id).single()

    const isChallenger = challengingTeam?.player1_id === user.id || challengingTeam?.player2_id === user.id
    const isChallenged = challengedTeam?.player1_id === user.id || challengedTeam?.player2_id === user.id

    if (!isChallenger && !isChallenged) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const requestingTeamId = isChallenger ? challenge.challenging_team_id : challenge.challenged_team_id
    const otherTeam = isChallenger ? challengedTeam : challengingTeam
    const requestingTeam = isChallenger ? challengingTeam : challengedTeam

    const now = new Date()

    const { data: updated, error: updateError } = await adminClient
      .from('challenges')
      .update({
        status: 'reschedule_requested',
        reschedule_requested_by: requestingTeamId,
        reschedule_proposed_time: proposedDate.toISOString(),
        reschedule_proposed_venue_id: proposedVenueId || null,
        reschedule_reason: reason || null,
        // Preserve original so admin can revert on rejection
        original_confirmed_time: challenge.confirmed_time,
        original_venue_id: challenge.venue_id,
      })
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Notify the other team to confirm or decline
    if (otherTeam) {
      const formattedTime = proposedDate.toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
      await adminClient.from('notifications').insert([
        {
          player_id: otherTeam.player1_id,
          team_id: otherTeam.id,
          type: 'reschedule_requested',
          title: 'Reschedule Request',
          message: `${requestingTeam?.name} wants to reschedule your match to ${formattedTime}${reason ? ` — "${reason}"` : ''}. Accept and it will be confirmed immediately.`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: otherTeam.player2_id,
          team_id: otherTeam.id,
          type: 'reschedule_requested',
          title: 'Reschedule Request',
          message: `${requestingTeam?.name} wants to reschedule your match to ${formattedTime}${reason ? ` — "${reason}"` : ''}. Accept and it will be confirmed immediately.`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
      ])
    }

    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'reschedule_requested',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: {
        proposed_time: proposedDate.toISOString(),
        proposed_venue_id: proposedVenueId || null,
        requested_by: requestingTeamId,
        reason,
      },
      created_at: now.toISOString(),
    })

    await logChallengeEvent({
      challengeId: params.id,
      eventType: 'reschedule_requested',
      actorId: user.id,
      actorRole: 'player',
      data: {
        proposed_time: proposedTime,
        proposed_venue_id: proposedVenueId || null,
        reason: reason || null,
      },
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error requesting reschedule:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
