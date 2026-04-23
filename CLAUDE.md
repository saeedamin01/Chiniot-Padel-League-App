# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

```bash
npm run dev       # Start dev server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint

# Local Supabase (Docker)
supabase start              # Start local DB
supabase stop               # Stop local DB
supabase migration up       # Apply pending migrations
supabase db reset           # Wipe and replay all migrations (clears data)

# After db reset, re-seed test data (single command):
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here node scripts/seed-all.js

# Legacy scripts (still work but seed-all.js supersedes them):
# SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here node scripts/seed-users.js
# SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here node scripts/seed-tier-teams.js
```

No test suite exists. TypeScript is the primary correctness check: `npx tsc --noEmit`.

---

## Architecture

Next.js 14 App Router + Supabase (PostgreSQL). Full-stack in one repo — API routes are the backend, client components are the frontend. No tRPC, no GraphQL.

### Route Groups

| Group | Path | Auth |
|---|---|---|
| `(auth)` | /login, /register, /verify-email | Public |
| `(player)` | /dashboard, /challenges, /ladder, /chat, /profile, /league | Must be logged in + email verified |
| `(admin)` | /admin/* | Must be `players.is_admin = true` |
| `app/api/` | All API endpoints | Per-route (most require auth) |
| `app/standings/` | Public standings | None |

### Three Supabase Clients — This Matters

```typescript
// lib/supabase/client.ts  — Browser only. Uses ANON_KEY. Respects RLS.
import { createClient } from '@/lib/supabase/client'

// lib/supabase/server.ts  — API routes / server components. Uses ANON_KEY + cookies. Respects RLS.
import { createClient } from '@/lib/supabase/server'

// lib/supabase/admin.ts   — Internal ops ONLY. Uses SERVICE_ROLE_KEY. BYPASSES RLS. Never import in client components.
import { createAdminClient } from '@/lib/supabase/admin'
```

**Rule**: API routes that act on behalf of the *user* (reading their data, checking their permissions) use `createClient()`. Operations that need elevated access — notifications, ladder engine, sending emails, audit logs — use `createAdminClient()`. The typical pattern in an API route is: use `createClient()` to authenticate the user, then `createAdminClient()` for the actual DB writes.

---

## Data Model

```
seasons (1)
  ├── league_settings (1)     — all rule params (deadlines, limits, tier rules)
  ├── tiers (5)               — Diamond, Platinum, Gold, Silver, Bronze
  └── teams (many)
        ├── player1_id → players
        ├── player2_id → players
        └── ladder_positions (1) → tier_id

challenges (1)
  ├── challenging_team_id → teams
  ├── challenged_team_id → teams
  ├── match_results (1)        — scores, verify status, dispute tracking
  ├── challenge_chats (1)      — one chat room per challenge
  │     └── chat_messages (many)
  └── challenge_events (many)  — full audit timeline

notifications → players
push_subscriptions → players
```

**Key columns on `challenges`:**
- `status`: `pending → accepted/accepted_open → time_pending_confirm → scheduled → played/forfeited/dissolved`
- `slot_1/2/3`: time options proposed by challenger
- `confirmed_time`: agreed match time
- `forfeit_by`: `'challenger'` or `'challenged'` — required to count forfeit losses correctly
- `accept_deadline`, `match_deadline`, `confirmation_deadline`
- `time_submitted_by_team_id`: whichever team called `set-time` (either team can in `accepted_open`). The **other** team must confirm. See confirmation flow note below.

**Key columns on `match_results`:**
- `reported_by_team_id`, `verified_at`, `auto_verified`
- `disputed_score`, `dispute_resolved_at`
- `winner_team_id`, `loser_team_id`, `season_id`

---

## Context Providers

Two providers wrap the entire `(player)` layout:

**`TeamContext`** (`context/TeamContext.tsx`)
- Provides: `activeTeam`, `teams`, `switchTeam()`, `seasonId`, `refresh()`
- `seasonId` comes from `seasons.eq('is_active', true)` — this is the source of truth for the current season
- Used by: dashboard, challenges, ladder — all season-scoped queries must use this `seasonId`

**`ChatContext`** (`context/ChatContext.tsx`)
- Provides: `totalUnread`, `refresh()`
- Uses Supabase Realtime to maintain live unread count

Both are set up in `app/(player)/layout.tsx`. `TeamProvider` requires both `userId` and `seasonId`. If `seasonId` is not yet loaded, `TeamProvider` is not rendered — `useTeam()` returns `{ seasonId: '', activeTeam: null }` until ready.

---

## API Route Pattern

Every API route follows this structure:

```typescript
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  // ... validate, operate, notify, audit log
  return NextResponse.json({ result })
}
```

After any significant state change, the pattern is:
1. DB update (admin client)
2. In-app notification (`adminClient.from('notifications').insert(...)`)
3. Email (`sendEventEmail(...)`)
4. Push (`sendPushEvent(...)`)
5. Audit log (`adminClient.from('audit_log').insert(...)`)
6. Challenge timeline (`logChallengeEvent(...)`)

---

## Notification System

`lib/notifications/service.ts` → `createNotification()` handles in-app + push. Email is separate via `lib/email/events.ts` → `sendEventEmail()`. Push is via `lib/push/notify.ts` → `sendPushEvent()`.

All three are fire-and-forget in API routes (`.catch(() => {})`). They must never block the response.

---

## Ladder Engine (`lib/ladder/engine.ts`)

Core business logic. Key functions:
- `getActiveSeason()` — always use this for server-side season lookups; uses admin client
- `canChallenge(challengingTeamId, challengedTeamId, seasonId, settings, ticketType)` — validates distance rules, active challenge limits, freeze status, ticket eligibility
- `processForfeit(challengeId, forfeitingTeamId)` — drops ladder position by `settings.forfeit_drop_positions`

Challenge creation (`POST /api/challenges`) calls `canChallenge()` and uses `getActiveSeason()`. The resulting `season_id` on the challenge row must always match the season ID used in dashboard/challenges queries.

---

## Known Patterns and Gotchas

### Trigger function name — always use `update_updated_at()`, never `update_updated_at_column()`

Migration 001 defines the trigger helper as `update_updated_at()`. Any migration that adds an `updated_at` trigger **must** use this exact name:
```sql
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```
Using `update_updated_at_column()` (a common Supabase boilerplate name) will cause the migration to fail with `function update_updated_at_column() does not exist`. This breaks every subsequent migration too, leaving tables like `venues`, `tickets`, and `challenge_chats` missing. The symptom is PostgREST returning 400 on any query that joins those tables.

### PostgREST FK hints are required for ambiguous joins

When joining `match_results` from `challenges`, always use the explicit FK hint:
```typescript
// ✅ Correct
.select('*, match_result:match_results!challenge_id(*)')

// ❌ Wrong — silently fails if PostgREST can't infer the relationship
.select('*, match_result:match_results(*)')
```

Always destructure `error` from Supabase queries on the client side so failures are not silent:
```typescript
const { data, error } = await supabase.from('challenges').select(...)
if (error) console.error('[context] query failed:', error)
```

### PostgREST returns arrays for joined relations

A `.select('*, team:teams!team_id(*)')` returns `team` as an **array** even though it's a 1-to-1 join. Always normalise:
```typescript
const team = Array.isArray(row.team) ? row.team[0] : row.team
```

For TypeScript, use `as unknown as ExpectedType` after normalising — do not cast directly from the raw Supabase return.

### Forfeit losses are not in `match_results`

Forfeited challenges never create a `match_results` row. To count forfeit losses:
```typescript
// Two separate queries — one for 'challenger' forfeit, one for 'challenged' forfeit
supabase.from('challenges')
  .select('id', { count: 'exact', head: true })
  .eq('season_id', sid)
  .eq('status', 'forfeited')
  .eq('forfeit_by', 'challenger')
  .eq('challenging_team_id', teamId)
```
This is done in both `dashboard/page.tsx` and `challenges/page.tsx`. Both must stay in sync.

### `time_pending_confirm` — who confirms depends on who submitted

There are two paths that result in a `time_pending_confirm` status:

| Path | Who submits | Who confirms |
|---|---|---|
| `accepted` (slot chosen) | Challenged team picked a slot | **Challenging team** always |
| `accepted_open` → `set-time` | Either team enters the agreed time | **The other team** (tracked by `time_submitted_by_team_id`) |

The confirm route (`POST /api/challenges/[id]/confirm`) enforces this:
- `accepted` → only challenging team can call confirm
- `time_pending_confirm` → user must be on the team that is NOT `time_submitted_by_team_id`
- Exception: if `confirmation_deadline` has passed, any team member can trigger the auto-confirm (fired fire-and-forget from the client page load)

Never write code that assumes "challenging team always confirms" — it only holds for the slot-acceptance path.

### Chat creation is non-fatal

The accept route (`/api/challenges/[id]/accept/route.ts`) creates the chat room after accepting. This is wrapped in its own try/catch so a missing migration or DB error does not fail the acceptance itself.

If a chat room is missing for an accepted challenge, the challenge detail page calls `GET /api/chat/challenge/[challengeId]` which lazily creates it. This covers challenges accepted before the chat migration was applied.

### Dashboard `challenges.length === 0` is the empty state

The dashboard query returns nothing → `challenges = []` → empty state renders. If challenges appear on the Challenges page but not the Dashboard, the likely cause is a silent query failure (missing FK hint, missing error handling, or wrong `season_id`).

### `useTeam()` returns empty `seasonId` on first render

The `(player)/layout.tsx` fetches the season asynchronously. Until resolved, `TeamProvider` is not mounted, so `useTeam()` returns `{ seasonId: '', activeTeam: null }`. Dashboard/challenges useEffects guard against this:
```typescript
useEffect(() => {
  if (selectedTeamId && seasonId) { /* fetch */ }
  else { setLoading(false) }
}, [selectedTeamId, seasonId, fetchChallenges])
```

---

## Migrations

Migrations live in `supabase/migrations/` and run in filename order. Current migrations:

| File | What it does |
|---|---|
| `001_initial_schema.sql` | Full schema: players, seasons, teams, challenges, match_results, tiers, ladder_positions, league_settings, notifications, audit_log |
| `002` | Slot requirement columns on challenges |
| `003` | Challenge flow columns |
| `004` | Venues table + new challenge flow |
| `005` | Tickets system (tier/silver/gold challenge tickets) |
| `006` | Reschedule flow columns |
| `007` | Challenge events table + RLS |
| `008` | Player verification fields |
| `009` | Push subscriptions table |
| `010` | Ladder snapshots |
| `011` | Dissolved reason column |
| `012` | Score dispute columns on match_results |
| `013` | Email unsubscribe tokens |
| `014` | `challenge_chats` + `chat_messages` tables, RLS, `mark_chat_messages_read()` RPC |
| `015` | Backfill chat rooms for pre-existing accepted challenges |
| `016` | `time_submitted_by_team_id` column on `challenges` — tracks which team entered the agreed time so the correct other team is required to confirm |
| `017` | `is_partner` boolean on `venues` — partner venues shown in a separate highlighted section of the venue picker |

### Applying migrations

**Local (first time or after a new migration file is added):**
```bash
cd cpl-app
supabase migration up          # apply only pending (new) migrations — preserves data
supabase db reset              # wipe everything and replay all migrations from scratch
# then re-seed:
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here node scripts/seed-users.js
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here node scripts/seed-tier-teams.js
```

**Production / hosted Supabase:**
Open the Supabase dashboard → SQL Editor → paste the contents of the new migration file and run it.
For migration 016 specifically:
```sql
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS time_submitted_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS challenges_time_submitted_by
  ON challenges (time_submitted_by_team_id)
  WHERE time_submitted_by_team_id IS NOT NULL;
