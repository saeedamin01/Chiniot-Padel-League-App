/**
 * lib/email/mailer.ts
 *
 * Nodemailer transport + per-event HTML email templates.
 * ALL styles are inline — no <style> blocks — for maximum compatibility
 * with Gmail, Outlook, Apple Mail, and webmail clients.
 *
 * Light theme: white cards on off-white background, CPL emerald accent.
 */

import nodemailer from 'nodemailer'

// ─── Transport ────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: (process.env.SMTP_PORT === '465'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool: true,
  maxConnections: 3,
})

export interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export async function sendEmail({ to, subject, html, text }: EmailOptions): Promise<{ success: boolean; error?: unknown }> {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'CPL <noreply@cpl.com>',
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    })
    return { success: true }
  } catch (error) {
    console.error('[CPL Email] send error:', error)
    return { success: false, error }
  }
}

// ─── Shared style tokens ──────────────────────────────────────────────────────

const C = {
  bg: '#f1f5f9',
  card: '#ffffff',
  border: '#e2e8f0',
  emerald: '#059669',
  emeraldLight: '#d1fae5',
  emeraldText: '#065f46',
  heading: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  mutedBg: '#f8fafc',
  red: '#dc2626',
  redLight: '#fee2e2',
  orange: '#d97706',
  orangeLight: '#fef3c7',
  blue: '#2563eb',
  blueLight: '#dbeafe',
}

// ─── Base layout ──────────────────────────────────────────────────────────────
// All templates call this — keeps the outer shell consistent.

interface BaseData {
  playerName: string
  unsubscribeUrl: string
  previewText: string
}

function baseLayout(content: string, data: BaseData): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>CPL Notification</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:${C.bg};">${data.previewText}</div>

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};min-width:320px;">
    <tr>
      <td align="center" style="padding:32px 16px 24px;">

        <!-- Email container -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

          <!-- ── LOGO HEADER ── -->
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:${C.emerald};border-radius:12px;padding:6px 18px;">
                    <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">🎾 CPL</span>
                  </td>
                </tr>
              </table>
              <p style="margin:8px 0 0;font-size:12px;color:${C.muted};letter-spacing:0.05em;text-transform:uppercase;">Chiniot Padel League</p>
            </td>
          </tr>

          <!-- ── CARD ── -->
          <tr>
            <td style="background-color:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden;">
              ${content}
            </td>
          </tr>

          <!-- ── FOOTER ── -->
          <tr>
            <td align="center" style="padding:20px 0 8px;">
              <p style="margin:0;font-size:12px;color:${C.muted};line-height:1.6;">
                Hi ${escHtml(data.playerName)} — this is an automated message from CPL.<br/>
                <a href="${data.unsubscribeUrl}" style="color:${C.muted};text-decoration:underline;">Unsubscribe from CPL emails</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch { return iso }
}

function fmtDeadline(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch { return iso }
}

function heroSection(icon: string, title: string, subtitle: string, color = C.emerald): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background-color:${color};padding:32px 32px 24px;text-align:center;">
          <div style="font-size:36px;margin-bottom:10px;">${icon}</div>
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">${escHtml(title)}</h1>
          <p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">${escHtml(subtitle)}</p>
        </td>
      </tr>
    </table>`
}

function bodySection(children: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:28px 32px;">${children}</td></tr></table>`
}

function infoBox(label: string, value: string, color = C.emerald): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
      <tr>
        <td style="background-color:${C.mutedBg};border:1px solid ${C.border};border-left:3px solid ${color};border-radius:8px;padding:12px 16px;">
          <p style="margin:0;font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">${escHtml(label)}</p>
          <p style="margin:4px 0 0;font-size:14px;color:${C.heading};font-weight:600;">${value}</p>
        </td>
      </tr>
    </table>`
}

function ctaButton(label: string, url: string, color = C.emerald): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
      <tr>
        <td align="center">
          <a href="${url}" style="display:inline-block;background-color:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:10px;letter-spacing:0.01em;">
            ${escHtml(label)} &rarr;
          </a>
        </td>
      </tr>
    </table>`
}

function divider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:4px 0 16px;"><div style="border-top:1px solid ${C.border};"></div></td></tr></table>`
}

function p(text: string, style = ''): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:${C.body};${style}">${text}</p>`
}

// ─── Template: challenge_received ────────────────────────────────────────────

export interface ChallengeReceivedData extends BaseData {
  challengedTeamName: string
  challengingTeamName: string
  challengeCode: string
  slots: string[]  // ISO strings
  deadline: string // ISO
  acceptUrl: string
  ticketType?: string | null
}

