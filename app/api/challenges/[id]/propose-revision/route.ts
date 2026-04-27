import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { checkLeagueLock } from '@/lib/league/lock'

export const dynamic = 'force-dynamic'

// Challenged team proposes a revised time slot
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
    const { proposedSlot, proposedLocation } = body

    if (!proposedSlot) {
      return NextResponse.json({ error: 'Proposed slot is required' }, { status: 400 })
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

    if (challenge.status !== 'pending') {
      return NextResponse.json({ error: 'Can only propose a revision on a pending challenge' }, { status: 400 })
    }

    // Verify user is on the challenged team
    const { data: challengedTeam } = await adminClient
      .from('teams')
      .select('*')
      .eq('id', challenge.challenged_team_id)
      .single()

    if (!challengedTeam || (challengedTeam.player1_id !== user.id && challengedTeam.player2_id !== user.id)) {
      return NextResponse.json({ error: 'Only the challenged team can propose a revised slot' }, { status: 403 })
    }

    // Update challenge with proposed slot
    const now = new Date()
    const { data: updated, error: updateError } = await adminClient
      .from('challenges')
      .update({
        status: 'revision_proposed',
        proposed_slot: proposedSlot,
        proposed_location: proposedLocation || null,
        updated_at: now.toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Notify challenging team to confirm the proposed slot
    const { data: challengingTeamData } = await adminClient
      .from('teams')
      .select('player1_id, player2_id')
      .eq('id', challenge.challenging_team_id)
      .single()

    if (challengingTeamData) {
      const slotDate = new Date(proposedSlot).toLocaleString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
      await adminClient.from('notifications').insert([
        {
          player_id: challengingTeamData.player1_id,
          team_id: challenge.challenging_team_id,
          type: 'revision_proposed',
          title: 'Revised Time Proposed',
          message: `${challengedTeam.name} proposed a new time: ${slotDate}. Please confirm or decline.`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: challengingTeamData.player2_id,
          team_id: challenge.challenging_team_id,
          type: 'revision_proposed',
          title: 'Revised Time Proposed',
          message: `${challengedTeam.name} proposed a new time: ${slotDate}. Please confirm or decline.`,
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
      action_type: 'revision_proposed',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: { status: 'revision_proposed', proposed_slot: proposedSlot },
      created_at: now.toISOString(),
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error proposing revision:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
