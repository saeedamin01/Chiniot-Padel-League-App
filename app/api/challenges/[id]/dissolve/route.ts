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

    // Get challenge
    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('*')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    // Check if user is admin (or on one of the teams for safety)
    const { data: userData } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!userData?.is_admin) {
      return NextResponse.json({ error: 'Only admins can dissolve challenges' }, { status: 403 })
    }

    // Update challenge
    const now = new Date()
    const { data: updated } = await adminClient
      .from('challenges')
      .update({
        status: 'dissolved',
        updated_at: now.toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single()

    // Log to audit
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'challenge_dissolved',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: { status: 'dissolved' },
      notes: 'Challenge dissolved by admin',
      created_at: now.toISOString(),
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error dissolving challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
