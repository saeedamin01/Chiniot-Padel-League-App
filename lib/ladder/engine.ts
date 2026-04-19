import { createAdminClient } from '@/lib/supabase/admin'
import { LeagueSettings, TicketType } from '@/types'
import { createNotification, notifyAdmins } from '@/lib/notifications/service'

export async function getActiveSeason() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('seasons')
    .select('*, league_settings(*), tiers(*)')
    .eq('is_active', true)
    .single()
  return data
}

export async function getLadderWithTiers(seasonId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('ladder_positions')
    .select(`
      *,
      team:teams!team_id(
        *,
        player1:players!player1_id(*),
        player2:players!player2_id(*)
      ),
      tier:tiers!tier_id(*)
    `)
    .eq('season_id', seasonId)
    .order('rank', { ascending: true })
  return data || []
}

export async function getTeamActiveChallenge(teamId: string, seasonId: string) {
  const supabase = createAdminClient()

  const { data: outgoing } = await supabase
    .from('challenges')
    .select('*, challenging_team:teams!challenging_team_id(*), challenged_team:teams!challenged_team_id(*)')
    .eq('challenging_team_id', teamId)
    .eq('season_id', seasonId)
    .in('status', ['pending', 'accepted', 'accepted_open', 'time_pending_confirm', 'reschedule_requested', 'reschedule_pending_admin', 'revision_proposed', 'scheduled'])
    .maybeSingle()

  const { data: incoming } = await supabase
    .from('challenges')
    .select('*, challenging_team:teams!challenging_team_id(*), challenged_team:teams!challenged_team_id(*)')
    .eq('challenged_team_id', teamId)
    .eq('season_id', seasonId)
    .in('status', ['pending', 'accepted', 'accepted_open', 'time_pending_confirm', 'reschedule_requested', 'reschedule_pending_admin', 'revision_proposed', 'scheduled'])
    .maybeSingle()

  return { outgoing, incoming }
}

// ─── Active Rank Helpers ──────────────────────────────────────────────────────
// "Active rank" = position in the ladder counting only non-frozen teams.
// Frozen teams are invisible to challenge eligibility calculations.

type RankRow = { rank: number; status: string }

function getActiveRank(teamRank: number, allPositions: RankRow[]): number {
  // Count non-frozen teams at or above this rank (lower rank number = higher position)
  return allPositions.filter(p => p.status !== 'frozen' && p.rank <= teamRank).length
}

// ─── getTeamActiveTickets ─────────────────────────────────────────────────────
// Returns all active tickets for a team this season, sorted by type.

export async function getTeamActiveTickets(teamId: string, seasonId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('tickets')
    .select('*')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .eq('status', 'active')
  return data || []
}

// ─── validateTicketChallenge ──────────────────────────────────────────────────
// Checks whether a team can use a specific ticket type to challenge a target.
// Returns the ticket record if valid.