export function challengeReceivedEmail(data: ChallengeReceivedData): string {
  const ticketLine = data.ticketType
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;"><tr><td style="background-color:${C.blueLight};border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:13px;color:${C.blue};font-weight:600;">🎫 ${escHtml(data.ticketType.charAt(0).toUpperCase() + data.ticketType.slice(1))} Ticket Challenge</td></tr></table>`
    : ''
  const slotItems = data.slots.map((s, i) =>
    `<tr><td style="padding:4px 0;font-size:13px;color:${C.body};">Slot ${i + 1} &nbsp;—&nbsp; <strong>${fmtDate(s)}</strong></td></tr>`
  ).join('')

  const content = heroSection('🎾', 'Challenge Received!', `${data.challengingTeamName} wants to play you`) +
    bodySection(`
      ${ticketLine}
      ${p(`Hi <strong>${escHtml(data.playerName)}</strong>, your team <strong>${escHtml(data.challengedTeamName)}</strong> has been challenged by <strong>${escHtml(data.challengingTeamName)}</strong>.`)}
      ${infoBox('Challenge Code', escHtml(data.challengeCode))}
      ${infoBox('Accept By', fmtDeadline(data.deadline), C.orange)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
        <tr>
          <td style="background-color:${C.mutedBg};border:1px solid ${C.border};border-radius:8px;padding:14px 16px;">
            <p style="margin:0 0 8px;font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Proposed Time Slots</p>
            <table cellpadding="0" cellspacing="0" border="0">${slotItems}</table>
          </td>
        </tr>
      </table>
      ${p('Accept the challenge and choose how you want to schedule the match — pick one of their slots for an instant booking, or accept openly and coordinate over WhatsApp.', `color:${C.muted};font-size:13px;`)}
      ${ctaButton('View & Accept Challenge', data.acceptUrl)}
    `)

  return baseLayout(content, data)
}

// ─── Template: challenge_accepted ─────────────────────────────────────────────

export interface ChallengeAcceptedData extends BaseData {
  challengingTeamName: string
  challengedTeamName: string
  challengeCode: string
  mode: 'open' | 'slot'
  scheduledTime?: string | null  // ISO — only for slot mode
  challengeUrl: string
}

