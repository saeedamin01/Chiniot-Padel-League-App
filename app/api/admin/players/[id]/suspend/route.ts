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
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin only
    const { data: caller } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!caller?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { active } = await request.json() // true = unsuspend, false = suspend
    const adminClient = createAdminClient()

    const { data: player, error: updateErr } = await adminClient
      .from('players')
      .update({ is_active: active })
      .eq('id', params.id)
      .select('name, email')
      .single()

    if (updateErr || !player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: active ? 'player_unsuspended' : 'player_suspended',
      entity_type: 'player',
      entity_id: params.id,
      new_value: { name: player.name, email: player.email, is_active: active },
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Suspend player error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
