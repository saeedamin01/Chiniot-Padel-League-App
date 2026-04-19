import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET /api/cron/ladder-snapshot
// Runs daily at 2am via cron. Saves today's ladder as a JSON snapshot
// and deletes any snapshots older than 7 days.

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    // Get active season
    const { data: season } = await supabase
      .from('seasons')
      .select('id, name')
      .eq('is_active', true)
      .single()

    if (!season) {
      return NextResponse.json({ success: true, message: 'No active season' })
    }

    // Fetch full ladder with team + tier info
    const { data: positions } = await supabase
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
      return NextResponse.json({ success: true, message: 'No ladder positions found' })
    }

    // Get win/loss counts for all teams in one query
    const teamIds = positions.map(p => (p.team as any)?.id).filter(Boolean)
    const [winsRes, lossesRes] = await Promise.all([
      supabase.from('match_results')
        .select('winner_team_id')
        .eq('season_id', season.id)
        .in('winner_team_id', teamIds),
      supabase.from('match_results')
        .select('loser_team_id')
        .eq('season_id', season.id)
        .in('loser_team_id', teamIds),
    ])

    const winsMap = new Map<string, number>()
    const lossesMap = new Map<string, number>()
    for (const r of winsRes.data || []) {
      winsMap.set(r.winner_team_id, (winsMap.get(r.winner_team_id) ?? 0) + 1)
    }
    for (const r of lossesRes.data || []) {
      lossesMap.set(r.loser_team_id, (lossesMap.get(r.loser_team_id) ?? 0) + 1)
    }

    // Build compact snapshot array
    const snapshot = positions.map(p => {
      const team = p.team as any
      const tier = p.tier as any
      const teamId = team?.id ?? ''
      return {
        rank:    p.rank,
        team_id: teamId,
        team:    team?.name ?? 'Unknown',
        p1:      team?.player1?.name ?? '',
        p2:      team?.player2?.name ?? '',
        tier:    tier?.name ?? '',
        status:  p.status,
        w:       winsMap.get(teamId) ?? 0,
        l:       lossesMap.get(teamId) ?? 0,
      }
    })

    // Upsert today's snapshot (idempotent — safe to re-run)
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    const { error: upsertError } = await supabase
      .from('ladder_snapshots')
      .upsert(
        { season_id: season.id, snapshot_date: today, data: snapshot },
        { onConflict: 'season_id,snapshot_date' }
      )

    if (upsertError) {
      console.error('Snapshot upsert error:', upsertError)
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    // Delete snapshots older than 7 days for this season
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const cutoffDate = cutoff.toISOString().split('T')[0]

    await supabase
      .from('ladder_snapshots')
      .delete()
      .eq('season_id', season.id)
      .lt('snapshot_date', cutoffDate)

    return NextResponse.json({
      success: true,
      message: `Snapshot saved for ${today} (${snapshot.length} teams). Deleted snapshots before ${cutoffDate}.`,
      teams: snapshot.length,
      date: today,
    })
  } catch (err) {
    console.error('Cron ladder-snapshot error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
