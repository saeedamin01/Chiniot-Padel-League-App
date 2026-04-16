import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === 'true'
  const limit = parseInt(searchParams.get('limit') || '50')

  const adminClient = createAdminClient()

  let query = adminClient
    .from('notifications')
    .select('*')
    .eq('player_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) query = query.eq('is_read', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const unreadCount = data?.filter(n => !n.is_read).length || 0

  return NextResponse.json({ notifications: data, unreadCount })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { action } = body // 'mark_all_read'

  const adminClient = createAdminClient()

  if (action === 'mark_all_read') {
    await adminClient
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('player_id', user.id)
      .eq('is_read', false)

    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
