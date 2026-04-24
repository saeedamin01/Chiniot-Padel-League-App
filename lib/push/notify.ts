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
  | 'chat_message'

// ─── Per-event payload types ──────────────────────────────────────────────────

export interface PushChallengeReceivedPayload {
  challengingTeamName: string
  challengedTeamName: string
  challengeCode: string
  challengeId: string
}

export interface PushChallengeAcceptedPayload {
  challengedTeamName: string
  challengingTeamName: string
  challengeCode: string
  mode: 'open' | 'slot'
  challengeId: string
}

export interface PushMatchScheduledPayload {
  opponentName: string
  myTeamName: string
  challengeCode: string
  scheduledTime: string
  challengeId: string
}

export interface PushResultSubmittedPayload {
  reporterTeamName: string
  opponentTeamName: string
  challengeCode: string
  isReporter: boolean
  challengeId: string
}

export interface PushChallengeDissolvedPayload {
  challengingTeamName: string
  challengedTeamName: string
  challengeCode: string
  reason: string
  challengeId: string
}

export interface PushScoreDisputedPayload {
  disputerTeamName: string
  opponentTeamName: string
  challengeCode: string
  isReporter: boolean
  challengeId: string
}

export interface PushDisputeResolvedPayload {
  challengingTeamName: string
  challengedTeamName: string
  challengeCode: string
  winnerTeamName: string
  isWinner: boolean
  challengeId: string
}

export interface PushChatMessagePayload {
  senderName: string
  messagePreview: string
  challengingTeamName: string
  challengedTeamName: string
  challengeCode: string
  chatId: string
}

type PushEventPayloadMap = {
  challenge_received:   PushChallengeReceivedPayload
  challenge_accepted:   PushChallengeAcceptedPayload
  match_scheduled:      PushMatchScheduledPayload
  result_submitted:     PushResultSubmittedPayload
  challenge_dissolved:  PushChallengeDissolvedPayload
  score_disputed:       PushScoreDisputedPayload
  dispute_resolved:     PushDisputeResolvedPayload
  chat_message:         PushChatMessagePayload
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
        body:  `${d.challengingTeamName} has challenged ${d.challengedTeamName}`,
        url:   challengeUrl,
        tag:   `challenge-received-${d.challengeId}`,
        icon:  '/icons/icon-192.svg',
      }
      break
    }

    case 'challenge_accepted': {
      const d = data as PushChallengeAcceptedPayload
      const match = `${d.challengingTeamName} vs ${d.challengedTeamName}`
      payload = d.mode === 'slot'
        ? {
            title: '✅ Match Scheduled!',
            body:  `${match} — ${d.challengedTeamName} picked a slot`,
            url:   challengeUrl,
            tag:   `challenge-accepted-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '🤝 Challenge Accepted',
            body:  `${match} — coordinate the match time over chat`,
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
        body:  `${d.myTeamName} vs ${d.opponentName} — ${when}`,
        url:   challengeUrl,
        tag:   `match-scheduled-${d.challengeId}`,
        icon:  '/icons/icon-192.svg',
      }
      break
    }

    case 'result_submitted': {
      const d = data as PushResultSubmittedPayload
      const match = `${d.reporterTeamName} vs ${d.opponentTeamName}`
      payload = d.isReporter
        ? {
            title: '📊 Score Submitted',
            body:  `${match} — waiting for the other team to verify`,
            url:   challengeUrl,
            tag:   `result-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '⚠️ Please Verify the Score',
            body:  `${match} — ${d.reporterTeamName} submitted a result`,
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
        body:  `${d.challengingTeamName} vs ${d.challengedTeamName} — ${d.reason}`,
        url:   challengeUrl,
        tag:   `dissolved-${d.challengeId}`,
        icon:  '/icons/icon-192.svg',
      }
      break
    }

    case 'score_disputed': {
      const d = data as PushScoreDisputedPayload
      const match = `${d.disputerTeamName} vs ${d.opponentTeamName}`
      payload = d.isReporter
        ? {
            title: '⚠️ Score Disputed',
            body:  `${match} — ${d.disputerTeamName} has filed a counter-score`,
            url:   challengeUrl,
            tag:   `dispute-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '✅ Dispute Filed',
            body:  `${match} — your counter-score has been sent`,
            url:   challengeUrl,
            tag:   `dispute-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
      break
    }

    case 'dispute_resolved': {
      const d = data as PushDisputeResolvedPayload
      const match = `${d.challengingTeamName} vs ${d.challengedTeamName}`
      payload = d.isWinner
        ? {
            title: '🏆 You Won!',
            body:  `${match} — ${d.winnerTeamName} wins the dispute`,
            url:   challengeUrl,
            tag:   `dispute-resolved-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
        : {
            title: '✅ Dispute Resolved',
            body:  `${match} — the score dispute has been settled`,
            url:   challengeUrl,
            tag:   `dispute-resolved-${d.challengeId}`,
            icon:  '/icons/icon-192.svg',
          }
      break
    }

    case 'chat_message': {
      const d = data as PushChatMessagePayload
      payload = {
        title: `💬 ${d.senderName}`,
        body:  `${d.challengingTeamName} vs ${d.challengedTeamName}: ${d.messagePreview.slice(0, 100)}`,
        url:   `${appUrl()}/chat/${d.chatId}`,
        tag:   `chat-${d.chatId}`,
        icon:  '/icons/icon-192.svg',
      }
      break
    }

    default:
      return
  }

  await sendPushToPlayers(playerIds, payload)
}
