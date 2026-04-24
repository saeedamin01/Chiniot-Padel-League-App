-- ─────────────────────────────────────────────────────────────────────────────
-- CPL Season Reset
--
-- KEEPS:   players, teams, ladder_positions (ranks), tiers, seasons,
--          league_settings, venues, push_subscriptions, notification_preferences
--
-- CLEARS:  challenges, match_results, chat rooms/messages, notifications,
--          audit_log, challenge_events, ladder_history, ladder_snapshots, tickets
--
-- Also resets ladder_positions.consecutive_forfeits and last_challenged_team_id
-- so teams start with a clean slate.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Chat messages (FK → challenge_chats)
DELETE FROM public.chat_messages;

-- 2. Challenge chats (FK → challenges)
DELETE FROM public.challenge_chats;

-- 3. Challenge events / timeline (FK → challenges)
DELETE FROM public.challenge_events;

-- 4. Match results (FK → challenges)
DELETE FROM public.match_results;

-- 5. Ladder history entries tied to challenges (nullable FK)
DELETE FROM public.ladder_history;

-- 6. Ladder snapshots (historical, not needed for fresh start)
DELETE FROM public.ladder_snapshots;

-- 7. Tickets (challenge-linked)
DELETE FROM public.tickets;

-- 8. All notifications (inbox will be empty for everyone)
DELETE FROM public.notifications;

-- 9. Audit log
DELETE FROM public.audit_log;

-- 10. Challenges (main table — must come after all children are deleted)
DELETE FROM public.challenges;

-- 11. Reset ladder position counters — keep rank and tier but clear forfeits
--     and the rematch restriction so no team is blocked from day one
UPDATE public.ladder_positions
SET
  consecutive_forfeits      = 0,
  last_challenged_team_id   = NULL;

COMMIT;

-- Verify: these should all return 0
SELECT 'challenges'      AS tbl, COUNT(*) FROM public.challenges
UNION ALL
SELECT 'match_results',          COUNT(*) FROM public.match_results
UNION ALL
SELECT 'chat_messages',          COUNT(*) FROM public.chat_messages
UNION ALL
SELECT 'challenge_chats',        COUNT(*) FROM public.challenge_chats
UNION ALL
SELECT 'challenge_events',       COUNT(*) FROM public.challenge_events
UNION ALL
SELECT 'tickets',                COUNT(*) FROM public.tickets
UNION ALL
SELECT 'notifications',          COUNT(*) FROM public.notifications
UNION ALL
SELECT 'audit_log',              COUNT(*) FROM public.audit_log
UNION ALL
SELECT 'ladder_history',         COUNT(*) FROM public.ladder_history
UNION ALL
SELECT 'ladder_snapshots',       COUNT(*) FROM public.ladder_snapshots;
