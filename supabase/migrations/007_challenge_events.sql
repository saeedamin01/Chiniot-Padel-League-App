-- ─────────────────────────────────────────────────────────────────────────────
-- 007_challenge_events.sql
--
-- Per-challenge event timeline.
-- Every meaningful state change, player action, and admin operation against a
-- challenge writes a row here. This gives a full, ordered audit trail that can
-- be displayed alongside the challenge in both the admin and player UIs.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS challenge_events (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id UUID        NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,
  actor_id     UUID        REFERENCES players(id) ON DELETE SET NULL,
  actor_role   TEXT        NOT NULL CHECK (actor_role IN ('player', 'admin', 'system')),
  actor_name   TEXT,                        -- denormalised at write-time
  data         JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS challenge_events_challenge_id_idx
  ON challenge_events(challenge_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE challenge_events ENABLE ROW LEVEL SECURITY;

-- Players can read events for challenges they are part of
CREATE POLICY "Players can view their own challenge events"
  ON challenge_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   challenges c
      JOIN   teams t
             ON (t.id = c.challenging_team_id OR t.id = c.challenged_team_id)
      WHERE  c.id = challenge_events.challenge_id
        AND  (t.player1_id = auth.uid() OR t.player2_id = auth.uid())
    )
  );

-- Inserts always go through the service-role (admin) client, which bypasses RLS
-- No INSERT policy needed for anon/auth roles.
