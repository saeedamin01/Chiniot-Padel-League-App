import { NextRequest, NextResponse } from 'next/server'
import { sendEventEmail, EmailEvent } from '@/lib/email/events'

export const dynamic = 'force-dynamic'

// ─── POST /api/notifications/email ───────────────────────────────────────────
//
// Thin HTTP wrapper around sendEventEmail — primarily for external callers
// or admin tooling. Internal API routes call sendEventEmail() directly.
//
// Body: {
//   event: EmailEvent
//   recipientIds: string[]
//   payload: Record<string, unknown>  // event-specific, excluding BaseData
// }
//
// Returns: { sent: number, skipped: number }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { event, recipientIds, payload } = body as {
      event: EmailEvent
      recipientIds: string[]
      payload: Record<string, unknown>
    }

    if (!event || !recipientIds || !Array.isArray(recipientIds)) {
      return NextResponse.json(
        { error: 'event (string) and recipientIds (string[]) are required' },
        { status: 400 }
      )
    }

    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'payload object is required' }, { status: 400 })
    }

    const result = await sendEventEmail(event, recipientIds, payload as any)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[CPL Email] /api/notifications/email error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
