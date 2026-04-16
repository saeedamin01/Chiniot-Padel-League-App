import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getActiveSeason } from '@/lib/ladder/engine'

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

    // Admin only
    const { data: playerData } = await supabase
      .from('players').select('is_admin').eq('id', user.id).single()
    if (!playerData?.is_admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { playerPosition, newPlayerId } = body as {
      playerPosition: 'player1' | 'player2'
      newPlayerId: string
    }

    if (!playerPosition || !newPlayerId) {
      return NextResponse.json({ error: 'playerPosition and newPlayerId are required' }, { status: 400 })
    }
    if (playerPosition !== 'player1' && playerPosition !== 'player2') {
      return NextResponse.json({ error: 'playerPosition must be player1 or player2' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Get team + current players
    const { data: team } = await adminClient
      .from('teams')
      .select('*, player1:players!player1_id(id, name), player2:players!player2_id(id, name)')
      .eq('id', params.id)
      .single()

    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    if (team.status === 'dissolved') {
      return NextResponse.json({ error: 'Cannot change partner on a dissolved team' }, { status: 400 })
    }

    // Validate: new player must be different from the player they're replacing
    const removedPlayerId = playerPosition === 'player1' ? team.player1_id : team.player2_id
    const remainingPlayerId = playerPosition === 'player1' ? team.player2_id : team.player1_id

    if (newPlayerId === removedPlayerId) {
      return NextResponse.json({ error: 'New player is the same as the current player in that slot' }, { status: 400 })
    }
    if (newPlayerId === remainingPlayerId) {
      return NextResponse.json({ error: 'New player is already on this team' }, { status: 400 })
    }

    // Validate: new player exists and is active
    const { data: newPlayer } = await adminClient
      .from('players').select('id, name, is_active').eq('id', newPlayerId).single()
    if (!newPlayer) return NextResponse.json({ error: 'New player not found' }, { status: 404 })
    if (!newPlayer.is_active) {
      return NextResponse.json({ error: 'New player account is suspended' }, { status: 400 })
    }

    // Get active season + settings
    const season = await getActiveSeason()
    if (!season) return NextResponse.json({ error: 'No active season' }, { status: 400 })
    const settings = season.league_settings

    // Check max_teams_per_player for new player
    const { count: existingTeamCount } = await adminClient
      .from('teams')
      .select('id', { count: 'exact' })
      .eq('season_id', season.id)
      .neq('status', 'dissolved')
      .or(`player1_id.eq.${newPlayerId},player2_id.eq.${newPlayerId}`)

    if ((existingTeamCount || 0) >= settings.max_teams_per_player) {
      return NextResponse.json({
        error: `${newPlayer.name} is already on ${existingTeamCount} team(s) — the league limit is ${settings.max_teams_per_player} per player`
      }, { status: 400 })
    }

    // Block partner change during active challenge (challenge involves both players)
    const { data: activeChallenge } = await adminClient
      .from('challenges')
      .select('id, status')
      .or(`challenging_team_id.eq.${params.id},challenged_team_id.eq.${params.id}`)
      .in('status', ACTIVE_CHALLENGE_STATUSES)
      .limit(1)
      .maybeSingle()

    if (activeChallenge) {
      return NextResponse.json({
        error: 'Cannot change partner while the team is in an active challenge. Resolve the challenge first.'
      }, { status: 400 })
    }

    // Get current ladder position + tier boundary
    const { data: position } = await adminClient
      .from('ladder_positions')
      .select('id, rank, tier_id, tier:tiers!tier_id(max_rank)')
      .eq('team_id', params.id)
      .eq('season_id', season.id)
      .single()

    if (!position) return NextResponse.json({ error: 'Team not in ladder' }, { status: 400 })

    const { count: totalCount } = await adminClient
      .from('ladder_positions').select('id', { count: 'exact' }).eq('season_id', season.id)
    const totalTeams = totalCount || 100

    const tierData = Array.isArray(position.tier) ? (position.tier as any[])[0] : position.tier
    const tierMaxRank = (tierData as any)?.max_rank ?? totalTeams

    // Compute rank after partner change penalty
    const currentRank = position.rank
    const dropAmount  = settings.partner_change_drop_positions
    const newRank     = Math.min(currentRank + dropAmount, tierMaxRank, totalTeams)

    const now = new Date()

    // ── Apply rank change ────────────────────────────────────────────────────
    // Phase A: park the team at rank 0 to vacate slot
    await adminClient.from('ladder_positions').update({ rank: 0 }).eq('id', (position as any).id)

    // Phase B: shift non-frozen teams in [currentRank+1 .. newRank] UP by 1
    // (they fill the gap left by the dropping team)
    if (newRank > currentRank) {
      const { data: gapPositions } = await adminClient
        .from('ladder_positions')
        .select('id, rank, team_id, status')
        .eq('season_id', season.id)
        .gte('rank', currentRank + 1)
        .lte('rank', newRank)
        .neq('status', 'frozen')

      const toFill = (gapPositions || []).sort((a, b) => a.rank - b.rank)

      // Sub-phase B1: park at negatives
      for (const p of toFill) {
        await adminClient.from('ladder_positions').update({ rank: -(p.rank) }).eq('id', p.id)
      }

      // Sub-phase B2: assign rank - 1 (shift up)
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
          change_type: 'partner_change',
          notes: `Shifted up — ${team.name} changed partner`,
        })
      }
    }

    // Phase C: place team at new rank
    const { data: tiersForNew } = await adminClient
      .from('tiers').select('id, min_rank, max_rank').eq('season_id', season.id)
    const newTierId = tiersForNew?.find(
      t => newRank >= t.min_rank && newRank <= (t.max_rank ?? t.min_rank)
    )?.id

    await adminClient.from('ladder_positions')
      .update({ rank: newRank, ...(newTierId ? { tier_id: newTierId } : {}) })
      .eq('id', (position as any).id)

    // Log partner change movement
    await adminClient.from('ladder_history').insert({
      season_id: season.id, team_id: params.id,
      old_rank: currentRank, new_rank: newRank,
      change_type: 'partner_change',
      notes: `Partner change: ${
        playerPosition === 'player1' ? (team.player1 as any)?.name : (team.player2 as any)?.name
      } replaced by ${newPlayer.name}`,
    })

    // ── Update team ───────────────────────────────────────────────────────────
    const updateField = playerPosition === 'player1' ? 'player1_id' : 'player2_id'
    await adminClient.from('teams')
      .update({ [updateField]: newPlayerId, partner_changed: true })
      .eq('id', params.id)

    // ── Audit log ─────────────────────────────────────────────────────────────
    const removedPlayer = playerPosition === 'player1' ? team.player1 : team.player2
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      action_type: 'partner_change',
      entity_type: 'team',
      entity_id: params.id,
      old_value: {
        [updateField]: removedPlayerId,
        rank: currentRank,
        removed_player: (removedPlayer as any)?.name,
      },
      new_value: {
        [updateField]: newPlayerId,
        rank: newRank,
        new_player: newPlayer.name,
        drop_positions: newRank - currentRank,
      },
      created_at: now.toISOString(),
    })

    // ── Notifications ────────────────────────────────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const removedPlayerObj = playerPosition === 'player1' ? team.player1 : team.player2
    const removedPlayerName = (removedPlayerObj as any)?.name ?? 'the previous player'
    const droppedBy = newRank - currentRank

    // Notify the REMAINING player (still on the team)
    await adminClient.from('notifications').insert({
      player_id: remainingPlayerId,
      team_id: params.id,
      type: 'partner_changed',
      title: '🔄 Partner change on your team',
      message: `${removedPlayerName} has been replaced by ${newPlayer.name} on ${team.name}. The team dropped ${droppedBy} position${droppedBy !== 1 ? 's' : ''} to rank #${newRank}.`,
      action_url: `${appUrl}/dashboard`,
    })

    // Notify the NEW player joining the team
    await adminClient.from('notifications').insert({
      player_id: newPlayerId,
      team_id: params.id,
      type: 'partner_changed',
      title: '👋 You joined a team',
      message: `You have been added to ${team.name} (rank #${newRank}). Welcome to the team!`,
      action_url: `${appUrl}/dashboard`,
    })

    // Notify the REMOVED player
    await adminClient.from('notifications').insert({
      player_id: removedPlayerId,
      team_id: params.id,
      type: 'partner_changed',
      title: '📋 Removed from team',
      message: `You have been removed from ${team.name} by the admin.`,
      action_url: `${appUrl}/challenges`,
    })

    return NextResponse.json({
      success: true,
      removedPlayer: (removedPlayer as any)?.name,
      newPlayer: newPlayer.name,
      previousRank: currentRank,
      newRank,
      droppedBy: newRank - currentRank,
    })
  } catch (err) {
    console.error('Partner change error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