export function challengeAcceptedEmail(data: ChallengeAcceptedData): string {
  const isSlot = data.mode === 'slot'
  const subtitle = isSlot ? `Match automatically scheduled for ${data.scheduledTime ? fmtDate(data.scheduledTime) : 'the agreed slot'}` : 'Coordinate a time over WhatsApp'

  const bodyContent = isSlot
    ? `${p(`<strong>${escHtml(data.challengedTeamName)}</strong> accepted your challenge and picked one of your suggested time slots. The match is now officially scheduled — no further confirmation needed.`)}
       ${infoBox('Scheduled Time', data.scheduledTime ? fmtDate(data.scheduledTime) : 'See challenge for details')}
       ${p('Good luck! 🏆', `font-size:13px;color:${C.muted};`)}`
    : `${p(`<strong>${escHtml(data.challengedTeamName)}</strong> accepted your challenge. They didn't select a specific slot, so please coordinate a time that works for both teams over WhatsApp, then enter it in the app.`)}
       ${p('Once a time is agreed and entered, both teams confirm it before it\'s locked in.', `font-size:13px;color:${C.muted};`)}`

  const content = heroSection(
    isSlot ? '✅' : '🤝',
    isSlot ? 'Match Scheduled!' : 'Challenge Accepted!',
    subtitle,
    isSlot ? C.emerald : C.blue
  ) +
    bodySection(`
      ${infoBox('Challenge', escHtml(data.challengeCode))}
      ${divider()}
      ${bodyContent}
      ${ctaButton('View Challenge', data.challengeUrl, isSlot ? C.emerald : C.blue)}
    `)

  return baseLayout(content, data)
}

// ─── Template: match_scheduled ─────────────────────────────────────────────

export interface MatchScheduledData extends BaseData {
  challengeCode: string
  teamName: string
  opponentName: string
  scheduledTime: string   // ISO
  venueName?: string | null
  venueAddress?: string | null
  challengeUrl: string
}

export function matchScheduledEmail(data: MatchScheduledData): string {
  const venueBlock = data.venueName
    ? infoBox('Venue', `${escHtml(data.venueName)}${data.venueAddress ? `<br/><span style="font-size:12px;font-weight:400;color:${C.muted};">${escHtml(data.venueAddress)}</span>` : ''}`)
    : ''

  const content = heroSection('📅', 'Match Scheduled', `${data.teamName} vs ${data.opponentName}`) +
    bodySection(`
      ${p(`Your match is confirmed and ready to go, ${escHtml(data.playerName)}. See you on the court!`)}
      ${infoBox('Challenge', escHtml(data.challengeCode))}
      ${infoBox('Date & Time', fmtDate(data.scheduledTime))}
      ${venueBlock}
      ${divider()}
      ${p('You can request a reschedule from the challenge page if your plans change.', `font-size:13px;color:${C.muted};`)}
      ${ctaButton('View Match Details', data.challengeUrl)}
    `)

  return baseLayout(content, data)
}

// ─── Template: result_submitted ──────────────────────────────────────────────

export interface ResultSubmittedData extends BaseData {
  challengeCode: string
  reporterTeamName: string
  opponentName: string
  set1: string  // "6-4"
  set2: string
  supertiebreak?: string | null
  reportedWinnerName: string
  verifyDeadline: string  // ISO
  challengeUrl: string
  isReporter: boolean   // true if the email recipient is the reporting team
}

export function resultSubmittedEmail(data: ResultSubmittedData): string {
  const isReporter = data.isReporter

  const scoreBlock = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
      <tr>
        <td style="background-color:${C.mutedBg};border:1px solid ${C.border};border-radius:8px;padding:14px 16px;">
          <p style="margin:0 0 10px;font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Reported Score</p>
          <table cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:2px 0;font-size:13px;color:${C.body};">Set 1 &nbsp;—&nbsp; <strong>${escHtml(data.set1)}</strong></td></tr>
            <tr><td style="padding:2px 0;font-size:13px;color:${C.body};">Set 2 &nbsp;—&nbsp; <strong>${escHtml(data.set2)}</strong></td></tr>
            ${data.supertiebreak ? `<tr><td style="padding:2px 0;font-size:13px;color:${C.body};">Super TB — <strong>${escHtml(data.supertiebreak)}</strong></td></tr>` : ''}
          </table>
        </td>
      </tr>
    </table>`

  const winnerBadge = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
      <tr>
        <td style="background-color:${C.emeraldLight};border:1px solid #6ee7b7;border-radius:8px;padding:10px 14px;">
          <p style="margin:0;font-size:13px;color:${C.emeraldText};font-weight:700;">🏆 ${escHtml(data.reportedWinnerName)} reported as winner</p>
        </td>
      </tr>
    </table>`

  const content = isReporter
    ? heroSection('📊', 'Score Submitted', `Waiting for ${data.opponentName} to verify`) +
      bodySection(`
        ${p(`Your score for challenge <strong>${escHtml(data.challengeCode)}</strong> has been recorded. The opposing team has been asked to verify.`)}
        ${scoreBlock}
        ${winnerBadge}
        ${p(`They have until <strong>${fmtDeadline(data.verifyDeadline)}</strong> to verify. If they don't respond in time, the result is auto-approved.`, `color:${C.muted};font-size:13px;`)}
        ${ctaButton('View Challenge', data.challengeUrl)}
      `)
    : heroSection('⚠️', 'Please Verify the Score', `${data.reporterTeamName} has submitted a result`, C.orange) +
      bodySection(`
        ${p(`<strong>${escHtml(data.reporterTeamName)}</strong> has submitted a match result for challenge <strong>${escHtml(data.challengeCode)}</strong>. Please check the score and verify it — or dispute it if it doesn't match what you remember.`)}
        ${scoreBlock}
        ${winnerBadge}
        ${infoBox('Verify By', fmtDeadline(data.verifyDeadline), C.orange)}
        ${p('If you don\'t respond before the deadline, the result will be automatically approved.', `color:${C.muted};font-size:13px;`)}
        ${ctaButton('Verify or Dispute Result', data.challengeUrl, C.orange)}
      `)

  return baseLayout(content, data)
}

// ─── Template: challenge_dissolved ───────────────────────────────────────────

export interface ChallengeDissolveddData extends BaseData {
  challengeCode: string
  challengingTeamName: string
  challengedTeamName: string
  reason: string
  challengeUrl: string
}

export function challengeDissolvedEmail(data: ChallengeDissolveddData): string {
  const content = heroSection('💨', 'Challenge Dissolved', `${data.challengeCode} has been removed`, '#64748b') +
    bodySection(`
      ${p(`Hi <strong>${escHtml(data.playerName)}</strong>, the challenge between <strong>${escHtml(data.challengingTeamName)}</strong> and <strong>${escHtml(data.challengedTeamName)}</strong> has been dissolved.`)}
      ${infoBox('Reason', escHtml(data.reason), '#94a3b8')}
      ${p('No ladder changes have been applied. If you have questions, contact the league admin.', `font-size:13px;color:${C.muted};`)}
      ${ctaButton('View Challenge', data.challengeUrl, '#64748b')}
    `)

  return baseLayout(content, data)
}

// ─── Template: score_disputed ─────────────────────────────────────────────────

export interface ScoreDisputedData extends BaseData {
  challengeCode: string
  disputerTeamName: string
  reporterTeamName: string
  originalScore: { set1: string; set2: string; supertiebreak?: string | null; winner: string }
  disputedScore: { set1: string; set2: string; supertiebreak?: string | null; winner: string }
  challengeUrl: string
  isReporter: boolean  // true → reporter gets the "you need to respond" email
  windowMinutes: number
}

export function scoreDisputedEmail(data: ScoreDisputedData): string {
  const scoreBox = (label: string, s: { set1: string; set2: string; supertiebreak?: string | null; winner: string }, color: string) => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
      <tr>
        <td style="background-color:${C.mutedBg};border:1px solid ${C.border};border-left:3px solid ${color};border-radius:8px;padding:12px 14px;">
          <p style="margin:0 0 6px;font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">${escHtml(label)}</p>
          <p style="margin:0;font-size:13px;color:${C.body};">S1 <strong>${escHtml(s.set1)}</strong> &nbsp;·&nbsp; S2 <strong>${escHtml(s.set2)}</strong>${s.supertiebreak ? ` &nbsp;·&nbsp; TB <strong>${escHtml(s.supertiebreak)}</strong>` : ''}</p>
          <p style="margin:4px 0 0;font-size:12px;color:${C.muted};">Winner: <strong style="color:${C.heading};">${escHtml(s.winner)}</strong></p>
        </td>
      </tr>
    </table>`

  const content = data.isReporter
    ? heroSection('⚠️', 'Score Disputed', `${data.disputerTeamName} disagrees with your result`, C.orange) +
      bodySection(`
        ${p(`<strong>${escHtml(data.disputerTeamName)}</strong> has filed a counter-score for challenge <strong>${escHtml(data.challengeCode)}</strong>. Both versions are shown below.`)}
        ${scoreBox('Your submitted score', data.originalScore, C.blue)}
        ${scoreBox('Their counter-score', data.disputedScore, C.orange)}
        ${infoBox('Resolution Window', `You have ${data.windowMinutes} minute${data.windowMinutes !== 1 ? 's' : ''} to accept their version`, C.orange)}
        ${p('If you agree with their score, click "Accept Their Score" in the app. If neither team resolves this, the dispute will escalate to admin review.', `font-size:13px;color:${C.muted};`)}
        ${ctaButton('Review & Accept or Escalate', data.challengeUrl, C.orange)}
      `)
    : heroSection('✅', 'Dispute Filed', 'Waiting for the other team to respond', C.blue) +
      bodySection(`
        ${p(`Your counter-score for challenge <strong>${escHtml(data.challengeCode)}</strong> has been sent to <strong>${escHtml(data.reporterTeamName)}</strong>. They have ${data.windowMinutes} minute${data.windowMinutes !== 1 ? 's' : ''} to accept your version.`)}
        ${scoreBox('Original score', data.originalScore, '#94a3b8')}
        ${scoreBox('Your counter-score', data.disputedScore, C.blue)}
        ${p('If they don\'t respond, the dispute will automatically escalate to admin review.', `font-size:13px;color:${C.muted};`)}
        ${ctaButton('Track Dispute', data.challengeUrl, C.blue)}
      `)

  return baseLayout(content, data)
}

