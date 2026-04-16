import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { sendEmail, accountCreatedEmail } from '@/lib/email/mailer'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateTempPassword(): string {
  // e.g. "CPL-aB3k-9Xm2"  — readable, secure enough as a one-time credential
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const pick = (n: number) =>
    Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `CPL-${pick(4)}-${pick(4)}`
}

function generateVerificationToken(): string {
  return randomBytes(16).toString('hex') // 32-char hex string
}

// ── POST /api/admin/players/create ───────────────────────────────────────────
// Creates an auth account + players row + sends verification email.
// Returns the temp password so admin can share it as a backup.

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin only
    const { data: caller } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!caller?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { name, email, phone, teamName } = body as {
      name: string
      email: string
      phone?: string
      teamName?: string  // used in welcome email copy only
    }

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'name and email are required' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // ── Check if player already exists in DB ─────────────────────────────────
    const { data: existing } = await adminClient
      .from('players').select('id, email_verified').eq('email', email.toLowerCase()).single()

    if (existing) {
      return NextResponse.json({
        error: `A player with email ${email} already exists`,
        existingPlayerId: existing.id,
      }, { status: 409 })
    }

    // ── Generate credentials ─────────────────────────────────────────────────
    const tempPassword        = generateTempPassword()
    const verificationToken   = generateVerificationToken()
    const tokenExpiresAt      = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    // ── Create Supabase Auth user ─────────────────────────────────────────────
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: false,   // we handle verification ourselves
      user_metadata: { name: name.trim() },
    })

    if (authError || !authData?.user) {
      console.error('Auth user creation failed:', authError)
      return NextResponse.json({
        error: authError?.message || 'Failed to create auth account',
      }, { status: 500 })
    }

    // ── Create player row with matching UUID ─────────────────────────────────
    const { data: player, error: playerError } = await adminClient
      .from('players')
      .insert({
        id:                          authData.user.id,
        email:                       email.toLowerCase(),
        name:                        name.trim(),
        phone:                       phone?.trim() || null,
        email_verified:              false,
        is_admin:                    false,
        is_active:                   true,
        verification_token:          verificationToken,
        verification_token_expires_at: tokenExpiresAt,
      })
      .select()
      .single()

    if (playerError || !player) {
      // Roll back the auth user if DB insert failed
      await adminClient.auth.admin.deleteUser(authData.user.id)
      console.error('Player row creation failed:', playerError)
      return NextResponse.json({
        error: 'Failed to create player profile. Auth account rolled back.',
      }, { status: 500 })
    }

    // ── Send verification email via SMTP ─────────────────────────────────────
    const appUrl          = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`

    const emailResult = await sendEmail({
      to: email.toLowerCase(),
      subject: '🎾 Welcome to CPL — Please verify your email',
      html: accountCreatedEmail({
        playerName: name.trim(),
        email: email.toLowerCase(),
        tempPassword,
        verificationUrl,
        teamName,
      }),
    })

    if (!emailResult.success) {
      // Don't fail the whole request — player is created, just email didn't send.
      // Admin can use the temp password displayed on screen.
      console.warn('Verification email failed to send:', emailResult.error)
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    await adminClient.from('audit_log').insert({
      actor_id:    user.id,
      actor_email: user.email,
      action_type: 'player_created',
      entity_type: 'player',
      entity_id:   player.id,
      new_value:   { email, name, team: teamName, email_sent: emailResult.success },
      created_at:  new Date().toISOString(),
    })

    return NextResponse.json({
      success:      true,
      player:       { id: player.id, name: player.name, email: player.email },
      tempPassword,                        // shown to admin on screen
      emailSent:    emailResult.success,
    }, { status: 201 })

  } catch (err) {
    console.error('Create player error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
