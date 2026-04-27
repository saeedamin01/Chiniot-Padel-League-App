import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { addHours } from 'date-fns'
import { logChallengeEvent } from '@/lib/challenges/events'
import { sendEventEmail } from '@/lib/email/events'
import { sendPushEvent } from '@/lib/push/notify'

export const dynamic = 'force-dynamic'

// POST /api/challenges/[id]/accept
//
// Two acceptance modes for the CHALLENGED team:
//
// Option 1 — Accept without choosing a slot (agree time over WhatsApp later):
//   { acceptMode: 'open' }
//   Status → 'accepted_open'. Team B will enter the agreed time via
//   POST /api/challenges/[id]/set-time. Team A then confirms.
//   After accepting open, Team B CANNOT switch to a provided slot.
//
// Option 2 — Pick one of the challenger's 3 suggested slots:
//   { acceptMode: 'slot', slotIndex: 0 | 1 | 2 }
//   Status → 'accepted'. Starts Team A's confirmation window.
//   Venue can be added later via PATCH /api/challenges/[id]/venue.

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
    const { acceptMode, slotIndex } = body

    if (!acceptMode || !['open', 'slot'].includes(acceptMode)) {
      return NextResponse.json(
        { error: 'acceptMode must be "open" or "slot"' },
        { status: 400 }
      )
    }

    if (acceptMode === 'slot' && (slotIndex === undefined || slotIndex === null)) {
      return NextResponse.json({ error: 'slotIndex (0-2) is required for slot mode' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Fetch challenge + league settings
    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('*, season:seasons(*, league_settings(*))')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (challenge.status !== 'pending') {
      return NextResponse.json({ error: 'Challenge is not pending' }, { status: 400 })
    }

    // Verify user is on the challenged team
    const { data: challengedTeam } = await adminClient
      .from('teams')
      .select('*')
      .eq('id', challenge.challenged_team_id)
      .single()

    if (
      !challengedTeam ||
      (challengedTeam.player1_id !== user.id && challengedTeam.player2_id !== user.id)
    ) {
      return NextResponse.json(
        { error: 'Not authorized to accept this challenge' },
        { status: 403 }
      )
    }

    const settings = challenge.season?.league_settings
    const confirmationWindowHours = settings?.confirmation_window_hours ?? 24
    const now = new Date()

    let updatePayload: Record<string, unknown>
    let newStatus: string

    if (acceptMode === 'open') {
      // Option 1: Accept without slot — time to be agreed and entered later
      newStatus = 'accepted_open'
      updatePayload = {
        status: 'accepted_open',
        accepted_at: now.toISOString(),
      }
    } else {
      // Option 2: Pick one of the 3 suggested slots
      const slotFields = ['slot_1', 'slot_2', 'slot_3'] as const
      const slotField = slotFields[slotIndex]
      if (slotIndex < 0 || slotIndex > 2 || !slotField) {
        return NextResponse.json({ error: 'slotIndex must be 0, 1, or 2' }, { status: 400 })
      }
      const slotValue = challenge[slotField]
      if (!slotValue) {
        return NextResponse.json({ error: 'That slot is not set on this challenge' }, { status: 400 })
      }

      // Slot chosen by challenged team → immediately scheduled.
      // The challenger already proposed this time, so no re-confirmation is needed.
      newStatus = 'scheduled'
      updatePayload = {
        status: 'scheduled',
        accepted_at: now.toISOString(),
        accepted_slot: slotValue,
        confirmed_time: slotValue, // keep confirmed_time in sync for downstream queries
        match_date: slotValue,     // keep match_date in sync for existing queries
        scheduled_at: now.toISOString(),
        // No confirmation_deadline — match is already confirmed
      }
    }

    const { data: updated, error: updateError } = await adminClient
      .from('challenges')
      .update(updatePayload)
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Auto-dissolve all other pending challenges against the same challenged team
    const { data: otherChallenges } = await adminClient
      .from('challenges')
      .select('id, challenging_team_id')
      .eq('challenged_team_id', challenge.challenged_team_id)
      .eq('season_id', challenge.season_id)
      .in('status', ['pending', 'revision_proposed'])
      .neq('id', params.id)

    if (otherChallenges && otherChallenges.length > 0) {
      await adminClient
        .from('challenges')
        .update({
          status: 'dissolved',
          dissolved_reason: `${challengedTeam.name} accepted another challenge.`,
        })
        .in('id', otherChallenges.map(c => c.id))

      for (const other of otherChallenges) {
        const dissolveReason = `${challengedTeam.name} accepted another challenge.`
        const { data: otherTeam } = await adminClient
          .from('teams')
          .select('player1_id, player2_id')
          .eq('id', other.challenging_team_id)
          .single()
        if (otherTeam) {
          await adminClient.from('notifications').insert([
            {
              player_id: otherTeam.player1_id,
              team_id: other.challenging_team_id,
              type: 'challenge_dissolved',
              title: 'Challenge Dissolved',
              message: `Your challenge to ${challengedTeam.name} was dissolved — they accepted another challenge.`,
              action_url: `/challenges/${other.id}`,
              is_read: false,
              email_sent: false,
            },
            {
              player_id: otherTeam.player2_id,
              team_id: other.challenging_team_id,
              type: 'challenge_dissolved',
              title: 'Challenge Dissolved',
              message: `Your challenge to ${challengedTeam.name} was dissolved — they accepted another challenge.`,
              action_url: `/challenges/${other.id}`,
              is_read: false,
              email_sent: false,
            },
          ])
        }
        // Log to the challenge event timeline with the reason
        await logChallengeEvent({
          challengeId: other.id,
          eventType: 'dissolved',
          actorRole: 'system',
          data: { reason: dissolveReason },
        })
      }
    }

    // Notify the challenging team
    const { data: challengingTeamData } = await adminClient
      .from('teams')
      .select('player1_id, player2_id, name')
      .eq('id', challenge.challenging_team_id)
      .single()

    if (challengingTeamData) {
      if (acceptMode === 'open') {
        // Option 1: let challenger know the time will come later
        await adminClient.from('notifications').insert([
          {
            player_id: challengingTeamData.player1_id,
            team_id: challenge.challenging_team_id,
            type: 'challenge_accepted',
            title: 'Challenge Accepted',
            message: `${challengedTeam.name} accepted your challenge. Agree on a time over WhatsApp — they'll enter it in the app for you to confirm.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: challengingTeamData.player2_id,
            team_id: challenge.challenging_team_id,
            type: 'challenge_accepted',
            title: 'Challenge Accepted',
            message: `${challengedTeam.name} accepted your challenge. Agree on a time over WhatsApp — they'll enter it in the app for you to confirm.`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      } else {
        // Option 2: slot chosen → match is now scheduled (no re-confirmation needed)
        const slotDate = new Date(challenge[(['slot_1', 'slot_2', 'slot_3'] as const)[slotIndex]])
        const formattedTime = slotDate.toLocaleString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
          hour: 'numeric', minute: '2-digit', hour12: true,
        })
        await adminClient.from('notifications').insert([
          {
            player_id: challengingTeamData.player1_id,
            team_id: challenge.challenging_team_id,
            type: 'challenge_scheduled',
            title: 'Match Scheduled',
            message: `${challengedTeam.name} accepted your challenge and picked your slot: ${formattedTime}. Your match is now confirmed!`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
          {
            player_id: challengingTeamData.player2_id,
            team_id: challenge.challenging_team_id,
            type: 'challenge_scheduled',
            title: 'Match Scheduled',
            message: `${challengedTeam.name} accepted your challenge and picked your slot: ${formattedTime}. Your match is now confirmed!`,
            action_url: `/challenges/${params.id}`,
            is_read: false,
            email_sent: false,
          },
        ])
      }
    }

    // Fire-and-forget email + push to the challenging team
    if (challengingTeamData) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const recipients = [challengingTeamData.player1_id, challengingTeamData.player2_id].filter(Boolean) as string[]
      const slotFields3 = ['slot_1', 'slot_2', 'slot_3'] as const
      const scheduledTime = acceptMode === 'slot' && slotIndex !== undefined
        ? (challenge[slotFields3[slotIndex as number]] as string | null)
        : null

      sendEventEmail('challenge_accepted', recipients, {
        challengingTeamName: challengingTeamData.name,
        challengedTeamName: challengedTeam!.name,
        challengeCode: challenge.challenge_code,
        mode: acceptMode as 'open' | 'slot',
        scheduledTime,
        challengeUrl: `${appUrl}/challenges/${params.id}`,
      }).catch(() => {})

      sendPushEvent('challenge_accepted', recipients, {
        challengedTeamName: challengedTeam!.name,
        challengingTeamName: challengingTeamData.name,
        challengeCode: challenge.challenge_code,
        mode: acceptMode as 'open' | 'slot',
        challengeId: params.id,
      }).catch(() => {})
    }

    // ── Auto-create chat room for this challenge ──────────────────────────────
    // Non-fatal: if the chat table doesn't exist yet (migration pending) or
    // the upsert fails for any reason, we still return a successful acceptance.
    try {
      if (challengingTeamData) {
        const allPlayerIds = [
          challengedTeam.player1_id,
          challengedTeam.player2_id,
          challengingTeamData.player1_id,
          challengingTeamData.player2_id,
        ].filter(Boolean) as string[]

        const { error: chatErr } = await adminClient
          .from('challenge_chats')
          .upsert(
            { challenge_id: params.id, allowed_player_ids: allPlayerIds },
            { onConflict: 'challenge_id', ignoreDuplicates: true }
          )

        if (chatErr) {
          console.error('[Chat] Failed to create chat room on accept:', chatErr)
        }
      }
    } catch (chatErr) {
      console.error('[Chat] Unexpected error creating chat room:', chatErr)
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'challenge_accepted',
      entity_type: 'challenge',
      entity_id: params.id,
      new_value: { status: newStatus, acceptMode, slotIndex: acceptMode === 'slot' ? slotIndex : null, direct_schedule: acceptMode === 'slot' },
      created_at: now.toISOString(),
    })

    // Log to challenge timeline
    const slotFields2 = ['slot_1', 'slot_2', 'slot_3'] as const
    await logChallengeEvent({
      challengeId: params.id,
      eventType: acceptMode === 'slot' ? 'time_confirmed' : 'challenge_accepted',
      actorId: user.id,
      actorRole: 'player',
      actorName: challengedTeam.name,
      data: acceptMode === 'open'
        ? { mode: 'open' }
        : {
            mode: 'slot',
            slot_index: slotIndex,
            confirmed_time: challenge[slotFields2[slotIndex as number]],
            direct_schedule: true,
          },
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error accepting challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
