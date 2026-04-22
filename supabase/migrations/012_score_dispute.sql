-- ─── Phase 6: Score Dispute Flow ─────────────────────────────────────────────
--
-- Adds dispute tracking columns to match_results and a configurable
-- dispute_window_minutes setting to league_settings.

-- ─── match_results: dispute fields ───────────────────────────────────────────

ALTER TABLE match_results
  ADD COLUMN IF NOT EXISTS disputed_score       JSONB,          -- the counter-score submitted by the non-reporter
  ADD COLUMN IF NOT EXISTS disputed_at          TIMESTAMPTZ,    -- when the dispute was raised
  ADD COLUMN IF NOT EXISTS dispute_resolved_by  UUID REFERENCES players(id),  -- player (or admin) who resolved it
  ADD COLUMN IF NOT EXISTS dispute_resolved_at  TIMESTAMPTZ,    -- when the dispute was resolved
  ADD COLUMN IF NOT EXISTS dispute_flagged_at   TIMESTAMPTZ;    -- set when window expires without resolution → needs admin review

COMMENT ON COLUMN match_results.disputed_score IS
  'Counter-score submitted by the non-reporting team as a JSON object with '
  'keys set1_challenger, set1_challenged, set2_challenger, set2_challenged, '
  'supertiebreak_challenger, supertiebreak_challenged, winner_team_id.';

COMMENT ON COLUMN match_results.disputed_at IS
  'Timestamp when the non-reporting team filed a score dispute.';

COMMENT ON COLUMN match_results.dispute_resolved_by IS
  'Player ID of whoever resolved the dispute (either the original reporter who '
  'accepted the counter-score, or an admin who set the final score).';

COMMENT ON COLUMN match_results.dispute_resolved_at IS
  'Timestamp when the dispute was resolved (either by team agreement or admin decision).';

COMMENT ON COLUMN match_results.dispute_flagged_at IS
  'Set when the dispute_window_minutes expires without resolution, signalling '
  'that the match needs admin review.';

-- ─── league_settings: dispute window ─────────────────────────────────────────

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS dispute_window_minutes INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN league_settings.dispute_window_minutes IS
  'Minutes the original score-reporter has to accept a disputed counter-score '
  'before the match is flagged for admin review. Default: 30.';
