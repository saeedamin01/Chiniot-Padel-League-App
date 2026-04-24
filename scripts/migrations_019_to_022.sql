-- Migration 019: Add 'result_pending' challenge status
--
-- Previously, challenge status was set to 'played' the moment a score was
-- submitted. This meant both teams were immediately free to send/receive new
-- challenges during the verification window.
--
-- New flow:
--   score submitted  → status: 'result_pending'  (teams locked, score hidden from 3rd parties)
--   result verified  → status: 'played'           (ladder updated, teams unlocked)
--
-- 'played' now exclusively means "verified and complete".

ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_status_check;

ALTER TABLE challenges
  ADD CONSTRAINT challenges_status_check CHECK (
    status IN (
      'pending',
      'accepted',
      'accepted_open',
      'time_pending_confirm',
      'revision_proposed',
      'reschedule_requested',
      'reschedule_pending_admin',
      'scheduled',
      'result_pending',
      'played',
      'forfeited',
      'dissolved'
    )
  );

-- Migration 020: Add slot_evening_start_minute to support sub-hour evening starts (e.g. 5:30 PM)

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS slot_evening_start_minute INTEGER DEFAULT 30;

-- Update existing rows: shift start to 17:30 (was 18:00)
UPDATE league_settings
  SET slot_evening_start_hour   = 17,
      slot_evening_start_minute = 30
  WHERE slot_evening_start_hour = 18
    AND (slot_evening_start_minute IS NULL OR slot_evening_start_minute = 0);

-- Migration 021: Add challenger_forfeit_drop_positions to league_settings
--
-- Controls how many ladder positions the CHALLENGER drops if they forfeit
-- a challenge at any point (before or after scheduling). Default is 0 (no penalty).
-- The challenged team forfeit penalty is the existing forfeit_drop_positions column.

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS challenger_forfeit_drop_positions INTEGER DEFAULT 0;

-- Migration 022: Chat enhancements — reply-to and reactions

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reactions           JSONB NOT NULL DEFAULT '{}';

-- Index for fast reply lookups
CREATE INDEX IF NOT EXISTS chat_messages_reply_to_idx
  ON chat_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

COMMENT ON COLUMN chat_messages.reply_to_message_id IS
  'The message this message is replying to, if any.';

COMMENT ON COLUMN chat_messages.reactions IS
  'Emoji reactions as a JSON object: { "👍": ["player_id1", "player_id2"], "❤️": ["player_id3"] }';

