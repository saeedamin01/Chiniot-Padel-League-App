import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// POST /api/challenges/[id]/confirm
//
// Called by the CHALLENGING team after the challenged team sets the time/venue.
// Body: { action: 'confirm' | 'dispute' }
//
// confirm  → moves to 'scheduled'. Match is officially on the books.
// dispute  → moves back to 'pending' so the challenged team can re-enter the time.
//            Use this if the time entered doesn't match what was agreed offline.
//
// Auto-confirm: if the challenger doesn't respond before confirmation_deadline,
// any page load that reads the challenge should call checkAndAutoConfirm() which
// will move it to 'scheduled' automatically.

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
    const { action } = body

    if (!action || !['confirm', 'dispute'].includes(action)) {
      return NextResponse.json({ error: 'action must be confirm or dispute' }, { status: 400 })
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

    if (!['accepted', 'time_pending_confirm'].includes(challenge.status)) {
      return NextResponse.json({ error: 'Challenge is not awaiting confirmation' }, { status: 400 })
    }

    // Verify user is on challenging team
    const { data: challengingTeam } = await adminClient
      .from('teams')
      .select('*')
      .eq('id', challenge.challenging_team_id)
      .single()

    if (
      !challengingTeam ||
      (challengingTeam.player1_id !== user.id && challengingTeam.player2_id !== user.id)
    ) {
      return NextResponse.json({ error: 'Not authorized to confirm this challenge' }, { status: 403 })
    }

    const now = new Date()

    if (action === 'confirm') {
      // Move to scheduled — match is officially on the books
      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'scheduled',
          scheduled_at: now.toISOString(),
          match_date: challenge.confirmed_time, // keep match_date in sync for existing queries
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      // Notify challenged team
      const { data: challengedTeamData } = await adminClient
        .from('teams')
        .select('player1_id, player2_id')
        .eq('id', challenge.challenged_team_id)
        .single()

      const formattedTime = challenge.confirmed_time
        ? new Date(challenge.confirmed_time).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })
        : 'the agreed time'

      if (challengedTeamData) {
        await adminClient.from('notifications').insert([
          {
            player_id: challengedTeamData.player1_id,
            team_id: challenge.challenged_team_id,
            type: 'challenge_scheduled',
            title: 'Match Confirmed',
            message: `${challengingTeam.name} confirmed the match for ${formattedTime}. Good luck!`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: challengedTeamData.player2_id,
            team_id: challenge.challenged_team_id,
            type: 'challenge_scheduled',
            title: 'Match Confirmed',
            message: `${challengingTeam.name} confirmed the match for ${formattedTime}. Good luck!`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      }

      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action_type: 'challenge_confirmed',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { status: 'scheduled', match_date: challenge.confirmed_time },
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: 'time_confirmed',
        actorId: user.id,
        actorRole: 'player',
        actorName: challengingTeam.name,
        data: { confirmed_time: challenge.confirmed_time },
      })

      return NextResponse.json({ challenge: updated })

    } else {
      // Dispute:
      // - 'accepted' (slot chosen)       → back to 'pending' (Team B re-accepts entirely)
      // - 'time_pending_confirm'          → back to 'accepted_open' (Team B re-enters a time)
      const revertStatus = challenge.status === 'time_pending_confirm' ? 'accepted_open' : 'pending'

      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: revertStatus,
          confirmed_time: null,
          accepted_slot: revertStatus === 'pending' ? null : challenge.accepted_slot,
          venue_id: null,
          confirmation_deadline: null,
          ...(revertStatus === 'pending' ? { accepted_at: null } : {}),
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      // Notify challenged team to re-enter the time
      const { data: challengedTeamData } = await adminClient
        .from('teams')
        .select('player1_id, player2_id')
        .eq('id', challenge.challenged_team_id)
        .single()

      if (challengedTeamData) {
        await adminClient.from('notifications').insert([
          {
            player_id: challengedTeamData.player1_id,
            team_id: challenge.challenged_team_id,
            type: 'challenge_disputed',
            title: 'Match Time Disputed',
            message: challenge.status === 'time_pending_confirm'
                ? `${challengingTeam.name} disputed the time you entered. Please coordinate again and enter the new agreed time.`
                : `${challengingTeam.name} disputed the slot. Please accept the challenge again with a new agreed time.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: challengedTeamData.player2_id,
            team_id: challenge.challenged_team_id,
            type: 'challenge_disputed',
            title: 'Match Time Disputed',
            message: challenge.status === 'time_pending_confirm'
                ? `${challengingTeam.name} disputed the time you entered. Please coordinate again and enter the new agreed time.`
                : `${challengingTeam.name} disputed the slot. Please accept the challenge again with a new agreed time.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      }

      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action_type: 'challenge_disputed',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { status: 'pending' },
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: 'time_disputed',
        actorId: user.id,
        actorRole: 'player',
        actorName: challengingTeam.name,
        data: { reverted_to: revertStatus },
      })

      return NextResponse.json({ challenge: updated })
    }
  } catch (err) {
    console.error('Error confirming challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
