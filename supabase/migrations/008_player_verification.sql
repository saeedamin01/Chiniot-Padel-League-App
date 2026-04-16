-- Migration 008: Player email verification tokens
-- Adds token columns so the app can send and verify its own
-- email verification links (independent of any auth provider).

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS verification_token      UUID,
  ADD COLUMN IF NOT EXISTS verification_token_expires_at TIMESTAMPTZ;

-- Fast lookup when a player clicks a verification link
CREATE INDEX IF NOT EXISTS idx_players_verification_token
  ON players (verification_token)
  WHERE verification_token IS NOT NULL;
