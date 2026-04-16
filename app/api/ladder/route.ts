import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { getLadderWithTiers } from '@/lib/ladder/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const adminClient = createAdminClient()

    const { data: season } = await adminClient
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .single()

    if (!season) {
      return NextResponse.json({ error: 'No active season' }, { status: 404 })
    }

    const ladder = await getLadderWithTiers(season.id)
    return NextResponse.json({ ladder })
  } catch (error) {
    console.error('Error fetching ladder:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
