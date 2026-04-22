import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { canChallenge, getActiveSeason } from '@/lib/ladder/engine'
import { generateChallengeCode } from '@/lib/utils'
import { addHours, addDays } from 'date-fns'
import type { TicketType } from '@/types'
import { logChallengeEvent } from '@/lib/challenges/events'
import { sendEventEmail } from '@/lib/email/events'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      challengingTeamId,
      challengedTeamId,
      slot1, slot2, slot3,
      location,
      // ticketType: 'tier' | 'silver' | 'gold' | null
      // If set, the challenge bypasses distance rules and uses a ticket.
      ticketType,
    }: {
      challengingTeamId: string
      challengedTeamId: string
      slot1: string
      slot2: string
      slot3: string
      location?: string
      ticketType?: TicketType | null
    } = body

    // Get active season
    const season = await getActiveSeason()
    if (!season) {
      return NextResponse.json({ error: 'No active season' }, { status: 400 })
    }

    const settings = season.league_settings
    const adminClient = createAdminClient()

    // Validate slots are on 30-minute boundaries
    const slots30 = [slot1, slot2, slot3].map(s => new Date(s))
    for (const [i, d] of slots30.entries()) {
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: `Slot ${i + 1} is not a valid date/time` }, { status: 400 })
      }
      if (d.getMinutes() % 30 !== 0 || d.getSeconds() !== 0) {
        return NextResponse.json({ error: `Slot ${i + 1} must be on a 30-minute boundary (e.g. 18:00 or 18:30)` }, { status: 400 })
      }
    }

    // Check if current user is on challenging team
    const { data: challengingTeam } = await supabase
      .from('teams')
      .select('*')
      .eq('id', challengingTeamId)
      .single()

    if (!challengingTeam || (challengingTeam.player1_id !== user.id && challengingTeam.player2_id !== user.id)) {
      return NextResponse.json({ error: 'Not authorized to create this challenge' }, { status: 403 })
    }

    // Validate can challenge (ticket-aware)
    const { allowed, ticket, reason } = await canChallenge(
      challengingTeamId,
      challengedTeamId,
      season.id,
      settings,
      ticketType || null
    )

    if (!allowed) {
      return NextResponse.json({ error: reason }, { status: 400 })
    }

    // ── If NOT a ticket challenge: forfeit any active tickets ─────────────────
    // Rule: the first challenge a team sends MUST be a ticket challenge if they
    // hold active tickets. Sending a normal challenge forfeits the tickets.
    let forfeitedTicketIds: string[] = []
    if (!ticketType) {
      const { data: activeTickets } = await adminClient
        .from('tickets')
        .select('id, ticket_type')
        .eq('team_id', challengingTeamId)
        .eq('season_id', season.id)
        .eq('status', 'active')

      if (activeTickets && activeTickets.length > 0) {
        const ids = activeTickets.map(t => t.id)
        await adminClient
          .from('tickets')
          .update({ status: 'forfeited', forfeited_at: new Date().toISOString() })
          .in('id', ids)
        forfeitedTicketIds = ids
      }
    }

    // Create the challenge
    const challengeCode = generateChallengeCode(season.season_number)
    const now = new Date()

    const { data: challenge, error } = await adminClient
      .from('challenges')
      .insert({
        challenge_code: challengeCode,
        season_id: season.id,
        challenging_team_id: challengingTeamId,
        challenged_team_id: challengedTeamId,
        slot_1: slot1,
        slot_2: slot2,
        slot_3: slot3,
        match_location: location,
        // ticket_id is linked after challenge is created (we need the challenge ID)
        ticket_id: null,
        status: 'pending',
        accept_deadline: addHours(now, settings.challenge_accept_hours).toISOString(),
        match_deadline: addDays(now, settings.challenge_window_days).toISOString(),
        issued_at: now.toISOString(),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // ── If ticket challenge: link ticket to challenge ──────────────────────────
    if (ticketType && ticket) {
      // Update the challenge to link the ticket
      await adminClient
        .from('challenges')
        .update({ ticket_id: ticket.id })
        .eq('id', challenge.id)

      // Update the ticket to record which challenge it's linked to
      // Status stays 'active' until the match result is processed
      await adminClient
        .from('tickets')
        .update({ challenge_id: challenge.id })
        .eq('id', ticket.id)
    }

    // Get tier for the challenged team and update the challenge
    const { data: pos } = await adminClient
      .from('ladder_positions')
      .select('tier_id')
      .eq('team_id', challengedTeamId)
      .eq('season_id', season.id)
      .single()

    if (pos) {
      await adminClient
        .from('challenges')
        .update({ tier_id: pos.tier_id })
        .eq('id', challenge.id)
    }

    // Notify the challenged team
    const { data: challengedTeamData } = await adminClient
      .from('teams')
      .select('player1_id, player2_id, name')
      .eq('id', challengedTeamId)
      .single()

    const ticketLabel = ticketType ? ` (${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)} Ticket Challenge)` : ''

    if (challengedTeamData) {
      await adminClient.from('notifications').insert([
        {
          player_id: challengedTeamData.player1_id,
          team_id: challengedTeamId,
          type: 'challenge_received',
          title: `New Challenge Received${ticketLabel}`,
          message: `${challengingTeam.name} has challenged you${ticketLabel}!`,
          action_url: `/challenges/${challenge.id}`,
          is_read: false,
          email_sent: false,
        },
        {
          player_id: challengedTeamData.player2_id,
          team_id: challengedTeamId,
          type: 'challenge_received',
          title: `New Challenge Received${ticketLabel}`,
          message: `${challengingTeam.name} has challenged you${ticketLabel}!`,
          action_url: `/challenges/${challenge.id}`,
          is_read: false,
          email_sent: false,
        },
      ])
    }

    // Fire-and-forget email to challenged team players
    if (challengedTeamData) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const recipients = [challengedTeamData.player1_id, challengedTeamData.player2_id].filter(Boolean) as string[]
      sendEventEmail('challenge_received', recipients, {
        challengedTeamName: (challengedTeamData as any).name ?? '',
        challengingTeamName: challengingTeam.name,
        challengeCode: challenge.challenge_code,
        slots: [slot1, slot2, slot3].filter(Boolean),
        deadline: challenge.accept_deadline,
        acceptUrl: `${appUrl}/challenges/${challenge.id}`,
        ticketType: ticketType || null,
      }).catch(() => {})
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'challenge_created',
      entity_type: 'challenge',
      entity_id: challenge.id,
      new_value: {
        challenge_code: challenge.challenge_code,
        status: 'pending',
        ticket_type: ticketType || null,
        ticket_id: ticket?.id || null,
        forfeited_tickets: forfeitedTicketIds,
      },
      created_at: now.toISOString(),
    })

    // Log to challenge timeline
    await logChallengeEvent({
      challengeId: challenge.id,
      eventType: 'challenge_issued',
      actorId: user.id,
      actorRole: 'player',
      data: {
        challenge_code: challenge.challenge_code,
        slot_1: slot1,
        slot_2: slot2,
        slot_3: slot3,
        accept_deadline: challenge.accept_deadline,
        match_deadline: challenge.match_deadline,
        ticket_type: ticketType || null,
      },
    })

    return NextResponse.json({
      challenge,
      ticketUsed: ticketType ? ticket : null,
      forfeitedTickets: forfeitedTicketIds,
    }, { status: 201 })
  } catch (err) {
    console.error('Error creating challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const teamId = searchParams.get('teamId')

    const adminClient = createAdminClient()

    let query = adminClient
      .from('challenges')
      .select(`
        *,
        challenging_team:teams!challenging_team_id(
          *,
          player1:players!player1_id(*),
          player2:players!player2_id(*)
        ),
        challenged_team:teams!challenged_team_id(
          *,
          player1:players!player1_id(*),
          player2:players!player2_id(*)
        ),
        tier:tiers(*),
        match_result:match_results!challenge_id(*)
      `)
      .order('issued_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    if (teamId) {
      query = query.or(`challenging_team_id.eq.${teamId},challenged_team_id.eq.${teamId}`)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ challenges: data })
  } catch (err) {
    console.error('Error fetching challenges:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
