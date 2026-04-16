import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const seasonId = searchParams.get('seasonId')
  const tierId = searchParams.get('tierId')
  const status = searchParams.get('status')

  const adminClient = createAdminClient()

  // Get active season if not specified
  let activeSeasonId = seasonId
  if (!activeSeasonId) {
    const { data: season } = await adminClient
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .single()
    activeSeasonId = season?.id
  }

  if (!activeSeasonId) return NextResponse.json({ error: 'No active season' }, { status: 404 })

  let query = adminClient
    .from('teams')
    .select(`
      *,
      player1:players!player1_id(id, name, email, avatar_url),
      player2:players!player2_id(id, name, email, avatar_url),
      ladder_position:ladder_positions(rank, tier_id, status, tier:tiers(*))
    `)
    .eq('season_id', activeSeasonId)
    .order('name')

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ teams: data })
}
