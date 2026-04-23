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
