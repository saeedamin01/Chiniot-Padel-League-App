-- Migration 005: Enhance tickets table for full ticket lifecycle
--
-- Ticket types:
--   tier   — challenge any available team in your own tier
--   silver — challenge any available team in the Silver tier
--   gold   — challenge any available team in the Gold tier
--
-- Ticket status lifecycle:
--   active    → the ticket is available for use
--   used      → ticket was used and the challenging team WON
--   forfeited → ticket was used and the challenging team LOST,
--               OR the team sent a non-ticket challenge while holding the ticket,
--               OR this is a gold ticket and the linked silver ticket was lost
--   converted → silver + gold were traded in together for a tier ticket (admin action)
--
-- Silver/Gold dependency rule:
--   If a team holds both silver and gold tickets, they MUST win the silver
--   ticket match before they can use the gold ticket. If they lose the silver
--   match, both silver AND gold are forfeited simultaneously.
--
-- Forfeiture on first non-ticket challenge:
--   If a team sends ANY challenge without designating a ticket, their active
--   tickets are immediately forfeited. Receiving a challenge does NOT trigger this.

-- ── 1. Add new columns to the existing tickets table ──────────────────────────

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'forfeited', 'converted')),
  ADD COLUMN IF NOT EXISTS challenge_id     UUID REFERENCES challenges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by      UUID REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_reason  TEXT,
  ADD COLUMN IF NOT EXISTS forfeited_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Back-fill status from the legacy is_used column for any existing rows
UPDATE tickets SET status = 'used' WHERE is_used = TRUE AND status = 'active';

-- ── 2. Auto-update updated_at ─────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. Enable RLS ─────────────────────────────────────────────────────────────

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Players can see tickets for their own team(s)
CREATE POLICY "tickets_read_own" ON tickets
  FOR SELECT USING (
    team_id IN (
      SELECT t.id FROM teams t
      WHERE t.player1_id = auth.uid() OR t.player2_id = auth.uid()
    )
  );

-- Players can see all tickets (needed for opponent ticket display on ladder)
-- Actually, let's keep it open — ticket status (e.g. "this team has a silver ticket")
-- might be visible publicly on the ladder.
DROP POLICY IF EXISTS "tickets_read_own" ON tickets;
CREATE POLICY "tickets_read_all" ON tickets
  FOR SELECT USING (true);

-- Only admins can insert/update/delete tickets
CREATE POLICY "tickets_admin_write" ON tickets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM players WHERE id = auth.uid() AND is_admin = TRUE
    )
  );

-- ── 4. Index for fast lookup by team + status ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tickets_team_status
  ON tickets (team_id, season_id, status);

CREATE INDEX IF NOT EXISTS idx_tickets_challenge
  ON tickets (challenge_id);
