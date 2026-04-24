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
