/**
 * GET /api/chat/challenge/[challengeId]
 *
 * Returns (and lazily creates) the chat room for a given challenge.
 * Safe to call if the chat already exists — upsert with ignoreDuplicates.
 *
 * Used by the challenge detail page as a fallback for challenges that were
 * accepted before the chat migration was applied, or where the chat creation
 * failed silently during acceptance.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ACCEPTED_STATUSES = [
  'accepted_open',
  'accepted',
  'time_pending_confirm',
  'revision_proposed',
  'reschedule_requested',
  'reschedule_pending_admin',
  'scheduled',
  'result_pending',
  'played',
  'forfeited',
]

export async function GET(
  _request: NextRequest,
  { params }: { params: { challengeId: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // ── Fetch the challenge with both teams ───────────────────────────────────
    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select(`
        id,
        status,
        challenging_team_id,
        challenged_team_id,
        challenging_team:teams!challenges_challenging_team_id_fkey ( player1_id, player2_id ),
        challenged_team:teams!challenges_challenged_team_id_fkey  ( player1_id, player2_id )
      `)
      .eq('id', params.challengeId)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    // ── Verify the caller is on one of the teams ──────────────────────────────
    const ct = challenge.challenging_team as unknown as { player1_id: string; player2_id: string } | null
    const cd = challenge.challenged_team as unknown as { player1_id: string; player2_id: string } | null
    const allPlayers = [ct?.player1_id, ct?.player2_id, cd?.player1_id, cd?.player2_id].filter(Boolean) as string[]

    if (!allPlayers.includes(user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── Only create chats for accepted/active challenges ──────────────────────
    if (!ACCEPTED_STATUSES.includes(challenge.status)) {
      return NextResponse.json({ chatId: null })
    }

    // ── Check if chat already exists ──────────────────────────────────────────
    const { data: existing } = await adminClient
      .from('challenge_chats')
      .select('id')
      .eq('challenge_id', params.challengeId)
      .single()

    if (existing) {
      return NextResponse.json({ chatId: existing.id })
    }

    // ── Create the chat room (lazy creation) ──────────────────────────────────
    const { data: created, error: createError } = await adminClient
      .from('challenge_chats')
      .insert({ challenge_id: params.challengeId, allowed_player_ids: allPlayers })
      .select('id')
      .single()

    if (createError || !created) {
      console.error('[Chat] Failed to lazily create chat room:', createError)
      return NextResponse.json({ error: 'Failed to create chat room' }, { status: 500 })
    }

    return NextResponse.json({ chatId: created.id })
  } catch (err) {
    console.error('[Chat] Unexpected error in GET /api/chat/challenge/[challengeId]:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
