ALTER TABLE players
  ADD COLUMN IF NOT EXISTS verification_token UUID,
  ADD COLUMN IF NOT EXISTS verification_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_players_verification_token
  ON players (verification_token)
  WHERE verification_token IS NOT NULL;