export async function validateTicketChallenge(
  ticketType: TicketType,
  challengingTeamId: string,
  challengedTeamId: string,
  seasonId: string
): Promise<{ allowed: boolean; ticket?: any; reason?: string }> {
  const supabase = createAdminClient()

  // Fetch the challenger's active ticket of this type
  const { data: tickets } = await supabase
    .from('tickets')
    .select('*')
    .eq('team_id', challengingTeamId)
    .eq('season_id', seasonId)
    .eq('ticket_type', ticketType)
    .eq('status', 'active')

  if (!tickets || tickets.length === 0) {
    return { allowed: false, reason: `You do not have an active ${ticketType} ticket` }
  }

  const ticket = tickets[0]

  // Silver/Gold dependency: if using gold, silver must already be won (used)
  if (ticketType === 'gold') {
    const { data: silverTickets } = await supabase
      .from('tickets')
      .select('status')
      .eq('team_id', challengingTeamId)
      .eq('season_id', seasonId)
      .eq('ticket_type', 'silver')

    const silverActive = silverTickets?.some(t => t.status === 'active')
    if (silverActive) {
      return {
        allowed: false,
        reason: 'You must win your Silver ticket match before using your Gold ticket'
      }
    }
  }

  // Fetch both teams' ladder positions (including tier info)
  const { data: challengerLadder } = await supabase
    .from('ladder_positions')
    .select('rank, status, tier_id, tier:tiers!tier_id(id, name)')
    .eq('team_id', challengingTeamId)
    .eq('season_id', seasonId)
    .single()

  const { data: challengedLadder } = await supabase
    .from('ladder_positions')
    .select('rank, status, tier_id, tier:tiers!tier_id(id, name)')
    .eq('team_id', challengedTeamId)
    .eq('season_id', seasonId)
    .single()

  if (!challengerLadder || !challengedLadder) {
    return { allowed: false, reason: 'Team not found in ladder' }
  }

  // Cannot challenge a frozen team
  if (challengedLadder.status === 'frozen') {
    return { allowed: false, reason: 'That team is currently frozen and cannot be challenged' }
  }

  // Challenger must still be below (higher rank number) the challenged team
  if (challengerLadder.rank <= challengedLadder.rank) {
    return { allowed: false, reason: 'Ticket challenges must still be directed upward' }
  }

  // Validate the challenged team is in the correct tier for this ticket type
  const challengedTierName = (challengedLadder.tier as any)?.name as string | undefined

  if (ticketType === 'tier') {
    // Must be in same tier as challenger
    const challengerTierName = (challengerLadder.tier as any)?.name as string | undefined
    if (challengedTierName !== challengerTierName) {
      return {
        allowed: false,
        reason: `Tier ticket can only be used to challenge teams in your own tier (${challengerTierName})`
      }
    }
  } else if (ticketType === 'silver') {
    if (challengedTierName?.toLowerCase() !== 'silver') {
      return { allowed: false, reason: 'Silver ticket can only be used to challenge Silver tier teams' }
    }
  } else if (ticketType === 'gold') {
    if (challengedTierName?.toLowerCase() !== 'gold') {
      return { allowed: false, reason: 'Gold ticket can only be used to challenge Gold tier teams' }
    }
  }

  return { allowed: true, ticket }
}

// ─── canChallenge ─────────────────────────────────────────────────────────────
//
// ticketType: if set, ticket rules replace distance rules for this challenge.

