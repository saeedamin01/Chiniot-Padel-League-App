ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges ADD CONSTRAINT challenges_status_check
  CHECK (status IN (
    'pending',
    'accepted',
    'accepted_open',
    'time_pending_confirm',
    'reschedule_requested',
    'reschedule_pending_admin',
    'revision_proposed',
    'scheduled',
    'played',
    'forfeited',
    'dissolved'
  ));

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS reschedule_requested_by    UUID REFERENCES teams(id),
  ADD COLUMN IF NOT EXISTS reschedule_proposed_time   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_proposed_venue_id UUID REFERENCES venues(id),
  ADD COLUMN IF NOT EXISTS reschedule_reason          TEXT,
  ADD COLUMN IF NOT EXISTS reschedule_confirmed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reschedule_approved_by     UUID REFERENCES players(id),
  ADD COLUMN IF NOT EXISTS reschedule_approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_confirmed_time    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_venue_id          UUID REFERENCES venues(id);