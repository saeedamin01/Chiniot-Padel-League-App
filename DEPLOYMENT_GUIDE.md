# Chiniot Padel League Admin Panel - Deployment Guide

## Overview
This document covers the deployment and setup of the complete admin panel for the Chiniot Padel League app.

## Files Created Summary

### Admin Pages (8 files)
Located in `app/(admin)/admin/`:
- **layout.tsx** - Admin layout with sidebar and auth guard
- **page.tsx** - Main dashboard with stats and quick actions
- **teams/page.tsx** - Team management (CRUD + freeze/dissolve)
- **ladder/page.tsx** - Manual ladder adjustments
- **challenges/page.tsx** - Challenge oversight and admin actions
- **settings/page.tsx** - Complete league settings panel
- **audit/page.tsx** - Audit log with pagination and export
- **players/page.tsx** - Player management and permissions

### API Routes (15 files)
Located in `app/api/`:

**Challenge Routes:**
- `challenges/route.ts` - GET (list), POST (create)
- `challenges/[id]/accept/route.ts` - Accept challenge with slot
- `challenges/[id]/forfeit/route.ts` - Forfeit challenge
- `challenges/[id]/dissolve/route.ts` - Admin dissolve

**Team Routes:**
- `teams/[id]/freeze/route.ts` - Freeze team
- `teams/[id]/unfreeze/route.ts` - Unfreeze team
- `teams/[id]/dissolve/route.ts` - Dissolve team

**Admin Routes:**
- `admin/teams/route.ts` - Create team with full options
- `admin/ladder/route.ts` - Manual ladder adjustments
- `admin/settings/route.ts` - GET/PATCH league settings
- `admin/audit/route.ts` - Audit log queries

**Other Routes:**
- `ladder/route.ts` - Get full ladder
- `cron/freeze-drops/route.ts` - Process freeze drops
- `cron/challenge-forfeit/route.ts` - Auto-forfeit challenges
- `cron/result-verify/route.ts` - Auto-verify results

## Prerequisites

### Required Dependencies
All should already be in package.json:
- next 14
- react 19
- @supabase/supabase-js
- @supabase/ssr
- date-fns
- tailwindcss
- lucide-react
- clsx & tailwind-merge

### Environment Variables
Add to `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Cron Jobs Security
CRON_SECRET=<generate-a-secure-random-string>
```

## Database Schema Requirements

The following tables must exist in Supabase:

### Core Tables
- **players** - User accounts with admin flag
- **seasons** - Season definitions
- **league_settings** - Configurable rules per season
- **tiers** - Tier definitions (Diamond, Platinum, Gold, Silver, Bronze)
- **teams** - Team records
- **ladder_positions** - Current ladder rankings
- **ladder_history** - Historical rank changes

### Challenge & Match Tables
- **challenges** - Challenge records
- **match_results** - Match result records
- **tickets** - Entry tickets

### Freeze & Audit Tables
- **freeze_records** - Frozen team records with drop schedule
- **audit_log** - Complete action audit trail
- **notifications** - User notifications

See Supabase migrations for complete schema.

## Deployment Steps

### 1. Environment Setup
```bash
cd /path/to/cpl-app
cp .env.example .env.local
# Edit .env.local with actual values
```

### 2. Database Verification
Ensure all required tables exist with proper columns:
```sql
-- Verify audit_log table exists and has required columns:
-- id, actor_id, actor_email, action_type, entity_type, entity_id,
-- old_value, new_value, notes, created_at
```

### 3. Test Admin Access
- Create a test admin player with is_admin = true
- Log in and verify access to `/admin`
- Should see sidebar and dashboard

### 4. Configure Cron Jobs
Set up recurring jobs to call:
- `GET /api/cron/freeze-drops` every day (e.g., 3 AM)
- `GET /api/cron/challenge-forfeit` every 30 minutes
- `GET /api/cron/result-verify` every hour

