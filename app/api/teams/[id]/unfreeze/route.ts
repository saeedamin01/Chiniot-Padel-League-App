import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

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

    const adminClient = createAdminClient()

    // Team members can unfreeze their own team; admins can unfreeze any team
    const [{ data: team }, { data: playerData }] = await Promise.all([
      adminClient.from('teams').select('*').eq('id', params.id).single(),
      supabase.from('players').select('is_admin').eq('id', user.id).single(),
    ])

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const isTeamMember = team.player1_id === user.id || team.player2_id === user.id
    const isAdmin = playerData?.is_admin

    if (!isTeamMember && !isAdmin) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    if (team.status !== 'frozen') {
      return NextResponse.json({ error: 'Team is not currently frozen' }, { status: 400 })
    }

    const now = new Date()

    // Update ladder position
    await adminClient
      .from('ladder_positions')
      .update({ status: 'active' })
      .eq('team_id', params.id)

    // Update freeze record
    await adminClient
      .from('freeze_records')
      .update({ unfrozen_at: now.toISOString() })
      .eq('team_id', params.id)
      .is('unfrozen_at', null)

    // Update team status
    const { data: updated } = await adminClient
      .from('teams')
      .update({ status: 'active' })
      .eq('id', params.id)
      .select()
      .single()

    // Log to audit
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'team_unfrozen',
      entity_type: 'team',
      entity_id: params.id,
      new_value: { status: 'active' },
      created_at: now.toISOString(),
    })

    // Notify both players on the team
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    for (const pid of [team.player1_id, team.player2_id]) {
      if (!pid) continue
      await adminClient.from('notifications').insert({
        player_id: pid,
        team_id: params.id,
        type: 'team_unfrozen',
        title: '🟢 Team unfrozen',
        message: `${team.name} has been unfrozen and can now send and receive challenges again.`,
        action_url: `${appUrl}/challenges`,
      })
    }

    return NextResponse.json({ team: updated })
  } catch (err) {
    console.error('Error unfreezing team:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
