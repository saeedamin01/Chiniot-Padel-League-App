-- Migration 011: Add dissolved_reason column to challenges table
-- Stores a human-readable explanation whenever a challenge is dissolved,
-- so players know why their challenge disappeared.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS dissolved_reason TEXT;

COMMENT ON COLUMN challenges.dissolved_reason IS
  'Human-readable reason a challenge was dissolved. Set by API routes and cron jobs.';

-- ─── Phase 6: Score Dispute Flow ─────────────────────────────────────────────
--
-- Adds dispute tracking columns to match_results and a configurable
-- dispute_window_minutes setting to league_settings.

-- ─── match_results: dispute fields ───────────────────────────────────────────

ALTER TABLE match_results
  ADD COLUMN IF NOT EXISTS disputed_score       JSONB,          -- the counter-score submitted by the non-reporter
  ADD COLUMN IF NOT EXISTS disputed_at          TIMESTAMPTZ,    -- when the dispute was raised
  ADD COLUMN IF NOT EXISTS dispute_resolved_by  UUID REFERENCES players(id),  -- player (or admin) who resolved it
  ADD COLUMN IF NOT EXISTS dispute_resolved_at  TIMESTAMPTZ,    -- when the dispute was resolved
  ADD COLUMN IF NOT EXISTS dispute_flagged_at   TIMESTAMPTZ;    -- set when window expires without resolution → needs admin review

COMMENT ON COLUMN match_results.disputed_score IS
  'Counter-score submitted by the non-reporting team as a JSON object with '
  'keys set1_challenger, set1_challenged, set2_challenger, set2_challenged, '
  'supertiebreak_challenger, supertiebreak_challenged, winner_team_id.';

COMMENT ON COLUMN match_results.disputed_at IS
  'Timestamp when the non-reporting team filed a score dispute.';

COMMENT ON COLUMN match_results.dispute_resolved_by IS
  'Player ID of whoever resolved the dispute (either the original reporter who '
  'accepted the counter-score, or an admin who set the final score).';

COMMENT ON COLUMN match_results.dispute_resolved_at IS
  'Timestamp when the dispute was resolved (either by team agreement or admin decision).';

COMMENT ON COLUMN match_results.dispute_flagged_at IS
  'Set when the dispute_window_minutes expires without resolution, signalling '
  'that the match needs admin review.';

-- ─── league_settings: dispute window ─────────────────────────────────────────

ALTER TABLE league_settings
  ADD COLUMN IF NOT EXISTS dispute_window_minutes INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN league_settings.dispute_window_minutes IS
  'Minutes the original score-reporter has to accept a disputed counter-score '
  'before the match is flagged for admin review. Default: 30.';

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

-- ─── Phase 9: Backfill chat rooms for already-accepted challenges ─────────────
--
-- Run this AFTER 014_chat.sql has been applied.
-- Creates a challenge_chats row for every accepted/active/historical challenge
-- that doesn't already have one, so players can chat about older matches.
--
-- Safe to run multiple times (INSERT ... WHERE NOT EXISTS).

INSERT INTO public.challenge_chats (challenge_id, allowed_player_ids)
SELECT
  c.id                                        AS challenge_id,
  ARRAY_REMOVE(
    ARRAY[
      ct.player1_id,
      ct.player2_id,
      cd.player1_id,
      cd.player2_id
    ],
    NULL
  )::uuid[]                                   AS allowed_player_ids
FROM public.challenges c
JOIN public.teams ct ON ct.id = c.challenging_team_id
JOIN public.teams cd ON cd.id = c.challenged_team_id
WHERE c.status IN (
  'accepted_open',
  'accepted',
  'time_pending_confirm',
  'revision_proposed',
  'reschedule_requested',
  'reschedule_pending_admin',
  'scheduled',
  'played',
  'forfeited'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.challenge_chats cc
  WHERE cc.challenge_id = c.id
);

-- ─── Track which team submitted the agreed time ──────────────────────────────
-- When status = time_pending_confirm, the team that is NOT time_submitted_by_team_id
-- must confirm. This prevents the submitting team from confirming their own time.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS time_submitted_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS challenges_time_submitted_by
  ON challenges (time_submitted_by_team_id)
  WHERE time_submitted_by_team_id IS NOT NULL;

-- Migration 017: Add is_partner flag to venues
--
-- Partner venues are clubs or courts that have a formal arrangement with CPL
-- (e.g. a discount for league members). They appear in a separate "Partner
-- Venues" section in the venue picker and are highlighted for players.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS is_partner BOOLEAN NOT NULL DEFAULT false;

-- Partners sort before non-partners, then alphabetically
CREATE INDEX IF NOT EXISTS idx_venues_partner
  ON venues (season_id, is_partner DESC, name);

COMMENT ON COLUMN venues.is_partner IS
  'True for clubs/courts with a formal CPL partnership (discounts etc.)';

-- Migration 018: Allow players to mark/delete their own notifications
--
-- The original schema only had a FOR SELECT policy on notifications.
-- Players could not UPDATE (mark as read) or DELETE their own rows,
-- causing all dismiss/dismiss-all/delete actions to silently fail.

-- Players can mark their own notifications as read (UPDATE is_read, read_at only)
CREATE POLICY "Players can update own notifications" ON notifications
  FOR UPDATE USING (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  )
  WITH CHECK (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  );

-- Players can delete their own notifications
CREATE POLICY "Players can delete own notifications" ON notifications
  FOR DELETE USING (
    player_id IN (
      SELECT id FROM players WHERE id::TEXT = auth.uid()::TEXT
    )
  );

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

