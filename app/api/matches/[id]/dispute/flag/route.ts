import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { addMinutes } from 'date-fns'
import { createNotification } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

// ─── POST /api/matches/[id]/dispute/flag ──────────────────────────────────────
//
// Called fire-and-forget from the challenge detail page when:
//   • match_result.disputed_at is set (dispute was filed)
//   • match_result.dispute_resolved_at is null (not yet resolved)
//   • match_result.dispute_flagged_at is null (not yet flagged)
//   • disputed_at + dispute_window_minutes < now  (window has expired)
//
// Effect: sets dispute_flagged_at, notifies all admins.
// Safe to call multiple times — no-op if already flagged or resolved.

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const adminClient = createAdminClient()

  // Fetch result with league settings
  const { data: result } = await adminClient
    .from('match_results')
    .select(`
      *,
      challenge:challenges(
        id, challenge_code, challenging_team_id, challenged_team_id,
        season:seasons(*, league_settings(*))
      )
    `)
    .eq('id', params.id)
    .single()

  if (!result) return NextResponse.json({ flagged: false })

  // Guards
  if (!result.disputed_at) return NextResponse.json({ flagged: false })
  if (result.dispute_resolved_at) return NextResponse.json({ flagged: false, reason: 'already_resolved' })
  if (result.dispute_flagged_at) return NextResponse.json({ flagged: false, reason: 'already_flagged' })

  const challenge = result.challenge as any
  const settings = challenge?.season?.league_settings
  const disputeWindowMinutes: number = settings?.dispute_window_minutes ?? 30

  const disputedAt = new Date(result.disputed_at)
  const flagDeadline = addMinutes(disputedAt, disputeWindowMinutes)

  if (new Date() < flagDeadline) {
    return NextResponse.json({ flagged: false, reason: 'window_not_expired' })
  }

  // Flag the result
  await adminClient
    .from('match_results')
    .update({ dispute_flagged_at: new Date().toISOString() })
    .eq('id', params.id)
    .is('dispute_flagged_at', null)  // guard against race conditions

  // Notify admins
  const { data: admins } = await adminClient
    .from('players')
    .select('id')
    .eq('is_admin', true)

  if (admins && challenge) {
    // Fetch reporter and disputer team names for the notification
    const { data: reporterTeam } = await adminClient
      .from('teams')
      .select('name')
      .eq('id', result.reported_by_team_id)
      .single()

    const disputerTeamId = challenge.challenging_team_id === result.reported_by_team_id
      ? challenge.challenged_team_id
      : challenge.challenging_team_id

    const { data: disputerTeam } = await adminClient
      .from('teams')
      .select('name')
      .eq('id', disputerTeamId)
      .single()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    for (const admin of admins) {
      await createNotification({
        playerId: admin.id,
        type: 'admin_score_dispute',
        title: '🚨 Unresolved Score Dispute',
        message: `Challenge ${challenge.challenge_code}: ${disputerTeam?.name ?? 'A team'} disputes the score submitted by ${reporterTeam?.name ?? 'the other team'}. The resolution window has expired — admin review needed.`,
        actionUrl: `${appUrl}/admin/challenges?filter=disputed`,
        sendEmail: true,
      })
    }
  }

  return NextResponse.json({ flagged: true })
}
