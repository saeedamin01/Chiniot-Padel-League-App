import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { processForfeit } from '@/lib/ladder/engine'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// Declining a challenge = forfeit with rank penalty for the declining (challenged) team
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

    if (!['pending', 'revision_proposed'].includes(challenge.status)) {
      return NextResponse.json({ error: 'Challenge cannot be declined in its current state' }, { status: 400 })
    }

    // Verify user is on the challenged team (only challenged team can decline)
    const { data: challengedTeam } = await adminClient
      .from('teams')
      .select('*')
      .eq('id', challenge.challenged_team_id)
      .single()

    if (!challengedTeam || (challengedTeam.player1_id !== user.id && challengedTeam.player2_id !== user.id)) {
      return NextResponse.json({ error: 'Only the challenged team can decline a challenge' }, { status: 403 })
    }

    // Declining = forfeit by the challenged team
    const result = await processForfeit(params.id, challenge.challenged_team_id)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    // Update challenge status
    const now = new Date()
    const { data: updated } = await adminClient
      .from('challenges')
      .update({
        status: 'forfeited',
        forfeit_by: 'challenged',
        updated_at: now.toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    // Notify challenging team
    const { data: challengingTeamData } = await adminClient
      .from('teams')
      .select('player1_id, player2_id')
      .eq('id', challenge.challenging_team_id)
      .single()

    if (challengingTeamData) {
      await adminClient.from('notifications').insert([
        {
          player_id: challengingTeamData.player1_id,
          team_id: challenge.challenging_team_id,
          type: 'challenge_declined',
          title: 'Challenge Declined',
          message: `${challengedTeam.name} declined your challenge — this counts as a forfeit for them.`,
          action_url: `/challenges/${params.id}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: challengingTeamData.player2_id,
          team_id: challenge.challenging_team_id,
          type: 'challenge_declined',
          title: 'Challenge Declined',
          message: `${challengedTeam.name} declined your challenge — this counts as a forfeit for them.`,
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
      action_type: 'challenge_declined',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: { status: 'forfeited', forfeit_by: 'challenged', reason: 'declined' },
      created_at: now.toISOString(),
    })

    await logChallengeEvent({
      challengeId: params.id,
      eventType: 'challenge_declined',
      actorId: user.id,
      actorRole: 'player',
      actorName: challengedTeam.name,
      data: { reason: 'Declined by challenged team (forfeit)' },
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error declining challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