Pass cron secret in Authorization header:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.com/api/cron/freeze-drops
```

### 5. Test Admin Features
- [ ] Create a team from admin panel
- [ ] Adjust ladder rankings
- [ ] Create a challenge
- [ ] Accept/forfeit/dissolve challenges
- [ ] Update league settings
- [ ] View audit log
- [ ] Export audit log to CSV
- [ ] Manage players (make admin, suspend)
- [ ] Verify all notifications are created

## Feature Verification Checklist

### Dashboard
- [ ] Stats cards show correct counts
- [ ] Pending challenges list displays
- [ ] Recent activity feed populated
- [ ] Quick action buttons functional

### Team Management
- [ ] Can create teams with player selection
- [ ] New teams start at Bronze tier
- [ ] Returning teams get specified rank
- [ ] Tickets created when specified
- [ ] Can freeze teams (drops 1 position)
- [ ] Can dissolve teams (cancels challenges)
- [ ] Search and filters work

### Ladder Management
- [ ] Full ladder displays with correct ranks
- [ ] Manual rank adjustments validate
- [ ] Prevents duplicate ranks
- [ ] Tier boundaries shown
- [ ] Changes logged to audit trail

### Challenge Management
- [ ] Challenges display with status badges
- [ ] Overdue challenges highlighted
- [ ] Force forfeit processes correctly
- [ ] Dissolve works for active challenges
- [ ] Status filters work

### Settings Panel
- [ ] All sections display tabs correctly
- [ ] Can edit all setting values
- [ ] Tier colors have picker
- [ ] Save button appears on changes
- [ ] Values persist after save
- [ ] Changes logged to audit

### Audit Log
- [ ] Log entries display with proper pagination
- [ ] Can filter by action type
- [ ] Can filter by admin
- [ ] Expandable rows show diffs
- [ ] CSV export generates file
- [ ] Timestamps correct

### Players
- [ ] Can search players
- [ ] Can filter by role/status
- [ ] Can make/remove admin
- [ ] Can resend verification email
- [ ] Can suspend/unsuspend accounts
- [ ] Team counts accurate

## Performance Optimization

### Database Queries
- All routes use select() to limit columns
- Joins use syntax like `table!foreign_key_name()`
- Pagination implemented on audit log
- Indexes exist on frequently filtered columns

### Frontend Optimization
- Pages use React.lazy for code splitting
- Images use next/image component
- CSS is minified via Tailwind
- Dark theme reduces eye strain

### Cron Job Efficiency
- Cron jobs use count('exact') for pagination
- Batch operations where possible
- Notification creation batched
- History entries created after state updates

## Monitoring & Logging

### What to Monitor
- **Auth failures** - Check player is_admin flag
- **API errors** - Look for 400/500 responses
- **Cron job runs** - Check audit_log for system entries
- **Notification failures** - Check notifications table

### Common Issues & Solutions

**Issue: 403 Forbidden on admin routes**
- Solution: Verify user has is_admin = true in players table
- Check: `SELECT is_admin FROM players WHERE id = '<user-id>'`

**Issue: Challenges not auto-forfeiting**
- Solution: Verify cron job is running with correct secret
- Check: `SELECT * FROM challenges WHERE status = 'pending' AND accept_deadline < NOW()`

**Issue: Settings changes not saving**
- Solution: Verify SUPABASE_SERVICE_ROLE_KEY is correct
- Check: Try from Supabase dashboard directly

**Issue: Audit log not recording**
- Solution: Verify actor_id is correctly set
- Check: Ensure user is authenticated before action

## Security Checklist

- [ ] CRON_SECRET is strong (32+ characters)
- [ ] SERVICE_ROLE_KEY never exposed to client
- [ ] All protected routes check is_admin
- [ ] Destructive actions require confirmation
- [ ] Audit log captures all admin actions
- [ ] Email notifications don't leak sensitive data
- [ ] CSP headers configured for admin routes

## Scaling Considerations

### For Large Leagues (1000+ teams)
- Add pagination to team listings
- Consider caching tier data
- Archive old audit logs (>1 year)
- Use Supabase read replicas for reporting

### For High Challenge Volume
- Increase cron job frequency for challenge-forfeit
- Monitor queue depth in notifications table
- Consider background job processor (like Inngest)

## Rollback Procedure

If critical issue found:
1. Revert environment variables
2. Restore database from backup
3. Redeploy previous version
4. Review audit log for what went wrong

## Support & Troubleshooting

### Debug Mode
Enable debug logging by checking browser console:
- API responses logged to console
- State changes logged
- Validation errors displayed

### Get Support
- Check `/admin/audit` for error events
- Review Supabase logs for DB errors
- Check browser Network tab for API failures
- Verify CORS configuration

## Next Steps

1. **Test** - Run through feature verification checklist
2. **Configure** - Set up cron jobs on schedule
3. **Monitor** - Watch audit log for issues
4. **Iterate** - Adjust settings based on league needs
5. **Scale** - Archive old data, optimize as needed

---

## Quick Reference

### Admin Dashboard URL
`/admin`

### Key Settings to Configure
1. Challenge window (how long to play)
2. Challenge accept deadline (how long to respond)
3. Forfeit penalty (position drops)
4. Freeze rules (immediate drop + interval)

### Default Values
- Challenge window: 10 days
- Accept deadline: 24 hours
- Forfeit drop: 2 positions
- Freeze interval: 7 days
- Tiebreak points: 7

### Admin Actions Logged
- team_created, team_frozen, team_unfrozen, team_dissolved
- challenge_created, challenge_accepted, challenge_forfeited, challenge_dissolved
- ladder_adjusted, settings_updated
- team_frozen, team_unfrozen, team_dissolved
- result_auto_verified, challenge_auto_forfeited

---

**Last Updated:** April 2026
**Version:** 1.0
**Status:** Production Ready
