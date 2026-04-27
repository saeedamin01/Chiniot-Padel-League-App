import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// POST /api/challenges/[id]/confirm
//
// Confirms or disputes an awaiting-confirmation challenge.
// Body: { action: 'confirm' | 'dispute' }
//
// STATUS: accepted (slot chosen by challenged team)
//   → Challenging team confirms/disputes — they are always the confirmer here.
//
// STATUS: time_pending_confirm (time entered via set-time)
//   → The team that did NOT submit the time must confirm.
//     challenge.time_submitted_by_team_id records who submitted.
//     Exception: if confirmation_deadline has passed, any team member triggers
//     auto-confirm (fire-and-forget from the client on page load).
//
// confirm  → moves to 'scheduled'. Match is officially on the books.
// dispute  → for time_pending_confirm → reverts to 'accepted_open' (re-enter time)
//            for accepted             → reverts to 'pending' (re-accept entirely)

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    if (!action || !['confirm', 'dispute'].includes(action)) {
      return NextResponse.json({ error: 'action must be confirm or dispute' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('*')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (!['accepted', 'time_pending_confirm'].includes(challenge.status)) {
      return NextResponse.json({ error: 'Challenge is not awaiting confirmation' }, { status: 400 })
    }

    // Fetch both teams — needed to determine who the user is and who should confirm
    const [{ data: challengingTeam }, { data: challengedTeam }] = await Promise.all([
      adminClient.from('teams').select('*').eq('id', challenge.challenging_team_id).single(),
      adminClient.from('teams').select('*').eq('id', challenge.challenged_team_id).single(),
    ])

    const isOnChallengingTeam = !!(challengingTeam &&
      (challengingTeam.player1_id === user.id || challengingTeam.player2_id === user.id))
    const isOnChallengedTeam = !!(challengedTeam &&
      (challengedTeam.player1_id === user.id || challengedTeam.player2_id === user.id))

    if (!isOnChallengingTeam && !isOnChallengedTeam) {
      return NextResponse.json({ error: 'Not authorized to confirm this challenge' }, { status: 403 })
    }

    const now = new Date()

    // ── Determine if the current user is allowed to confirm ─────────────────
    if (challenge.status === 'accepted') {
      // Slot was chosen by challenged team → only challenger confirms
      if (!isOnChallengingTeam) {
        return NextResponse.json({ error: 'Only the challenging team can confirm a slot selection' }, { status: 403 })
      }
    } else if (challenge.status === 'time_pending_confirm') {
      // Time was entered via set-time → the OTHER team from the submitter confirms.
      // Exception: if the confirmation window has expired, allow any team member to
      // trigger the auto-confirm (fired as a fire-and-forget from the client page load).
      const deadlineExpired = challenge.confirmation_deadline &&
        new Date(challenge.confirmation_deadline) <= now

      if (!deadlineExpired && challenge.time_submitted_by_team_id) {
        const userIsSubmitter =
          (isOnChallengingTeam && challenge.time_submitted_by_team_id === challenge.challenging_team_id) ||
          (isOnChallengedTeam  && challenge.time_submitted_by_team_id === challenge.challenged_team_id)

        if (userIsSubmitter) {
          return NextResponse.json(
            { error: 'You entered this time — the other team needs to confirm it' },
            { status: 403 }
          )
        }
      }
    }

    // The team doing the confirming, and the team to notify
    const confirmingTeam = isOnChallengingTeam ? challengingTeam : challengedTeam
    const notifyTeam     = isOnChallengingTeam ? challengedTeam  : challengingTeam

    // Was this triggered by an expired deadline (auto-confirm via page-load fire-and-forget)?
    const deadlineExpiredForConfirm = !!(challenge.confirmation_deadline &&
      new Date(challenge.confirmation_deadline) <= now)

    if (action === 'confirm') {
      // Move to scheduled — match is officially on the books
      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: 'scheduled',
          scheduled_at: now.toISOString(),
          match_date: challenge.confirmed_time, // keep match_date in sync for existing queries
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      const formattedTime = challenge.confirmed_time
        ? new Date(challenge.confirmed_time).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })
        : 'the agreed time'

      // Notify both teams
      const teamsToNotify = [
        { team: notifyTeam,      teamId: notifyTeam?.id },
        { team: confirmingTeam,  teamId: confirmingTeam?.id },
      ]
      for (const { team } of teamsToNotify) {
        if (!team) continue
        const msg = deadlineExpiredForConfirm
          ? `Your match has been automatically confirmed for ${formattedTime} — the confirmation window expired.`
          : `${confirmingTeam?.name ?? 'Opponent'} confirmed the match for ${formattedTime}. Good luck!`
        await adminClient.from('notifications').insert([
          {
            player_id: team.player1_id,
            team_id: team.id,
            type: 'challenge_scheduled',
            title: deadlineExpiredForConfirm ? 'Match Auto-Confirmed' : 'Match Confirmed',
            message: msg,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: team.player2_id,
            team_id: team.id,
            type: 'challenge_scheduled',
            title: deadlineExpiredForConfirm ? 'Match Auto-Confirmed' : 'Match Confirmed',
            message: msg,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      }

      await adminClient.from('audit_log').insert({
        actor_id: deadlineExpiredForConfirm ? null : user.id,
        actor_email: deadlineExpiredForConfirm ? 'system' : user.email,
        action_type: deadlineExpiredForConfirm ? 'challenge_auto_confirmed' : 'challenge_confirmed',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { status: 'scheduled', match_date: challenge.confirmed_time },
        notes: deadlineExpiredForConfirm ? 'Match time auto-confirmed: confirmation deadline expired' : undefined,
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: deadlineExpiredForConfirm ? 'time_auto_confirmed' : 'time_confirmed',
        actorId: deadlineExpiredForConfirm ? undefined : user.id,
        actorRole: deadlineExpiredForConfirm ? 'system' : 'player',
        actorName: deadlineExpiredForConfirm ? undefined : (confirmingTeam?.name ?? 'Unknown'),
        data: {
          confirmed_time: challenge.confirmed_time,
          ...(deadlineExpiredForConfirm ? { reason: 'Confirmation window expired — auto-confirmed by system.' } : {}),
        },
      })

      return NextResponse.json({ challenge: updated })

    } else {
      // Dispute:
      // - 'accepted' (slot chosen)       → back to 'pending' (re-accept entirely)
      // - 'time_pending_confirm'          → back to 'accepted_open' (re-enter time)
      const revertStatus = challenge.status === 'time_pending_confirm' ? 'accepted_open' : 'pending'

      const { data: updated, error: updateError } = await adminClient
        .from('challenges')
        .update({
          status: revertStatus,
          confirmed_time: null,
          accepted_slot: revertStatus === 'pending' ? null : challenge.accepted_slot,
          venue_id: null,
          confirmation_deadline: null,
          time_submitted_by_team_id: null,
          ...(revertStatus === 'pending' ? { accepted_at: null } : {}),
        })
        .eq('id', params.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      // Notify the submitting team (the one whose time was disputed) to re-enter
      // For 'accepted', that's always the challenged team; for 'time_pending_confirm'
      // it's whoever submitted (tracked by time_submitted_by_team_id, or fall back to notifyTeam).
      const reNotifyTeam = challenge.status === 'time_pending_confirm' ? notifyTeam : challengedTeam

      if (reNotifyTeam) {
        const disputeMsg = challenge.status === 'time_pending_confirm'
          ? `${confirmingTeam?.name ?? 'Opponent'} disputed the time you entered. Please coordinate again and re-enter the agreed time.`
          : `${confirmingTeam?.name ?? 'Opponent'} disputed the slot. Please accept the challenge again with a new agreed time.`

        await adminClient.from('notifications').insert([
          {
            player_id: reNotifyTeam.player1_id,
            team_id: reNotifyTeam.id,
            type: 'challenge_disputed',
            title: 'Match Time Disputed',
            message: disputeMsg,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: reNotifyTeam.player2_id,
            team_id: reNotifyTeam.id,
            type: 'challenge_disputed',
            title: 'Match Time Disputed',
            message: disputeMsg,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      }

      await adminClient.from('audit_log').insert({
        actor_id: user.id,
        actor_email: user.email,
        action_type: 'challenge_disputed',
        entity_type: 'challenge',
        entity_id: params.id,
        new_value: { status: revertStatus },
        created_at: now.toISOString(),
      })

      await logChallengeEvent({
        challengeId: params.id,
        eventType: 'time_disputed',
        actorId: user.id,
        actorRole: 'player',
        actorName: confirmingTeam?.name ?? 'Unknown',
        data: { reverted_to: revertStatus },
      })

      return NextResponse.json({ challenge: updated })
    }
  } catch (err) {
    console.error('Error confirming challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
