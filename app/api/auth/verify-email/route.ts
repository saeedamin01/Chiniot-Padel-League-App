import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET /api/auth/verify-email?token=<hex-token>
// Called when a player clicks the verification link in their welcome email.
// Marks email_verified = true and clears the token.

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

  if (!token) {
    return NextResponse.redirect(`${appUrl}/verify-email?error=missing_token`)
  }

  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // Find player with this token
  const { data: player, error } = await supabase
    .from('players')
    .select('id, email, name, verification_token_expires_at')
    .eq('verification_token', token)
    .single()

  if (error || !player) {
    return NextResponse.redirect(`${appUrl}/verify-email?error=invalid_token`)
  }

  // Check token hasn't expired
  if (player.verification_token_expires_at && new Date(player.verification_token_expires_at) < new Date()) {
    return NextResponse.redirect(`${appUrl}/verify-email?error=expired_token`)
  }

  // Mark verified and clear token
  await supabase
    .from('players')
    .update({
      email_verified:              true,
      email_verified_at:           now,
      verification_token:          null,
      verification_token_expires_at: null,
    })
    .eq('id', player.id)

  // Also confirm the email in Supabase Auth so the auth layer is in sync
  await supabase.auth.admin.updateUserById(player.id, { email_confirm: true })

  // Audit log
  await supabase.from('audit_log').insert({
    actor_email: player.email,
    action_type: 'email_verified',
    entity_type: 'player',
    entity_id:   player.id,
    new_value:   { email_verified: true },
    created_at:  now,
  })

  return NextResponse.redirect(`${appUrl}/login?verified=1`)
}
