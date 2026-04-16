import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const actionType = searchParams.get('action_type')
    const actorId = searchParams.get('actor_id')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('page_size') || '50')

    const adminClient = createAdminClient()

    let query = adminClient
      .from('audit_log')
      .select('*, actor:players!actor_id(*)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (actionType) {
      query = query.eq('action_type', actionType)
    }

    if (actorId) {
      query = query.eq('actor_id', actorId)
    }

    if (dateFrom) {
      query = query.gte('created_at', dateFrom)
    }

    if (dateTo) {
      query = query.lte('created_at', dateTo)
    }

    const offset = (page - 1) * pageSize
    query = query.range(offset, offset + pageSize - 1)

    const { data, count } = await query

    return NextResponse.json({
      logs: data,
      total: count,
      page,
      pageSize,
      totalPages: count ? Math.ceil(count / pageSize) : 0,
    })
  } catch (err) {
    console.error('Error fetching audit log:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
