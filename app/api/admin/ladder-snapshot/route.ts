import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// POST /api/admin/ladder-snapshot
// Allows admins to manually trigger a snapshot from the admin panel.

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminClient = createAdminClient()

    // Verify admin role
    const { data: player } = await adminClient
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!player?.is_admin) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    // Get active season
    const { data: season } = await adminClient
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return NextResponse.json({ error: 'No active season' }, { status: 404 })

    // Fetch full ladder
    const { data: positions } = await adminClient
      .from('ladder_positions')
      .select(`
        rank, status,
        team:teams!team_id(
          id, name,
          player1:players!player1_id(name),
          player2:players!player2_id(name)
        ),
        tier:tiers!tier_id(name)
      `)
      .eq('season_id', season.id)
      .order('rank', { ascending: true })

    if (!positions || positions.length === 0) {
      return NextResponse.json({ error: 'No ladder positions' }, { status: 404 })
    }

    const teamIds = positions.map(p => (p.team as any)?.id).filter(Boolean)
    const [winsRes, lossesRes] = await Promise.all([
      adminClient.from('match_results').select('winner_team_id').eq('season_id', season.id).in('winner_team_id', teamIds),
      adminClient.from('match_results').select('loser_team_id').eq('season_id', season.id).in('loser_team_id', teamIds),
    ])
    const winsMap = new Map<string, number>()
    const lossesMap = new Map<string, number>()
    for (const r of winsRes.data || []) winsMap.set(r.winner_team_id, (winsMap.get(r.winner_team_id) ?? 0) + 1)
    for (const r of lossesRes.data || []) lossesMap.set(r.loser_team_id, (lossesMap.get(r.loser_team_id) ?? 0) + 1)

    const snapshot = positions.map(p => {
      const team = p.team as any
      const tier = p.tier as any
      const teamId = team?.id ?? ''
      return {
        rank: p.rank, team_id: teamId, team: team?.name ?? 'Unknown',
        p1: team?.player1?.name ?? '', p2: team?.player2?.name ?? '',
        tier: tier?.name ?? '', status: p.status,
        w: winsMap.get(teamId) ?? 0, l: lossesMap.get(teamId) ?? 0,
      }
    })

    const today = new Date().toISOString().split('T')[0]
    const { error } = await adminClient
      .from('ladder_snapshots')
      .upsert(
        { season_id: season.id, snapshot_date: today, data: snapshot },
        { onConflict: 'season_id,snapshot_date' }
      )

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Delete snapshots older than 7 days
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    await adminClient
      .from('ladder_snapshots')
      .delete()
      .eq('season_id', season.id)
      .lt('snapshot_date', cutoff.toISOString().split('T')[0])

    return NextResponse.json({ success: true, date: today, teams: snapshot.length })
  } catch (err) {
    console.error('Admin snapshot error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
