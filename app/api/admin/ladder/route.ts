import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface RankChange {
  teamId: string
  newRank: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin
    const { data: adminCheck } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!adminCheck?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { changes, seasonId } = body as { changes: RankChange[]; seasonId: string }

    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Validate no duplicate ranks
    const ranks = changes.map(c => c.newRank)
    if (new Set(ranks).size !== ranks.length) {
      return NextResponse.json({ error: 'Duplicate ranks detected' }, { status: 400 })
    }

    // Get current ladder
    const { data: currentLadder } = await adminClient
      .from('ladder_positions')
      .select('id, team_id, rank')
      .eq('season_id', seasonId)

    if (!currentLadder) {
      return NextResponse.json({ error: 'Ladder not found' }, { status: 404 })
    }

    // Build old values map
    const oldValues: Record<string, number> = {}
    for (const change of changes) {
      const current = currentLadder.find(p => p.team_id === change.teamId)
      if (current) {
        oldValues[change.teamId] = current.rank
      }
    }

    // Load tiers so we can keep tier_id in sync with rank
    const { data: tiers } = await adminClient
      .from('tiers')
      .select('id, min_rank, max_rank')
      .eq('season_id', seasonId)

    function tierIdFromRank(rank: number): string | null {
      return tiers?.find(t => rank >= t.min_rank && rank <= (t.max_rank ?? t.min_rank))?.id ?? null
    }

    // To avoid UNIQUE(season_id, rank) conflicts when swapping, use a 3-step approach:
    // 1. Park all moving teams at temporary negative ranks (no collisions possible)
    // 2. Apply all the real new ranks
    // 3. Write history
    for (const change of changes) {
      const tempRank = -(oldValues[change.teamId] ?? 0)
      await adminClient
        .from('ladder_positions')
        .update({ rank: tempRank })
        .eq('team_id', change.teamId)
        .eq('season_id', seasonId)
    }

    for (const change of changes) {
      const newTierId = tierIdFromRank(change.newRank)
      const { error } = await adminClient
        .from('ladder_positions')
        .update({ rank: change.newRank, ...(newTierId ? { tier_id: newTierId } : {}) })
        .eq('team_id', change.teamId)
        .eq('season_id', seasonId)

      if (error) {
        return NextResponse.json({ error: `Failed to update team rank: ${error.message}` }, { status: 500 })
      }
    }

    // Write history for all changes
    for (const change of changes) {
      await adminClient.from('ladder_history').insert({
        season_id: seasonId,
        team_id: change.teamId,
        old_rank: oldValues[change.teamId],
        new_rank: change.newRank,
        change_type: 'admin_adjustment',
      })
    }

    // Log to audit
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'ladder_adjusted',
      entity_type: 'ladder_position',
      old_value: oldValues,
      new_value: Object.fromEntries(changes.map(c => [c.teamId, c.newRank])),
      notes: `Manual adjustment of ${changes.length} team(s)`,
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, changesApplied: changes.length })
  } catch (err) {
    console.error('Error adjusting ladder:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
