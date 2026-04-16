-- Migration 006: Accept-open flow + reschedule flow
--
-- New challenge statuses:
--   accepted_open          — Team B accepted without choosing a slot.
--                            Waiting for Team B to enter the agreed time.
--   time_pending_confirm   — Team B entered the agreed time.
--                            Waiting for Team A (challenger) to confirm.
--   reschedule_requested   — Either team requested a time/venue change.
--                            Waiting for the OTHER team to confirm.
--   reschedule_pending_admin — Both teams agreed to reschedule.
--                            Waiting for admin approval.
--
-- Existing statuses kept as-is:
--   pending, accepted, revision_proposed (legacy), scheduled,
--   played, forfeited, dissolved

-- ── 1. Expand the status constraint ──────────────────────────────────────────

ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check
  CHECK (status IN (
    'pending',
    'accepted',                  -- Option 2: slot chosen by Team B, Team A confirms
    'accepted_open',             -- Option 1: accepted without slot, time TBD
    'time_pending_confirm',      -- Team B entered time, Team A confirms
    'reschedule_requested',      -- Reschedule proposed, awaiting other team
    'reschedule_pending_admin',  -- Both agreed, awaiting admin approval
    'revision_proposed',         -- legacy
    'scheduled',
    'played',
    'forfeited',
    'dissolved'
  ));

-- ── 2. Reschedule columns ─────────────────────────────────────────────────────

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS reschedule_requested_by    UUID REFERENCES teams(id),
  ADD COLUMN IF NOT EXISTS reschedule_proposed_time   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_proposed_venue_id UUID REFERENCES venues(id),
  ADD COLUMN IF NOT EXISTS reschedule_reason          TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_confirmed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_approved_by     UUID REFERENCES players(id),
  ADD COLUMN IF NOT EXISTS reschedule_approved_at     TIMESTAMPTZ,
  -- Preserve the original scheduled time so admin can revert on rejection
  ADD COLUMN IF NOT EXISTS original_confirmed_time    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_venue_id          UUID REFERENCES venues(id);
