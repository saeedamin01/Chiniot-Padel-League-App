import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/tickets?seasonId=xxx
// Returns all tickets for the season with team info
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminCheck } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!adminCheck?.is_admin)
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const seasonId = searchParams.get('seasonId')
    if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

    const adminClient = createAdminClient()

    // Try full query (migration-005 columns + assigner join); fall back to base columns
    let tickets: Record<string, unknown>[] | null = null
    let queryError: { message: string } | null = null

    const fullResult = await adminClient
      .from('tickets')
      .select(`
        *,
        team:teams!team_id(
          id, name,
          player1:players!player1_id(id, name, email),
          player2:players!player2_id(id, name, email)
        ),
        assigner:players!assigned_by(id, name)
      `)
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false })

    if (fullResult.error) {
      // Fall back: base columns only, no assigner join
      const baseResult = await adminClient
        .from('tickets')
        .select(`
          *,
          team:teams!team_id(
            id, name,
            player1:players!player1_id(id, name, email),
            player2:players!player2_id(id, name, email)
          )
        `)
        .eq('season_id', seasonId)
        .order('created_at', { ascending: false })

      tickets = (baseResult.data as Record<string, unknown>[] | null)
      queryError = baseResult.error
    } else {
      tickets = (fullResult.data as Record<string, unknown>[] | null)
    }

    if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 })

    return NextResponse.json({ tickets })
  } catch (err) {
    console.error('Error fetching admin tickets:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/tickets
// Assign a ticket to a team
// Body: { teamId, seasonId, ticketType, assignedReason?, lateEntry? }
// lateEntry: if true, assigns both silver AND gold tickets at once
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminCheck } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!adminCheck?.is_admin)
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const { teamId, seasonId, ticketType, assignedReason, lateEntry } = await request.json()

    if (!teamId || !seasonId) {
      return NextResponse.json({ error: 'teamId and seasonId are required' }, { status: 400 })
    }

    if (!lateEntry && !ticketType) {
      return NextResponse.json({ error: 'ticketType or lateEntry is required' }, { status: 400 })
    }

    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    const reason = assignedReason || (lateEntry ? 'Late entry — assigned Silver & Gold tickets' : `Admin assigned ${ticketType} ticket`)

    // Base columns — guaranteed to exist from migration 001
    const baseTickets = lateEntry
      ? [
          { team_id: teamId, season_id: seasonId, ticket_type: 'silver', is_used: false, expires_after_first_match: true },
          { team_id: teamId, season_id: seasonId, ticket_type: 'gold',   is_used: false, expires_after_first_match: true },
        ]
      : [
          { team_id: teamId, season_id: seasonId, ticket_type: ticketType, is_used: false, expires_after_first_match: true },
        ]

    const { data: newTickets, error: insertError } = await adminClient
      .from('tickets')
      .insert(baseTickets)
      .select()

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

    // Patch with migration-005 columns (status, assigned_by, assigned_reason).
    // These may not exist if the migration hasn't been applied yet — fail silently.
    if (newTickets && newTickets.length > 0) {
      for (const ticket of newTickets) {
        try {
          await adminClient
            .from('tickets')
            .update({ status: 'active', assigned_by: user.id, assigned_reason: reason })
            .eq('id', ticket.id)
        } catch {
          // Columns may not exist yet — ignore
        }
      }
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'ticket_assigned',
      entity_type: 'ticket',
      entity_id: newTickets?.[0]?.id,
      new_value: {
        team_id: teamId,
        ticket_types: lateEntry ? ['silver', 'gold'] : [ticketType],
        late_entry: lateEntry ?? false,
        reason,
      },
      created_at: now,
    })

    return NextResponse.json({ tickets: newTickets }, { status: 201 })
  } catch (err) {
    console.error('Error assigning ticket:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/tickets
// Revoke (forfeit) a ticket
// Body: { ticketId }
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminCheck } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!adminCheck?.is_admin)
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    const { ticketId } = await request.json()
    if (!ticketId) return NextResponse.json({ error: 'ticketId is required' }, { status: 400 })

    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    // Fetch ticket before update for audit
    const { data: ticket } = await adminClient
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single()

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    if (ticket.status !== 'active') {
      return NextResponse.json({ error: `Cannot revoke a ticket with status "${ticket.status}"` }, { status: 400 })
    }

    // Try updating with migration-005 columns first; fall back to is_used if they don't exist
    const { error: updateError } = await adminClient
      .from('tickets')
      .update({ status: 'forfeited', forfeited_at: now, is_used: true })
      .eq('id', ticketId)

    if (updateError) {
      // migration-005 columns may not exist — fall back to base columns only
      const { error: fallbackError } = await adminClient
        .from('tickets')
        .update({ is_used: true })
        .eq('id', ticketId)
      if (fallbackError) return NextResponse.json({ error: fallbackError.message }, { status: 500 })
    }

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'ticket_revoked',
      entity_type: 'ticket',
      entity_id: ticketId,
      old_value: { status: 'active', ticket_type: ticket.ticket_type, team_id: ticket.team_id },
      new_value: { status: 'forfeited', forfeited_at: now },
      created_at: now,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error revoking ticket:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