export async function canChallenge(
  challengingTeamId: string,
  challengedTeamId: string,
  seasonId: string,
  settings: LeagueSettings,
  ticketType?: TicketType | null
): Promise<{ allowed: boolean; ticket?: any; reason?: string }> {
  const supabase = createAdminClient()

  // Get both teams' positions
  const { data: positions } = await supabase
    .from('ladder_positions')
    .select('*, team:teams!team_id(*)')
    .eq('season_id', seasonId)
    .in('team_id', [challengingTeamId, challengedTeamId])

  const challengerPos = positions?.find(p => p.team_id === challengingTeamId)
  const challengedPos = positions?.find(p => p.team_id === challengedTeamId)

  if (!challengerPos || !challengedPos) {
    return { allowed: false, reason: 'Team not found in ladder' }
  }

  // Challenger cannot be frozen
  if (challengerPos.status === 'frozen') {
    return { allowed: false, reason: 'Your team is frozen and cannot send challenges' }
  }

  // ── Active challenges check (applies whether ticket or not) ────────────────
  const { outgoing } = await getTeamActiveChallenge(challengingTeamId, seasonId)
  if (outgoing) {
    return { allowed: false, reason: 'You already have an active outgoing challenge' }
  }

  // Challenged team can be challenged as long as they haven't already ACCEPTED an incoming challenge.
  // Rule: a team can receive multiple pending challenges simultaneously — accepting one dissolves the others.
  // Rule: a team's own outgoing challenge (to someone above them) does NOT prevent them being challenged from below.
  const { incoming: targetIn } = await getTeamActiveChallenge(challengedTeamId, seasonId)
  const acceptedIncomingStatuses = ['accepted', 'accepted_open', 'time_pending_confirm', 'reschedule_requested', 'reschedule_pending_admin', 'revision_proposed', 'scheduled']
  if (targetIn && acceptedIncomingStatuses.includes(targetIn.status)) {
    return { allowed: false, reason: 'That team has already accepted a challenge and cannot receive another right now' }
  }

  // ── Player overlap (shared player between teams) ───────────────────────────
  const challengerTeam = challengerPos.team
  const challengedTeam = challengedPos.team
  if (
    challengerTeam?.player1_id === challengedTeam?.player1_id ||
    challengerTeam?.player1_id === challengedTeam?.player2_id ||
    challengerTeam?.player2_id === challengedTeam?.player1_id ||
    challengerTeam?.player2_id === challengedTeam?.player2_id
  ) {
    return { allowed: false, reason: 'A player cannot challenge their own other team' }
  }

  // ── TICKET CHALLENGE PATH ──────────────────────────────────────────────────
  if (ticketType) {
    const result = await validateTicketChallenge(
      ticketType, challengingTeamId, challengedTeamId, seasonId
    )
    return result
  }

  // ── NORMAL CHALLENGE PATH ──────────────────────────────────────────────────

  // Challenger must be below (higher rank number) the challenged team
  if (challengerPos.rank <= challengedPos.rank) {
    return { allowed: false, reason: 'Can only challenge teams above you' }
  }

  // Challenged team cannot be frozen
  if (challengedPos.status === 'frozen') {
    return { allowed: false, reason: 'That team is currently frozen and cannot be challenged' }
  }

  // ── Active rank difference (frozen teams skipped) ──────────────────────────
  const { data: allPositions } = await supabase
    .from('ladder_positions')
    .select('rank, status')
    .eq('season_id', seasonId)

  const rows: RankRow[] = allPositions || []

  const challengerActiveRank = getActiveRank(challengerPos.rank, rows)
  const challengedActiveRank = getActiveRank(challengedPos.rank, rows)
  const activeRankDiff = challengerActiveRank - challengedActiveRank

  if (activeRankDiff <= 0) {
    return { allowed: false, reason: 'Can only challenge teams above you' }
  }

  if (activeRankDiff > settings.challenge_positions_above) {
    return {
      allowed: false,
      reason: `Can only challenge up to ${settings.challenge_positions_above} active positions above you (frozen teams don't count)`
    }
  }

  // ── Same team restriction ──────────────────────────────────────────────────
  // Exempt: Diamond tier (all) + top 2 positions of Platinum tier
  if (challengerPos.last_challenged_team_id === challengedTeamId) {
    const { data: tier } = await supabase
      .from('tiers')
      .select('name, min_rank')
      .eq('id', challengerPos.tier_id)
      .single()

    const isDiamond        = tier?.name === 'Diamond'
    const isTopTwoPlatinum = tier?.name === 'Platinum' &&
                             challengerPos.rank <= (tier.min_rank + 1)

    if (!isDiamond && !isTopTwoPlatinum) {
      return { allowed: false, reason: 'You cannot challenge the same team twice in a row' }
    }
  }

  return { allowed: true }
}

// ─── Rank Shift Helper ────────────────────────────────────────────────────────
// Shifts non-frozen teams in a rank range by +1 or -1.
// Frozen teams in that range are completely untouched.
// shiftActiveTeams — moves non-frozen teams in [fromRank, toRank] by `direction` (±1).
//
// Frozen teams are IMMOVABLE LANDMARKS: active teams "flow around" them.
// If an active team's natural destination rank is occupied by a frozen team,
// it keeps moving in the shift direction until it finds a free non-frozen slot.
//
// Two-phase approach (park → place) avoids all UNIQUE(season_id, rank) conflicts.

