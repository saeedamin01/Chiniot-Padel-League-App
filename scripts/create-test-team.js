/**
 * Creates test teams across Bronze, Silver, and Gold tiers with real Auth accounts.
 * New teams are spread across empty slots within each tier.
 *
 * Run from the project root:
 *   node scripts/create-test-team.js
 *
 * Password for all accounts: Test1234!
 */

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD     = 'Test1234!'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TEST_TEAMS = [
  // ── Bronze ──────────────────────────────────────────────────────────────
  {
    name: 'Test Titans',
    tier: 'Bronze',
    p1: { email: 'test.player1@cpl.com', name: 'Test Player 1' },
    p2: { email: 'test.player2@cpl.com', name: 'Test Player 2' },
  },

  // ── Silver ──────────────────────────────────────────────────────────────
  {
    name: 'Silver Saints',
    tier: 'Silver',
    p1: { email: 'test.player3@cpl.com', name: 'Test Player 3' },
    p2: { email: 'test.player4@cpl.com', name: 'Test Player 4' },
  },
  {
    name: 'Silver Surge',
    tier: 'Silver',
    p1: { email: 'test.player7@cpl.com', name: 'Test Player 7' },
    p2: { email: 'test.player8@cpl.com', name: 'Test Player 8' },
  },
  {
    name: 'Silver Storm',
    tier: 'Silver',
    p1: { email: 'test.player9@cpl.com', name: 'Test Player 9' },
    p2: { email: 'test.player10@cpl.com', name: 'Test Player 10' },
  },

  // ── Gold ────────────────────────────────────────────────────────────────
  {
    name: 'Gold Guardians',
    tier: 'Gold',
    p1: { email: 'test.player5@cpl.com', name: 'Test Player 5' },
    p2: { email: 'test.player6@cpl.com', name: 'Test Player 6' },
  },
  {
    name: 'Gold Griffins',
    tier: 'Gold',
    p1: { email: 'test.player11@cpl.com', name: 'Test Player 11' },
    p2: { email: 'test.player12@cpl.com', name: 'Test Player 12' },
  },
  {
    name: 'Gold Galaxy',
    tier: 'Gold',
    p1: { email: 'test.player13@cpl.com', name: 'Test Player 13' },
    p2: { email: 'test.player14@cpl.com', name: 'Test Player 14' },
  },
]

async function upsertAuthUser(email, name) {
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const existing = list?.users?.find(u => u.email === email)

  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, { password: PASSWORD })
    console.log(`    ↺  ${email}`)
    return existing.id
  }

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (error) throw new Error(`Failed to create auth user ${email}: ${error.message}`)
  console.log(`    +  ${email}`)
  return created.user.id
}

