-- Migration 003: Enhanced challenge flow
-- Adds proposed slot for revision flow, updates status enum, removes incoming challenge uniqueness assumption

-- Add proposed slot columns for revision flow
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS proposed_slot TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_location TEXT,
  ADD COLUMN IF NOT EXISTS match_date TIMESTAMPTZ;

-- Expand the status check constraint to include revision_proposed
-- We need to drop and recreate the constraint since Postgres doesn't support modifying CHECK constraints
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check
  CHECK (status IN ('pending', 'revision_proposed', 'scheduled', 'played', 'forfeited', 'dissolved'));
