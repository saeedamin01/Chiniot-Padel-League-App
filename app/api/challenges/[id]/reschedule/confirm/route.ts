import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'
import { notifyAdmins } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

// POST /api/challenges/[id]/reschedule/confirm
//
// Called by the OTHER team (not who requested the reschedule) to either
// agree to the reschedule (→ reschedule_pending_admin, awaiting admin approval)
// or decline it (→ back to scheduled, original time kept).
//
// Body: { action: 'confirm' | 'decline' }

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

    if (!action || !['confirm', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be "confirm" or "decline"' }, { status: 400 })
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

    if (challenge.status !== 'reschedule_requested') {
      return NextResponse.json(
        { error: 'No pending reschedule request on this challenge' },
        { status: 400 }
      )
    }

    // Verify user is on the OTHER team (not the requester)
    const { data: challengingTeam } = await adminClient
      .from('teams').select('*').eq('id', challenge.challenging_team_id).single()
    const { data: challengedTeam } = await adminClient
      .from('teams').select('*').eq('id', challenge.challenged_team_id).single()

    const isChallenger = challengingTeam?.player1_id === user.id || challengingTeam?.player2_id === user.id
    const isChallenged = challengedTeam?.player1_id === user.id || challengedTeam?.player2_id === user.id

    if (!isChallenger && !isChallenged) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const myTeamId = isChallenger ? challenge.challenging_team_id : challenge.challenged_team_id
    if (myTeamId === challenge.reschedule_requested_by) {
      return NextResponse.json(
        { error: 'You cannot confirm your own reschedule request' },
        { status: 400 }
      )
    }

    const now = new Date()
    const requestingTeam = challenge.reschedule_requested_by === challenge.challenging_team_id
      ? challengingTeam : challengedTeam
    const confirmingTeam = isChallenger ? challengingTeam : challengedTeam

    if (action === 'confirm') {
      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'reschedule_pending_admin',
          reschedule_confirmed_at: now.toISOString(),
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      // Notify requesting team their counterpart agreed
      if (requestingTeam) {
        await adminClient.from('notifications').insert([
          {
            player_id: requestingTeam.player1_id,
            team_id: requestingTeam.id,
            type: 'reschedule_confirmed',
            title: 'Reschedule Agreed — Awaiting Admin',
            message: `${confirmingTeam?.name} agreed to the reschedule. It's now pending admin approval.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: requestingTeam.player2_id,
            team_id: requestingTeam.id,
            type: 'reschedule_confirmed',
            title: 'Reschedule Agreed — Awaiting Admin',
            message: `${confirmingTeam?.name} agreed to the reschedule. It's now pending admin approval.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      }

      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action_type: 'reschedule_team_confirmed',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { status: 'reschedule_pending_admin' },
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: 'reschedule_confirmed_by_team',
        actorId: user.id,
        actorRole: 'player',
        data: { action },
      })

      // Notify admins: action required
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      await notifyAdmins({
        type: 'reschedule_pending_admin',
        title: '🗓 Reschedule needs your approval',
        message: `${challengingTeam?.name} vs ${challengedTeam?.name} (${challenge.challenge_code}) — both teams agreed to reschedule. Please review and approve or reject.`,
        actionUrl: `${appUrl}/admin/challenges`,
      })

      return NextResponse.json({ challenge: updated })

    } else {
      // Decline — revert to scheduled, clear reschedule fields
      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'scheduled',
          reschedule_requested_by: null,
          reschedule_proposed_time: null,
          reschedule_proposed_venue_id: null,
          reschedule_reason: null,
          reschedule_confirmed_at: null,
          original_confirmed_time: null,
          original_venue_id: null,
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      // Notify requesting team their reschedule was declined
      if (requestingTeam) {
        await adminClient.from('notifications').insert([
          {
            player_id: requestingTeam.player1_id,
            team_id: requestingTeam.id,
            type: 'reschedule_declined',
            title: 'Reschedule Declined',
            message: `${confirmingTeam?.name} declined the reschedule request. The match remains at the original scheduled time.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: requestingTeam.player2_id,
            team_id: requestingTeam.id,
            type: 'reschedule_declined',
            title: 'Reschedule Declined',
            message: `${confirmingTeam?.name} declined the reschedule request. The match remains at the original scheduled time.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      }

      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action_type: 'reschedule_declined',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { status: 'scheduled' },
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: 'reschedule_declined_by_team',
        actorId: user.id,
        actorRole: 'player',
        data: { action },
      })

      return NextResponse.json({ challenge: updated })
    }
  } catch (err) {
    console.error('Error confirming reschedule:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
