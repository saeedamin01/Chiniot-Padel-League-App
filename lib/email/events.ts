/**
 * lib/email/events.ts
 *
 * Typed fire-and-forget email dispatch for each CPL notification event.
 *
 * Usage (in any API route):
 *   sendEventEmail('challenge_received', [player1Id, player2Id], payload).catch(() => {})
 *
 * The function:
 *  1. Fetches player name / email / unsubscribe status from DB
 *  2. Skips unsubscribed / email-less players
 *  3. Renders the correct template with per-player BaseData injected
 *  4. Calls sendEmail for each eligible recipient
 *
 * Never throws — errors are caught and logged.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendEmail,
  challengeReceivedEmail,
  challengeAcceptedEmail,
  matchScheduledEmail,
  resultSubmittedEmail,
  challengeDissolvedEmail,
  scoreDisputedEmail,
  disputeResolvedEmail,
} from '@/lib/email/mailer'

// ─── Event type ───────────────────────────────────────────────────────────────

export type EmailEvent =
  | 'challenge_received'
  | 'challenge_accepted'
  | 'match_scheduled'
  | 'result_submitted'
  | 'challenge_dissolved'
  | 'score_disputed'
  | 'dispute_resolved'

// ─── Payload types (caller-supplied, excluding BaseData) ──────────────────────

export interface ChallengeReceivedPayload {
  challengedTeamName: string
  challengingTeamName: string
  challengeCode: string
  slots: string[]
  deadline: string
  acceptUrl: string
  ticketType?: string | null
}

export interface ChallengeAcceptedPayload {
  challengingTeamName: string
  challengedTeamName: string
  challengeCode: string
  mode: 'open' | 'slot'
  scheduledTime?: string | null
  challengeUrl: string
}

export interface MatchScheduledPayload {
  challengeCode: string
  teamName: string
  opponentName: string
  scheduledTime: string
  venueName?: string | null
  venueAddress?: string | null
  challengeUrl: string
}

export interface ResultSubmittedPayload {
  challengeCode: string
  reporterTeamName: string
  opponentName: string
  set1: string
  set2: string
  supertiebreak?: string | null
  reportedWinnerName: string
  verifyDeadline: string
  challengeUrl: string
  isReporter: boolean
}

export interface ChallengeDissolvedPayload {
  challengeCode: string
  challengingTeamName: string
  challengedTeamName: string
  reason: string
  challengeUrl: string
}

export interface ScoreDisputedPayload {
  challengeCode: string
  disputerTeamName: string
  reporterTeamName: string
  originalScore: { set1: string; set2: string; supertiebreak?: string | null; winner: string }
  disputedScore: { set1: string; set2: string; supertiebreak?: string | null; winner: string }
  challengeUrl: string
  isReporter: boolean
  windowMinutes: number
}

export interface DisputeResolvedPayload {
  challengeCode: string
  finalScore: { set1: string; set2: string; supertiebreak?: string | null; winner: string }
  resolvedBy: 'agreement' | 'admin'
  isWinner: boolean
  challengeUrl: string
}

// ─── Payload union ────────────────────────────────────────────────────────────

type EventPayloadMap = {
  challenge_received: ChallengeReceivedPayload
  challenge_accepted: ChallengeAcceptedPayload
  match_scheduled: MatchScheduledPayload
  result_submitted: ResultSubmittedPayload
  challenge_dissolved: ChallengeDissolvedPayload
  score_disputed: ScoreDisputedPayload
  dispute_resolved: DisputeResolvedPayload
}

// ─── Core function ────────────────────────────────────────────────────────────

export async function sendEventEmail<E extends EmailEvent>(
  event: E,
  recipientIds: string[],
  payload: EventPayloadMap[E]
): Promise<{ sent: number; skipped: number }> {
  if (!recipientIds.length) return { sent: 0, skipped: 0 }

  const adminClient = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Fetch player credentials
  const { data: players } = await adminClient
    .from('players')
    .select('id, name, email, email_unsubscribed, email_unsubscribe_token')
    .in('id', recipientIds)

  if (!players?.length) return { sent: 0, skipped: 0 }

  let sent = 0
  let skipped = 0

  for (const player of players) {
    // Skip unsubscribed or email-less players
    if (player.email_unsubscribed || !player.email) {
      skipped++
      continue
    }

    const unsubscribeUrl = `${appUrl}/api/notifications/unsubscribe?token=${player.email_unsubscribe_token}`
    const base = { playerName: player.name as string, unsubscribeUrl }

    let html: string
    let subject: string

    try {
      switch (event) {
        case 'challenge_received': {
          const p = payload as ChallengeReceivedPayload
          subject = `🎾 New Challenge — ${p.challengingTeamName} wants to play`
          html = challengeReceivedEmail({
            ...base,
            ...p,
            previewText: `${p.challengingTeamName} has challenged your team. Accept by the deadline to keep your rank.`,
          })
          break
        }

        case 'challenge_accepted': {
          const p = payload as ChallengeAcceptedPayload
          const isSlot = p.mode === 'slot'
          subject = isSlot
            ? `✅ Match Scheduled — ${p.challengeCode}`
            : `🤝 Challenge Accepted — ${p.challengeCode}`
          html = challengeAcceptedEmail({
            ...base,
            ...p,
            previewText: isSlot
              ? `${p.challengedTeamName} picked your slot — match confirmed!`
              : `${p.challengedTeamName} accepted. Coordinate the time on WhatsApp.`,
          })
          break
        }

        case 'match_scheduled': {
          const p = payload as MatchScheduledPayload
          subject = `📅 Match Scheduled — ${p.challengeCode}`
          html = matchScheduledEmail({
            ...base,
            ...p,
            previewText: `Your match vs ${p.opponentName} is confirmed. See you on the court!`,
          })
          break
        }

        case 'result_submitted': {
          const p = payload as ResultSubmittedPayload
          subject = p.isReporter
            ? `📊 Score Submitted — ${p.challengeCode}`
            : `⚠️ Please Verify the Score — ${p.challengeCode}`
          html = resultSubmittedEmail({
            ...base,
            ...p,
            previewText: p.isReporter
              ? `Your score is recorded and waiting for ${p.opponentName} to verify.`
              : `${p.reporterTeamName} submitted a match result. Please review and verify.`,
          })
          break
        }

        case 'challenge_dissolved': {
          const p = payload as ChallengeDissolvedPayload
          subject = `💨 Challenge Dissolved — ${p.challengeCode}`
          html = challengeDissolvedEmail({
            ...base,
            ...p,
            previewText: `Challenge ${p.challengeCode} between ${p.challengingTeamName} and ${p.challengedTeamName} has been dissolved.`,
          })
          break
        }

        case 'score_disputed': {
          const p = payload as ScoreDisputedPayload
          subject = p.isReporter
            ? `⚠️ Score Disputed — ${p.challengeCode}`
            : `✅ Dispute Filed — ${p.challengeCode}`
          html = scoreDisputedEmail({
            ...base,
            ...p,
            previewText: p.isReporter
              ? `${p.disputerTeamName} has filed a counter-score. Respond in the app.`
              : `Your counter-score for ${p.challengeCode} has been sent.`,
          })
          break
        }

        case 'dispute_resolved': {
          const p = payload as DisputeResolvedPayload
          subject = p.isWinner
            ? `🏆 Dispute Resolved — You Won! (${p.challengeCode})`
            : `✅ Dispute Resolved — ${p.challengeCode}`
          html = disputeResolvedEmail({
            ...base,
            ...p,
            previewText: `The score dispute for ${p.challengeCode} has been resolved. Ladder updated.`,
          })
          break
        }

        default:
          skipped++
          continue
      }
    } catch (templateErr) {
      console.error('[CPL Email] template build error', event, templateErr)
      skipped++
      continue
    }

    const result = await sendEmail({ to: player.email as string, subject, html })
    if (result.success) sent++
    else skipped++
  }

  return { sent, skipped }
}
