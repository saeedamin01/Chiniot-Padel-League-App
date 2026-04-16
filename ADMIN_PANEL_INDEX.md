# Admin Panel Complete Implementation Index

## Quick Start

1. **Verify setup**: Check all environment variables in `.env.local`
2. **Test access**: Log in as admin and navigate to `/admin`
3. **Run cron jobs**: Set up scheduled tasks for automated operations
4. **Configure settings**: Customize league rules in `/admin/settings`

---

## File Structure

### Admin Pages (`app/(admin)/admin/`)

| Page | Purpose | Key Features |
|------|---------|--------------|
| `layout.tsx` | Protected layout | Auth guard, sidebar, role check |
| `page.tsx` | Dashboard | Stats, activity, quick actions |
| `teams/page.tsx` | Team mgmt | CRUD, freeze, dissolve |
| `ladder/page.tsx` | Ladder mgmt | Manual rank adjust, validation |
| `challenges/page.tsx` | Challenge mgmt | Status tracking, admin actions |
| **`settings/page.tsx`** | **CRITICAL** | **8 tabs, all league rules** |
| `audit/page.tsx` | Audit log | Paginated, filterable, export CSV |
| `players/page.tsx` | Player mgmt | Permissions, verification, suspend |

### API Routes (`app/api/`)

#### Challenges
- `POST /api/challenges` - Create challenge
- `GET /api/challenges` - List with filters
- `POST /api/challenges/{id}/accept` - Accept with slot
- `POST /api/challenges/{id}/forfeit` - Forfeit (processes ladder)
- `POST /api/challenges/{id}/dissolve` - Admin dissolve

#### Teams
- `POST /api/admin/teams` - Create (full options)
- `POST /api/teams/{id}/freeze` - Freeze (drops 1 rank)
- `POST /api/teams/{id}/unfreeze` - Unfreeze (admin)
- `POST /api/teams/{id}/dissolve` - Dissolve (admin)

#### Admin
- `GET /api/ladder` - Full ladder with details
- `POST /api/admin/ladder` - Rank adjustments
- `GET/PATCH /api/admin/settings` - Settings CRUD
- `GET /api/admin/audit` - Audit log queries

#### Cron Jobs (secured with CRON_SECRET)
- `GET /api/cron/freeze-drops` - Auto-drop frozen teams
- `GET /api/cron/challenge-forfeit` - Auto-forfeit expired
- `GET /api/cron/result-verify` - Auto-verify results

---

## Critical Settings (Settings Page)

### Challenge Rules Section
- **challenge_window_days** (default: 10) - Days to play after accepting
- **challenge_accept_hours** (default: 24) - Hours to accept before expiry
- **challenge_positions_above** (default: 3) - Max positions above to challenge
- **max_active_challenges_out/in** - Concurrent challenge limits
- **consecutive_forfeit_limit** (default: 3) - Before dropping to bottom

### Freeze Rules Section
- **freeze_immediate_drop** (default: 1) - Positions dropped on freeze
- **freeze_interval_days** (default: 7) - Days between drops
- **freeze_interval_drop** (default: 1) - Positions per interval drop

### Forfeit Rules Section
- **forfeit_drop_positions** (default: 2) - Rank drops on forfeit

### Result Reporting Section
- **result_report_hours** (default: 2) - Hours to report after match
- **result_verify_hours** (default: 24) - Hours before auto-verify

### Match Format Section
- **sets_to_win** (default: 2)
- **super_tiebreak_points** (default: 10)
- **tiebreak_points** (default: 7)
- **lateness_set_forfeit_minutes** (default: 15)
- **lateness_match_forfeit_minutes** (default: 25)

### Player Rules Section
- **max_teams_per_player** (default: 2)
- **inactivity_dissolve_days** (default: 15)
- **partner_change_drop_positions** (default: 3)

### Tier Configuration
- Configure each tier: name, color, rank range, prizes

---

## Data Flow Examples

### Creating a Team
```
POST /api/admin/teams
  ├─ Validates players exist
  ├─ Creates team record
  ├─ Determines tier based on rank
  ├─ Creates ladder_position
  ├─ Creates ticket (optional)
  └─ Logs to audit_log
```

### Challenge Forfeit Process
```
POST /api/challenges/{id}/forfeit
  ├─ Validates authorization
  ├─ Calls processForfeit() from engine
  │   ├─ Recalculates ladder positions
  │   ├─ Shifts teams between
  │   └─ Updates tier assignments
  ├─ Updates challenge status
  ├─ Creates notifications
  └─ Logs to audit_log
```