async function main() {
  // Active season
  const { data: season, error: sErr } = await supabase
    .from('seasons').select('id, name').eq('is_active', true).single()
  if (!season) { console.error('No active season:', sErr?.message); process.exit(1) }
  console.log(`Season: ${season.name}\n`)

  // Tiers
  const { data: tiers } = await supabase
    .from('tiers').select('*').eq('season_id', season.id).order('rank_order')
  const tierMap = Object.fromEntries((tiers || []).map(t => [t.name, t]))

  // All occupied ranks
  const { data: allPos } = await supabase
    .from('ladder_positions').select('rank, team_id').eq('season_id', season.id)
  const occupiedRanks = new Set((allPos || []).map(p => p.rank))

  // Build a map of tier → list of empty ranks spread evenly across the tier range
  // We'll hand out ranks one at a time per tier as teams are placed
  const emptySlotsByTier = {}
  for (const tier of (tiers || [])) {
    const max = tier.max_rank ?? tier.min_rank
    const slots = []
    for (let r = tier.min_rank; r <= max; r++) {
      if (!occupiedRanks.has(r)) slots.push(r)
    }
    // Space them out: take ranks evenly from across the range rather than bottom-first
    const spaced = []
    if (slots.length > 0) {
      const step = Math.max(1, Math.floor(slots.length / (slots.length + 1)))
      // Just take them in order — they're already spread across the tier
      spaced.push(...slots)
    }
    emptySlotsByTier[tier.name] = spaced
  }

  const summary = []

  for (const entry of TEST_TEAMS) {
    console.log(`── ${entry.name} (${entry.tier}) ──`)

    const tier = tierMap[entry.tier]
    if (!tier) { console.warn(`  Tier "${entry.tier}" not found — skipping\n`); continue }

    // Auth
    console.log('  Auth:')
    const p1Id = await upsertAuthUser(entry.p1.email, entry.p1.name)
    const p2Id = await upsertAuthUser(entry.p2.email, entry.p2.name)

    // Player rows
    for (const [id, email, name] of [
      [p1Id, entry.p1.email, entry.p1.name],
      [p2Id, entry.p2.email, entry.p2.name],
    ]) {
      await supabase.from('players').upsert(
        { id, email, name, email_verified: true, is_admin: false, is_active: true },
        { onConflict: 'id' }
      )
    }

    // Team
    let teamId
    const { data: existingTeam } = await supabase
      .from('teams').select('id').eq('name', entry.name).eq('season_id', season.id).maybeSingle()

    if (existingTeam) {
      teamId = existingTeam.id
      await supabase.from('teams').update({ player1_id: p1Id, player2_id: p2Id }).eq('id', teamId)
      console.log('  Team: already exists — updated players')
    } else {
      const { data: team, error: tErr } = await supabase.from('teams').insert({
        season_id: season.id,
        name: entry.name,
        player1_id: p1Id,
        player2_id: p2Id,
        status: 'active',
        is_new_team: true,
        entry_fee_paid: false,
      }).select().single()
      if (tErr) { console.error(`  Failed to create team: ${tErr.message}\n`); continue }
      teamId = team.id
      console.log('  Team: created')
    }

    // Ladder position
    const { data: existingPos } = await supabase
      .from('ladder_positions').select('id, rank').eq('team_id', teamId).eq('season_id', season.id).maybeSingle()

    let rank
    if (existingPos) {
      rank = existingPos.rank
      console.log(`  Ladder: already at rank #${rank}`)
    } else {
      // Pick the next empty slot for this tier, spread across the range
      const slots = emptySlotsByTier[entry.tier] || []
      if (slots.length === 0) {
        // Tier is full — append after the tier's max rank
        const max = tier.max_rank ?? tier.min_rank
        const { data: afterMax } = await supabase
          .from('ladder_positions').select('rank').eq('season_id', season.id)
          .order('rank', { ascending: false }).limit(1)
        rank = (afterMax?.[0]?.rank ?? max) + 1
      } else {
        // Take from the middle of available slots to spread teams out
        const midIdx = Math.floor(slots.length / 2)
        rank = slots.splice(midIdx, 1)[0]
        emptySlotsByTier[entry.tier] = slots
      }

      // If rank is outside tier bounds we still use the tier id
      const { error: posErr } = await supabase.from('ladder_positions').insert({
        team_id: teamId,
        season_id: season.id,
        rank,
        tier_id: tier.id,
        status: 'active',
        consecutive_forfeits: 0,
      })
      if (posErr) { console.error(`  Failed to place: ${posErr.message}\n`); continue }
      occupiedRanks.add(rank)
      console.log(`  Ladder: placed at rank #${rank}`)
    }

    summary.push({ name: entry.name, tier: entry.tier, rank, p1: entry.p1.email, p2: entry.p2.email })
    console.log()
  }

  // Print summary
  const colW = 49
  const line  = '═'.repeat(colW)
  console.log(`╔${line}╗`)
  console.log(`║${'  TEST TEAMS READY'.padEnd(colW)}║`)
  console.log(`╠${line}╣`)
  console.log(`║  Password for all:  ${PASSWORD.padEnd(colW - 21)}║`)
  console.log(`╠${line}╣`)

  const tiers_ = ['Gold', 'Silver', 'Bronze']
  for (const tierName of tiers_) {
    const rows = summary.filter(t => t.tier === tierName)
    if (rows.length === 0) continue
    console.log(`║  ${tierName.toUpperCase().padEnd(colW - 2)}║`)
    for (const t of rows.sort((a, b) => a.rank - b.rank)) {
      console.log(`║    #${String(t.rank).padEnd(4)} ${t.name.padEnd(colW - 11)}║`)
      console.log(`║          ${t.p1.padEnd(colW - 10)}║`)
      console.log(`║          ${t.p2.padEnd(colW - 10)}║`)
    }
    console.log(`║${' '.repeat(colW)}║`)
  }
  console.log(`╚${line}╝`)
}

main().catch(err => { console.error(err); process.exit(1) })
