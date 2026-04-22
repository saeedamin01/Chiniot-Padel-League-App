-- ─── Phase 7: Email Notifications — unsubscribe tokens ───────────────────────
--
-- Adds per-player email opt-out and a stable unsubscribe token.
-- The token is generated once at row-creation and never changes, so links
-- included in already-sent emails remain valid indefinitely.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS email_unsubscribed       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_unsubscribe_token  UUID    NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN players.email_unsubscribed IS
  'True when the player has opted out of all CPL email notifications.';

COMMENT ON COLUMN players.email_unsubscribe_token IS
  'Stable HMAC-free one-click unsubscribe token included in every outgoing email.';

-- Unique index so token lookups are fast
CREATE UNIQUE INDEX IF NOT EXISTS players_email_unsubscribe_token_idx
  ON players (email_unsubscribe_token);