```

**`001_initial_schema.sql` auto-seeds**: active Season 3, 5 tiers, default `league_settings`. After `db reset`, run `scripts/seed-users.js` to recreate test accounts.

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY    # Public anon key
SUPABASE_SERVICE_ROLE_KEY        # Secret service role key (server only, never expose)
NEXT_PUBLIC_APP_URL              # Full URL (http://localhost:3000 or https://yourdomain.com)
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM   # Email (Nodemailer)
CRON_SECRET                      # Bearer token for /api/cron/* endpoints
NEXT_PUBLIC_VAPID_PUBLIC_KEY     # Web push (optional — push degrades gracefully if absent)
VAPID_PRIVATE_KEY                # Web push private key (server only)
```

Local dev values are in `.env.local` (git-ignored). See `.env.example` for template.

---

## PWA & Push Notifications

The app is a PWA. `public/service-worker.js` handles push events and offline caching. Push requires VAPID keys — if not set, push notifications are silently skipped (guarded in `lib/push/send.ts`).

iOS PWA install prompt is handled in `components/PushNotificationManager.tsx` using the `beforeinstallprompt` event pattern.

---

## Test Accounts (after seed-all.js)

3 teams per tier, 15 teams total.

| Rank | Team | Tier | Login | Password |
|---|---|---|---|---|
| Admin | — | — | admin@cpl.com | Admin@cpl2026 |
| 1 | Alpha Smashers | Diamond | alpha1@cpl.com | Test1234 |
| 2 | Beta Blasters | Diamond | beta1@cpl.com | Test1234 |
| 3 | Gamma Kings | Diamond | gamma1@cpl.com | Test1234 |
| 4 | Delta Force | Platinum | delta1@cpl.com | Test1234 |
| 5 | Echo Warriors | Platinum | echo1@cpl.com | Test1234 |
| 6 | Foxtrot Smash | Platinum | foxtrot1@cpl.com | Test1234 |
| 7 | Ghost Riders | Gold | ghost1@cpl.com | Test1234 |
| 8 | Hunter Squad | Gold | hunter1@cpl.com | Test1234 |
| 9 | Iron Wolves | Gold | iron1@cpl.com | Test1234 |
| 10 | Jade Tigers | Silver | jade1@cpl.com | Test1234 |
| 11 | Kestrel FC | Silver | kestrel1@cpl.com | Test1234 |
| 12 | Lion Hearts | Silver | lion1@cpl.com | Test1234 |
| 13 | Midnight Ravens | Bronze | midnight1@cpl.com | Test1234 |
| 14 | Nova Squad | Bronze | nova1@cpl.com | Test1234 |
| 15 | Oak Warriors | Bronze | oak1@cpl.com | Test1234 |