async function shiftActiveTeams(
  supabase: ReturnType<typeof createAdminClient>,
  seasonId: string,
  fromRank: number,    // inclusive lower bound
  toRank: number,      // inclusive upper bound
  direction: 1 | -1,  // +1 = shift down (higher rank number), -1 = shift up
  challengeId: string | null,
  changeType: string,
  notes: string
) {
  // Fetch a wider window so we can see frozen teams that active teams might skip over
  const fetchFrom = direction === 1 ? fromRank : Math.max(1, fromRank - 20)
  const fetchTo   = direction === 1 ? toRank + 20 : toRank

  const { data: rangePositions } = await supabase
    .from('ladder_positions')
    .select('id, rank, team_id, status')
    .eq('season_id', seasonId)
    .gte('rank', fetchFrom)
    .lte('rank', fetchTo)

  // Frozen ranks are immovable — active teams skip over them
  const frozenRanks = new Set(
    (rangePositions || []).filter(p => p.status === 'frozen').map(p => p.rank)
  )

  // Only shift active teams that fall within the original range
  const toShift = (rangePositions || []).filter(
    p => p.status !== 'frozen' && p.rank >= fromRank && p.rank <= toRank
  )
  if (toShift.length === 0) return

  // Process from the far end of movement first to avoid stepping on neighbours
  const sorted = direction === 1
    ? toShift.sort((a, b) => b.rank - a.rank) // highest first for shift-down
    : toShift.sort((a, b) => a.rank - b.rank) // lowest first for shift-up

  // Load tiers for tier_id sync
  const { data: tiers } = await supabase
    .from('tiers').select('id, min_rank, max_rank').eq('season_id', seasonId)

  // Phase 1 — park all shifting teams at unique negative temp ranks
  // (vacates their slots so the new ranks are free to assign)
  for (const u of sorted) {
    await supabase.from('ladder_positions')
      .update({ rank: -(u.rank) })
      .eq('id', u.id)
  }

  // Phase 2 — assign final ranks, skipping any frozen positions
  for (const u of sorted) {
    let newRank = u.rank + direction
    // Skip past frozen teams in the movement direction
    while (frozenRanks.has(newRank)) newRank += direction

    const newTierId = tiers?.find(
      t => newRank >= t.min_rank && newRank <= (t.max_rank ?? t.min_rank)
    )?.id

    await supabase.from('ladder_positions')
      .update({ rank: newRank, ...(newTierId ? { tier_id: newTierId } : {}) })
      .eq('id', u.id)

    await supabase.from('ladder_history').insert({
      season_id: seasonId,
      team_id: u.team_id,
      old_rank: u.rank,
      new_rank: newRank,
      change_type: changeType,
      ...(challengeId ? { related_challenge_id: challengeId } : {}),
      notes,
    })
  }
}

// ─── processMatchResult ───────────────────────────────────────────────────────

