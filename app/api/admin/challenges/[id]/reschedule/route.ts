import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'

// PATCH /api/admin/challenges/[id]/reschedule
//
// Admin approves or rejects a reschedule that both teams agreed to.
//
// approve → update confirmed_time + venue_id with the proposed values → 'scheduled'
// reject  → revert to original_confirmed_time + original_venue_id  → 'scheduled'
//
// Body: { action: 'approve' | 'reject', adminNote?: string }

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Admin check
    const { data: adminCheck } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { action, adminNote } = body

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
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

    if (challenge.status !== 'reschedule_pending_admin') {
      return NextResponse.json(
        { error: 'Challenge is not awaiting reschedule approval' },
        { status: 400 }
      )
    }

    const now = new Date()

    // Fetch both teams for notifications
    const { data: challengingTeam } = await adminClient
      .from('teams').select('player1_id, player2_id, name').eq('id', challenge.challenging_team_id).single()
    const { data: challengedTeam } = await adminClient
      .from('teams').select('player1_id, player2_id, name').eq('id', challenge.challenged_team_id).single()

    if (action === 'approve') {
      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'scheduled',
          confirmed_time: challenge.reschedule_proposed_time,
          match_date: challenge.reschedule_proposed_time,
          venue_id: challenge.reschedule_proposed_venue_id ?? challenge.venue_id,
          reschedule_approved_by: user.id,
          reschedule_approved_at: now.toISOString(),
          // Clear reschedule fields
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

      const formattedTime = new Date(challenge.reschedule_proposed_time).toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })

      const notifMsg = `Your reschedule request was approved. Match is now scheduled for ${formattedTime}.${adminNote ? ` Admin note: ${adminNote}` : ''}`
      const allPlayers = [
        { id: challengingTeam?.player1_id, teamId: challenge.challenging_team_id },
        { id: challengingTeam?.player2_id, teamId: challenge.challenging_team_id },
        { id: challengedTeam?.player1_id, teamId: challenge.challenged_team_id },
        { id: challengedTeam?.player2_id, teamId: challenge.challenged_team_id },
      ].filter(p => p.id)

      await adminClient.from('notifications').insert(
        allPlayers.map(p => ({
          player_id: p.id,
          team_id: p.teamId,
          type: 'reschedule_approved',
          title: 'Reschedule Approved',
          message: notifMsg,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        }))
      )

      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action_type: 'reschedule_approved',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { new_time: challenge.reschedule_proposed_time, admin_note: adminNote },
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: 'reschedule_approved',
        actorId: user.id,
        actorRole: 'admin',
        data: { new_time: challenge.reschedule_proposed_time, admin_note: adminNote || null },
      })

      return NextResponse.json({ challenge: updated })

    } else {
      // Reject — revert to original scheduled time/venue
      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'scheduled',
          confirmed_time: challenge.original_confirmed_time,
          match_date: challenge.original_confirmed_time,
          venue_id: challenge.original_venue_id,
          // Clear reschedule fields
          reschedule_requested_by: null,
          reschedule_proposed_time: null,
          reschedule_proposed_venue_id: null,
          reschedule_reason: null,
          reschedule_confirmed_at: null,
          reschedule_approved_by: null,
          reschedule_approved_at: null,
          original_confirmed_time: null,
          original_venue_id: null,
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      const allPlayers = [
        { id: challengingTeam?.player1_id, teamId: challenge.challenging_team_id },
        { id: challengingTeam?.player2_id, teamId: challenge.challenging_team_id },
        { id: challengedTeam?.player1_id, teamId: challenge.challenged_team_id },
        { id: challengedTeam?.player2_id, teamId: challenge.challenged_team_id },
      ].filter(p => p.id)

      await adminClient.from('notifications').insert(
        allPlayers.map(p => ({
          player_id: p.id,
          team_id: p.teamId,
          type: 'reschedule_rejected',
          title: 'Reschedule Not Approved',
          message: `The reschedule request was not approved. The match remains at the original time.${adminNote ? ` Admin note: ${adminNote}` : ''}`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        }))
      )

      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action_type: 'reschedule_rejected',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { reverted_to: challenge.original_confirmed_time, admin_note: adminNote },
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: 'reschedule_rejected',
        actorId: user.id,
        actorRole: 'admin',
        data: { reverted_to: challenge.original_confirmed_time, admin_note: adminNote || null },
      })

      return NextResponse.json({ challenge: updated })
    }
  } catch (err) {
    console.error('Error processing reschedule approval:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