### Manual Ladder Adjustment
```
POST /api/admin/ladder
  ├─ Validates no duplicate ranks
  ├─ Atomically applies all changes
  ├─ Creates ladder_history entries
  └─ Logs complete change to audit_log
```

### Cron Job: Auto-Forfeit
```
GET /api/cron/freeze-drops (daily)
  ├─ Finds frozen teams with pending drops
  ├─ Drops positions per settings
  ├─ Updates next_drop_at
  └─ Creates notifications
```

---

## Authentication & Authorization

### Protected Routes
All routes in `app/(admin)/` check:
1. User is authenticated
2. User has `is_admin = true`

### API Protection
- Most routes check authenticated user
- Admin-only routes verify is_admin flag
- Cron routes verify CRON_SECRET header

### Audit Trail
Every action logs:
- Who: actor_id, actor_email
- What: action_type, entity_type, entity_id
- When: created_at timestamp
- Details: old_value, new_value, notes

---

## Deployment Checklist

- [ ] All env vars set in .env.local
- [ ] Database tables created with migrations
- [ ] Admin player created with is_admin=true
- [ ] Tested admin access to /admin
- [ ] Tested team creation
- [ ] Tested ladder adjustments
- [ ] Tested challenge operations
- [ ] Tested settings updates save
- [ ] Set up cron job schedule
- [ ] Tested with CRON_SECRET
- [ ] Verified audit logging works
- [ ] CSV export functional
- [ ] Notifications appear in DB
- [ ] Error handling tested

---

## Monitoring & Support

### Check Admin Activity
```sql
SELECT * FROM audit_log 
WHERE action_type LIKE '%team%' OR action_type LIKE '%ladder%'
ORDER BY created_at DESC LIMIT 50;
```

### Find Recent Changes
```sql
SELECT * FROM audit_log 
WHERE created_at > NOW() - INTERVAL 1 day
ORDER BY created_at DESC;
```

### Monitor Challenges
```sql
SELECT id, challenge_code, status, accept_deadline 
FROM challenges 
WHERE season_id = '<current-season>'
ORDER BY issued_at DESC;
```

### Check Frozen Teams
```sql
SELECT f.*, t.name FROM freeze_records f
JOIN teams t ON f.team_id = t.id
WHERE unfrozen_at IS NULL;
```

---

## Common Operations

### Make User an Admin
```bash
curl -X PATCH https://app.supabase.com/rest/v1/players \
  -H "Authorization: Bearer <service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{"is_admin": true}' \
  -w '?id=eq.<player-id>'
```

### Create a Manual Challenge
Use `/admin` → Challenges (when user flow enabled)

### Freeze a Team
1. Navigate to `/admin/teams`
2. Find team in table
3. Click freeze button
4. Confirm action
5. Team drops 1 position

### Export Audit Log
1. Navigate to `/admin/audit`
2. Apply filters if needed
3. Click "Export CSV" button
4. File downloads automatically

### Update League Settings
1. Navigate to `/admin/settings`
2. Click relevant tab
3. Update values
4. Click "Save Changes"
5. Changes logged to audit_log

---

## File Sizes Summary

| File | Size | Lines | Purpose |
|------|------|-------|---------|
| settings/page.tsx | 29KB | 600+ | Settings panel (largest) |
| challenges/page.tsx | 12KB | 250+ | Challenge management |
| teams/page.tsx | 14KB | 350+ | Team management |
| admin/teams/route.ts | 7KB | 173 | Team creation API |
| ladder/page.tsx | 10KB | 240+ | Ladder management |
| audit/page.tsx | 12KB | 280+ | Audit log UI |
| dashboard/page.tsx | 10KB | 220+ | Admin dashboard |

**Total Code**: ~150KB of TypeScript/React
**Total Files**: 23 (8 pages + 14 APIs + 1 layout)

---

## Support Resources

- **API Documentation**: See inline comments in each route
- **Component Guide**: Check COMPONENT_GUIDE.md
- **Implementation Details**: See ADMIN_IMPLEMENTATION_SUMMARY.md
- **Deployment**: See DEPLOYMENT_GUIDE.md

---

## Quick Links

- **Admin Dashboard**: `/admin`
- **Teams Page**: `/admin/teams`
- **Settings**: `/admin/settings`
- **Audit Log**: `/admin/audit`
- **Challenges**: `/admin/challenges`
- **Ladder**: `/admin/ladder`
- **Players**: `/admin/players`

---

**Created**: April 2026
**Status**: Production Ready
**Next Review**: After first season deployment
