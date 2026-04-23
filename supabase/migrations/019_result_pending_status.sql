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
