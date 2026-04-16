#!/usr/bin/env node
// Run with: node scripts/apply-migrations-003-005.js
// Applies migrations 003, 004, 005 and any missing league_settings columns

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ─── SQL statements to apply (each is idempotent via IF NOT EXISTS / IF EXISTS) ───

const SQL_003 = `
-- Migration 003: Enhanced challenge flow
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS proposed_slot      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_location  TEXT,
  ADD COLUMN IF NOT EXISTS match_date         TIMESTAMPTZ;

ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check
  CHECK (status IN ('pending', 'revision_proposed', 'accepted', 'scheduled', 'played', 'forfeited', 'dissolved'));
`

const SQL_004 = `
-- Migration 004: Venues + new challenge flow columns
CREATE TABLE IF NOT EXISTS venues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   UUID REFERENCES seasons(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venues_read" ON venues;
CREATE POLICY "venues_read" ON venues FOR SELECT USING (true);

DROP POLICY IF EXISTS "venues_admin_write" ON venues;
CREATE POLICY "venues_admin_write" ON venues FOR ALL USING (
  EXISTS (SELECT 1 FROM players WHERE id = auth.uid() AND is_admin = true)
);

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS venue_id              UUID REFERENCES venues(id),
  ADD COLUMN IF NOT EXISTS confirmed_time        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMPTZ;

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS confirmation_window_hours INT NOT NULL DEFAULT 24;
`

const SQL_005 = `
-- Migration 005: Tickets enhanced
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'forfeited', 'converted')),
  ADD COLUMN IF NOT EXISTS challenge_id    UUID REFERENCES challenges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by     UUID REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_reason TEXT,
  ADD COLUMN IF NOT EXISTS forfeited_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE tickets SET status = 'used' WHERE is_used = TRUE AND status = 'active';

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tickets_read_own" ON tickets;
DROP POLICY IF EXISTS "tickets_read_all" ON tickets;
CREATE POLICY "tickets_read_all" ON tickets FOR SELECT USING (true);

DROP POLICY IF EXISTS "tickets_admin_write" ON tickets;
CREATE POLICY "tickets_admin_write" ON tickets FOR ALL USING (
  EXISTS (SELECT 1 FROM players WHERE id = auth.uid() AND is_admin = TRUE)
);

CREATE INDEX IF NOT EXISTS idx_tickets_team_status  ON tickets (team_id, season_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_challenge     ON tickets (challenge_id);
`

// result_verify_minutes was never added to a migration but the settings form references it
const SQL_EXTRA = `
ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS result_verify_minutes INT NOT NULL DEFAULT 30;
`

async function runSQL(label, sql) {
  const { error } = await supabase.rpc('exec_sql', { sql })
  if (error) {
    console.error(`❌  ${label} — RPC failed: ${error.message}`)
    return false
  }
  console.log(`✅  ${label}`)
  return true
}

async function main() {
  console.log('Checking connection...')
  const { error: connErr } = await supabase.from('seasons').select('id').limit(1)
  if (connErr) {
    console.error('Cannot reach Supabase. Is your local dev server running? (npx supabase start)')
    console.log('\nIf exec_sql RPC is not available, run this SQL directly in Supabase Studio')
    console.log('→ http://localhost:54323  → SQL Editor\n')
    console.log('--- PASTE THIS SQL ---')
    console.log(SQL_003)
    console.log(SQL_004)
    console.log(SQL_005)
    console.log(SQL_EXTRA)
    console.log('--- END SQL ---')
    process.exit(1)
  }

  console.log('Connected. Applying migrations...\n')

  const ok003 = await runSQL('Migration 003 (challenge columns)', SQL_003)
  const ok004 = await runSQL('Migration 004 (venues + confirmation_window_hours)', SQL_004)
  const ok005 = await runSQL('Migration 005 (tickets enhanced)', SQL_005)
  const okExtra = await runSQL('Extra: result_verify_minutes', SQL_EXTRA)

  if (!ok003 || !ok004 || !ok005 || !okExtra) {
    console.log('\n⚠️  Some steps failed via RPC. Paste the SQL above directly into Supabase Studio:')
    console.log('→ http://localhost:54323  → SQL Editor\n')
    console.log('--- PASTE THIS SQL ---')
    if (!ok003) console.log(SQL_003)
    if (!ok004) console.log(SQL_004)
    if (!ok005) console.log(SQL_005)
    if (!okExtra) console.log(SQL_EXTRA)
    console.log('--- END SQL ---')
  } else {
    console.log('\n🎉 All migrations applied!')
  }

  // Verify key columns
  const { data, error: verifyErr } = await supabase
    .from('league_settings')
    .select('confirmation_window_hours, result_verify_minutes')
    .limit(1)
  if (!verifyErr && data?.length) {
    console.log('Verified league_settings columns:', data[0])
  }
}

main().catch(console.error)
