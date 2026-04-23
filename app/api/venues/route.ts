import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET /api/venues?seasonId=xxx   — list active venues for a season (players + admin)
// POST /api/venues               — create a new venue (admin only)

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const seasonId = searchParams.get('seasonId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const adminClient = createAdminClient()
    let query = adminClient.from('venues').select('*').order('name')

    if (seasonId) query = query.eq('season_id', seasonId)
    if (!includeInactive) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ venues: data })
  } catch (err) {
    console.error('Error fetching venues:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin only
    const { data: player } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!player?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { seasonId, name, address, notes, is_partner } = body

    if (!seasonId || !name?.trim()) {
      return NextResponse.json({ error: 'seasonId and name are required' }, { status: 400 })
    }

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('venues')
      .insert({
        season_id: seasonId,
        name: name.trim(),
        address,
        notes,
        is_active: true,
        is_partner: is_partner === true,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ venue: data }, { status: 201 })
  } catch (err) {
    console.error('Error creating venue:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
