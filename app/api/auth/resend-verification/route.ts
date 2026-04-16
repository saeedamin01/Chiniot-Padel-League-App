import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail, accountCreatedEmail } from '@/lib/email/mailer'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase      = await createClient()
    const adminClient   = createAdminClient()

    // Must be an admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { data: caller } = await supabase.from('players').select('is_admin').eq('id', user.id).single()
    if (!caller?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { playerId, email } = await req.json()
    if (!playerId || !email) return NextResponse.json({ error: 'playerId and email required' }, { status: 400 })

    // Generate a fresh token
    const verificationToken  = randomBytes(16).toString('hex')
    const tokenExpiresAt     = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // Save new token to player row
    const { data: player, error: updateErr } = await adminClient
      .from('players')
      .update({ verification_token: verificationToken, verification_token_expires_at: tokenExpiresAt })
      .eq('id', playerId)
      .select('name')
      .single()

    if (updateErr || !player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    // Send email
    const appUrl          = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`

    const result = await sendEmail({
      to: email,
      subject: '🎾 CPL — Verify your email',
      html: accountCreatedEmail({
        playerName:   player.name,
        email,
        tempPassword: '(use your existing password)',
        verificationUrl,
        teamName:     undefined,
      }),
    })

    if (!result.success) {
      console.error('Resend verification email failed:', result.error)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('resend-verification error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
