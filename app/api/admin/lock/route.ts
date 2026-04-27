import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getActiveSeason } from '@/lib/ladder/engine'

export const dynamic = 'force-dynamic'

// POST /api/admin/lock
// Body: { locked: boolean }
// Requires admin role.
// Atomically sets is_locked on the active season's league_settings.

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Admin check
    const { data: playerData } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!playerData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    if (typeof body.locked !== 'boolean') {
      return NextResponse.json({ error: '"locked" must be a boolean' }, { status: 400 })
    }

    const season = await getActiveSeason()
    if (!season) {
      return NextResponse.json({ error: 'No active season' }, { status: 404 })
    }

    const adminClient = createAdminClient()

    const { data: updated, error } = await adminClient
      .from('league_settings')
      .update({ is_locked: body.locked })
      .eq('season_id', season.id)
      .select('is_locked')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: body.locked ? 'league_locked' : 'league_unlocked',
      entity_type: 'league_settings',
      entity_id: season.id,
      new_value: { is_locked: body.locked },
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({ is_locked: updated?.is_locked ?? body.locked })
  } catch (err) {
    console.error('Error toggling league lock:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
