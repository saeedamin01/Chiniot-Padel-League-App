import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getActiveSeason } from '@/lib/ladder/engine'
import { addDays } from 'date-fns'
import { checkLeagueLock } from '@/lib/league/lock'

export const dynamic = 'force-dynamic'

const ACTIVE_CHALLENGE_STATUSES = [
  'pending', 'accepted', 'accepted_open', 'time_pending_confirm',
  'reschedule_requested', 'reschedule_pending_admin', 'revision_proposed', 'scheduled',
]

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const lockResponse = await checkLeagueLock()
    if (lockResponse) return lockResponse

    const adminClient = createAdminClient()

    // Verify caller is a team member or admin
    const [{ data: team }, { data: playerData }] = await Promise.all([
      adminClient.from('teams').select('*').eq('id', params.id).single(),
      supabase.from('players').select('is_admin').eq('id', user.id).single(),
    ])

    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

    const isTeamMember = team.player1_id === user.id || team.player2_id === user.id
    const isAdmin = playerData?.is_admin
    if (!isTeamMember && !isAdmin) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // Rule 2: cannot freeze while in an active challenge
    const { data: activeChallenge } = await adminClient
      .from('challenges')
      .select('id, status')
      .or(`challenging_team_id.eq.${params.id},challenged_team_id.eq.${params.id}`)
      .in('status', ACTIVE_CHALLENGE_STATUSES)
      .limit(1)
      .maybeSingle()

    if (activeChallenge) {
      return NextResponse.json(
        { error: 'Cannot freeze while in an active challenge. Forfeit or complete the challenge first.' },
        { status: 400 }
      )
    }

    if (team.status === 'frozen') {
      return NextResponse.json({ error: 'Team is already frozen' }, { status: 400 })
    }
    if (team.status === 'dissolved') {
      return NextResponse.json({ error: 'Dissolved teams cannot be frozen' }, { status: 400 })
    }

    // Get active season + settings
    const season = await getActiveSeason()
    if (!season) return NextResponse.json({ error: 'No active season' }, { status: 400 })
    const settings = season.league_settings

    // Get current ladder position + tier boundary
    const { data: position } = await adminClient
      .from('ladder_positions')
      .select('*, tier:tiers!tier_id(id, min_rank, max_rank)')
      .eq('team_id', params.id)
      .eq('season_id', season.id)
      .single()

    if (!position) return NextResponse.json({ error: 'Team not in ladder' }, { status: 400 })

    const { count: totalCount } = await adminClient
      .from('ladder_positions')
      .select('id', { count: 'exact' })
      .eq('season_id', season.id)

    const totalTeams = totalCount || 100

    // Rule 5: cannot drop below tier's lowest rank
    const tierMaxRank = (position.tier as any)?.max_rank ?? totalTeams

    // Rule 3: immediate drop on freeze
    const currentRank = position.rank
    const newRank = Math.min(
      currentRank + settings.freeze_immediate_drop,
      tierMaxRank,
      totalTeams
    )

    const now = new Date()

    // ── Apply freeze with correct rank shifting ──────────────────────────────
    // Phase A: park the freezing team at a temp rank so their slot is free
    await adminClient
      .from('ladder_positions')
      .update({ rank: 0 })
      .eq('id', position.id)

    // Phase B: shift the non-frozen teams that occupied [currentRank+1 .. newRank]
    // UP by 1 — they fill the gap left by the departing team
    if (newRank > currentRank) {
      // We do this manually to avoid depending on shiftActiveTeams' challengeId signature
      // for a non-challenge context.
      const { data: gapPositions } = await adminClient
        .from('ladder_positions')
        .select('id, rank, team_id, status')
        .eq('season_id', season.id)
        .gte('rank', currentRank + 1)
        .lte('rank', newRank)
        .neq('status', 'frozen')

      const toFill = (gapPositions || []).sort((a, b) => a.rank - b.rank) // ascending for shift-up

      // Sub-phase B1: park them at negatives
      for (const p of toFill) {
        await adminClient.from('ladder_positions').update({ rank: -(p.rank) }).eq('id', p.id)
      }

      // Sub-phase B2: assign each team to rank - 1 (shift up)
      const { data: tiers } = await adminClient
        .from('tiers').select('id, min_rank, max_rank').eq('season_id', season.id)

      for (const p of toFill) {
        const r = p.rank - 1
        const newTierId = tiers?.find(t => r >= t.min_rank && r <= (t.max_rank ?? t.min_rank))?.id
        await adminClient.from('ladder_positions')
          .update({ rank: r, ...(newTierId ? { tier_id: newTierId } : {}) })
          .eq('id', p.id)
        await adminClient.from('ladder_history').insert({
          season_id: season.id, team_id: p.team_id,
          old_rank: p.rank, new_rank: r,
          change_type: 'freeze_drop', notes: 'Shifted up — team above froze',
        })
      }
    }

    // Phase C: place the frozen team at their new rank
    const { data: tiers } = await adminClient
      .from('tiers').select('id, min_rank, max_rank').eq('season_id', season.id)
    const newTierId = tiers?.find(t => newRank >= t.min_rank && newRank <= (t.max_rank ?? t.min_rank))?.id

    await adminClient.from('ladder_positions')
      .update({ rank: newRank, status: 'frozen', ...(newTierId ? { tier_id: newTierId } : {}) })
      .eq('id', position.id)

    // Log freeze movement
    if (newRank !== currentRank) {
      await adminClient.from('ladder_history').insert({
        season_id: season.id, team_id: params.id,
        old_rank: currentRank, new_rank: newRank,
        change_type: 'freeze_drop', notes: 'Immediate drop on freeze',
      })
    }

    // Create freeze record
    const { data: freezeRecord } = await adminClient
      .from('freeze_records')
      .insert({
        team_id: params.id,
        season_id: season.id,
        rank_at_freeze: currentRank,
        tier_id: position.tier_id,
        frozen_at: now.toISOString(),
        next_drop_at: addDays(now, settings.freeze_interval_days).toISOString(),
        drop_count: newRank - currentRank,
      })
      .select()
      .single()

    // Update team status
    await adminClient.from('teams').update({ status: 'frozen' }).eq('id', params.id)

    // Audit log
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'team_frozen',
      entity_type: 'team',
      entity_id: params.id,
      old_value: { rank: currentRank },
      new_value: { status: 'frozen', rank: newRank },
      created_at: now.toISOString(),
    })

    // Notify both players on the team
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    for (const pid of [team.player1_id, team.player2_id]) {
      if (!pid) continue
      await adminClient.from('notifications').insert({
        player_id: pid,
        team_id: params.id,
        type: 'team_frozen',
        title: '❄️ Team frozen',
        message: `${team.name} has been frozen at rank #${newRank}. The team will drop 1 position each week while frozen.`,
        action_url: `${appUrl}/dashboard`,
      })
    }

    return NextResponse.json({ success: true, previousRank: currentRank, newRank, freezeRecord })
  } catch (err) {
    console.error('Error freezing team:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
