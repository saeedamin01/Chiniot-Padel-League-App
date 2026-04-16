#!/usr/bin/env node
/**
 * CPL Fix Ladder Script
 * Finds all teams with no ladder_position and assigns them one.
 * Safely assigns ranks without UNIQUE constraint conflicts.
 * Run with: node scripts/fix-ladder.js
 */

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function fixLadder() {
  console.log('🔧 CPL Ladder Repair\n')

  // Get active season
  const { data: season } = await supabase
    .from('seasons').select('id, name').eq('is_active', true).single()

  if (!season) {
    console.error('❌ No active season found. Run: npx supabase db reset')
    process.exit(1)
  }
  console.log(`✅ Active season: ${season.name} (${season.id})\n`)

  // Get all tiers ordered by rank
  const { data: tiers } = await supabase
    .from('tiers')
    .select('id, name, rank_order, min_rank, max_rank')
    .eq('season_id', season.id)
    .order('rank_order', { ascending: true })

  if (!tiers || tiers.length === 0) {
    console.error('❌ No tiers found. Run: npx supabase db reset')
    process.exit(1)
  }

  const tierMap = {}
  for (const t of tiers) tierMap[t.name] = t

  console.log('Tiers:', tiers.map(t => t.name).join(', '))

  // Get all teams for this season
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, status')
    .eq('season_id', season.id)

  console.log(`\nTotal teams found: ${teams?.length || 0}`)

  // Get all existing ladder positions
  const { data: existingPositions } = await supabase
    .from('ladder_positions')
    .select('team_id, rank, tier_id')
    .eq('season_id', season.id)

  const teamsWithPosition = new Set((existingPositions || []).map(p => p.team_id))
  const usedRanks = new Set((existingPositions || []).map(p => p.rank))

  const teamsWithoutPosition = (teams || []).filter(t => !teamsWithPosition.has(t.id))
  console.log(`Teams missing ladder position: ${teamsWithoutPosition.length}`)

  if (teamsWithoutPosition.length === 0) {
    console.log('\n✅ All teams already have ladder positions!')
    console.log('\nIf teams still not showing on ladder, check:')
    console.log('  1. Ladder page filters (status = active?)')
    console.log('  2. Visit http://localhost:3001/ladder')
    return
  }

  // Find the next available rank (after all existing ones)
  let nextRank = 1
  while (usedRanks.has(nextRank)) nextRank++

  // Use Bronze tier for all unranked teams by default
  const bronzeTier = tierMap['Bronze']
  if (!bronzeTier) {
    console.error('❌ Bronze tier not found')
    process.exit(1)
  }

  console.log(`\nAssigning missing teams to Bronze tier, starting at rank ${nextRank}...\n`)

  for (const team of teamsWithoutPosition) {
    while (usedRanks.has(nextRank)) nextRank++

    const { error } = await supabase
      .from('ladder_positions')
      .insert({
        team_id: team.id,
        season_id: season.id,
        rank: nextRank,
        tier_id: bronzeTier.id,
        status: 'active',
        consecutive_forfeits: 0,
      })

    if (error) {
      console.log(`  ❌ ${team.name} (rank ${nextRank}): ${error.message}`)
    } else {
      console.log(`  ✅ ${team.name} → Rank ${nextRank} (Bronze)`)
      usedRanks.add(nextRank)
      nextRank++
    }
  }

  // Summary
  const { data: finalPositions } = await supabase
    .from('ladder_positions')
    .select('rank, team:teams(name), tier:tiers(name)')
    .eq('season_id', season.id)
    .order('rank', { ascending: true })

  console.log('\n📊 Final Ladder:')
  console.log('────────────────────────────────────────')
  for (const pos of finalPositions || []) {
    const name = (pos.team?.name || 'Unknown').padEnd(20)
    const tier = (pos.tier?.name || '?').padEnd(10)
    console.log(`  #${String(pos.rank).padEnd(3)}  ${name}  ${tier}`)
  }
  console.log('────────────────────────────────────────')
  console.log(`\n✅ Done! ${finalPositions?.length || 0} teams on ladder.`)
  console.log('\nVisit http://localhost:3001/ladder to see them.\n')
}

fixLadder().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
