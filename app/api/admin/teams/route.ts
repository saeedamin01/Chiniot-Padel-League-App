import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminCheck } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!adminCheck?.is_admin)
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const body = await request.json()
    const {
      teamName, player1Id, player2Id, seasonId,
      teamType,       // 'new' | 'returning'
      selectedTier,   // tier name for new teams
      placement,      // 'random' | 'specific' (new teams only)
      specificRank,   // rank within tier (specific placement)
      initialRank,    // absolute rank (returning teams)
      ticketType,     // null | 'tier' | 'silver' | 'gold'
      entryFeePaid,
    } = body

    const adminClient = createAdminClient()

    // Validate players exist
    const { data: p1 } = await adminClient.from('players').select('id').eq('id', player1Id).single()
    const { data: p2 } = await adminClient.from('players').select('id').eq('id', player2Id).single()
    if (!p1 || !p2) return NextResponse.json({ error: 'One or both players not found' }, { status: 400 })

    // Enforce max_teams_per_player from league settings
    const { data: settings } = await adminClient
      .from('league_settings')
      .select('max_teams_per_player')
      .eq('season_id', seasonId)
      .single()

    const maxTeams = settings?.max_teams_per_player ?? 2

    // Count current teams for each player this season
    const countTeams = async (playerId: string) => {
      const { count } = await adminClient
        .from('teams')
        .select('id', { count: 'exact' })
        .eq('season_id', seasonId)
        .in('status', ['active', 'frozen'])
        .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
      return count ?? 0
    }

    const [p1Count, p2Count] = await Promise.all([countTeams(player1Id), countTeams(player2Id)])

    if (p1Count >= maxTeams) {
      const { data: p1Profile } = await adminClient.from('players').select('name').eq('id', player1Id).single()
      return NextResponse.json({
        error: `${p1Profile?.name ?? 'Player 1'} is already on ${p1Count} team(s). The limit is ${maxTeams} per player.`
      }, { status: 400 })
    }
    if (p2Count >= maxTeams) {
      const { data: p2Profile } = await adminClient.from('players').select('name').eq('id', player2Id).single()
      return NextResponse.json({
        error: `${p2Profile?.name ?? 'Player 2'} is already on ${p2Count} team(s). The limit is ${maxTeams} per player.`
      }, { status: 400 })
    }

    // Create team
    const { data: team, error: teamError } = await adminClient
      .from('teams')
      .insert({
        season_id: seasonId,
        name: teamName,
        player1_id: player1Id,
        player2_id: player2Id,
        status: 'active',
        is_new_team: teamType === 'new',
        entry_fee_paid: entryFeePaid,
        partner_changed: false,
      })
      .select()
      .single()

    if (teamError) return NextResponse.json({ error: teamError.message }, { status: 500 })

    // ─── Determine tier & rank ────────────────────────────────────────────────
    // Rank and tier are always linked: rank lives within the tier's min_rank–max_rank range.
    let tierId: string
    let finalRank = 1

    // Load all tiers for this season so we can derive tier from rank
    const { data: allTiers } = await adminClient
      .from('tiers')
      .select('id, name, min_rank, max_rank, rank_order')
      .eq('season_id', seasonId)
      .order('rank_order', { ascending: true })
    const tierByName = Object.fromEntries((allTiers || []).map(t => [t.name, t]))

    function tierIdFromRank(rank: number): string | null {
      return allTiers?.find(t => rank >= t.min_rank && rank <= (t.max_rank ?? t.min_rank))?.id ?? null
    }

    if (teamType === 'new') {
      const tierName = selectedTier || 'Bronze'
      const tier = tierByName[tierName]
      if (!tier) return NextResponse.json({ error: `${tierName} tier not found` }, { status: 500 })
      tierId = tier.id
      const tierMin = tier.min_rank
      const tierMax = tier.max_rank ?? tier.min_rank

      // Find all positions currently within this tier's rank range (the occupied slots)
      const { data: occupiedInTier } = await adminClient
        .from('ladder_positions')
        .select('id, rank')
        .eq('season_id', seasonId)
        .gte('rank', tierMin)
        .lte('rank', tierMax)
        .order('rank', { ascending: false }) // descending for shift-down logic

      if (placement === 'specific' && specificRank) {
        // specificRank is 1-based position within the tier
        const targetGlobalRank = Math.min(tierMin + specificRank - 1, tierMax)

        // Shift every team at or below the target rank downward, within the tier
        const toShift = (occupiedInTier || []).filter(p => p.rank >= targetGlobalRank)
        for (const pos of toShift) {
          await adminClient.from('ladder_positions').update({ rank: pos.rank + 1 }).eq('id', pos.id)
        }
        finalRank = targetGlobalRank
      } else {
        // Random = next available rank at the bottom of this tier
        const occupied = (occupiedInTier || []).map(p => p.rank)
        // Find first free slot from the bottom of the tier range
        let placed = false
        for (let r = tierMin; r <= tierMax; r++) {
          if (!occupied.includes(r)) { finalRank = r; placed = true; break }
        }
        if (!placed) {
          // Tier is full — place one below the tier's max (extends the tier downward)
          finalRank = tierMax + 1
        }
      }
    } else {
      // Returning team — absolute rank provided by admin; derive tier from it
      finalRank = initialRank || 1
      tierId = tierIdFromRank(finalRank) ?? ''
      if (!tierId) return NextResponse.json({ error: `No tier defined for rank ${finalRank}` }, { status: 400 })
    }

    // Always re-derive tier_id from finalRank so rank and tier are never out of sync
    tierId = tierIdFromRank(finalRank) ?? tierId

    // Create ladder position
    const { error: ladderError } = await adminClient
      .from('ladder_positions')
      .insert({
        team_id: team.id,
        season_id: seasonId,
        rank: finalRank,
        tier_id: tierId,
        status: 'active',
        consecutive_forfeits: 0,
      })

    if (ladderError) return NextResponse.json({ error: ladderError.message }, { status: 500 })

    // Create ticket only if one was chosen — use only guaranteed base columns
    if (ticketType) {
      await adminClient.from('tickets').insert({
        team_id: team.id,
        season_id: seasonId,
        ticket_type: ticketType,
        is_used: false,
        expires_after_first_match: true,
      })
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'team_created',
      entity_type: 'team',
      entity_id: team.id,
      new_value: { name: team.name, rank: finalRank, tier_id: tierId },
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({ team }, { status: 201 })
  } catch (err) {
    console.error('Error creating team:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
