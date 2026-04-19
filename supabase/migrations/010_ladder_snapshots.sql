-- ─── Ladder Snapshots ────────────────────────────────────────────────────────
-- Stores a daily JSON snapshot of the full ladder for the last 7 days.
-- One row per day per season. Old rows are deleted by the cron job.

create table if not exists ladder_snapshots (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons(id) on delete cascade,
  snapshot_date date not null,
  data         jsonb not null,  -- array of { rank, team_id, team_name, tier, status, wins, losses }
  created_at   timestamptz not null default now(),

  unique (season_id, snapshot_date)
);

-- Admins can read; no player access needed
alter table ladder_snapshots enable row level security;

create policy "Admins can manage ladder snapshots"
  on ladder_snapshots for all
  using (
    exists (
      select 1 from players
      where players.id = auth.uid()
      and players.role = 'admin'
    )
  );

-- Index for fast date-range lookups
create index if not exists ladder_snapshots_season_date
  on ladder_snapshots (season_id, snapshot_date desc);
