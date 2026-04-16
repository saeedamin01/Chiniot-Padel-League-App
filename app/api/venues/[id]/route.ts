import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// PATCH /api/venues/[id]  — update a venue (admin only)
// DELETE /api/venues/[id] — soft-delete (set is_active=false) (admin only)

async function requireAdmin(supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never, userId: string) {
  const { data: player } = await supabase
    .from('players').select('is_admin').eq('id', userId).single()
  return player?.is_admin === true
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await requireAdmin(supabase, user.id)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { name, address, notes, is_active } = body

    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name.trim()
    if (address !== undefined) updates.address = address
    if (notes !== undefined) updates.notes = notes
    if (is_active !== undefined) updates.is_active = is_active

    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from('venues')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ venue: data })
  } catch (err) {
    console.error('Error updating venue:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!await requireAdmin(supabase, user.id)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Soft-delete: mark inactive rather than hard delete to preserve history
    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from('venues')
      .update({ is_active: false })
      .eq('id', params.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting venue:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