// ─── Template: dispute_resolved ───────────────────────────────────────────────

export interface DisputeResolvedData extends BaseData {
  challengeCode: string
  finalScore: { set1: string; set2: string; supertiebreak?: string | null; winner: string }
  resolvedBy: 'agreement' | 'admin'
  isWinner: boolean
  challengeUrl: string
}

export function disputeResolvedEmail(data: DisputeResolvedData): string {
  const byLine = data.resolvedBy === 'admin'
    ? 'An admin has reviewed both scores and set the final result.'
    : 'Both teams reached agreement on the final score.'

  const content = heroSection(
    data.isWinner ? '🏆' : '✅',
    data.isWinner ? 'Dispute Resolved — You Won!' : 'Dispute Resolved',
    byLine,
    data.isWinner ? C.emerald : '#64748b'
  ) +
    bodySection(`
      ${p(`Hi <strong>${escHtml(data.playerName)}</strong>, the score dispute for challenge <strong>${escHtml(data.challengeCode)}</strong> has been resolved.`)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
        <tr>
          <td style="background-color:${data.isWinner ? C.emeraldLight : C.mutedBg};border:1px solid ${data.isWinner ? '#6ee7b7' : C.border};border-radius:8px;padding:14px 16px;">
            <p style="margin:0 0 8px;font-size:11px;color:${C.muted};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Final Score</p>
            <p style="margin:0;font-size:15px;font-weight:700;color:${C.heading};">S1 ${escHtml(data.finalScore.set1)} &nbsp;·&nbsp; S2 ${escHtml(data.finalScore.set2)}${data.finalScore.supertiebreak ? ` &nbsp;·&nbsp; TB ${escHtml(data.finalScore.supertiebreak)}` : ''}</p>
            <p style="margin:6px 0 0;font-size:13px;color:${C.emeraldText};font-weight:600;">🏆 ${escHtml(data.finalScore.winner)}</p>
          </td>
        </tr>
      </table>
      ${p('The ladder has been updated to reflect this result.', `font-size:13px;color:${C.muted};`)}
      ${ctaButton('View Challenge', data.challengeUrl)}
    `)

  return baseLayout(content, data)
}

