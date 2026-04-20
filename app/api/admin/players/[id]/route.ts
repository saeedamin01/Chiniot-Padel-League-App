import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// PATCH /api/admin/players/[id]
// Body: { name?, phone?, email? }
// Email changes update Supabase Auth AND the players table.
// Supabase automatically sends a confirmation email to the new address.

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin guard
    const adminClient = createAdminClient()
    const { data: caller } = await adminClient
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!caller?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { name, phone, email } = body as { name?: string; phone?: string; email?: string }

    // Fetch existing player details for the audit log
    const { data: existing } = await adminClient
      .from('players').select('name, email, phone').eq('id', params.id).single()
    if (!existing) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    const profileUpdates: Record<string, string | null> = {}
    if (name  !== undefined) profileUpdates.name  = name.trim()
    if (phone !== undefined) profileUpdates.phone = phone.trim() || null

    let emailChanged = false

    // ── Handle email change via Auth Admin API ────────────────────────────────
    if (email !== undefined && email.trim().toLowerCase() !== existing.email.toLowerCase()) {
      const newEmail = email.trim().toLowerCase()

      // Basic format check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
      }

      // Update Supabase Auth — this also sends a confirmation email to the new address
      const { error: authErr } = await adminClient.auth.admin.updateUserById(params.id, {
        email: newEmail,
      })
      if (authErr) {
        return NextResponse.json({ error: authErr.message }, { status: 400 })
      }

      profileUpdates.email = newEmail
      emailChanged = true
    }

    // ── Update players table ──────────────────────────────────────────────────
    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileErr } = await adminClient
        .from('players')
        .update(profileUpdates)
        .eq('id', params.id)

      if (profileErr) {
        return NextResponse.json({ error: profileErr.message }, { status: 500 })
      }
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'player_edited',
      entity_type: 'player',
      entity_id: params.id,
      old_value: { name: existing.name, email: existing.email, phone: existing.phone },
      new_value: { ...profileUpdates },
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true, emailChanged })
  } catch (err) {
    console.error('Edit player error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
