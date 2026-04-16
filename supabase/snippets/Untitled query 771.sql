-- Migration 003
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS proposed_slot      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_location  TEXT,
  ADD COLUMN IF NOT EXISTS match_date         TIMESTAMPTZ;

ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check
  CHECK (status IN ('pending', 'revision_proposed', 'accepted', 'scheduled', 'played', 'forfeited', 'dissolved'));

-- Migration 004
CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL, address TEXT, notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "venues_read" ON venues;
CREATE POLICY "venues_read" ON venues FOR SELECT USING (true);
DROP POLICY IF EXISTS "venues_admin_write" ON venues;
CREATE POLICY "venues_admin_write" ON venues FOR ALL USING (
  EXISTS (SELECT 1 FROM players WHERE id = auth.uid() AND is_admin = true)
);
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id),
  ADD COLUMN IF NOT EXISTS confirmed_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMPTZ;
ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS confirmation_window_hours INT NOT NULL DEFAULT 24;

-- Migration 005
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'forfeited', 'converted')),
  ADD COLUMN IF NOT EXISTS challenge_id UUID REFERENCES challenges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_reason TEXT,
  ADD COLUMN IF NOT EXISTS forfeited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE tickets SET status = 'used' WHERE is_used = TRUE AND status = 'active';
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tickets_read_own" ON tickets;
DROP POLICY IF EXISTS "tickets_read_all" ON tickets;
CREATE POLICY "tickets_read_all" ON tickets FOR SELECT USING (true);
DROP POLICY IF EXISTS "tickets_admin_write" ON tickets;
CREATE POLICY "tickets_admin_write" ON tickets FOR ALL USING (
  EXISTS (SELECT 1 FROM players WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE INDEX IF NOT EXISTS idx_tickets_team_status ON tickets (team_id, season_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_challenge ON tickets (challenge_id);

-- Extra: missing settings column
ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS result_verify_minutes INT NOT NULL DEFAULT 30;