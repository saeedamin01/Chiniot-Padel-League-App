'use client'

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Search, Zap, Users, Snowflake, Calendar, Clock, CheckCircle,
  AlertCircle, ChevronDown, Flame, Ticket as TicketIcon, X,
  TrendingUp, TrendingDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  confirmedTime?: string | null
}

interface TeamStats {
  wins: number
  losses: number
  played: number
  recentForm: ('W' | 'L')[]
  rankGained: number
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
  /** True when my team is in range but the target is locked by an active challenge */
  lockedForMe: boolean
  requiresTicket: boolean
  ticketType: string | null
  challenges: TeamChallengeInfo[]
  stats: TeamStats | null
  tickets: ActiveTicket[]
}

interface TierSection {
  tier: Tier
  positions: PositionRow[]
}

// ─── Tier style map ───────────────────────────────────────────────────────────

const TIER_STYLE: Record<string, {
  border: string
  dot: string
  rank: string
  headerBg: string
}> = {
  Diamond:  {
    border:   'border-cyan-200   dark:border-cyan-500/20',
    dot:      'bg-cyan-500',
    rank:     'text-cyan-700   dark:text-cyan-400',
    headerBg: 'bg-cyan-50/80   dark:bg-cyan-500/5',
  },
  Platinum: {
    border:   'border-violet-200 dark:border-violet-500/20',
    dot:      'bg-violet-500',
    rank:     'text-violet-700 dark:text-violet-400',
    headerBg: 'bg-violet-50/80 dark:bg-violet-500/5',
  },
  Gold: {
    border:   'border-amber-200  dark:border-amber-500/20',
    dot:      'bg-amber-500',
    rank:     'text-amber-700  dark:text-amber-500',
    headerBg: 'bg-amber-50/80  dark:bg-amber-500/5',
  },
  Silver: {
    border:   'border-slate-300  dark:border-slate-500/20',
    dot:      'bg-slate-400',
    rank:     'text-slate-600  dark:text-slate-400',
    headerBg: 'bg-slate-100/80 dark:bg-slate-500/5',
  },
  Bronze: {
    border:   'border-orange-200 dark:border-orange-500/20',
    dot:      'bg-orange-500',
    rank:     'text-orange-700 dark:text-orange-400',
    headerBg: 'bg-orange-50/80 dark:bg-orange-500/5',
  },
}
const DEFAULT_TIER_STYLE = {
  border:   'border-slate-200 dark:border-slate-700/40',
  dot:      'bg-emerald-500',
  rank:     'text-emerald-700 dark:text-emerald-400',
  headerBg: 'bg-slate-50     dark:bg-slate-800/40',
}

// ─── Challenge status helpers ─────────────────────────────────────────────────

const ARRANGING_STATUSES = ['accepted', 'accepted_open', 'time_pending_confirm', 'reschedule_requested', 'reschedule_pending_admin']

// ── Expanded-panel helpers (detailed) ────────────────────────────────────────

function challengeStatusLabel(ci: TeamChallengeInfo): string {
  if (ci.status === 'result_pending') {
    const vs = ci.opponentName ? ` vs ${ci.opponentName}` : ''
    return `Result pending${vs}`
  }
  const dir = ci.type === 'sent' ? '↑' : '↓'
  if (ci.status === 'scheduled') return `Match scheduled ${dir}`
  if (ARRANGING_STATUSES.includes(ci.status as string)) return `Arranging time ${dir}`
  return ci.type === 'sent' ? `Challenge sent ${dir}` : `Incoming challenge ${dir}`
}

function challengeStatusColors(ci: TeamChallengeInfo): string {
  if (ci.status === 'result_pending')
    return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/25'
  if (ci.status === 'scheduled')
    return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25'
  if (ARRANGING_STATUSES.includes(ci.status as string))
    return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-400 dark:border-orange-500/25'
  if (ci.type === 'sent')
    return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-400/15 dark:text-yellow-600 dark:border-yellow-400/30'
  return 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/25'
}

function challengeStatusIcon(ci: TeamChallengeInfo) {
  if (ci.status === 'result_pending') return <CheckCircle className="h-3 w-3 shrink-0" />
  if (ci.status === 'scheduled')      return <Calendar    className="h-3 w-3 shrink-0" />
  if (ARRANGING_STATUSES.includes(ci.status as string)) return <Clock className="h-3 w-3 shrink-0" />
  if (ci.type === 'sent')             return <Zap         className="h-3 w-3 shrink-0" />
  return <AlertCircle className="h-3 w-3 shrink-0" />
}

