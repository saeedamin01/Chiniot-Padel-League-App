-- ─── Track which team submitted the agreed time ──────────────────────────────
-- When status = time_pending_confirm, the team that is NOT time_submitted_by_team_id
-- must confirm. This prevents the submitting team from confirming their own time.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS time_submitted_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS challenges_time_submitted_by
  ON challenges (time_submitted_by_team_id)
  WHERE time_submitted_by_team_id IS NOT NULL;
