import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/tickets/convert
//
// Converts an active Silver + Gold pair into a single Tier ticket.
// Rule: a team that holds both a silver and a gold ticket can trade them
// in together for a tier ticket instead of playing two separate ticket matches.
//
// Body: { teamId: string, seasonId: string }

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { teamId, seasonId } = await request.json()

    if (!teamId || !seasonId) {
      return NextResponse.json({ error: 'teamId and seasonId are required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify the user is on this team
    const { data: team } = await adminClient
      .from('teams')
      .select('player1_id, player2_id, name')
      .eq('id', teamId)
      .single()

    if (!team || (team.player1_id !== user.id && team.player2_id !== user.id)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // Fetch active silver and gold tickets for this team
    const { data: tickets } = await adminClient
      .from('tickets')
      .select('id, ticket_type')
      .eq('team_id', teamId)
      .eq('season_id', seasonId)
      .eq('status', 'active')
      .in('ticket_type', ['silver', 'gold'])

    const silverTicket = tickets?.find(t => t.ticket_type === 'silver')
    const goldTicket = tickets?.find(t => t.ticket_type === 'gold')

    if (!silverTicket || !goldTicket) {
      return NextResponse.json(
        { error: 'You must have both an active Silver and Gold ticket to convert' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    // Mark both as 'converted'
    await adminClient
      .from('tickets')
      .update({ status: 'converted', forfeited_at: now })
      .in('id', [silverTicket.id, goldTicket.id])

    // Create the new Tier ticket
    const { data: newTicket, error: insertError } = await adminClient
      .from('tickets')
      .insert({
        team_id: teamId,
        season_id: seasonId,
        ticket_type: 'tier',
        status: 'active',
        is_used: false,
        expires_after_first_match: true,
        assigned_by: user.id,
        assigned_reason: 'Converted from Silver + Gold ticket pair',
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'tickets_converted',
      entity_type: 'ticket',
      entity_id: newTicket.id,
      new_value: {
        team_id: teamId,
        converted_from: [silverTicket.id, goldTicket.id],
        new_ticket_type: 'tier',
      },
      created_at: now,
    })

    return NextResponse.json({ ticket: newTicket })
  } catch (err) {
    console.error('Error converting tickets:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
