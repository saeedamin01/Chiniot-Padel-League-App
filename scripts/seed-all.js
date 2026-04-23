#!/usr/bin/env node
/**
 * CPL — Full Seed Script
 *
 * Creates admin + 15 test teams (3 per tier) for the active season.
 * Safe to re-run after `supabase db reset`.
 *
 *   supabase db reset
 *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here node scripts/seed-all.js
 *
 * ─── Teams ───────────────────────────────────────────────────────────────────
 * Rank  Team               Tier      Login (p1)              Password
 *  1    Alpha Smashers     Diamond   alpha1@cpl.com           Test1234
 *  2    Beta Blasters      Diamond   beta1@cpl.com            Test1234
 *  3    Gamma Kings        Diamond   gamma1@cpl.com           Test1234
 *  4    Delta Force        Platinum  delta1@cpl.com           Test1234
 *  5    Echo Warriors      Platinum  echo1@cpl.com            Test1234
 *  6    Foxtrot Smash      Platinum  foxtrot1@cpl.com         Test1234
 *  7    Ghost Riders       Gold      ghost1@cpl.com           Test1234
 *  8    Hunter Squad       Gold      hunter1@cpl.com          Test1234
 *  9    Iron Wolves        Gold      iron1@cpl.com            Test1234
 * 10    Jade Tigers        Silver    jade1@cpl.com            Test1234
 * 11    Kestrel FC         Silver    kestrel1@cpl.com         Test1234
 * 12    Lion Hearts        Silver    lion1@cpl.com            Test1234
 * 13    Midnight Ravens    Bronze    midnight1@cpl.com        Test1234
 * 14    Nova Squad         Bronze    nova1@cpl.com            Test1234
 * 15    Oak Warriors       Bronze    oak1@cpl.com             Test1234
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_SERVICE_ROLE_KEY is not set.')
  console.error('    Run: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/seed-all.js')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const DEFAULT_PASSWORD = 'Test1234'

// ─── Team definitions ────────────────────────────────────────────────────────
// Each entry creates 2 auth users: p1 (team lead) + p2
const TEAMS = [
  // Diamond tier
  { rank: 1,  name: 'Alpha Smashers',   tier: 'Diamond',  p1: 'alpha1@cpl.com',    p2: 'alpha2@cpl.com'    },
  { rank: 2,  name: 'Beta Blasters',    tier: 'Diamond',  p1: 'beta1@cpl.com',     p2: 'beta2@cpl.com'     },
  { rank: 3,  name: 'Gamma Kings',      tier: 'Diamond',  p1: 'gamma1@cpl.com',    p2: 'gamma2@cpl.com'    },
  // Platinum tier
  { rank: 4,  name: 'Delta Force',      tier: 'Platinum', p1: 'delta1@cpl.com',    p2: 'delta2@cpl.com'    },
  { rank: 5,  name: 'Echo Warriors',    tier: 'Platinum', p1: 'echo1@cpl.com',     p2: 'echo2@cpl.com'     },
  { rank: 6,  name: 'Foxtrot Smash',    tier: 'Platinum', p1: 'foxtrot1@cpl.com',  p2: 'foxtrot2@cpl.com'  },
  // Gold tier
  { rank: 7,  name: 'Ghost Riders',     tier: 'Gold',     p1: 'ghost1@cpl.com',    p2: 'ghost2@cpl.com'    },
  { rank: 8,  name: 'Hunter Squad',     tier: 'Gold',     p1: 'hunter1@cpl.com',   p2: 'hunter2@cpl.com'   },
  { rank: 9,  name: 'Iron Wolves',      tier: 'Gold',     p1: 'iron1@cpl.com',     p2: 'iron2@cpl.com'     },
  // Silver tier
  { rank: 10, name: 'Jade Tigers',      tier: 'Silver',   p1: 'jade1@cpl.com',     p2: 'jade2@cpl.com'     },
  { rank: 11, name: 'Kestrel FC',       tier: 'Silver',   p1: 'kestrel1@cpl.com',  p2: 'kestrel2@cpl.com'  },
  { rank: 12, name: 'Lion Hearts',      tier: 'Silver',   p1: 'lion1@cpl.com',     p2: 'lion2@cpl.com'     },
  // Bronze tier
  { rank: 13, name: 'Midnight Ravens',  tier: 'Bronze',   p1: 'midnight1@cpl.com', p2: 'midnight2@cpl.com' },
  { rank: 14, name: 'Nova Squad',       tier: 'Bronze',   p1: 'nova1@cpl.com',     p2: 'nova2@cpl.com'     },
  { rank: 15, name: 'Oak Warriors',     tier: 'Bronze',   p1: 'oak1@cpl.com',      p2: 'oak2@cpl.com'      },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getOrCreateAuthUser(email, name) {
  // Try to find existing auth user
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const existing = list?.users?.find(u => u.email === email)
  if (existing) return existing.id

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  })

  if (error) throw new Error(`Auth error for ${email}: ${error.message}`)
  return data.user.id
}

async function upsertPlayerProfile(id, email, name, isAdmin = false) {
  await supabase.from('players').upsert(
    { id, email, name, email_verified: true, is_admin: isAdmin, is_active: true },
    { onConflict: 'id' }
  )
  await supabase.from('notification_preferences').upsert(
    { player_id: id },
    { onConflict: 'player_id' }
  )
}

async function upsertTeam(seasonId, teamDef, p1Id, p2Id) {
  const { error } = await supabase.from('teams').upsert(
    {
      season_id: seasonId,
      name: teamDef.name,
      player1_id: p1Id,
      player2_id: p2Id,
      status: 'active',
      entry_fee_paid: true,
    },
    { onConflict: 'name,season_id' }
  )
  if (error) throw new Error(`Team upsert failed for ${teamDef.name}: ${error.message}`)

  const { data: row } = await supabase
    .from('teams')
    .select('id')
    .eq('name', teamDef.name)
    .eq('season_id', seasonId)
    .single()

  return row?.id
}

async function upsertLadderPosition(teamId, seasonId, rank, tierId) {
  // Check if a position already exists for this team IN THIS SEASON
  const { data: existing } = await supabase
    .from('ladder_positions')
    .select('id')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)   // ← always filter by season
    .maybeSingle()

  if (existing) {
    // Update existing position (fixes stale tier_id and rank)
    await supabase
      .from('ladder_positions')
      .update({ rank, tier_id: tierId, status: 'active' })
      .eq('id', existing.id)
  } else {
    await supabase.from('ladder_positions').insert({
      team_id: teamId,
      season_id: seasonId,
      rank,
      tier_id: tierId,
      status: 'active',
      consecutive_forfeits: 0,
    })
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  CPL Full Seed\n')

  // ── Admin ──────────────────────────────────────────────────────────────────
  console.log('1/4  Creating admin account …')
  const adminId = await getOrCreateAuthUser('admin@cpl.com', 'CPL Admin')
  await upsertPlayerProfile(adminId, 'admin@cpl.com', 'CPL Admin', true)
  console.log('     ✅  admin@cpl.com / Admin@cpl2026\n')

  // ── Active season ──────────────────────────────────────────────────────────
  console.log('2/4  Checking active season …')
  const { data: season } = await supabase
    .from('seasons')
    .select('id, season_number')
    .eq('is_active', true)
    .single()

  if (!season) {
    console.error('     ❌  No active season found.')
    console.error('         Run: supabase db reset   (then re-run this script)')
    process.exit(1)
  }
  console.log(`     ✅  Season ${season.season_number}  (${season.id})\n`)

  // ── Tiers ──────────────────────────────────────────────────────────────────
  console.log('3/4  Loading tiers …')
  const { data: tiers } = await supabase
    .from('tiers')
    .select('id, name')
    .eq('season_id', season.id)

  if (!tiers || tiers.length === 0) {
    console.error('     ❌  No tiers found for this season.')
    process.exit(1)
  }

  const tierMap = Object.fromEntries(tiers.map(t => [t.name, t.id]))
  console.log(`     ✅  Found: ${Object.keys(tierMap).join(', ')}\n`)

  // ── Teams ──────────────────────────────────────────────────────────────────
  console.log('4/4  Creating / updating teams …\n')

  const results = []

  for (const team of TEAMS) {
    process.stdout.write(`     Rank ${String(team.rank).padStart(2)}  ${team.name.padEnd(18)}  ${team.tier.padEnd(10)}  `)

    const tierId = tierMap[team.tier]
    if (!tierId) {
      console.log(`❌  Tier "${team.tier}" not found in DB — skipping`)
      continue
    }

    try {
      const p1Name = team.p1.split('@')[0] + ' A'
      const p2Name = team.p1.split('@')[0] + ' B'

      const [p1Id, p2Id] = await Promise.all([
        getOrCreateAuthUser(team.p1, p1Name),
        getOrCreateAuthUser(team.p2, p2Name),
      ])

      await Promise.all([
        upsertPlayerProfile(p1Id, team.p1, p1Name),
        upsertPlayerProfile(p2Id, team.p2, p2Name),
      ])

      const teamId = await upsertTeam(season.id, team, p1Id, p2Id)
      if (!teamId) throw new Error('Could not get team ID after upsert')

      await upsertLadderPosition(teamId, season.id, team.rank, tierId)

      console.log('✅')
      results.push({ ...team, teamId })
    } catch (err) {
      console.log(`❌  ${err.message}`)
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ADMIN
  admin@cpl.com  →  Admin@cpl2026

  TEST ACCOUNTS  (all passwords: Test1234)
  Rank  Team               Tier      Login
  ────  ─────────────────  ────────  ─────────────────────────`)

  for (const t of results) {
    const rank = String(t.rank).padEnd(4)
    const name = t.name.padEnd(19)
    const tier = t.tier.padEnd(10)
    console.log(`  ${rank}  ${name}  ${tier}  ${t.p1}`)
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Visit: http://localhost:3000/login
`)
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message)
  process.exit(1)
})