// ── Inline row badge helpers (compact) ───────────────────────────────────────

function challengeInlineLabel(ci: TeamChallengeInfo): string {
  if (ci.status === 'result_pending') {
    const vs = ci.opponentName ? ` · ${ci.opponentName}` : ''
    return `Result due${vs}`
  }
  const dir = ci.type === 'sent' ? '↑' : '↓'
  const vs  = ci.opponentName ? ` · ${ci.opponentName}` : ''
  if (ci.status === 'scheduled') return `${dir} Scheduled${vs}`
  if (ARRANGING_STATUSES.includes(ci.status as string)) return `${dir} Arranging${vs}`
  return ci.type === 'sent' ? `${dir} Challenged${vs}` : `${dir} Incoming${vs}`
}

function challengeInlineColors(ci: TeamChallengeInfo): string {
  if (ci.status === 'result_pending')
    return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/25'
  if (ci.status === 'scheduled')
    return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25'
  if (ARRANGING_STATUSES.includes(ci.status as string))
    return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-400 dark:border-orange-500/25'
  if (ci.type === 'sent')
    return 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-400/15 dark:text-yellow-600 dark:border-yellow-400/30'
  return 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/25'
}

function challengeInlineIcon(ci: TeamChallengeInfo) {
  if (ci.status === 'result_pending') return <CheckCircle className="h-2.5 w-2.5 shrink-0" />
  if (ci.status === 'scheduled')      return <Calendar    className="h-2.5 w-2.5 shrink-0" />
  if (ARRANGING_STATUSES.includes(ci.status as string)) return <Clock className="h-2.5 w-2.5 shrink-0" />
  if (ci.type === 'sent')             return <Zap         className="h-2.5 w-2.5 shrink-0" />
  return <AlertCircle className="h-2.5 w-2.5 shrink-0" />
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LadderPage() {
  const [loading, setLoading]         = useState(true)
  const [searchTerm, setSearchTerm]   = useState('')
  const [showSearch, setShowSearch]   = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [tierSections, setTierSections] = useState<TierSection[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()
  const { activeTeam } = useTeam()

  const toggleExpanded = (teamId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  const toggleSearch = () => {
    setShowSearch(v => {
      if (v) { setSearchTerm(''); return false }
      // focus after paint
      setTimeout(() => searchInputRef.current?.focus(), 50)
      return true
    })
  }

  // ─── Data fetch ────────────────────────────────────────────────────────────

  const fetchLadder = useCallback(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { toast.error('Authentication required'); return }

        const { data: season } = await supabase
          .from('seasons').select('id').eq('is_active', true).single()
        if (!season) { toast.error('No active season found'); setLoading(false); return }

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
        const allPositions: any[] = positionsRes.data || []

        // Build the set of ALL teams the current user is a player on.
        // Used to prevent challenging your own other teams regardless of which team is active.
        const userTeamIdSet = new Set(
          allPositions
            .filter(p => p.team?.player1?.id === user.id || p.team?.player2?.id === user.id)
            .map(p => p.team_id)
            .filter(Boolean)
        )

        // The actively selected team from the team switcher — only this team is
        // highlighted with "You" and can initiate challenges.
        const activeTeamId = activeTeam?.id ?? null
        const allTeamIds = allPositions.map(p => p.team_id).filter(Boolean) as string[]

        const teamNameMap = new Map<string, string>()
        const teamRankMap = new Map<string, number>()
        allPositions.forEach(p => {
          if (p.team_id && p.team?.name) teamNameMap.set(p.team_id, p.team.name)
          if (p.team_id && p.rank)       teamRankMap.set(p.team_id, p.rank)
        })

        const [resultsRes, activeChalRes, unverifiedRes] = await Promise.all([
          allTeamIds.length > 0
            ? supabase
                .from('match_results')
                .select('id, winner_team_id, loser_team_id, created_at, challenge:challenges!challenge_id(challenging_team_id, challenged_team_id)')
                .eq('season_id', season.id)
                .not('verified_at', 'is', null)
                .order('created_at', { ascending: false })
            : Promise.resolve({ data: [] }),
          allTeamIds.length > 0
            ? supabase
                .from('challenges')
                .select('id, challenging_team_id, challenged_team_id, status, confirmed_time, accepted_slot, match_date')
                .in('status', ['pending', 'accepted', 'accepted_open', 'time_pending_confirm', 'reschedule_requested', 'reschedule_pending_admin', 'scheduled', 'result_pending'])
                .or(allTeamIds.map(id => `challenging_team_id.eq.${id},challenged_team_id.eq.${id}`).join(','))
            : Promise.resolve({ data: [] }),
          supabase
            .from('match_results')
            .select('id, challenge:challenges!challenge_id(id, challenging_team_id, challenged_team_id)')
            .eq('season_id', season.id)
            .is('verified_at', null),
        ])

        const statsMap = new Map<string, TeamStats>()
        const getOrCreate = (teamId: string): TeamStats => {
          if (!statsMap.has(teamId)) {
            statsMap.set(teamId, { wins: 0, losses: 0, played: 0, recentForm: [], rankGained: 0, winStreak: 0 })
          }
          return statsMap.get(teamId)!
        }

        for (const mr of (resultsRes.data || [])) {
          const challenge = Array.isArray(mr.challenge) ? mr.challenge[0] : mr.challenge
          const winnerStats = getOrCreate(mr.winner_team_id)
          const loserStats  = getOrCreate(mr.loser_team_id)
          winnerStats.wins++; winnerStats.played++
          loserStats.losses++; loserStats.played++
          if (winnerStats.recentForm.length < 5) winnerStats.recentForm.push('W')
          if (loserStats.recentForm.length < 5)  loserStats.recentForm.push('L')
          if (challenge) {
            if (mr.winner_team_id === challenge.challenging_team_id) {
              winnerStats.rankGained++
              loserStats.rankGained--
            }
          }
        }
        for (const [, s] of statsMap) {
          let streak = 0
          for (const r of s.recentForm) { if (r === 'W') streak++; else break }
          s.winStreak = streak
        }

        const challengeMap = new Map<string, TeamChallengeInfo[]>()
        for (const c of (activeChalRes.data || [])) {
          const challengingName = teamNameMap.get(c.challenging_team_id) ?? 'Unknown'
          const challengedName  = teamNameMap.get(c.challenged_team_id)  ?? 'Unknown'
          const status: TeamChallengeInfo['status'] = c.status
          const confirmedTime: string | null = c.confirmed_time ?? c.accepted_slot ?? c.match_date ?? null
          if (!challengeMap.has(c.challenging_team_id)) challengeMap.set(c.challenging_team_id, [])
          challengeMap.get(c.challenging_team_id)!.push({ type: 'sent', status, opponentName: challengedName, opponentRank: teamRankMap.get(c.challenged_team_id) ?? null, challengeId: c.id, confirmedTime })
          if (!challengeMap.has(c.challenged_team_id)) challengeMap.set(c.challenged_team_id, [])
          challengeMap.get(c.challenged_team_id)!.push({ type: 'received', status, opponentName: challengingName, opponentRank: teamRankMap.get(c.challenging_team_id) ?? null, challengeId: c.id, confirmedTime })
        }
        for (const mr of (unverifiedRes.data || [])) {
          const c = Array.isArray(mr.challenge) ? mr.challenge[0] : mr.challenge
          if (!c) continue
          for (const tid of [c.challenging_team_id, c.challenged_team_id]) {
            if (!tid) continue
            if (!challengeMap.has(tid)) challengeMap.set(tid, [])
            const existing = challengeMap.get(tid)!
            if (!existing.some(e => e.challengeId === c.id)) {
              const opponentId = tid === c.challenging_team_id ? c.challenged_team_id : c.challenging_team_id
              existing.push({ type: 'sent', status: 'result_pending', opponentName: teamNameMap.get(opponentId) ?? '', opponentRank: teamRankMap.get(opponentId) ?? null, challengeId: c.id })
            }
          }
        }

        const teamTicketMap = new Map<string, ActiveTicket[]>()
        for (const tk of (ticketsRes.data || [])) {
          if (!tk.team_id) continue
          if (!teamTicketMap.has(tk.team_id)) teamTicketMap.set(tk.team_id, [])
          teamTicketMap.get(tk.team_id)!.push({ id: tk.id, ticket_type: tk.ticket_type })
        }

        // Only the active team can initiate challenges — restrict myPositions to it.
        const myPositions = activeTeamId
          ? allPositions.filter(p => p.team_id === activeTeamId)
          : []
        const busyMyTeamIds = new Set(
          myPositions.map(p => p.team_id).filter(id => {
            const cis = challengeMap.get(id) ?? []
            return cis.some(ci => ci.type === 'sent' || ci.status === 'result_pending')
          })
        )

        const getActiveRank = (teamRank: number) =>
          allPositions.filter(p => p.status !== 'frozen' && p.rank <= teamRank).length

        const platinumMinRank = tiers.find((t: any) => t.name === 'Platinum')?.min_rank ?? null
        const isRematchExempt = (myPos: any) => {
          if (myPos.tier?.name === 'Diamond') return true
          if (myPos.tier?.name === 'Platinum' && platinumMinRank !== null && myPos.rank <= platinumMinRank + 1) return true
          return false
        }

        const rankToPos = new Map<number, any>()
        allPositions.forEach(p => rankToPos.set(p.rank, p))

        const ACCEPTED_STATUSES = ['accepted', 'accepted_open', 'time_pending_confirm',
          'reschedule_requested', 'reschedule_pending_admin', 'scheduled', 'result_pending']

        const sections: TierSection[] = tiers.map(tier => {
          const maxRank = tier.max_rank ?? tier.min_rank
          const positions: PositionRow[] = []

          for (let rank = tier.min_rank; rank <= maxRank; rank++) {
            const pos = rankToPos.get(rank)
            if (!pos) {
              positions.push({ rank, status: 'vacant', team: null, tier, team_id: null, isMyTeam: false, canChallenge: false, lockedForMe: false, requiresTicket: false, ticketType: null, challenges: [], stats: null, tickets: [] })
              continue
            }

            // isMyTeam = only the actively selected team (shown with "You" badge)
            const isMyTeam      = pos.team_id === activeTeamId
            // isAnyMyTeam = any team the user is on (blocks self-challenges)
            const isAnyMyTeam   = userTeamIdSet.has(pos.team_id)
            const isFrozen   = pos.status === 'frozen'
            const challenges = challengeMap.get(pos.team_id) ?? []
            const stats      = statsMap.get(pos.team_id) ?? { wins: 0, losses: 0, played: 0, recentForm: [], rankGained: 0, winStreak: 0 }
            const tickets    = teamTicketMap.get(pos.team_id) ?? []

            const normalEligible = myPositions.find((my: any) => {
              if (my.status === 'frozen') return false
              if (busyMyTeamIds.has(my.team_id)) return false
              const diff = getActiveRank(my.rank) - getActiveRank(pos.rank)
              if (diff <= 0 || diff > maxPositionsAbove) return false
              if (my.last_challenged_team_id === pos.team_id && !isRematchExempt(my)) return false
              return true
            })

            let ticketEligibleTeam: any = null
            let resolvedTicketType: string | null = null
            if (!normalEligible) {
              for (const my of myPositions) {
                if (my.status === 'frozen') continue
                if (busyMyTeamIds.has(my.team_id)) continue
                const diff = getActiveRank(my.rank) - getActiveRank(pos.rank)
                if (diff <= 0) continue
                const myTickets       = teamTicketMap.get(my.team_id) ?? []
                const myTierName      = (Array.isArray(my.tier) ? my.tier[0] : my.tier)?.name
                const hasActiveSilver = myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'silver')
                let matchingType: string | null = null
                if (tier.name === 'Silver' && myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'silver'))
                  matchingType = 'silver'
                else if (tier.name === 'Gold' && !hasActiveSilver && myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'gold'))
                  matchingType = 'gold'
                else if (tier.name === myTierName && myTickets.some((tk: ActiveTicket) => tk.ticket_type === 'tier'))
                  matchingType = 'tier'
                if (matchingType) { ticketEligibleTeam = my; resolvedTicketType = matchingType; break }
              }
            }

            const eligibleMyTeam = normalEligible || ticketEligibleTeam
            const requiresTicket = !normalEligible && !!ticketEligibleTeam
            const ticketType     = requiresTicket ? resolvedTicketType : null
            // A team is only unavailable if they RECEIVED a challenge from below and accepted it.
            // A team that SENT a challenge upward is still open to be challenged.
            const targetIsLocked = challenges.some(ci =>
              ci.type === 'received' && ACCEPTED_STATUSES.includes(ci.status)
            )
            const canChallenge = !isAnyMyTeam && !isFrozen && !targetIsLocked && !!eligibleMyTeam
            // Show "Unavailable" pill when my team is in range but target is locked by a received challenge
            const lockedForMe  = !isAnyMyTeam && !isFrozen && targetIsLocked && !!eligibleMyTeam

            positions.push({ rank, status: pos.status as 'active' | 'frozen', team: pos.team, tier, team_id: pos.team_id, isMyTeam, canChallenge, lockedForMe, requiresTicket, ticketType, challenges, stats, tickets })
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
  }, [supabase, activeTeam?.id])

  // Initial fetch
  useEffect(() => {
    fetchLadder()
  }, [fetchLadder])

  // Re-fetch whenever any challenge status changes (e.g. cron auto-verifies a result)
  useEffect(() => {
    const channel = supabase
      .channel('ladder-challenge-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'challenges' },
        () => { fetchLadder() }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'match_results' },
        () => { fetchLadder() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchLadder])

  // ─── Filtered sections ─────────────────────────────────────────────────────

  const filteredSections = useMemo(() => {
    if (!searchTerm.trim()) return tierSections
    const q = searchTerm.toLowerCase()
    return tierSections.map(s => ({
      ...s,
      positions: s.positions.filter(pos =>
        pos.status === 'vacant' ||
        pos.team?.name.toLowerCase().includes(q) ||
        pos.team?.player1?.name.toLowerCase().includes(q) ||
        pos.team?.player2?.name.toLowerCase().includes(q)
      ),
    })).filter(s => s.positions.length > 0)
  }, [tierSections, searchTerm])

  // ─── Skeleton ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="h-8 w-32 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
          <div className="h-9 w-9 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        </div>
        <div className="h-10 w-full rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse mb-4" />
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-[56px] rounded-2xl bg-slate-100 dark:bg-slate-800/40 animate-pulse" />
        ))}
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-2xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Ladder</h1>
          {!showSearch && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Challenge teams above you to climb</p>
          )}
        </div>
        {/* Search toggle button */}
        <button
          onClick={toggleSearch}
          aria-label={showSearch ? 'Close search' : 'Search ladder'}
          className={[
            'flex items-center justify-center h-9 w-9 rounded-xl border transition-colors shrink-0 mt-0.5',
            showSearch
              ? 'bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-300'
              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700',
          ].join(' ')}
        >
          {showSearch ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
        </button>
      </div>

      {/* ── Search input (shown when toggled) ── */}
      {showSearch && (
        <div className="relative -mt-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search teams or players…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400 dark:focus:border-emerald-500 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* ── Tier sections ── */}
      <div className="space-y-6">
        {filteredSections.map(({ tier, positions }) => {
          const style = TIER_STYLE[tier.name] ?? DEFAULT_TIER_STYLE

          return (
            <div key={tier.id} className="space-y-1">

              {/* ── Tier header ── */}
              <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${style.border} ${style.headerBg}`}>
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${style.dot}`} />
                <span className="font-bold text-slate-800 dark:text-white text-sm tracking-wide">{tier.name}</span>
                <span className="text-slate-400 dark:text-slate-500 text-xs ml-auto">
                  Ranks {tier.min_rank}–{tier.max_rank ?? tier.min_rank}
                </span>
              </div>

              {/* ── Position rows ── */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700/50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
                {positions.map(pos => {

                  // ── Vacant ──────────────────────────────────────────────
                  if (pos.status === 'vacant') {
                    return (
                      <div
                        key={pos.rank}
                        className="flex items-center gap-3 px-4 h-14 bg-slate-50/50 dark:bg-slate-900/20"
                      >
                        <span className={`w-8 text-center text-sm font-black tabular-nums shrink-0 ${style.rank} opacity-40`}>
                          {pos.rank}
                        </span>
                        <span className="text-xs text-slate-400 dark:text-slate-600 italic">Vacant</span>
                      </div>
                    )
                  }

                  const isFrozen   = pos.status === 'frozen'
                  const isExpanded = !!pos.team_id && expandedIds.has(pos.team_id)
                  const hasChal    = pos.challenges.length > 0
                  const hasStats   = (pos.stats?.played ?? 0) > 0
                  const isExpandable = hasChal || hasStats

                  // Card background
                  const cardBg = pos.isMyTeam
                    ? 'bg-emerald-100 border-l-4 border-emerald-500 dark:bg-emerald-500/15 dark:border-emerald-500/60'
                    : isFrozen
                    ? 'bg-sky-50/60 dark:bg-blue-500/5'
                    : 'bg-white dark:bg-slate-900/30 hover:bg-slate-50 dark:hover:bg-slate-800/50'

                  // W/L for default row
                  const w = pos.stats?.wins   ?? 0
                  const l = pos.stats?.losses ?? 0

                  return (
                    <div
                      key={pos.rank}
                      className={`transition-colors ${cardBg}`}
                    >
                      {/* ── Main row (min 56px) ── */}
                      <div
                        className={`flex items-center gap-3 px-4 min-h-[56px] py-2 ${isExpandable ? 'cursor-pointer' : ''}`}
                        onClick={() => isExpandable && pos.team_id && toggleExpanded(pos.team_id)}
                      >
                        {/* Rank number */}
                        <span className={`w-8 text-center text-base font-black tabular-nums shrink-0 leading-none ${style.rank}`}>
                          {pos.rank}
                        </span>

                        {/* Team info */}
                        <div className="flex-1 min-w-0 py-0.5">
                          {/* Row 1: Name + You/Frozen badges — always single line */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`font-semibold text-sm leading-snug truncate ${pos.isMyTeam ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-900 dark:text-white'}`}>
                              {pos.team?.name}
                            </span>
                            {pos.isMyTeam && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30 shrink-0">
                                You
                              </span>
                            )}
                            {isFrozen && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25 shrink-0">
                                <Snowflake className="h-2.5 w-2.5" />Frozen
                              </span>
                            )}
                          </div>

                          {/* Row 2: Player names + W/L */}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-500 dark:text-slate-400 leading-tight truncate">
                              {pos.team?.player1?.name} &amp; {pos.team?.player2?.name}
                            </span>
                            {(w > 0 || l > 0) && (
                              <span className="text-xs font-medium tabular-nums shrink-0">
                                <span className="text-emerald-600 dark:text-emerald-500">{w}W</span>
                                <span className="text-slate-400 dark:text-slate-600 mx-0.5">·</span>
                                <span className="text-red-600 dark:text-red-500">{l}L</span>
                              </span>
                            )}
                          </div>

                          {/* Row 3: Status chips — only if active challenges */}
                          {pos.challenges.length > 0 && (
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {pos.challenges.map((ci, idx) => (
                                <span
                                  key={idx}
                                  className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${challengeInlineColors(ci)}`}
                                >
                                  {challengeInlineIcon(ci)}
                                  <span className="truncate max-w-[140px]">{challengeInlineLabel(ci)}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Right side: action + chevron */}
                        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                          {/* Challenge button / Busy indicator */}
                          {pos.lockedForMe && (
                            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-600/50">
                              Unavailable
                            </span>
                          )}
                          {pos.canChallenge && (
                            <Link
                              href={`/challenges?opponent=${pos.team_id}${pos.ticketType ? `&ticket=${pos.ticketType}` : ''}`}
                            >
                              <Button
                                size="sm"
                                className={[
                                  'h-10 px-4 text-sm font-semibold rounded-xl gap-1.5',
                                  pos.requiresTicket
                                    ? 'bg-violet-600 hover:bg-violet-500 text-white dark:bg-violet-600 dark:hover:bg-violet-500'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500',
                                ].join(' ')}
                              >
                                {pos.requiresTicket
                                  ? <TicketIcon className="h-3.5 w-3.5" />
                                  : <Zap className="h-3.5 w-3.5" />
                                }
                                {pos.requiresTicket
                                  ? `${pos.ticketType!.charAt(0).toUpperCase()}${pos.ticketType!.slice(1)} Ticket`
                                  : 'Challenge'
                                }
                              </Button>
                            </Link>
                          )}

                          {/* Expand chevron (only if expandable and no challenge button, or always) */}
                          {isExpandable && (
                            <button
                              onClick={() => pos.team_id && toggleExpanded(pos.team_id)}
                              className="flex items-center justify-center h-7 w-7 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                              aria-label={isExpanded ? 'Collapse' : 'Expand'}
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ── Expanded panel ── */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100 dark:border-slate-700/40">

                          {/* Challenge details (expanded) */}
                          {hasChal && (
                            <div className="space-y-2">
                              <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                Active Challenge{pos.challenges.length > 1 ? 's' : ''}
                              </p>
                              {pos.challenges.map((ci, idx) => (
                                <div key={idx} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border ${challengeStatusColors(ci)}`}>
                                  {challengeStatusIcon(ci)}
                                  <div className="flex-1 min-w-0">
                                    <span className="text-[11px] font-bold">{challengeStatusLabel(ci)}</span>
                                    {ci.opponentName && ci.status !== 'result_pending' && (
                                      <span className="text-[11px] ml-1.5 opacity-80">
                                        vs {ci.opponentName}
                                        {ci.opponentRank != null && (
                                          <span className="ml-1 font-semibold">#{ci.opponentRank}</span>
                                        )}
                                      </span>
                                    )}
                                    {ci.status === 'scheduled' && ci.confirmedTime && (() => {
                                      const d = new Date(ci.confirmedTime)
                                      const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                                      const time = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
                                      return (
                                        <span className="block text-[11px] mt-0.5 opacity-70">
                                          📅 {date} · {time}
                                        </span>
                                      )
                                    })()}
                                  </div>
                                  <Link
                                    href={`/challenges/${ci.challengeId}`}
                                    className="text-[11px] font-bold hover:underline underline-offset-2 shrink-0 opacity-80 hover:opacity-100"
                                  >
                                    View →
                                  </Link>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Stats strip */}
                          {hasStats && pos.stats && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Season Stats</p>
                              <div className="flex items-center gap-3 flex-wrap">
                                {/* Win % */}
                                <span className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                                  {Math.round((pos.stats.wins / pos.stats.played) * 100)}% win rate
                                  <span className="text-slate-400 dark:text-slate-600 mx-1">·</span>
                                  {pos.stats.played} played
                                </span>
                                {/* Form dots — most recent on right */}
                                {pos.stats.recentForm.length > 0 && (
                                  <div className="flex items-center gap-1">
                                    {[...pos.stats.recentForm].reverse().slice(0, 5).reverse().map((r, i) => (
                                      <span
                                        key={i}
                                        title={r === 'W' ? 'Win' : 'Loss'}
                                        className={`inline-block h-2 w-2 rounded-full ${r === 'W' ? 'bg-emerald-500' : 'bg-red-400'}`}
                                      />
                                    ))}
                                  </div>
                                )}
                                {/* Hot streak */}
                                {pos.stats.winStreak >= 3 && (
                                  <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-400 dark:border-orange-500/20">
                                    <Flame className="h-3 w-3" />{pos.stats.winStreak} streak
                                  </span>
                                )}
                                {/* Rank movement */}
                                {pos.stats.rankGained !== 0 && (
                                  <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${pos.stats.rankGained > 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500'}`}>
                                    {pos.stats.rankGained > 0
                                      ? <TrendingUp className="h-3 w-3" />
                                      : <TrendingDown className="h-3 w-3" />
                                    }
                                    {Math.abs(pos.stats.rankGained)} places this season
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* View full team profile */}
                          {pos.team_id && (
                            <Link
                              href={`/teams/${pos.team_id}`}
                              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                            >
                              <Users className="h-3.5 w-3.5" />
                              View team profile &amp; match history
                            </Link>
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
      </div>

      {/* ── Empty state ── */}
      {filteredSections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-slate-400 dark:text-slate-600" />
          </div>
          <h3 className="font-semibold text-slate-800 dark:text-white mb-1">
            {searchTerm ? 'No Results' : 'Ladder is Empty'}
          </h3>
          <p className="text-sm text-slate-500">
            {searchTerm ? `No teams match "${searchTerm}"` : 'No teams have joined the ladder yet'}
          </p>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      )}

    </div>
  )
}
