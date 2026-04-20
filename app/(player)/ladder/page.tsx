'use client'

import React, { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Search, Trophy, Zap, Users, Snowflake,
  Calendar, Clock, CheckCircle, AlertCircle, ChevronRight,
  TrendingUp, TrendingDown, Flame, Ticket as TicketIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Tier } from '@/types'
import { useTeam } from '@/context/TeamContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamInfo {
  id: string
  name: string
  player1?: { id: string; name: string }
  player2?: { id: string; name: string }
}

interface TeamChallengeInfo {
  type: 'sent' | 'received'
  status: 'pending' | 'accepted' | 'scheduled' | 'result_pending'
  opponentName: string
  opponentRank: number | null
  challengeId: string
}

interface TeamStats {
  wins: number
  losses: number
  played: number
  // last N results, index 0 = most recent
  recentForm: ('W' | 'L')[]
  // net rank positions gained this season (wins as challenger - losses as challenged)
  rankGained: number
  // current consecutive win streak
  winStreak: number
}

interface ActiveTicket {
  id: string
  ticket_type: string
}

interface PositionRow {
  rank: number
  status: 'active' | 'frozen' | 'vacant'
  team: TeamInfo | null
  tier: Tier | null
  team_id: string | null
  isMyTeam: boolean
  canChallenge: boolean
  requiresTicket: boolean      // true when only a ticket makes this challenge possible
  ticketType: string | null    // which ticket type enables it
  challengeInfo: TeamChallengeInfo | null
  stats: TeamStats | null
  tickets: ActiveTicket[]
}

interface TierSection {
  tier: Tier
  positions: PositionRow[]
}

// ─── Challenge pill ───────────────────────────────────────────────────────────
// Direction is ALWAYS shown — even for scheduled/accepted states.
// Sent   = this team challenged UP (they are lower on the ladder)
// Received = this team is being challenged FROM BELOW (they hold the higher rank)

function ChallengePill({ info }: { info: TeamChallengeInfo }) {
  if (info.status === 'result_pending') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 border border-green-500/25 whitespace-nowrap">
        <CheckCircle className="h-3 w-3" />
        Result Pending
      </span>
    )
  }

  if (info.type === 'sent') {
    const label =
      info.status === 'scheduled' ? '↑ Match Scheduled' :
      info.status === 'accepted'  ? '↑ Awaiting Confirm' :
      'Challenging Up ↑'
    const icon =
      info.status === 'scheduled' ? <Calendar className="h-3 w-3" /> :
      info.status === 'accepted'  ? <Clock className="h-3 w-3" /> :
      <Zap className="h-3 w-3" />
    const colors =
      info.status === 'scheduled' ? 'bg-blue-500/15 text-blue-600 border-blue-500/25' :
      info.status === 'accepted'  ? 'bg-orange-500/15 text-orange-600 border-orange-500/25' :
      'bg-yellow-400/15 text-yellow-700 border-yellow-400/30 dark:text-yellow-400'
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${colors}`}>
        {icon}{label}
      </span>
    )
  }

  // received = higher-ranked team being challenged FROM BELOW
  const label =
    info.status === 'scheduled' ? '↓ Match Scheduled' :
    info.status === 'accepted'  ? '↓ Time Confirmed' :
    'Challenged from Below ↓'
  const icon =
    info.status === 'scheduled' ? <Calendar className="h-3 w-3" /> :
    info.status === 'accepted'  ? <Clock className="h-3 w-3" /> :
    <AlertCircle className="h-3 w-3" />
  const colors =
    info.status === 'scheduled' ? 'bg-purple-500/15 text-purple-600 border-purple-500/25' :
    info.status === 'accepted'  ? 'bg-orange-500/15 text-orange-600 border-orange-500/25' :
    'bg-purple-500/15 text-purple-600 border-purple-500/25 dark:text-purple-400'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${colors}`}>
      {icon}{label}
    </span>
  )
}

