/**
 * Seed script: adds test teams across Gold, Silver, and Bronze tiers.
 *
 * Run from the project root:
 *   node scripts/seed-tier-teams.js
 *
 * Prerequisites: Local Supabase must be running. Uses .env.local values.
 */

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// New teams to seed into Gold, Silver, and Bronze tiers
const NEW_TEAMS = [
  // Gold tier
  { name: 'Golden Eagles', tier: 'Gold', p1: 'gold1@test.com', p2: 'gold2@test.com', p1Name: 'gold1 A', p2Name: 'gold2 B' },
  { name: 'Gold Standard', tier: 'Gold', p1: 'gold3@test.com', p2: 'gold4@test.com', p1Name: 'gold3 A', p2Name: 'gold4 B' },
  // Silver tier
  { name: 'Silver Strikers', tier: 'Silver', p1: 'silver1@test.com', p2: 'silver2@test.com', p1Name: 'silver1 A', p2Name: 'silver2 B' },
  { name: 'Silver Bullets', tier: 'Silver', p1: 'silver3@test.com', p2: 'silver4@test.com', p1Name: 'silver3 A', p2Name: 'silver4 B' },
  { name: 'Silver Foxes',   tier: 'Silver', p1: 'silver5@test.com', p2: 'silver6@test.com', p1Name: 'silver5 A', p2Name: 'silver6 B' },
  // Bronze tier
  { name: 'Bronze Brigade', tier: 'Bronze', p1: 'bronze1@test.com', p2: 'bronze2@test.com', p1Name: 'bronze1 A', p2Name: 'bronze2 B' },
  { name: 'Bronze Bears',   tier: 'Bronze', p1: 'bronze3@test.com', p2: 'bronze4@test.com', p1Name: 'bronze3 A', p2Name: 'bronze4 B' },
]

async function main() {
  // 1. Get active season
  const { data: season, error: sErr } = await supabase.from('seasons').select('id').eq('is_active', true).single()
  if (!season) { console.error('No active season found', sErr); return }
  console.log('Active season:', season.id)

  // 2. Load tiers
  const { data: tiers } = await supabase.from('tiers').select('*').eq('season_id', season.id).order('rank_order')
  const tierMap = Object.fromEntries((tiers || []).map(t => [t.name, t]))
  console.log('Tiers:', Object.keys(tierMap).join(', '))

  // 3. Get current max rank
  const { data: maxPos } = await supabase
    .from('ladder_positions')
    .select('rank')
    .eq('season_id', season.id)
    .order('rank', { ascending: false })
    .limit(1)
  let nextRank = (maxPos?.[0]?.rank || 0) + 1

  for (const entry of NEW_TEAMS) {
    const tier = tierMap[entry.tier]
    if (!tier) { console.warn(`Tier "${entry.tier}" not found — skipping ${entry.name}`); continue }

    // Upsert players
    const p1 = await upsertPlayer(entry.p1, entry.p1Name)
    const p2 = await upsertPlayer(entry.p2, entry.p2Name)
    if (!p1 || !p2) { console.warn(`Could not create players for ${entry.name}`); continue }

    // Check if team already exists
    const { data: existing } = await supabase.from('teams')
      .select('id').eq('name', entry.name).eq('season_id', season.id).maybeSingle()
    if (existing) { console.log(`  ⏭  ${entry.name} already exists — skipping`); continue }

    // Create team
    const { data: team, error: tErr } = await supabase.from('teams').insert({
      season_id: season.id,
      name: entry.name,
      player1_id: p1.id,
      player2_id: p2.id,
      status: 'active',
      is_new_team: true,
      entry_fee_paid: true,
      partner_changed: false,
    }).select().single()

    if (tErr) { console.error(`  ✗ Failed to create ${entry.name}:`, tErr.message); continue }

    // Create ladder position with the correct tier_id
    const rank = nextRank++
    const { error: lErr } = await supabase.from('ladder_positions').insert({
      team_id: team.id,
      season_id: season.id,
      rank,
      tier_id: tier.id,
      status: 'active',
      consecutive_forfeits: 0,
    })

    if (lErr) { console.error(`  ✗ Failed to place ${entry.name}:`, lErr.message); continue }

    console.log(`  ✓ ${entry.name} → ${entry.tier} tier (rank #${rank})`)
  }

  console.log('\nDone! Refresh the admin page to see the new teams.')
}

async function upsertPlayer(email, name) {
  const { data: existing } = await supabase.from('players').select('id').eq('email', email).maybeSingle()
  if (existing) return existing

  const { data, error } = await supabase.from('players').insert({
    email,
    name,
    email_verified: true,
    is_admin: false,
    is_active: true,
  }).select().single()

  if (error) { console.error(`Failed to create player ${email}:`, error.message); return null }
  return data
}

main().catch(console.error)
