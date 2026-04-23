-- Migration 004: Venues table + new challenge flow
--
-- Challenge flow changes:
--   OLD: pending → revision_proposed → scheduled
--   NEW: pending → accepted → scheduled
--
-- "accepted" = challenged team entered confirmed time + venue, awaiting
--              challenger confirmation (or auto-confirm after window expires).
-- "revision_proposed" is retired.
--
-- New fields on challenges:
--   venue_id              FK to venues
--   confirmed_time        TIMESTAMPTZ — the mutually-agreed datetime entered by challenged team
--   confirmation_deadline TIMESTAMPTZ — when challenger's confirm window expires (auto-confirm after)
--
-- New league_settings field:
--   confirmation_window_hours INT — how long challenger has to confirm (default 24 h)

-- ── 1. Venues ──────────────────────────────────────────────────────────────────

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

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: admins can manage, players can read active venues
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venues_read" ON venues
  FOR SELECT USING (true);

CREATE POLICY "venues_admin_write" ON venues
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM players WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ── 2. Challenges — new columns ────────────────────────────────────────────────

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS venue_id              UUID REFERENCES venues(id),
  ADD COLUMN IF NOT EXISTS confirmed_time        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMPTZ;

-- ── 3. Status constraint — add 'accepted', retire 'revision_proposed' ──────────
-- We keep 'revision_proposed' in the constraint for now so existing rows are
-- not invalidated; it is simply no longer produced by new code.

ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check
  CHECK (status IN (
    'pending',
    'accepted',
    'revision_proposed',   -- legacy, kept for existing data
    'scheduled',
    'played',
    'forfeited',
    'dissolved'
  ));

-- ── 4. league_settings — confirmation window ───────────────────────────────────

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS confirmation_window_hours INT NOT NULL DEFAULT 24;
