#!/usr/bin/env node
/**
 * CPL Diagnostic Script — runs direct DB queries to find the issue
 */
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function run() {
  console.log('=== CPL Diagnostic ===\n')

  // 1. Active season
  const { data: season } = await admin.from('seasons').select('id,name').eq('is_active', true).single()
  console.log('Active season:', season?.name, season?.id)

  // 2. Teams count
  const { data: teams, count: tc } = await admin.from('teams').select('id,name', { count: 'exact' }).eq('season_id', season.id)
  console.log(`\nTeams in DB: ${tc}`)
  for (const t of teams || []) console.log('  -', t.name, t.id)

  // 3. Ladder positions (no joins)
  const { data: positions, count: pc } = await admin
    .from('ladder_positions')
    .select('id,team_id,rank,tier_id,status,season_id', { count: 'exact' })
    .eq('season_id', season.id)
  console.log(`\nLadder positions in DB: ${pc}`)
  for (const p of positions || []) {
    console.log(`  rank ${p.rank} | team_id: ${p.team_id} | tier_id: ${p.tier_id} | status: ${p.status}`)
  }

  // 4. Try with join (service role)
  console.log('\n--- Join query (service role) ---')
  const { data: joined, error: je } = await admin
    .from('ladder_positions')
    .select('rank, teams(name), tiers(name)')
    .eq('season_id', season.id)
  console.log('Error:', je?.message || 'none')
  console.log('Rows:', joined?.length)
  console.log('Sample:', JSON.stringify(joined?.[0]))

  // 5. Try with ANON key (what the browser uses)
  console.log('\n--- Ladder positions query (anon key — same as browser) ---')
  const { data: anonPos, error: ae } = await anon
    .from('ladder_positions')
    .select('rank, status')
    .eq('season_id', season.id)
  console.log('Error:', ae?.message || 'none')
  console.log('Rows returned:', anonPos?.length)

  // 6. Teams with anon key
  console.log('\n--- Teams query (anon key) ---')
  const { data: anonTeams, error: ate } = await anon
    .from('teams')
    .select('id,name')
    .eq('season_id', season.id)
  console.log('Error:', ate?.message || 'none')
  console.log('Rows returned:', anonTeams?.length)

  console.log('\n=== Done ===')
}

run().catch(console.error)
