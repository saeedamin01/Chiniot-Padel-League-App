import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/admin/teams/bulk-upload
// Validates and creates multiple teams from a CSV upload.
// Each row: { teamName, player1Email, player2Email, rank, ticket1?, ticket2? }
// Returns per-row results: { index, teamName, success, error?, teamId? }

interface BulkTeamRow {
  teamName: string
  player1Email: string
  player2Email: string
  rank: number
  ticket1?: string | null
  ticket2?: string | null
}

interface RowResult {
  index: number
  teamName: string
  success: boolean
  error?: string
  teamId?: string
  rank?: number
}

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
    const { rows, seasonId }: { rows: BulkTeamRow[]; seasonId: string } = body

    if (!rows || !Array.isArray(rows) || rows.length === 0)
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    if (!seasonId)
      return NextResponse.json({ error: 'seasonId is required' }, { status: 400 })

    const adminClient = createAdminClient()

    // ── Load reference data ────────────────────────────────────────────────
    const [{ data: allTiers }, { data: settings }, { data: existingPositions }] = await Promise.all([
      adminClient.from('tiers').select('id, name, min_rank, max_rank, rank_order')
        .eq('season_id', seasonId).order('rank_order', { ascending: true }),
      adminClient.from('league_settings').select('max_teams_per_player').eq('season_id', seasonId).single(),
      adminClient.from('ladder_positions').select('rank').eq('season_id', seasonId),
    ])

    const maxTeams = settings?.max_teams_per_player ?? 2
    const occupiedRanks = new Set((existingPositions || []).map(p => p.rank))

    function tierIdFromRank(rank: number): { id: string; name: string } | null {
      return allTiers?.find(t => rank >= t.min_rank && rank <= (t.max_rank ?? t.min_rank)) ?? null
    }

    // ── Pre-validate all rows ──────────────────────────────────────────────
    // Track ranks used in this batch to detect intra-CSV duplicates
    const batchRanks = new Map<number, number>() // rank → first row index using it
    // Track player team counts augmented by teams we're about to create
    const playerTeamCount = new Map<string, number>()

    // Load all player emails in one query
    const allEmails = [...new Set(rows.flatMap(r => [r.player1Email.toLowerCase(), r.player2Email.toLowerCase()]))]
    const { data: foundPlayers } = await adminClient
      .from('players')
      .select('id, email, name')
      .in('email', allEmails)

    const playerByEmail = new Map<string, { id: string; name: string; email: string }>()
    ;(foundPlayers || []).forEach(p => playerByEmail.set(p.email.toLowerCase(), p))

    // Load current team counts per player this season
    if (foundPlayers && foundPlayers.length > 0) {
      const { data: playerTeams } = await adminClient
        .from('teams')
        .select('player1_id, player2_id')
        .eq('season_id', seasonId)
        .in('status', ['active', 'frozen'])

      ;(playerTeams || []).forEach(t => {
        playerTeamCount.set(t.player1_id, (playerTeamCount.get(t.player1_id) ?? 0) + 1)
        playerTeamCount.set(t.player2_id, (playerTeamCount.get(t.player2_id) ?? 0) + 1)
      })
    }

    const VALID_TICKET_TYPES = new Set(['tier', 'silver', 'gold'])

    // ── Process rows one by one ────────────────────────────────────────────
    const results: RowResult[] = []
    // Track ranks created in this batch so subsequent rows can't conflict
    const createdRanksThisBatch = new Set<number>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const result: RowResult = { index: i, teamName: row.teamName, success: false }

      // Basic field validation
      if (!row.teamName?.trim()) { result.error = 'Team name is required'; results.push(result); continue }
      if (!row.player1Email?.trim()) { result.error = 'Player 1 email is required'; results.push(result); continue }
      if (!row.player2Email?.trim()) { result.error = 'Player 2 email is required'; results.push(result); continue }
      if (!row.rank || isNaN(row.rank) || row.rank < 1) { result.error = 'Rank must be a positive number'; results.push(result); continue }

      const p1 = playerByEmail.get(row.player1Email.toLowerCase())
      const p2 = playerByEmail.get(row.player2Email.toLowerCase())

      if (!p1) { result.error = `Player not found: ${row.player1Email}`; results.push(result); continue }
      if (!p2) { result.error = `Player not found: ${row.player2Email}`; results.push(result); continue }
      if (p1.id === p2.id) { result.error = 'Player 1 and Player 2 must be different people'; results.push(result); continue }

      // Ticket validation — both columns optional, each must be valid if provided, must not duplicate each other
      const ticket1 = row.ticket1?.trim().toLowerCase() || null
      const ticket2 = row.ticket2?.trim().toLowerCase() || null
      if (ticket1 && !VALID_TICKET_TYPES.has(ticket1)) {
        result.error = `Invalid ticket_1 "${ticket1}". Must be: tier, silver, gold, or empty`
        results.push(result); continue
      }
      if (ticket2 && !VALID_TICKET_TYPES.has(ticket2)) {
        result.error = `Invalid ticket_2 "${ticket2}". Must be: tier, silver, gold, or empty`
        results.push(result); continue
      }
      if (ticket1 && ticket2 && ticket1 === ticket2) {
        result.error = `ticket_1 and ticket_2 cannot be the same type ("${ticket1}")`
        results.push(result); continue
      }
      const ticketsToCreate = [ticket1, ticket2].filter(Boolean) as string[]

      // Rank must fall within a tier
      const tier = tierIdFromRank(row.rank)
      if (!tier) {
        result.error = `Rank ${row.rank} does not fall within any configured tier`
        results.push(result); continue
      }

      // Rank must not be occupied by existing teams
      if (occupiedRanks.has(row.rank)) {
        result.error = `Rank ${row.rank} is already occupied by an existing team`
        results.push(result); continue
      }

      // Rank must not be duplicated in this batch
      if (createdRanksThisBatch.has(row.rank)) {
        const firstIdx = batchRanks.get(row.rank)
        result.error = `Rank ${row.rank} is already used by row ${(firstIdx ?? 0) + 1} in this upload`
        results.push(result); continue
      }

      // Player team count check (maxTeams per player)
      const p1Count = playerTeamCount.get(p1.id) ?? 0
      const p2Count = playerTeamCount.get(p2.id) ?? 0

      if (p1Count >= maxTeams) {
        result.error = `${p1.name} already has ${p1Count} team(s) this season (limit: ${maxTeams})`
        results.push(result); continue
      }
      if (p2Count >= maxTeams) {
        result.error = `${p2.name} already has ${p2Count} team(s) this season (limit: ${maxTeams})`
        results.push(result); continue
      }

      // ── Create the team ──────────────────────────────────────────────────
      try {
        const { data: team, error: teamError } = await adminClient
          .from('teams')
          .insert({
            season_id: seasonId,
            name: row.teamName.trim(),
            player1_id: p1.id,
            player2_id: p2.id,
            status: 'active',
            is_new_team: false,
            entry_fee_paid: false,
            partner_changed: false,
          })
          .select()
          .single()

        if (teamError || !team) {
          result.error = teamError?.message || 'Failed to create team'
          results.push(result); continue
        }

        // Create ladder position
        const { error: ladderError } = await adminClient
          .from('ladder_positions')
          .insert({
            team_id: team.id,
            season_id: seasonId,
            rank: row.rank,
            tier_id: tier.id,
            status: 'active',
            consecutive_forfeits: 0,
          })

        if (ladderError) {
          // Roll back team creation if ladder insert fails
          await adminClient.from('teams').delete().eq('id', team.id)
          result.error = `Ladder position error: ${ladderError.message}`
          results.push(result); continue
        }

        // Create tickets (0, 1, or 2)
        if (ticketsToCreate.length > 0) {
          await adminClient.from('tickets').insert(
            ticketsToCreate.map(tt => ({
              team_id: team.id,
              season_id: seasonId,
              ticket_type: tt,
              is_used: false,
              expires_after_first_match: true,
            }))
          )
        }

        // Audit log
        await adminClient.from('audit_log').insert({
          actor_id: user.id,
          actor_email: user.email,
          action_type: 'team_bulk_created',
          entity_type: 'team',
          entity_id: team.id,
          new_value: { name: team.name, rank: row.rank, tier: tier.name, tickets: ticketsToCreate },
          created_at: new Date().toISOString(),
        })

        // Mark rank as used so subsequent rows in same batch can't conflict
        occupiedRanks.add(row.rank)
        createdRanksThisBatch.add(row.rank)
        batchRanks.set(row.rank, i)

        // Update in-memory player team counts
        playerTeamCount.set(p1.id, p1Count + 1)
        playerTeamCount.set(p2.id, p2Count + 1)

        result.success = true
        result.teamId = team.id
        result.rank = row.rank
      } catch (err) {
        result.error = err instanceof Error ? err.message : 'Unexpected error'
      }

      results.push(result)
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return NextResponse.json({ results, succeeded, failed }, { status: 200 })
  } catch (err) {
    console.error('Bulk team upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/admin/teams/bulk-upload — validate rows without creating (dry-run)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminCheck } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!adminCheck?.is_admin)
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const { searchParams } = request.nextUrl
    const seasonId = searchParams.get('seasonId')
    if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

    const adminClient = createAdminClient()

    // Return current occupied ranks and tier definitions for frontend validation
    const [{ data: tiers }, { data: positions }] = await Promise.all([
      adminClient.from('tiers').select('id, name, min_rank, max_rank').eq('season_id', seasonId).order('rank_order'),
      adminClient.from('ladder_positions').select('rank').eq('season_id', seasonId),
    ])

    return NextResponse.json({
      occupiedRanks: (positions || []).map(p => p.rank),
      tiers: tiers || [],
    })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
