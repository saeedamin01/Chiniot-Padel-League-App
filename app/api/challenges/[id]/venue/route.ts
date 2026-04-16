import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// PATCH /api/challenges/[id]/venue
//
// Lets either team add or update the venue/location for a challenge that
// has already been accepted (slot chosen) and is in 'accepted' or 'scheduled'
// status.  This covers the case where Option A was used (slot chosen first,
// venue agreed later over WhatsApp).
//
// Body: { venueId?: string, matchLocation?: string }
// venueId   — FK to venues table (preferred)
// matchLocation — free-text fallback if venueId is not set

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { venueId, matchLocation } = body

    if (!venueId && !matchLocation) {
      return NextResponse.json(
        { error: 'Provide venueId or matchLocation' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    // Fetch the challenge
    const { data: challenge, error: challengeError } = await adminClient
      .from('challenges')
      .select('id, status, challenging_team_id, challenged_team_id, season_id')
      .eq('id', params.id)
      .single()

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 })
    }

    if (!['accepted', 'scheduled'].includes(challenge.status)) {
      return NextResponse.json(
        { error: 'Location can only be set on accepted or scheduled challenges' },
        { status: 400 }
      )
    }

    // Verify user is on one of the two teams
    const { data: season } = await adminClient
      .from('seasons')
      .select('id')
      .eq('is_active', true)
      .single()

    const { data: userTeams } = await adminClient
      .from('teams')
      .select('id')
      .eq('season_id', season?.id ?? challenge.season_id)
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)

    const userTeamIds = userTeams?.map(t => t.id) ?? []
    const isParticipant =
      userTeamIds.includes(challenge.challenging_team_id) ||
      userTeamIds.includes(challenge.challenged_team_id)

    if (!isParticipant) {
      return NextResponse.json(
        { error: 'Not authorized to update this challenge' },
        { status: 403 }
      )
    }

    const updatePayload: Record<string, unknown> = {}
    if (venueId) updatePayload.venue_id = venueId
    if (matchLocation) updatePayload.match_location = matchLocation

    const { data: updated, error: updateError } = await adminClient
      .from('challenges')
      .update(updatePayload)
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ challenge: updated })
  } catch (err) {
    console.error('Error updating challenge venue:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