// ─── Template: account_created (existing — kept for compat) ──────────────────

export function accountCreatedEmail(data: {
  playerName: string
  email: string
  tempPassword: string
  verificationUrl: string
  teamName?: string
  unsubscribeUrl?: string
}): string {
  const base: BaseData = {
    playerName: data.playerName,
    unsubscribeUrl: data.unsubscribeUrl ?? '#',
    previewText: `Welcome to CPL — your login credentials inside`,
  }

  const content = heroSection('🎾', `Welcome to CPL, ${data.playerName}!`, data.teamName ? `You've been added to ${data.teamName}` : 'Your account is ready') +
    bodySection(`
      ${p(`Hi <strong>${escHtml(data.playerName)}</strong>, your CPL account has been created${data.teamName ? ` for <strong>${escHtml(data.teamName)}</strong>` : ''}. Here are your login credentials:`)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
        <tr>
          <td style="background-color:${C.mutedBg};border:1px solid ${C.border};border-radius:8px;padding:14px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:12px;color:${C.muted};padding-bottom:4px;">Email</td>
                <td style="font-size:14px;font-weight:700;color:${C.heading};font-family:monospace;text-align:right;">${escHtml(data.email)}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding:4px 0;"><div style="border-top:1px solid ${C.border};"></div></td>
              </tr>
              <tr>
                <td style="font-size:12px;color:${C.muted};padding-top:4px;">Temp Password</td>
                <td style="font-size:14px;font-weight:700;color:${C.heading};font-family:monospace;text-align:right;padding-top:4px;">${escHtml(data.tempPassword)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      ${p('Click below to verify your email and activate your account:')}
      ${ctaButton('Verify My Email', data.verificationUrl)}
      ${divider()}
      ${p('After verifying, sign in with the temporary password and change it from your profile. This link expires in 7 days.', `font-size:12px;color:${C.muted};`)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background-color:#fefce8;border:1px solid #fde047;border-radius:8px;padding:10px 14px;font-size:12px;color:#854d0e;">
            ⚠️ If you weren't expecting this, please ignore this email.
          </td>
        </tr>
      </table>
    `)

  return baseLayout(content, base)
}

// ─── Template: generic_notification (fallback) ────────────────────────────────

export function genericNotificationEmail(data: {
  playerName: string
  title: string
  message: string
  actionUrl?: string
  actionLabel?: string
  unsubscribeUrl?: string
}): string {
  const base: BaseData = {
    playerName: data.playerName,
    unsubscribeUrl: data.unsubscribeUrl ?? '#',
    previewText: data.message.slice(0, 100),
  }

  const content = heroSection('🎾', data.title, 'Chiniot Padel League') +
    bodySection(`
      ${p(`Hi <strong>${escHtml(data.playerName)}</strong>,`)}
      ${p(data.message)}
      ${data.actionUrl ? ctaButton(data.actionLabel || 'View Details', data.actionUrl) : ''}
    `)

  return baseLayout(content, base)
}
