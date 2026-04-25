-- Migration 023: Multi-round dispute system
--
-- Adds tracking columns to match_results so disputes can go up to 3 rounds:
--
--   Round 1: Team A submits → Team B has 30 min to verify/dispute
--   Round 2: Team B disputes → Team A has 60 min to accept/re-dispute
--   Round 3: Team A re-disputes → Team B has 60 min to accept/re-dispute
--   Round 4: Team B disputes again → admin resolves (locked for players)
--
-- dispute_round:           how many disputes have been filed (0 = none)
-- dispute_pending_team_id: which team must act next (NULL = admin required)
-- dispute_deadline:        when the current round expires (auto-approve on expiry)

ALTER TABLE match_results
  ADD COLUMN IF NOT EXISTS dispute_round           INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_pending_team_id UUID         REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispute_deadline        TIMESTAMPTZ;
