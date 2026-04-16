import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

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

    const adminClient = createAdminClient()

    // Get the player's email
    const { data: player } = await adminClient
      .from('players').select('id, name, email').eq('id', params.id).single()
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

    // Send a password reset email via Supabase Auth
    const { error: resetError } = await adminClient.auth.resetPasswordForEmail(player.email)

    if (resetError) {
      console.error('Failed to send reset email:', resetError)
      return NextResponse.json({ error: resetError.message || 'Failed to send reset email' }, { status: 500 })
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'password_reset_sent',
      entity_type: 'player',
      entity_id: params.id,
      new_value: { email: player.email, name: player.name },
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, email: player.email })
  } catch (err) {
    console.error('Reset password error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
