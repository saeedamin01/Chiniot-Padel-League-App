import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/challenges/[id]/events
//
// Returns the full event timeline for a challenge.
// Accessible by:
//   - Either player on the challenge (via RLS on challenge_events)
//   - Admins (bypass RLS via admin client)

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check if admin — if so use adminClient for full access
    const { data: playerRow } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()

    const client = playerRow?.is_admin ? createAdminClient() : supabase

    const { data: events, error } = await client
      .from('challenge_events')
      .select('*')
      .eq('challenge_id', params.id)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ events: events ?? [] })
  } catch (err) {
    console.error('Error fetching challenge events:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
