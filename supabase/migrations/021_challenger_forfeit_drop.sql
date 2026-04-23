-- Migration 021: Add challenger_forfeit_drop_positions to league_settings
--
-- Controls how many ladder positions the CHALLENGER drops if they forfeit
-- a challenge at any point (before or after scheduling). Default is 0 (no penalty).
-- The challenged team forfeit penalty is the existing forfeit_drop_positions column.

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS challenger_forfeit_drop_positions INTEGER DEFAULT 0;
