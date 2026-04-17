import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// POST — save a push subscription for the current player
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { endpoint, keys } = body
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription object' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Upsert — same endpoint = same device, just refresh it
    const { error } = await adminClient
      .from('push_subscriptions')
      .upsert(
        {
          player_id: user.id,
          endpoint,
          p256dh: keys.p256dh,
          auth:   keys.auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      )

    if (error) {
      console.error('push subscribe upsert error:', error)
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('push subscribe error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// DELETE — remove subscription (player turned off notifications)
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { endpoint } = await req.json()
    if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })

    const adminClient = createAdminClient()
    await adminClient
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('player_id', user.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('push unsubscribe error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
