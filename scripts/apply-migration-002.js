#!/usr/bin/env node
// Run with: node scripts/apply-migration-002.js
// Adds slot requirement columns to league_settings

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function applyMigration() {
  console.log('Applying migration 002: slot requirements...')

  // Use RPC to run raw SQL
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE league_settings
        ADD COLUMN IF NOT EXISTS slot_evening_count INTEGER DEFAULT 2,
        ADD COLUMN IF NOT EXISTS slot_weekend_count INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS slot_evening_start_hour INTEGER DEFAULT 18,
        ADD COLUMN IF NOT EXISTS slot_evening_end_hour INTEGER DEFAULT 21;

      UPDATE league_settings SET
        slot_evening_count = COALESCE(slot_evening_count, 2),
        slot_weekend_count = COALESCE(slot_weekend_count, 1),
        slot_evening_start_hour = COALESCE(slot_evening_start_hour, 18),
        slot_evening_end_hour = COALESCE(slot_evening_end_hour, 21);
    `
  })

  if (error) {
    // If RPC not available, use direct psql approach via supabase db
    console.log('RPC not available, run this SQL directly in Supabase Studio (http://localhost:54323):')
    console.log(`
ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS slot_evening_count INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS slot_weekend_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS slot_evening_start_hour INTEGER DEFAULT 18,
  ADD COLUMN IF NOT EXISTS slot_evening_end_hour INTEGER DEFAULT 21;

UPDATE league_settings SET
  slot_evening_count = COALESCE(slot_evening_count, 2),
  slot_weekend_count = COALESCE(slot_weekend_count, 1),
  slot_evening_start_hour = COALESCE(slot_evening_start_hour, 18),
  slot_evening_end_hour = COALESCE(slot_evening_end_hour, 21);
    `)
    console.log('\nOr run: npx supabase db push')
  } else {
    console.log('✅ Migration applied successfully!')
  }

  // Verify columns
  const { data, error: checkError } = await supabase
    .from('league_settings')
    .select('slot_evening_count, slot_weekend_count, slot_evening_start_hour, slot_evening_end_hour')
    .limit(1)

  if (!checkError) {
    console.log('✅ Columns verified:', data)
  } else {
    console.log('⚠️  Columns not yet applied. Run the SQL above in Supabase Studio.')
  }
}

applyMigration().catch(console.error)
