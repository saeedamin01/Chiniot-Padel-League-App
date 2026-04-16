import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export async function sendEmail({ to, subject, html, text }: EmailOptions) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'CPL <noreply@cpl.com>',
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    })
    return { success: true }
  } catch (error) {
    console.error('Email send error:', error)
    return { success: false, error }
  }
}

// Email templates
export function challengeReceivedEmail(data: {
  challengedTeamName: string
  challengingTeamName: string
  slot1: string
  slot2: string
  slot3: string
  deadline: string
  acceptUrl: string
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px; }
    .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
    .header p { color: rgba(255,255,255,0.8); margin: 8px 0 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    .card h2 { color: #f1f5f9; margin: 0 0 16px; font-size: 18px; }
    .slot { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; color: #94a3b8; }
    .btn { display: inline-block; background: #10B981; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-top: 16px; }
    .deadline { color: #fbbf24; font-weight: 600; }
    .footer { text-align: center; color: #475569; font-size: 14px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Challenge Received!</h1>
      <p>Chiniot Padel League</p>
    </div>
    <div class="card">
      <h2>${data.challengingTeamName} has challenged ${data.challengedTeamName}</h2>
      <p>You have been challenged! Accept the challenge and choose a time slot to play.</p>
      <p class="deadline">You must accept by: ${data.deadline}</p>
    </div>
    <div class="card">
      <h2>Available Time Slots</h2>
      <div class="slot">Slot 1: ${data.slot1}</div>
      <div class="slot">Slot 2: ${data.slot2}</div>
      <div class="slot">Slot 3: ${data.slot3}</div>
    </div>
    <div style="text-align: center;">
      <a href="${data.acceptUrl}" class="btn">View Challenge &amp; Accept</a>
    </div>
    <div class="footer">
      <p>Chiniot Padel League | Powered by CPL App</p>
    </div>
  </div>
</body>
</html>`
}

export function matchResultEmail(data: {
  teamName: string
  opponentName: string
  result: 'win' | 'loss'
  score: string
  verifyUrl: string
  verifyDeadline: string
}): string {
  const isWin = data.result === 'win'
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { background: ${isWin ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'}; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px; }
    .header h1 { color: white; margin: 0; font-size: 28px; font-weight: 700; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    .score { font-size: 32px; font-weight: 700; color: #f1f5f9; text-align: center; padding: 16px; }
    .btn { display: inline-block; background: #10B981; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-top: 16px; }
    .deadline { color: #fbbf24; font-weight: 600; }
    .footer { text-align: center; color: #475569; font-size: 14px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${isWin ? 'Match Won!' : 'Match Lost'}</h1>
      <p>Result has been reported for verification</p>
    </div>
    <div class="card">
      <p>Match result has been submitted. Please verify the score.</p>
      <div class="score">${data.score}</div>
      <p>${data.teamName} vs ${data.opponentName}</p>
      <p class="deadline">Verify by: ${data.verifyDeadline}</p>
      <p style="color: #94a3b8; font-size: 14px;">If not verified, the result will be auto-approved.</p>
    </div>
    <div style="text-align: center;">
      <a href="${data.verifyUrl}" class="btn">Verify Result</a>
    </div>
    <div class="footer">
      <p>Chiniot Padel League | Powered by CPL App</p>
    </div>
  </div>
</body>
</html>`
}

export function genericNotificationEmail(data: {
  playerName: string
  title: string
  message: string
  actionUrl?: string
  actionLabel?: string
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px; }
    .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 700; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    .btn { display: inline-block; background: #10B981; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; margin-top: 16px; }
    .footer { text-align: center; color: #475569; font-size: 14px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${data.title}</h1>
      <p>Chiniot Padel League</p>
    </div>
    <div class="card">
      <p>Hi ${data.playerName},</p>
      <p>${data.message}</p>
      ${data.actionUrl ? `<div style="text-align: center;"><a href="${data.actionUrl}" class="btn">${data.actionLabel || 'View Details'}</a></div>` : ''}
    </div>
    <div class="footer">
      <p>Chiniot Padel League | Powered by CPL App</p>
    </div>
  </div>
</body>
</html>`
}

// ── Account created / welcome email ──────────────────────────────────────────
export function accountCreatedEmail(data: {
  playerName: string
  email: string
  tempPassword: string
  verificationUrl: string
  teamName?: string
}) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0; }
    .wrapper { max-width:560px;margin:40px auto;padding:0 16px; }
    .logo { text-align:center;padding:32px 0 24px;font-size:24px;font-weight:800;color:#10b981; }
    .card { background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;margin-bottom:16px; }
    h2 { margin:0 0 6px;font-size:22px;color:#f8fafc; }
    .sub { color:#94a3b8;font-size:14px;margin:0 0 24px; }
    p { color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 16px; }
    .cred { background:#0f172a;border:1px solid #334155;border-radius:8px;padding:16px 20px;margin:20px 0; }
    .row { display:flex;justify-content:space-between;padding:6px 0; }
    .lbl { color:#64748b;font-size:13px; }
    .val { color:#f8fafc;font-size:14px;font-weight:700;font-family:monospace; }
    .btn-wrap { text-align:center;margin:28px 0; }
    .btn { display:inline-block;background:#10b981;color:#000 !important;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:8px; }
    .note { font-size:13px;color:#64748b; }
    .warn { background:#422006;border:1px solid #78350f;border-radius:8px;padding:12px 16px;font-size:13px;color:#fbbf24;margin-top:16px; }
    .footer { text-align:center;padding:20px 0 32px;color:#475569;font-size:12px; }
    hr { border:none;border-top:1px solid #334155;margin:20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="logo">🎾 CPL</div>
    <div class="card">
      <h2>Welcome to CPL, ${data.playerName}!</h2>
      <p class="sub">Your account has been created by the league admin${data.teamName ? ` for <strong style="color:#f8fafc">${data.teamName}</strong>` : ''}.</p>
      <p>Here are your login credentials — keep them safe:</p>
      <div class="cred">
        <div class="row"><span class="lbl">Email</span><span class="val">${data.email}</span></div>
        <hr style="border:none;border-top:1px solid #1e293b;margin:6px 0"/>
        <div class="row"><span class="lbl">Temporary Password</span><span class="val">${data.tempPassword}</span></div>
      </div>
      <p>Click below to verify your email — you must verify before you can sign in:</p>
      <div class="btn-wrap"><a href="${data.verificationUrl}" class="btn">Verify My Email &rarr;</a></div>
      <hr/>
      <p class="note">After verifying, sign in with the temporary password and update it from your profile. Link expires in 7 days.</p>
      <div class="warn">⚠️ If you weren't expecting this, please ignore it.</div>
    </div>
    <div class="footer">Chiniot Padel League &nbsp;·&nbsp; Season 3<br/>Automated message — please do not reply.</div>
  </div>
</body>
</html>`
}
