import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ─── GET /api/notifications/unsubscribe?token=<uuid> ─────────────────────────
//
// One-click unsubscribe handler linked from every outgoing email footer.
//
// • Looks up the player by email_unsubscribe_token (stable UUID, never rotates)
// • Sets email_unsubscribed = true
// • Returns a plain HTML confirmation page — no redirect needed
//
// Idempotent: calling it twice for the same token is a no-op (already false).

const successPage = (name: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Unsubscribed — CPL</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 40px 36px;
      max-width: 440px;
      width: 100%;
      text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
    p { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 12px; }
    .badge {
      display: inline-block;
      background: #d1fae5;
      color: #065f46;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 99px;
      margin-bottom: 20px;
    }
    a {
      display: inline-block;
      background: #059669;
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
      padding: 12px 28px;
      border-radius: 10px;
    }
    .muted { font-size: 12px; color: #94a3b8; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>You've been unsubscribed</h1>
    <p>Hi ${name}, you won't receive any more email notifications from CPL.</p>
    <div class="badge">🎾 Chiniot Padel League</div>
    <br/>
    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}">Back to CPL</a>
    <p class="muted">In-app notifications are not affected. You can re-enable emails from your profile settings.</p>
  </div>
</body>
</html>`

const errorPage = (message: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Error — CPL</title>
  <style>
    body { font-family: sans-serif; background: #f1f5f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px 36px; max-width: 440px; text-align: center; }
    h1 { font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
    p { font-size: 14px; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
    <h1>Invalid link</h1>
    <p>${message}</p>
  </div>
</body>
</html>`

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
    return new NextResponse(errorPage('This unsubscribe link is invalid or has expired.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const adminClient = createAdminClient()

  const { data: player } = await adminClient
    .from('players')
    .select('id, name, email_unsubscribed')
    .eq('email_unsubscribe_token', token)
    .single()

  if (!player) {
    return new NextResponse(errorPage('We couldn\'t find an account linked to this unsubscribe token.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Idempotent — set even if already unsubscribed
  await adminClient
    .from('players')
    .update({ email_unsubscribed: true })
    .eq('email_unsubscribe_token', token)

  return new NextResponse(successPage(player.name as string), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
