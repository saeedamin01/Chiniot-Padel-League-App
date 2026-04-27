import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

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

    // Check admin (only admins can dissolve)
    const { data: playerData } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!playerData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const adminClient = createAdminClient()

    // Get team
    const { data: team } = await adminClient
      .from('teams')
      .select('*')
      .eq('id', params.id)
      .single()

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const now = new Date()

    // Remove from ladder
    await adminClient
      .from('ladder_positions')
      .update({ status: 'inactive' })
      .eq('team_id', params.id)

    // Update team status
    const { data: updated } = await adminClient
      .from('teams')
      .update({ status: 'dissolved' })
      .eq('id', params.id)
      .select()
      .single()

    // Cancel any active challenges
    const { data: activeChallenges } = await adminClient
      .from('challenges')
      .select('id')
      .or(`challenging_team_id.eq.${params.id},challenged_team_id.eq.${params.id}`)
      .in('status', ['pending', 'scheduled'])

    if (activeChallenges) {
      const dissolveReason = `${team.name} was dissolved by an admin.`
      for (const challenge of activeChallenges) {
        await adminClient
          .from('challenges')
          .update({ status: 'dissolved', dissolved_reason: dissolveReason })
          .eq('id', challenge.id)
        await logChallengeEvent({
          challengeId: challenge.id,
          eventType: 'dissolved',
          actorId: user.id,
          actorRole: 'admin',
          data: { reason: dissolveReason },
        })
      }
    }

    // Log to audit
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'team_dissolved',
      entity_type: 'team',
      entity_id: params.id,
      new_value: { status: 'dissolved' },
      notes: `Team dissolved by admin. ${activeChallenges?.length || 0} active challenge(s) cancelled.`,
      created_at: now.toISOString(),
    })

    return NextResponse.json({ team: updated })
  } catch (err) {
    console.error('Error dissolving team:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