// ─── Opponent context line ────────────────────────────────────────────────────
// Shows: "vs Echo Warriors · #2 above" or "vs Delta Force · #5 below"
// This is the second line shown under the badge — always rendered when there's
// an active challenge with a known opponent.

function ChallengeOpponentLine({ info }: { info: TeamChallengeInfo }) {
  if (info.status === 'result_pending' || !info.opponentName) return null

  const rankLabel = info.opponentRank != null ? `#${info.opponentRank}` : null
  const dirLabel  = info.type === 'sent' ? 'above' : 'below'
  const dirColor  = info.type === 'sent' ? 'text-yellow-600 dark:text-yellow-500' : 'text-purple-600 dark:text-purple-400'

  return (
    <p className="text-xs text-slate-500 leading-snug">
      vs{' '}
      <span className="font-semibold text-slate-400">{info.opponentName}</span>
      {rankLabel && (
        <>
          {' '}
          <span className={`font-semibold ${dirColor}`}>
            {rankLabel} {dirLabel}
          </span>
        </>
      )}
    </p>
  )
}

// ─── Stats strip ──────────────────────────────────────────────────────────────

function StatsStrip({ stats }: { stats: TeamStats }) {
  if (stats.played === 0) {
    return <span className="text-[11px] text-slate-500 italic">No matches yet</span>
  }

  const winPct = Math.round((stats.wins / stats.played) * 100)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* W-L record */}
      <span className="text-[11px] font-semibold tabular-nums">
        <span className="text-emerald-500">{stats.wins}W</span>
        <span className="text-slate-400 mx-0.5">·</span>
        <span className="text-red-500">{stats.losses}L</span>
      </span>

      {/* Win percentage */}
      <span className="text-[11px] text-slate-500 tabular-nums">{winPct}%</span>

      {/* Recent form dots — last 5, most recent on right */}
      {stats.recentForm.length > 0 && (
        <div className="flex items-center gap-0.5">
          {[...stats.recentForm].reverse().slice(0, 5).reverse().map((r, i) => (
            <span
              key={i}
              title={r === 'W' ? 'Win' : 'Loss'}
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                r === 'W' ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
          ))}
        </div>
      )}

      {/* Streak badge */}
      {stats.winStreak >= 3 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-500 border border-orange-500/20">
          <Flame className="h-2.5 w-2.5" />{stats.winStreak}
        </span>
      )}

      {/* Net rank trend */}
      {stats.rankGained !== 0 && (
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${
          stats.rankGained > 0 ? 'text-emerald-500' : 'text-red-500'
        }`}>
          {stats.rankGained > 0
            ? <TrendingUp className="h-3 w-3" />
            : <TrendingDown className="h-3 w-3" />
          }
          {Math.abs(stats.rankGained)}
        </span>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LadderPage() {
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [tierSections, setTierSections] = useState<TierSection[]>([])
  const supabase = createClient()
  const { activeTeam } = useTeam()

  useEffect(() => {
    const fetchLadder = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { toast.error('Authentication required'); return }

        const { data: season } = await supabase
          .from('seasons').select('id').eq('is_active', true).single()
        if (!season) { toast.error('No active season found'); setLoading(false); return }

        // ── Parallel: settings, tiers, ladder positions, tickets ──
        const [settingsRes, tiersRes, positionsRes, ticketsRes] = await Promise.all([
          supabase.from('league_settings')
            .select('challenge_positions_above')
            .eq('season_id', season.id).single(),
          supabase.from('tiers')
            .select('*').eq('season_id', season.id)
            .order('rank_order', { ascending: true }),
          supabase.from('ladder_positions')
            .select(`*, team:teams!team_id(*, player1:players!player1_id(id,name), player2:players!player2_id(id,name)), tier:tiers!tier_id(*)`)
            .eq('season_id', season.id)
            .order('rank', { ascending: true }),
          supabase.from('tickets')
            .select('id, team_id, ticket_type')
            .eq('season_id', season.id)
            .eq('status', 'active'),
        ])

        const maxPositionsAbove = settingsRes.data?.challenge_positions_above ?? 3
        const tiers: Tier[] = tiersRes.data || []
        // Only the currently selected team is "my team" — drives highlighting + challenge eligibility
        const userTeamIdSet = new Set(activeTeam ? [activeTeam.id] : [])
        const allPositions: any[] = positionsRes.data || []
        const allTeamIds = allPositions.map(p => p.team_id).filter(Boolean) as string[]

        // Name + rank lookup from ladder data
        const teamNameMap = new Map<string, string>()
        const teamRankMap = new Map<string, number>()
        allPositions.forEach(p => {
          if (p.team_id && p.team?.name) teamNameMap.set(p.team_id, p.team.name)
          if (p.team_id && p.rank)       teamRankMap.set(p.team_id, p.rank)
        })

        // ── Fetch match results + active challenges in parallel ───────────────
        const [resultsRes, activeChalRes, unverifiedRes] = await Promise.all([
          // All match results this season (newest first) — for stats
          allTeamIds.length > 0
            ? supabase
                .from('match_results')
                .select('id, winner_team_id, loser_team_id, created_at, challenge:challenges!challenge_id(challenging_team_id, challenged_team_id)')
                .eq('season_id', season.id)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] }),

          // Active challenges for badge display
          allTeamIds.length > 0
            ? supabase
                .from('challenges')
                .select('id, challenging_team_id, challenged_team_id, status')
                .in('status', ['pending', 'accepted', 'accepted_open', 'time_pending_confirm', 'reschedule_requested', 'reschedule_pending_admin', 'scheduled'])
                .or(allTeamIds.map(id => `challenging_team_id.eq.${id},challenged_team_id.eq.${id}`).join(','))
            : Promise.resolve({ data: [] }),

          // Unverified results — contributes to "busy" state
          supabase
            .from('match_results')
            .select('id, challenge:challenges!challenge_id(id, challenging_team_id, challenged_team_id)')
            .eq('season_id', season.id)
            .is('verified_at', null),
        ])

        // ── Build stats map ──────────────────────────────────────────────────
        const statsMap = new Map<string, TeamStats>()

        const getOrCreate = (teamId: string): TeamStats => {
          if (!statsMap.has(teamId)) {
            statsMap.set(teamId, { wins: 0, losses: 0, played: 0, recentForm: [], rankGained: 0, winStreak: 0 })
          }
          return statsMap.get(teamId)!
        }

        for (const mr of (resultsRes.data || [])) {
          const challenge = Array.isArray(mr.challenge) ? mr.challenge[0] : mr.challenge

          const winnerStats  = getOrCreate(mr.winner_team_id)
          const loserStats   = getOrCreate(mr.loser_team_id)

          winnerStats.wins++
          winnerStats.played++
          loserStats.losses++
          loserStats.played++

          // Recent form (already newest-first, limit to last 5)
          if (winnerStats.recentForm.length < 5) winnerStats.recentForm.push('W')
          if (loserStats.recentForm.length < 5)  loserStats.recentForm.push('L')

          // Rank movement: challenger wins = moved up, challenged loses = moved down
          if (challenge) {
            if (mr.winner_team_id === challenge.challenging_team_id) {
              // Challenger won → moved up one position
              winnerStats.rankGained++
              loserStats.rankGained--
            }
            // If challenged team wins, no movement
          }
        }

        // Compute win streak for each team (results are newest-first)
        for (const [, s] of statsMap) {
          let streak = 0
          for (const r of s.recentForm) {
            if (r === 'W') streak++
            else break
          }
          s.winStreak = streak
        }

        // ── Build challenge info map ─────────────────────────────────────────
        const challengeMap = new Map<string, TeamChallengeInfo>()

        for (const c of (activeChalRes.data || [])) {
          const challengingName = teamNameMap.get(c.challenging_team_id) ?? 'Unknown'
          const challengedName  = teamNameMap.get(c.challenged_team_id)  ?? 'Unknown'
          const status: TeamChallengeInfo['status'] = c.status

          if (!challengeMap.has(c.challenging_team_id)) {
            challengeMap.set(c.challenging_team_id, {
              type: 'sent', status,
              opponentName: challengedName,
              opponentRank: teamRankMap.get(c.challenged_team_id) ?? null,
              challengeId: c.id,
            })
          }
          if (!challengeMap.has(c.challenged_team_id)) {
            challengeMap.set(c.challenged_team_id, {
              type: 'received', status,
              opponentName: challengingName,
              opponentRank: teamRankMap.get(c.challenging_team_id) ?? null,
              challengeId: c.id,
            })
          }
        }

        for (const mr of (unverifiedRes.data || [])) {
          const c = Array.isArray(mr.challenge) ? mr.challenge[0] : mr.challenge
          if (!c) continue
          for (const tid of [c.challenging_team_id, c.challenged_team_id]) {
            if (tid && !challengeMap.has(tid)) {
              challengeMap.set(tid, { type: 'sent', status: 'result_pending', opponentName: '', opponentRank: null, challengeId: c.id })
            }
          }
        }

        // ── Active ticket map ────────────────────────────────────────────────
        const teamTicketMap = new Map<string, ActiveTicket[]>()
        for (const tk of (ticketsRes.data || [])) {
          if (!tk.team_id) continue
          if (!teamTicketMap.has(tk.team_id)) teamTicketMap.set(tk.team_id, [])
          teamTicketMap.get(tk.team_id)!.push({ id: tk.id, ticket_type: tk.ticket_type })
        }

        // ── My teams: outgoing-busy check ────────────────────────────────────
        const myPositions = allPositions.filter(p => userTeamIdSet.has(p.team_id))
        const busyMyTeamIds = new Set(
          myPositions
            .map(p => p.team_id)
            .filter(id => {
              const ci = challengeMap.get(id)
              return ci && (ci.type === 'sent' || ci.status === 'result_pending')
            })
        )

        // ── Active-rank helper ───────────────────────────────────────────────
        const getActiveRank = (teamRank: number) =>
          allPositions.filter(p => p.status !== 'frozen' && p.rank <= teamRank).length

        // ── Rematch exemption helper ─────────────────────────────────────────
        // Mirrors the backend rule: Diamond (all) + top 2 of Platinum are exempt
        const platinumMinRank = tiers.find((t: any) => t.name === 'Platinum')?.min_rank ?? null
        const isRematchExempt = (myPos: any) => {
          if (myPos.tier?.name === 'Diamond') return true
          if (myPos.tier?.name === 'Platinum' && platinumMinRank !== null && myPos.rank <= platinumMinRank + 1) return true
          return false
        }

        const rankToPos = new Map<number, any>()
        allPositions.forEach(p => rankToPos.set(p.rank, p))

        // ── Build tier sections ──────────────────────────────────────────────
        const sections: TierSection[] = tiers.map(tier => {
          const maxRank = tier.max_rank ?? tier.min_rank
          const positions: PositionRow[] = []

          for (let rank = tier.min_rank; rank <= maxRank; rank++) {
            const pos = rankToPos.get(rank)

            if (!pos) {
              positions.push({ rank, status: 'vacant', team: null, tier, team_id: null, isMyTeam: false, canChallenge: false, requiresTicket: false, ticketType: null, challengeInfo: null, stats: null, tickets: [] })
              continue
            }

            const isMyTeam     = userTeamIdSet.has(pos.team_id)
            const isFrozen     = pos.status === 'frozen'
            const challengeInfo = challengeMap.get(pos.team_id) ?? null
            const stats         = statsMap.get(pos.team_id) ?? { wins: 0, losses: 0, played: 0, recentForm: [], rankGained: 0, winStreak: 0 }
            const tickets       = teamTicketMap.get(pos.team_id) ?? []

            // ── Normal eligibility (rank distance + rematch restriction) ────────
            const normalEligible = myPositions.find((my: any) => {
              if (my.status === 'frozen') return false
              if (busyMyTeamIds.has(my.team_id)) return false
              const diff = getActiveRank(my.rank) - getActiveRank(pos.rank)
              if (diff <= 0 || diff > maxPositionsAbove) return false
              if (my.last_challenged_team_id === pos.team_id && !isRematchExempt(my)) return false
              return true
            })

            // ── Ticket eligibility (bypasses distance, Silver-first rule applies) ─
            // Only evaluated when normal eligibility fails.
            let ticketEligibleTeam: any = null
            let resolvedTicketType: string | null = null

            if (!normalEligible) {
              for (const my of myPositions) {
                if (my.status === 'frozen') continue
                if (busyMyTeamIds.has(my.team_id)) continue
                const diff = getActiveRank(my.rank) - getActiveRank(pos.rank)
                if (diff <= 0) continue  // must be challenging up

                const myTickets       = teamTicketMap.get(my.team_id) ?? []
                const myTierName      = (Array.isArray(my.tier) ? my.tier[0] : my.tier)?.name
                const hasActiveSilver = myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'silver')

                // Determine which ticket type (if any) enables this challenge
                let matchingType: string | null = null
                if (tier.name === 'Silver' && myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'silver'))
                  matchingType = 'silver'
                else if (tier.name === 'Gold' && !hasActiveSilver && myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'gold'))
                  matchingType = 'gold'
                else if (tier.name === myTierName && myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'tier'))
                  matchingType = 'tier'

                if (matchingType) {
                  ticketEligibleTeam = my
                  resolvedTicketType = matchingType
                  break
                }
              }
            }

            const eligibleMyTeam  = normalEligible || ticketEligibleTeam
            const requiresTicket  = !normalEligible && !!ticketEligibleTeam
            const ticketType      = requiresTicket ? resolvedTicketType : null

            // A team is only blocked from receiving new challenges if they have already
            // ACCEPTED an incoming challenge (or are in an active match / result pending).
            // A team with only PENDING incoming challenges can still receive more —
            // accepting one will dissolve the rest automatically.
            // A team's own OUTGOING challenge (to someone above them) does NOT block
            // them from being challenged from below.
            const ACCEPTED_STATUSES = ['accepted', 'accepted_open', 'time_pending_confirm',
              'reschedule_requested', 'reschedule_pending_admin', 'scheduled', 'result_pending']
            const targetIsLocked = !!challengeInfo && (
              (challengeInfo.type === 'received' && ACCEPTED_STATUSES.includes(challengeInfo.status)) ||
              challengeInfo.status === 'result_pending'
            )
            const canChallenge = !isMyTeam && !isFrozen && !targetIsLocked && !!eligibleMyTeam

            positions.push({ rank, status: pos.status as 'active' | 'frozen', team: pos.team, tier, team_id: pos.team_id, isMyTeam, canChallenge, requiresTicket, ticketType, challengeInfo, stats, tickets })
          }

          return { tier, positions }
        })

        setTierSections(sections)
      } catch (err) {
        console.error('Error fetching ladder:', err)
        toast.error('Failed to load ladder')
      } finally {
        setLoading(false)
      }
    }

    fetchLadder()
  }, [supabase, activeTeam?.id])

  const filteredSections = useMemo(() => {
    if (!searchTerm) return tierSections
    return tierSections.map(s => ({
      ...s,
      positions: s.positions.filter(pos =>
        pos.status === 'vacant' ||
        pos.team?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pos.team?.player1?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pos.team?.player2?.name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    })).filter(s => s.positions.length > 0)
  }, [tierSections, searchTerm])

  // ── Tier style maps ──────────────────────────────────────────────────────────
  const TIER_STYLE: Record<string, { header: string; accent: string; rank: string }> = {
    Diamond:  { header: 'from-cyan-500/10  to-transparent border-cyan-500/20',   accent: 'bg-cyan-400',   rank: 'text-cyan-400'   },
    Platinum: { header: 'from-violet-500/10 to-transparent border-violet-500/20', accent: 'bg-violet-400', rank: 'text-violet-400' },
    Gold:     { header: 'from-amber-500/10  to-transparent border-amber-500/20',  accent: 'bg-amber-400',  rank: 'text-amber-400'  },
    Silver:   { header: 'from-slate-500/10  to-transparent border-slate-500/20',  accent: 'bg-slate-400',  rank: 'text-slate-400'  },
    Bronze:   { header: 'from-orange-500/10 to-transparent border-orange-500/20', accent: 'bg-orange-400', rank: 'text-orange-400' },
  }
  const defaultStyle = { header: 'from-slate-700/20 to-transparent border-slate-700/30', accent: 'bg-emerald-400', rank: 'text-emerald-400' }

  if (loading) {
    return (
      <div className="space-y-3 max-w-2xl mx-auto">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="bg-slate-800/40 rounded-2xl h-[72px] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-2xl mx-auto">

      {/* ── Header ── */}
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Ladder</h1>
        <p className="text-slate-400 mt-1 text-sm">Challenge teams ranked above you to climb</p>
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 text-slate-400 -translate-y-1/2 pointer-events-none" />
        <Input
          type="text"
          placeholder="Search teams or players…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9 h-10 bg-slate-800/60 border-slate-700/50 text-white placeholder-slate-500 rounded-xl text-sm"
        />
      </div>

      {/* ── Tier Sections ── */}
      {filteredSections.map(({ tier, positions }) => {
        const style = TIER_STYLE[tier.name] ?? defaultStyle
        const filledCount = positions.filter(p => p.status !== 'vacant').length

        return (
          <div key={tier.id} className="space-y-1.5">

            {/* Tier pill header */}
            <div className={`flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r ${style.header} border rounded-xl`}>
              <span className={`h-2 w-2 rounded-full ${style.accent} shrink-0`} />
              <span className="font-semibold text-white text-sm tracking-wide">{tier.name}</span>
              <span className="text-slate-500 text-xs ml-auto">
                {filledCount}/{positions.length} · Ranks {tier.min_rank}–{tier.max_rank ?? tier.min_rank}
              </span>
            </div>

            {/* Position rows */}
            <div className="space-y-1">
              {positions.map((pos) => {

                // ── Vacant slot ──────────────────────────────────────────────
                if (pos.status === 'vacant') {
                  return (
                    <div
                      key={pos.rank}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-slate-700/40 bg-slate-900/20"
                    >
                      <span className="w-10 text-right text-sm font-bold text-slate-700 shrink-0">#{pos.rank}</span>
                      <span className="text-slate-600 text-xs italic">Vacant</span>
                    </div>
                  )
                }

                // ── Filled row ───────────────────────────────────────────────
                const isFrozen  = pos.status === 'frozen'
                const hasChal   = !!pos.challengeInfo
                const hasStats  = !!pos.stats && pos.stats.played > 0

                const cardBase = pos.isMyTeam
                  ? 'bg-emerald-500/8 border-emerald-500/25 ring-1 ring-emerald-500/15'
                  : isFrozen
                  ? 'bg-blue-500/8 border-blue-500/20'
                  : 'bg-slate-800/50 border-slate-700/40 hover:bg-slate-800/70 hover:border-slate-600/60'

                return (
                  <div
                    key={pos.rank}
                    className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-150 ${cardBase}`}
                  >
                    {/* Rank */}
                    <div className="w-10 text-right shrink-0 pt-0.5">
                      <span className={`text-xl font-black tabular-nums leading-none ${style.rank}`}>
                        #{pos.rank}
                      </span>
                      {/* Net rank trend arrow */}
                      {pos.stats && pos.stats.rankGained !== 0 && (
                        <div className={`flex items-center justify-end mt-0.5 gap-0.5 text-[10px] font-semibold ${
                          pos.stats.rankGained > 0 ? 'text-emerald-500' : 'text-red-500'
                        }`}>
                          {pos.stats.rankGained > 0
                            ? <TrendingUp className="h-2.5 w-2.5" />
                            : <TrendingDown className="h-2.5 w-2.5" />
                          }
                          {Math.abs(pos.stats.rankGained)}
                        </div>
                      )}
                    </div>

                    {/* Team info */}
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Name row */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/teams/${pos.team_id}`}
                          className={`font-semibold text-sm hover:underline underline-offset-2 ${pos.isMyTeam ? 'text-emerald-300 hover:text-emerald-200' : 'text-white hover:text-slate-300'}`}
                        >
                          {pos.team?.name}
                        </Link>

                        {pos.isMyTeam && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                            You
                          </span>
                        )}
                        {isFrozen && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0">
                            <Snowflake className="h-2.5 w-2.5" />Frozen
                          </span>
                        )}
                        {hasChal && <ChallengePill info={pos.challengeInfo!} />}

                        {/* Active ticket pills */}
                        {pos.tickets.map(tk => {
                          const colors: Record<string, string> = {
                            tier:   'bg-violet-500/15 text-violet-300 border-violet-500/30',
                            silver: 'bg-slate-400/15 text-slate-200 border-slate-400/30',
                            gold:   'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
                          }
                          const label: Record<string, string> = {
                            tier: 'Tier', silver: 'Silver', gold: 'Gold',
                          }
                          return (
                            <span key={tk.id} className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${colors[tk.ticket_type] ?? 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>
                              <TicketIcon className="h-2.5 w-2.5" />
                              {label[tk.ticket_type] ?? tk.ticket_type}
                            </span>
                          )
                        })}
                      </div>

                      {/* Players */}
                      <p className="text-xs text-slate-500 leading-tight truncate">
                        {pos.team?.player1?.name} &amp; {pos.team?.player2?.name}
                      </p>

                      {/* Challenge opponent line */}
                      {hasChal && <ChallengeOpponentLine info={pos.challengeInfo!} />}

                      {/* Stats strip */}
                      {pos.stats && pos.stats.played > 0 && (
                        <div className="pt-0.5">
                          <StatsStrip stats={pos.stats} />
                        </div>
                      )}

                      {/* No matches yet — show subtly */}
                      {pos.stats && pos.stats.played === 0 && !pos.isMyTeam && (
                        <p className="text-[11px] text-slate-600 italic">No matches played yet</p>
                      )}
                    </div>

                    {/* Action button */}
                    {!pos.isMyTeam && (
                      <div className="shrink-0 ml-1 pt-0.5">
                        {pos.canChallenge ? (
                          <Link href={`/challenges?opponent=${pos.team?.id}${pos.ticketType ? `&ticket=${pos.ticketType}` : ''}`}>
                            <Button
                              size="sm"
                              className={`h-8 px-3 text-white text-xs font-semibold rounded-lg gap-1 ${
                                pos.requiresTicket
                                  ? 'bg-violet-600 hover:bg-violet-500'
                                  : 'bg-emerald-500 hover:bg-emerald-400'
                              }`}
                            >
                              {pos.requiresTicket
                                ? <TicketIcon className="h-3.5 w-3.5" />
                                : <Zap className="h-3.5 w-3.5" />
                              }
                              {pos.requiresTicket ? `${pos.ticketType?.charAt(0).toUpperCase()}${pos.ticketType?.slice(1)} Ticket` : 'Challenge'}
                            </Button>
                          </Link>
                        ) : hasChal ? (
                          <Link href={`/challenges/${pos.challengeInfo!.challengeId}`}>
                            <button className="flex items-center gap-0.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mt-1">
                              View <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-600 italic mt-1 inline-block">Not eligible</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* ── Empty State ── */}
      {filteredSections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-slate-600" />
          </div>
          <h3 className="font-semibold text-white mb-1">
            {searchTerm ? 'No Results' : 'Ladder is Empty'}
          </h3>
          <p className="text-sm text-slate-500">
            {searchTerm ? 'Try a different search' : 'No teams have joined the ladder yet'}
          </p>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="mt-3 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Clear search
            </button>
          )}
        </div>
      )}

    </div>
  )
}
