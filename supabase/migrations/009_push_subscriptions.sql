-- Push notification subscriptions
-- Stores Web Push API subscription objects per player per device

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A player can have multiple devices
create index if not exists push_subscriptions_player_id_idx
  on public.push_subscriptions(player_id);

-- RLS
alter table public.push_subscriptions enable row level security;

-- Players can only manage their own subscriptions
create policy "Players manage own push subscriptions"
  on public.push_subscriptions
  for all
  using  (player_id = auth.uid())
  with check (player_id = auth.uid());

-- Service role can read all (for sending notifications server-side)
-- (service role bypasses RLS by default — no extra policy needed)