export async function processMatchResult(
  challengeId: string,
  winnerTeamId: string,
  loserTeamId: string
) {
  const supabase = createAdminClient()

  const { data: challenge } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', challengeId)
    .single()

  if (!challenge) return { success: false, error: 'Challenge not found' }

  const seasonId = challenge.season_id

  const { data: positions } = await supabase
    .from('ladder_positions')
    .select('*')
    .eq('season_id', seasonId)
    .in('team_id', [challenge.challenging_team_id, challenge.challenged_team_id])

  const challengerPos = positions?.find(p => p.team_id === challenge.challenging_team_id)
  const challengedPos = positions?.find(p => p.team_id === challenge.challenged_team_id)

  if (!challengerPos || !challengedPos) return { success: false, error: 'Positions not found' }

  // Capture each team's previous last_challenged before we overwrite them.
  const challengerRank = challengerPos.rank
  const challengedRank = challengedPos.rank

  // ── Clear stale restrictions first ────────────────────────────────────────
  // Both teams are playing — lift any existing restrictions that pointed to
  // either of them. Runs before setting new restrictions so it doesn't
  // accidentally clear the one we're about to write.
  await supabase
    .from('ladder_positions')
    .update({ last_challenged_team_id: null })
    .eq('season_id', seasonId)
    .in('last_challenged_team_id', [challenge.challenging_team_id, challenge.challenged_team_id])

  if (winnerTeamId === challenge.challenging_team_id) {
    // ── Challenger wins ──────────────────────────────────────────────────────
    //
    // Example: Ladder is 1, 2, 3, 4, 5 — Team 5 challenges Team 2, Team 5 wins.
    // Expected result: 1, 5, 2, 3, 4.
    //
    // Problem: ladder_positions has UNIQUE(season_id, rank).
    // If we shift [2..4] down first, Team 4 tries to move to rank 5 while Team 5
    // is still there → UNIQUE constraint violation → update silently fails.
    //
    // Fix (3-step):
    //   1. Park challenger at rank 0 (safe placeholder, no real team is ever rank 0).
    //   2. Shift [challengedRank, challengerRank-1] down by 1 — rank 5 is now free.
    //   3. Place challenger at challengedRank.

    // Step 1 — park challenger at rank 0 to vacate its current rank
    await supabase
      .from('ladder_positions')
      .update({ rank: 0 })
      .eq('team_id', challenge.challenging_team_id)
      .eq('season_id', seasonId)

    // Step 2 — shift every non-frozen team between the two positions down by 1
    // (includes the challenged team itself, which also drops one spot)
    if (challengedRank < challengerRank) {
      await shiftActiveTeams(
        supabase, seasonId,
        challengedRank,       // e.g. rank 2 (challenged)
        challengerRank - 1,   // e.g. rank 4 (one above challenger's old rank)
        1,                    // shift down (+1)
        challengeId,
        'challenge_loss',
        'Shifted down — challenger won'
      )
    }

    // Step 3 — place challenger at the challenged team's old rank (no rematch restriction:
    // the beaten team may challenge back immediately to reclaim their position)
    await supabase
      .from('ladder_positions')
      .update({ rank: challengedRank })
      .eq('team_id', challenge.challenging_team_id)
      .eq('season_id', seasonId)

    await supabase.from('ladder_history').insert({
      season_id: seasonId,
      team_id: challenge.challenging_team_id,
      old_rank: challengerRank,
      new_rank: challengedRank,
      change_type: 'challenge_win',
      related_challenge_id: challengeId,
    })

    await updateTeamTier(challenge.challenging_team_id, seasonId)

  } else {
    // ── Challenged team wins — no movement ──────────────────────────────────
    // Only restrict the CHALLENGER (loser): they cannot challenge the same team
    // again until either team plays a different match.
    await supabase
      .from('ladder_positions')
      .update({ last_challenged_team_id: challenge.challenged_team_id })
      .eq('team_id', challenge.challenging_team_id)
      .eq('season_id', seasonId)
  }

  // ── Ticket resolution ─────────────────────────────────────────────────────
  // If this challenge was a ticket challenge, resolve the ticket status.
  if (challenge.ticket_id) {
    const now = new Date().toISOString()
    const challengerWon = winnerTeamId === challenge.challenging_team_id

    if (challengerWon) {
      // Ticket is consumed — mark as used
      await supabase
        .from('tickets')
        .update({ status: 'used', is_used: true, used_at: now })
        .eq('id', challenge.ticket_id)
    } else {
      // Challenger lost — ticket is forfeited
      const { data: usedTicket } = await supabase
        .from('tickets')
        .select('ticket_type')
        .eq('id', challenge.ticket_id)
        .single()

      await supabase
        .from('tickets')
        .update({ status: 'forfeited', forfeited_at: now })
        .eq('id', challenge.ticket_id)

      // Silver/Gold cascade: if the lost ticket was silver, also forfeit gold
      if (usedTicket?.ticket_type === 'silver') {
        await supabase
          .from('tickets')
          .update({ status: 'forfeited', forfeited_at: now })
          .eq('team_id', challenge.challenging_team_id)
          .eq('season_id', seasonId)
          .eq('ticket_type', 'gold')
          .eq('status', 'active')
      }
    }
  }

  // ── Ladder movement notifications ────────────────────────────────────────────
  // Only fire when the challenger won (rank changes happened).
  if (winnerTeamId === challenge.challenging_team_id) {
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, player1_id, player2_id')
      .in('id', [challenge.challenging_team_id, challenge.challenged_team_id])

    const challengerTeam = teams?.find(t => t.id === challenge.challenging_team_id)
    const challengedTeam = teams?.find(t => t.id === challenge.challenged_team_id)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Winner (challenger) moved up
    if (challengerTeam) {
      for (const pid of [challengerTeam.player1_id, challengerTeam.player2_id]) {
        if (!pid) continue
        await createNotification({
          playerId: pid,
          teamId: challengerTeam.id,
          type: 'ladder_movement',
          title: '🏆 You climbed the ladder!',
          message: `${challengerTeam.name} beat ${challengedTeam?.name ?? 'the opposing team'} and moved up to rank #${challengedRank}!`,
          actionUrl: `${appUrl}/ladder`,
        })
      }
    }

    // Loser (challenged) dropped — their new rank is challengedRank + 1 after the shift
    if (challengedTeam) {
      const loserNewRank = challengedRank + 1
      for (const pid of [challengedTeam.player1_id, challengedTeam.player2_id]) {
        if (!pid) continue
        await createNotification({
          playerId: pid,
          teamId: challengedTeam.id,
          type: 'ladder_movement',
          title: '📉 Ladder position changed',
          message: `${challengerTeam?.name ?? 'The opposing team'} beat ${challengedTeam.name} and took rank #${challengedRank}. You are now at rank #${loserNewRank}.`,
          actionUrl: `${appUrl}/ladder`,
        })
      }
    }
  }

  return { success: true }
}

