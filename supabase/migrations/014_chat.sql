-- ─── Phase 9: In-App Chat ────────────────────────────────────────────────────
--
-- One chat room per accepted challenge. Only the 4 players on the challenge
-- can read and write.
--
-- Design decisions:
--   • allowed_player_ids uuid[]  — cached on the row so RLS doesn't need to
--     re-join challenges → teams → players on every query.
--   • read_by uuid[]             — append-only array; use the RPC below to
--     mark messages as read (PostgREST can't do array_append inline).
--   • last_email_sent_at         — chat-level throttle so we never spam email
--     more than once per hour per chat.
--   • Realtime enabled on chat_messages for live-update subscriptions.

-- ─── challenge_chats ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.challenge_chats (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id        UUID        NOT NULL UNIQUE REFERENCES public.challenges(id) ON DELETE CASCADE,
  allowed_player_ids  UUID[]      NOT NULL DEFAULT '{}',
  last_email_sent_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.challenge_chats.allowed_player_ids IS
  'The 4 player IDs from both teams — cached so RLS is a fast array contains check.';

COMMENT ON COLUMN public.challenge_chats.last_email_sent_at IS
  'Throttle: do not send another new-message email until this timestamp + 1 hour has passed.';

CREATE INDEX IF NOT EXISTS challenge_chats_challenge_id_idx
  ON public.challenge_chats (challenge_id);

-- ─── chat_messages ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    UUID        NOT NULL REFERENCES public.challenge_chats(id) ON DELETE CASCADE,
  sender_id  UUID        NOT NULL REFERENCES public.players(id),
  content    TEXT        NOT NULL CHECK (length(trim(content)) > 0 AND length(content) <= 2000),
  read_by    UUID[]      NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_chat_id_idx
  ON public.chat_messages (chat_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_sender_idx
  ON public.chat_messages (sender_id);

-- GIN index so the `read_by @> ARRAY[uid]` check in RLS is fast
CREATE INDEX IF NOT EXISTS chat_messages_read_by_gin_idx
  ON public.chat_messages USING GIN (read_by);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.challenge_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages   ENABLE ROW LEVEL SECURITY;

-- challenge_chats: players can see chats they're in
CREATE POLICY "chat_member_select"
  ON public.challenge_chats FOR SELECT
  USING (allowed_player_ids @> ARRAY[auth.uid()]);

-- challenge_chats: service role inserts new chats (no player policy needed)

-- chat_messages: read — user must be in the chat
CREATE POLICY "chat_message_select"
  ON public.chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.challenge_chats cc
      WHERE cc.id = chat_messages.chat_id
        AND cc.allowed_player_ids @> ARRAY[auth.uid()]
    )
  );

-- chat_messages: insert — user must be in the chat and must be the sender
CREATE POLICY "chat_message_insert"
  ON public.chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.challenge_chats cc
      WHERE cc.id = chat_messages.chat_id
        AND cc.allowed_player_ids @> ARRAY[auth.uid()]
    )
  );

-- chat_messages: update read_by — user must be in the chat
-- (actual array mutation is done via the RPC below, but we still need the policy)
CREATE POLICY "chat_message_update"
  ON public.chat_messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.challenge_chats cc
      WHERE cc.id = chat_messages.chat_id
        AND cc.allowed_player_ids @> ARRAY[auth.uid()]
    )
  );

-- ─── RPC: mark_chat_messages_read ────────────────────────────────────────────
-- Called from the client when a player opens a chat thread.
-- Appends auth.uid() to read_by on all unread messages in the given chat
-- that were NOT sent by the current user.

CREATE OR REPLACE FUNCTION public.mark_chat_messages_read(p_chat_id UUID)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.chat_messages
  SET read_by = array_append(read_by, auth.uid())
  WHERE chat_id = p_chat_id
    AND sender_id  != auth.uid()
    AND NOT (read_by @> ARRAY[auth.uid()]);
$$;

GRANT EXECUTE ON FUNCTION public.mark_chat_messages_read(UUID) TO authenticated;

-- ─── Supabase Realtime ────────────────────────────────────────────────────────
-- Enables live-update subscriptions on the messages table.
-- Requires `supabase_realtime` publication to already exist (it does by default).

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
