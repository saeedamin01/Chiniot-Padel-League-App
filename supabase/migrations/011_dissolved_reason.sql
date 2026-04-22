-- Migration 011: Add dissolved_reason column to challenges table
-- Stores a human-readable explanation whenever a challenge is dissolved,
-- so players know why their challenge disappeared.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS dissolved_reason TEXT;

COMMENT ON COLUMN challenges.dissolved_reason IS
  'Human-readable reason a challenge was dissolved. Set by API routes and cron jobs.';