// ─── processForfeit ───────────────────────────────────────────────────────────

export async function processForfeit(challengeId: string, forfeitingTeamId: string) {
  const supabase = createAdminClient()

  const { data: challenge } = await supabase
    .from('challenges').select('*').eq('id', challengeId).single()
  if (!challenge) return { success: false, error: 'Challenge not found' }

  const { data: settings } = await supabase
    .from('league_settings').select('*').eq('season_id', challenge.season_id).single()
  if (!settings) return { success: false, error: 'Settings not found' }

  const seasonId = challenge.season_id
  const winnerTeamId = forfeitingTeamId === challenge.challenging_team_id
    ? challenge.challenged_team_id
    : challenge.challenging_team_id

  const { data: positions } = await supabase
    .from('ladder_positions').select('*').eq('season_id', seasonId)
    .in('team_id', [forfeitingTeamId, winnerTeamId])

  const forfeitPos = positions?.find(p => p.team_id === forfeitingTeamId)
  const winnerPos  = positions?.find(p => p.team_id === winnerTeamId)
  if (!forfeitPos || !winnerPos) return { success: false, error: 'Positions not found' }

  // Capture previous last_challenged values for OR-clearing at the end
  const forfeitOldLastChallenged = forfeitPos.last_challenged_team_id as string | null
  const winnerOldLastChallenged  = winnerPos.last_challenged_team_id  as string | null

  const { count: totalTeams } = await supabase
    .from('ladder_positions').select('id', { count: 'exact' }).eq('season_id', seasonId)
  const total = totalTeams || 100

  if (winnerRankIsBelow(winnerPos.rank, forfeitPos.rank)) {
    // ── Challenger forfeited — winner (challenged) was above, forfeiter was below ──
    // Winner stays where it is. Forfeiter drops forfeit_drop_positions spots.
    // Teams between [forfeitRank+1, newForfeitRank] shift up by 1 to close the gap.
    //
    // UNIQUE fix: park the forfeiter at rank 0 before shifting, so teams shifting
    // up into its old rank don't hit a UNIQUE conflict.
    const newForfeitRank = Math.min(forfeitPos.rank + settings.forfeit_drop_positions, total)

    // Park forfeiter at rank 0
    await supabase.from('ladder_positions')
      .update({ rank: 0 })
      .eq('team_id', forfeitingTeamId).eq('season_id', seasonId)

    // Shift teams between old forfeit rank+1 and new forfeit rank up by 1
    if (forfeitPos.rank + 1 <= newForfeitRank) {
      await shiftActiveTeams(
        supabase, seasonId,
        forfeitPos.rank + 1,
        newForfeitRank,
        -1,
        challengeId, 'forfeit', 'Shifted up — challenger forfeited'
      )
    }

    // Place forfeiter at the penalty rank
    await supabase.from('ladder_positions')
      .update({ rank: newForfeitRank, consecutive_forfeits: forfeitPos.consecutive_forfeits + 1 })
      .eq('team_id', forfeitingTeamId).eq('season_id', seasonId)

  } else {
    // ── Challenged forfeited — winner (challenger) was below, forfeiter was above ──
    // Winner earns the forfeiter's old rank (same movement as a normal win).
    // Forfeiter additionally drops forfeit_drop_positions spots from the winner's old rank.
    //
    // UNIQUE fix: park the winner at rank 0 before shifting, so Team at
    // (winnerPos.rank - 1) can shift into winnerPos.rank without conflict.
    const newForfeitRank = Math.min(winnerPos.rank + settings.forfeit_drop_positions, total)

    // Park winner at rank 0
    await supabase.from('ladder_positions')
      .update({ rank: 0 })
      .eq('team_id', winnerTeamId).eq('season_id', seasonId)

    // Shift teams between the two positions down by 1
    if (forfeitPos.rank < winnerPos.rank) {
      await shiftActiveTeams(
        supabase, seasonId,
        forfeitPos.rank,
        winnerPos.rank - 1,
        1,
        challengeId, 'forfeit', 'Shifted down — challenged team forfeited'
      )
    }

    // Place winner at the forfeiter's old rank
    await supabase.from('ladder_positions')
      .update({ rank: forfeitPos.rank })
      .eq('team_id', winnerTeamId).eq('season_id', seasonId)

    // Place forfeiter at penalty rank
    await supabase.from('ladder_positions')
      .update({ rank: newForfeitRank, consecutive_forfeits: forfeitPos.consecutive_forfeits + 1 })
      .eq('team_id', forfeitingTeamId).eq('season_id', seasonId)
  }

  // Check consecutive forfeits limit
  const newConsec = forfeitPos.consecutive_forfeits + 1
  if (newConsec >= settings.consecutive_forfeit_limit) {
    await supabase.from('ladder_positions')
      .update({ rank: total, consecutive_forfeits: 0 })
      .eq('team_id', forfeitingTeamId).eq('season_id', seasonId)

    // Notify admins: team hit the forfeit limit and was dropped to the bottom
    const { data: forfeitingTeam } = await supabase
      .from('teams').select('name').eq('id', forfeitingTeamId).single()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await notifyAdmins({
      type: 'consecutive_forfeit_limit',
      title: '⚠️ Forfeit limit reached',
      message: `${forfeitingTeam?.name ?? 'A team'} has reached the consecutive forfeit limit (${settings.consecutive_forfeit_limit}) and has been moved to the bottom of the ladder. Consider dissolving the team.`,
      actionUrl: `${appUrl}/admin/teams`,
    })
  }

  await updateTeamTier(winnerTeamId, seasonId)
  await updateTeamTier(forfeitingTeamId, seasonId)

  // ── Shared OR back-to-back clearing (forfeit) ─────────────────────────────
  if (forfeitOldLastChallenged && forfeitOldLastChallenged !== winnerTeamId) {
    await supabase
      .from('ladder_positions')
      .update({ last_challenged_team_id: null })
      .eq('team_id', forfeitOldLastChallenged)
      .eq('season_id', seasonId)
      .eq('last_challenged_team_id', forfeitingTeamId)
  }

  if (winnerOldLastChallenged && winnerOldLastChallenged !== forfeitingTeamId) {
    await supabase
      .from('ladder_positions')
      .update({ last_challenged_team_id: null })
      .eq('team_id', winnerOldLastChallenged)
      .eq('season_id', seasonId)
      .eq('last_challenged_team_id', winnerTeamId)
  }

  return { success: true }
}

function winnerRankIsBelow(winnerRank: number, forfeitRank: number) {
  return winnerRank < forfeitRank // lower rank number = higher position
}

// ─── updateTeamTier ───────────────────────────────────────────────────────────

export async function updateTeamTier(teamId: string, seasonId: string) {
  const supabase = createAdminClient()

  const { data: position } = await supabase
    .from('ladder_positions')
    .select('rank')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .single()

  if (!position) return

  const { data: tier } = await supabase
    .from('tiers')
    .select('id')
    .eq('season_id', seasonId)
    .lte('min_rank', position.rank)
    .or(`max_rank.is.null,max_rank.gte.${position.rank}`)
    .order('rank_order', { ascending: true })
    .limit(1)
    .single()

  if (tier) {
    await supabase
      .from('ladder_positions')
      .update({ tier_id: tier.id })
      .eq('team_id', teamId)
      .eq('season_id', seasonId)
  }
}
