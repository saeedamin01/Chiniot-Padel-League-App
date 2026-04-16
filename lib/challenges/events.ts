import { createAdminClient } from '@/lib/supabase/admin'

// ─── Event type catalogue ──────────────────────────────────────────────────────
export type ChallengeEventType =
  | 'challenge_issued'
  | 'challenge_accepted'          // challenged team accepted (open or slot)
  | 'challenge_declined'          // challenged team declined (forfeit)
  | 'time_set'                    // challenged team entered agreed time
  | 'time_confirmed'              // challenging team confirmed time → scheduled
  | 'time_auto_confirmed'         // auto-confirmed after deadline expired
  | 'time_disputed'               // challenging team disputed the entered time
  | 'score_entered'               // either team submitted the match result
  | 'result_verified'             // opposing team manually verified the result
  | 'result_auto_verified'        // auto-verified after verify window expired
  | 'result_disputed'             // opposing team disputed the result
  | 'forfeit'                     // a team forfeited (player-initiated)
  | 'auto_forfeit'                // system auto-forfeited due to missed deadline
  | 'dissolved'                   // challenge dissolved (admin or system)
  | 'reschedule_requested'        // either team asked to reschedule
  | 'reschedule_confirmed_by_team'// the other team agreed to the reschedule
  | 'reschedule_declined_by_team' // the other team declined the reschedule
  | 'reschedule_approved'         // admin approved the reschedule
  | 'reschedule_rejected'         // admin rejected the reschedule
  | 'admin_edited'                // admin changed challenge fields
  | 'venue_set'                   // venue added/changed

// ─── Human-readable labels ────────────────────────────────────────────────────
export const EVENT_LABELS: Record<ChallengeEventType, string> = {
  challenge_issued:              'Challenge issued',
  challenge_accepted:            'Challenge accepted',
  challenge_declined:            'Challenge declined (forfeit)',
  time_set:                      'Match time entered',
  time_confirmed:                'Match time confirmed',
  time_auto_confirmed:           'Match time auto-confirmed',
  time_disputed:                 'Match time disputed',
  score_entered:                 'Score submitted',
  result_verified:               'Result verified',
  result_auto_verified:          'Result auto-verified',
  result_disputed:               'Result disputed',
  forfeit:                       'Forfeited',
  auto_forfeit:                  'Auto-forfeited (deadline missed)',
  dissolved:                     'Challenge dissolved',
  reschedule_requested:          'Reschedule requested',
  reschedule_confirmed_by_team:  'Reschedule agreed by team',
  reschedule_declined_by_team:   'Reschedule declined by team',
  reschedule_approved:           'Reschedule approved by admin',
  reschedule_rejected:           'Reschedule rejected by admin',
  admin_edited:                  'Edited by admin',
  venue_set:                     'Venue updated',
}

// ─── Icon + colour hints (for UI rendering) ───────────────────────────────────
export const EVENT_COLOURS: Record<ChallengeEventType, string> = {
  challenge_issued:              'blue',
  challenge_accepted:            'emerald',
  challenge_declined:            'red',
  time_set:                      'blue',
  time_confirmed:                'emerald',
  time_auto_confirmed:           'slate',
  time_disputed:                 'orange',
  score_entered:                 'blue',
  result_verified:               'emerald',
  result_auto_verified:          'slate',
  result_disputed:               'orange',
  forfeit:                       'red',
  auto_forfeit:                  'red',
  dissolved:                     'red',
  reschedule_requested:          'purple',
  reschedule_confirmed_by_team:  'purple',
  reschedule_declined_by_team:   'orange',
  reschedule_approved:           'emerald',
  reschedule_rejected:           'red',
  admin_edited:                  'yellow',
  venue_set:                     'blue',
}

// ─── Log helper ───────────────────────────────────────────────────────────────
export interface LogChallengeEventOptions {
  challengeId: string
  eventType: ChallengeEventType
  actorId?: string | null
  actorRole: 'player' | 'admin' | 'system'
  /** Pass pre-fetched name to avoid an extra DB round-trip */
  actorName?: string | null
  data?: Record<string, unknown>
  /** Override created_at (e.g. for backfilling). Defaults to now. */
  timestamp?: string
}

export async function logChallengeEvent(opts: LogChallengeEventOptions): Promise<void> {
  try {
    const adminClient = createAdminClient()

    // Resolve actor name if not already provided
    let actorName = opts.actorName ?? null
    if (!actorName && opts.actorId) {
      const { data: player } = await adminClient
        .from('players')
        .select('name')
        .eq('id', opts.actorId)
        .single()
      actorName = player?.name ?? null
    }

    await adminClient.from('challenge_events').insert({
      challenge_id: opts.challengeId,
      event_type:   opts.eventType,
      actor_id:     opts.actorId   ?? null,
      actor_role:   opts.actorRole,
      actor_name:   actorName,
      data:         opts.data ?? {},
      created_at:   opts.timestamp ?? new Date().toISOString(),
    })
  } catch (err) {
    // Event logging is non-critical — never let it break the primary operation
    console.error('[logChallengeEvent] failed:', err)
  }
}
