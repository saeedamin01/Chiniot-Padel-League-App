/**
 * lib/push/notify.ts
 *
 * Typed push-notification dispatch for each CPL event.
 * Mirrors the shape of lib/email/events.ts so both channels stay in sync.
 *
 * Usage (fire-and-forget in any API route):
 *   sendPushEvent('challenge_received', [p1Id, p2Id], payload).catch(() => {})
 */

import { sendPushToPlayers, type PushPayload } from '@/lib/push/send'

// ─── Event type ───────────────────────────────────────────────────────────────

export type PushEvent =
  | 'challenge_received'
  | 'challenge_accepted'
  | 'match_scheduled'
  | 'result_submitted'
  | 'challenge_dissolved'
  | 'score_disputed'
  | 'dispute_resolved'

// ─── Per-event payload types ──────────────────────────────────────────────────

export interface PushChallengeReceivedPayload {
  challengingTeamName: string
  challengeCode: string
  challengeId: string
}

export interface PushChallengeAcceptedPayload {
  challengedTeamName: string
  challengeCode: string
  mode: 'open' | 'slot'
  challengeId: string
}

export interface PushMatchScheduledPayload {
  opponentName: string
  challengeCode: string
  scheduledTime: string  // ISO — used only for the notification body text
  challengeId: string
}

export interface PushResultSubmittedPayload {
  reporterTeamName: string
  challengeCode: string
  isReporter: boolean
  challengeId: string
}

export interface PushChallengeDissolvedPayload {
  challengeCode: string
  reason: string
  challengeId: string
}

export interface PushScoreDisputedPayload {
  disputerTeamName: string
  challengeCode: string
  isReporter: boolean
  challengeId: string
}

export interface PushDisputeResolvedPayload {
  challengeCode: string
  winnerTeamName: string
  isWinner: boolean
  challengeId: string
}

type PushEventPayloadMap = {
  challenge_received:   PushChallengeReceivedPayload
  challenge_accepted:   PushChallengeAcceptedPayload
  match_scheduled:      PushMatchScheduledPayload
  result_submitted:     PushResultSubmittedPayload
  challenge_dissolved:  PushChallengeDissolvedPayload
  score_disputed:       PushScoreDisputedPayload
  dispute_resolved:     PushDisputeResolvedPayload
}

// ─── Core function ────────────────────────────────────────────────────────────

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function sendPushEvent<E extends PushEvent>(
  event: E,
  playerIds: string[],
  data: PushEventPayloadMap[E]
): Promise<void> {
  if (!playerIds.length) return

  let payload: PushPayload
  const challengeUrl = `${appUrl()}/challenges/${(data as { challengeId: string }).challengeId}`

  switch (event) {
    case 'challenge_received': {
      const d = data as PushChallengeReceivedPayload
      payload = {
        title: '🎾 New Challenge!',
        body:  `${d.challengingTeamName} has challenged your team (${d.challengeCode})`,
        url:   challengeUrl,
        tag:   `challenge-received-${d.challengeId}`,
        icon:  '/icons/icon-192.svg',
      }
      break
    }

    case 'challenge_accepted': {
      const d = data as PushChallengeAcceptedPayload
      payload = d.mode === 'slot'
        ? {
            title: '✅ Match Scheduled!',
            body:  `${d.challengedTeamName} picked your slot — ${d.challengeCode} is confirmed`,
            url:   challengeUrl,
            tag:   `challenge-accepted-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '🤝 Challenge Accepted',
            body:  `${d.challengedTeamName} accepted ${d.challengeCode} — coordinate the time over WhatsApp`,
            url:   challengeUrl,
            tag:   `challenge-accepted-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
      break
    }

    case 'match_scheduled': {
      const d = data as PushMatchScheduledPayload
      const when = (() => {
        try {
          return new Date(d.scheduledTime).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', hour12: true,
          })
        } catch { return d.scheduledTime }
      })()
      payload = {
        title: '📅 Match Scheduled',
        body:  `${d.challengeCode} vs ${d.opponentName} — ${when}`,
        url:   challengeUrl,
        tag:   `match-scheduled-${d.challengeId}`,
        icon:  '/icons/icon-192.svg',
      }
      break
    }

    case 'result_submitted': {
      const d = data as PushResultSubmittedPayload
      payload = d.isReporter
        ? {
            title: '📊 Score Submitted',
            body:  `${d.challengeCode}: waiting for the other team to verify`,
            url:   challengeUrl,
            tag:   `result-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '⚠️ Please Verify the Score',
            body:  `${d.reporterTeamName} submitted a result for ${d.challengeCode}`,
            url:   challengeUrl,
            tag:   `result-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
      break
    }

    case 'challenge_dissolved': {
      const d = data as PushChallengeDissolvedPayload
      payload = {
        title: '💨 Challenge Dissolved',
        body:  `${d.challengeCode}: ${d.reason}`,
        url:   challengeUrl,
        tag:   `dissolved-${d.challengeId}`,
        icon:  '/icons/icon-192.svg',
      }
      break
    }

    case 'score_disputed': {
      const d = data as PushScoreDisputedPayload
      payload = d.isReporter
        ? {
            title: '⚠️ Score Disputed',
            body:  `${d.disputerTeamName} has filed a counter-score for ${d.challengeCode}`,
            url:   challengeUrl,
            tag:   `dispute-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '✅ Dispute Filed',
            body:  `Your counter-score for ${d.challengeCode} has been sent`,
            url:   challengeUrl,
            tag:   `dispute-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
      break
    }

    case 'dispute_resolved': {
      const d = data as PushDisputeResolvedPayload
      payload = d.isWinner
        ? {
            title: '🏆 You Won!',
            body:  `Dispute resolved for ${d.challengeCode} — ${d.winnerTeamName} wins`,
            url:   challengeUrl,
            tag:   `dispute-resolved-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '✅ Dispute Resolved',
            body:  `The score dispute for ${d.challengeCode} has been settled`,
            url:   challengeUrl,
            tag:   `dispute-resolved-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
      break
    }

    default:
      return
  }

  await sendPushToPlayers(playerIds, payload)
}
