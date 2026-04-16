import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processForfeit } from '@/lib/ladder/engine'

// Challenging team confirms or rejects the proposed revised slot
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
    const { action } = body // 'confirm' or 'reject'

    if (!['confirm', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Action must be confirm or reject' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Get challenge
    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('*')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status !== 'revision_proposed') {
      return NextResponse.json({ error: 'No revision to confirm on this challenge' }, { status: 400 })
    }

    if (!challenge.proposed_slot) {
      return NextResponse.json({ error: 'No proposed slot found' }, { status: 400 })
    }

    // Verify user is on the challenging team
    const { data: challengingTeam } = await adminClient
      .from('teams')
      .select('*')
      .eq('id', challenge.challenging_team_id)
      .single()

    if (!challengingTeam || (challengingTeam.player1_id !== user.id && challengingTeam.player2_id !== user.id)) {
      return NextResponse.json({ error: 'Only the challenging team can confirm or reject a proposed revision' }, { status: 403 })
    }

    const now = new Date()
    let updated: any
    let notifTitle: string
    let notifMessage: string

    if (action === 'confirm') {
      // Challenger confirms — set match_date to proposed_slot, status → scheduled
      const { data, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'scheduled',
          match_date: challenge.proposed_slot,
          match_location: challenge.proposed_location || challenge.match_location,
          accepted_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
      updated = data

      const slotDate = new Date(challenge.proposed_slot).toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
      notifTitle = 'Match Scheduled'
      notifMessage = `${challengingTeam.name} confirmed the revised time: ${slotDate}. Match is now scheduled!`

    } else {
      // Challenger rejects — challenge goes back to pending, proposed slot cleared
      // Rejecting the revision is NOT a forfeit — they can still negotiate
      const { data, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'pending',
          proposed_slot: null,
          proposed_location: null,
          updated_at: now.toISOString(),
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
      updated = data

      notifTitle = 'Revised Slot Rejected'
      notifMessage = `${challengingTeam.name} rejected your proposed time. The original slots are still available.`
    }

    // Notify challenged team
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
          type: action === 'confirm' ? 'revision_confirmed' : 'revision_rejected',
          title: notifTitle,
          message: notifMessage,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: challengedTeamData.player2_id,
          team_id: challenge.challenged_team_id,
          type: action === 'confirm' ? 'revision_confirmed' : 'revision_rejected',
          title: notifTitle,
          message: notifMessage,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
      ])
    }

    // Log to audit
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: action === 'confirm' ? 'revision_confirmed' : 'revision_rejected',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: { status: updated.status },
      created_at: now.toISOString(),
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error confirming revision:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
