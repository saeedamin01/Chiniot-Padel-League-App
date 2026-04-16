#!/usr/bin/env node
/**
 * CPL Seed Users Script
 * Creates admin + 8 test teams using the Supabase Admin API
 * Run with: node scripts/seed-users.js
 */

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// ─── Test Accounts ────────────────────────────────────────────────────────────
// Each team has 2 players. Password for all: Test1234
// Team login is player1's email.
//
// Rank | Team Name        | Tier     | Player 1 email       | Player 2 email
//  1   | Alpha Smashers   | Diamond  | alpha1@cpl.com       | alpha2@cpl.com
//  2   | Beta Blasters    | Diamond  | beta1@cpl.com        | beta2@cpl.com
//  3   | Gamma Kings      | Platinum | gamma1@cpl.com       | gamma2@cpl.com
//  4   | Delta Force      | Platinum | delta1@cpl.com       | delta2@cpl.com
//  5   | Echo Warriors    | Gold     | echo1@cpl.com        | echo2@cpl.com
//  6   | Foxtrot Smash    | Gold     | foxtrot1@cpl.com     | foxtrot2@cpl.com
//  7   | Ghost Riders     | Silver   | ghost1@cpl.com       | ghost2@cpl.com
//  8   | Hunter Squad     | Bronze   | hunter1@cpl.com      | hunter2@cpl.com
// ─────────────────────────────────────────────────────────────────────────────

const TEAMS = [
  { name: 'Alpha Smashers',  tier: 'Diamond',  rank: 1, p1: 'alpha1@cpl.com',   p2: 'alpha2@cpl.com'   },
  { name: 'Beta Blasters',   tier: 'Diamond',  rank: 2, p1: 'beta1@cpl.com',    p2: 'beta2@cpl.com'    },
  { name: 'Gamma Kings',     tier: 'Platinum', rank: 3, p1: 'gamma1@cpl.com',   p2: 'gamma2@cpl.com'   },
  { name: 'Delta Force',     tier: 'Platinum', rank: 4, p1: 'delta1@cpl.com',   p2: 'delta2@cpl.com'   },
  { name: 'Echo Warriors',   tier: 'Gold',     rank: 5, p1: 'echo1@cpl.com',    p2: 'echo2@cpl.com'    },
  { name: 'Foxtrot Smash',   tier: 'Gold',     rank: 6, p1: 'foxtrot1@cpl.com', p2: 'foxtrot2@cpl.com' },
  { name: 'Ghost Riders',    tier: 'Silver',   rank: 7, p1: 'ghost1@cpl.com',   p2: 'ghost2@cpl.com'   },
  { name: 'Hunter Squad',    tier: 'Bronze',   rank: 8, p1: 'hunter1@cpl.com',  p2: 'hunter2@cpl.com'  },
]

const DEFAULT_PASSWORD = 'Test1234'

async function createPlayer(email, name) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: { name }
  })

  if (error) {
    if (error.message.includes('already been registered')) {
      // Get existing user ID
      const { data: list } = await supabase.auth.admin.listUsers()
      const existing = list?.users?.find(u => u.email === email)
      return existing?.id
    }
    throw new Error(`Auth error for ${email}: ${error.message}`)
  }

  return data.user.id
}

async function seedUsers() {
  console.log('🌱 Seeding CPL — Admin + 8 Test Teams\n')

  // ─── 1. Admin ──────────────────────────────────────────────────────────────
  console.log('Creating admin: admin@cpl.com / Admin@cpl2026')
  const adminId = await createPlayer('admin@cpl.com', 'CPL Admin')

  await supabase.from('players').upsert({
    id: adminId,
    email: 'admin@cpl.com',
    name: 'CPL Admin',
    phone: '+92-300-0000000',
    email_verified: true,
    is_admin: true,
    is_active: true
  }, { onConflict: 'email' })

  await supabase.from('notification_preferences')
    .upsert({ player_id: adminId }, { onConflict: 'player_id' })

  console.log('  ✅ Admin created\n')

  // ─── 2. Active Season ──────────────────────────────────────────────────────
  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .single()

  if (!season) {
    console.error('❌ No active season. Run: npx supabase db reset')
    process.exit(1)
  }

  // ─── 3. Tiers ──────────────────────────────────────────────────────────────
  const { data: tiers } = await supabase
    .from('tiers')
    .select('id, name')
    .eq('season_id', season.id)

  const tierMap = {}
  for (const t of tiers || []) tierMap[t.name] = t.id

  // ─── 4. Teams ──────────────────────────────────────────────────────────────
  console.log('Creating 8 teams (password for all players: Test1234)\n')

  for (const team of TEAMS) {
    process.stdout.write(`  Rank ${team.rank} — ${team.name} (${team.tier}): `)

    // Create both players
    const p1Name = team.p1.split('@')[0].replace(/\d/g, '') + ' A'
    const p2Name = team.p1.split('@')[0].replace(/\d/g, '') + ' B'

    const p1Id = await createPlayer(team.p1, p1Name)
    const p2Id = await createPlayer(team.p2, p2Name)

    // Upsert player profiles
    await supabase.from('players').upsert([
      { id: p1Id, email: team.p1, name: p1Name, email_verified: true, is_admin: false, is_active: true },
      { id: p2Id, email: team.p2, name: p2Name, email_verified: true, is_admin: false, is_active: true }
    ], { onConflict: 'email' })

    await supabase.from('notification_preferences').upsert([
      { player_id: p1Id },
      { player_id: p2Id }
    ], { onConflict: 'player_id' })

    // Create team
    const { error: teamError } = await supabase.from('teams').upsert({
      season_id: season.id,
      name: team.name,
      player1_id: p1Id,
      player2_id: p2Id,
      status: 'active',
      entry_fee_paid: true
    }, { onConflict: 'name,season_id' })

    if (teamError) {
      console.log(`❌ ${teamError.message}`)
      continue
    }

    // Get team ID
    const { data: teamRow } = await supabase
      .from('teams')
      .select('id')
      .eq('name', team.name)
      .eq('season_id', season.id)
      .single()

    if (teamRow && tierMap[team.tier]) {
      // Check if ladder position exists
      const { data: existingPos } = await supabase
        .from('ladder_positions')
        .select('id')
        .eq('team_id', teamRow.id)
        .single()

      if (!existingPos) {
        await supabase.from('ladder_positions').insert({
          team_id: teamRow.id,
          season_id: season.id,
          rank: team.rank,
          tier_id: tierMap[team.tier],
          status: 'active'
        })
      }
    }

    console.log('✅')
  }

  // ─── 5. Summary ────────────────────────────────────────────────────────────
  console.log('\n✅ All done!\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  ADMIN')
  console.log('  admin@cpl.com       →  Admin@cpl2026')
  console.log('')
  console.log('  TEAMS  (all players: password = Test1234)')
  console.log('  Rank  Team              Login (player 1)')
  console.log('  ────  ────────────────  ─────────────────────')
  for (const t of TEAMS) {
    const rank = String(t.rank).padEnd(4)
    const name = t.name.padEnd(18)
    console.log(`  ${rank}  ${name}  ${t.p1}`)
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log('  Visit: http://localhost:3000/login\n')
}

seedUsers().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
