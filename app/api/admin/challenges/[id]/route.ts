import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { logChallengeEvent } from '@/lib/challenges/events'

export const dynamic = 'force-dynamic'

// ─── Auth + admin guard (shared) ──────────────────────────────────────────────
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401, user: null }

  const { data: adminCheck } = await supabase
    .from('players').select('is_admin').eq('id', user.id).single()
  if (!adminCheck?.is_admin) return { error: 'Admin access required', status: 403, user: null }

  return { error: null, status: 200, user }
}

// ─── PATCH /api/admin/challenges/[id] ────────────────────────────────────────
//
// Edits a challenge. Teams cannot be changed.
//
// Editable fields:
//   status, accept_deadline, match_deadline, confirmed_time, confirmation_deadline,
//   venue_id, match_location, match_date, slot_1, slot_2, slot_3, accepted_slot
//
// All changes are logged to audit_log with old_value + new_value.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { user } = auth

    const body = await request.json()
    const adminClient = createAdminClient()

    // Fetch current challenge for old_value snapshot and validation
    const { data: current, error: fetchError } = await adminClient
      .from('challenges')
      .select('*')
      .eq('id', params.id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    // Whitelist of editable fields — teams are never editable
    const EDITABLE_FIELDS = [
      'status',
      'accept_deadline',
      'match_deadline',
      'confirmed_time',
      'confirmation_deadline',
      'venue_id',
      'match_location',
      'match_date',
      'slot_1',
      'slot_2',
      'slot_3',
      'accepted_slot',
      'forfeit_by',
    ] as const

    // Validate status if provided
    const VALID_STATUSES = [
      'pending', 'accepted', 'accepted_open', 'time_pending_confirm',
      'reschedule_requested', 'reschedule_pending_admin', 'revision_proposed',
      'scheduled', 'played', 'forfeited', 'dissolved',
    ]
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 })
    }

    // Build update payload from whitelisted fields only
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const field of EDITABLE_FIELDS) {
      if (field in body) {
        // Allow explicit null to clear a field
        updates[field] = body[field] === '' ? null : body[field]
      }
    }

    if (Object.keys(updates).length === 1) {
      // Only updated_at, nothing to change
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
    }

    const { data: updated, error: updateError } = await adminClient
      .from('challenges')
      .update(updates)
      .eq('id', params.id)
      .select('*')
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Build human-readable diff for the log
    const changedFields: Record<string, { from: unknown; to: unknown }> = {}
    for (const field of EDITABLE_FIELDS) {
      if (field in body && current[field] !== (updates[field] ?? null)) {
        changedFields[field] = { from: current[field] ?? null, to: updates[field] ?? null }
      }
    }

    await adminClient.from('audit_log').insert({
      actor_id: user!.id,
      actor_email: user!.email,
      action_type: 'challenge_edited',
      entity_type: 'challenge',
      entity_id: params.id,
      old_value: {
        challenge_code: current.challenge_code,
        ...Object.fromEntries(
          Object.entries(changedFields).map(([k, v]) => [k, v.from])
        ),
      },
      new_value: {
        challenge_code: current.challenge_code,
        changed_fields: changedFields,
        admin_note: body.adminNote ?? null,
      },
      created_at: new Date().toISOString(),
    })

    await logChallengeEvent({
      challengeId: params.id,
      eventType: 'admin_edited',
      actorId: user!.id,
      actorRole: 'admin',
      data: { changed_fields: changedFields, admin_note: body.adminNote ?? null },
    })

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error editing challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── DELETE /api/admin/challenges/[id] ───────────────────────────────────────
//
// Permanently deletes a challenge. Logs the full challenge snapshot before deletion.

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { user } = auth

    const body = await request.json().catch(() => ({}))
    const adminClient = createAdminClient()

    // Fetch current challenge for the audit snapshot
    const { data: current, error: fetchError } = await adminClient
      .from('challenges')
      .select(`
        *,
        challenging_team:teams!challenging_team_id(name),
        challenged_team:teams!challenged_team_id(name)
      `)
      .eq('id', params.id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    // Log BEFORE deleting so the record is preserved in audit_log
    await adminClient.from('audit_log').insert({
      actor_id: user!.id,
      actor_email: user!.email,
      action_type: 'challenge_deleted',
      entity_type: 'challenge',
      entity_id: params.id,
      old_value: {
        challenge_code: current.challenge_code,
        status: current.status,
        challenging_team: (current.challenging_team as any)?.name ?? current.challenging_team_id,
        challenged_team: (current.challenged_team as any)?.name ?? current.challenged_team_id,
        issued_at: current.issued_at,
        confirmed_time: current.confirmed_time ?? null,
        match_date: current.match_date ?? null,
        venue_id: current.venue_id ?? null,
        admin_note: body.adminNote ?? null,
      },
      new_value: null,
      created_at: new Date().toISOString(),
    })

    const { error: deleteError } = await adminClient
      .from('challenges')
      .delete()
      .eq('id', params.id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting challenge:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
