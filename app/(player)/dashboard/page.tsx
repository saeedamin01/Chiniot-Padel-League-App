'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Trophy, Zap, Calendar, Clock, AlertTriangle, CheckCircle,
  XCircle, RefreshCw, ArrowRight, Loader2,
  Check, X, Flag, Users, AlertCircle, Snowflake, MessageCircle,
  TrendingUp, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TierBadge } from '@/components/ui/tier-badge'
import type { Team, LadderPosition, Challenge, MatchResult } from '@/types'
import { useTeam } from '@/context/TeamContext'
import { useChat } from '@/context/ChatContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerInfo { id: string; name: string; phone?: string | null }

interface DashboardTeam extends Omit<Team, 'player1' | 'player2'> {
  player1?: PlayerInfo
  player2?: PlayerInfo
  ladder_position?: LadderPosition & { tier?: { name: string; color: string; rank_order: number } }
}

interface DashboardChallenge extends Omit<Challenge, 'challenging_team' | 'challenged_team' | 'match_result' | 'venue'> {
  challenging_team: DashboardTeam
  challenged_team: DashboardTeam
  match_result?: MatchResult | null
  venue?: { id: string; name: string; address?: string } | null
}

interface RecentMatch {
  id: string
  winner_team_id: string
  loser_team_id: string
  verified_at: string
  set1_challenger: number
  set1_challenged: number
  set2_challenger: number
  set2_challenged: number
  supertiebreak_challenger: number | null
  supertiebreak_challenged: number | null
  challenge: {
    id: string
    challenge_code: string
    challenging_team_id: string
    challenged_team_id: string
    challenging_team: { id: string; name: string }
    challenged_team: { id: string; name: string }
  } | null
}

// ─── Countdown hook ───────────────────────────────────────────────────────────

function useCountdown(deadline: string | null | undefined) {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    if (!deadline) return
    const target = new Date(deadline).getTime()
    const tick = () => setRemaining(Math.max(0, target - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])
  const hours   = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return { hours, minutes, seconds, expired: remaining === 0, remaining }
}

function CountdownPill({ deadline, urgent }: { deadline: string | null | undefined; urgent?: boolean }) {
  const { hours, minutes, seconds, expired } = useCountdown(deadline)
  if (!deadline) return null
  const isUrgent = urgent || (!expired && hours < 1)
  const base = 'inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full border'
  const style = expired
    ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30'
    : isUrgent
    ? 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/30'
    : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:border-slate-600/50'
  return (
    <span className={`${base} ${style}`}>
      <Clock className="h-3 w-3 flex-shrink-0" />
      {expired
        ? 'Expired'
        : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`}
    </span>
  )
}

// ─── Shared card wrapper ──────────────────────────────────────────────────────

function DCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  )
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({ label, color }: { label: string; color: 'orange' | 'yellow' | 'blue' | 'green' | 'purple' | 'slate' | 'red' }) {
  const styles: Record<string, string> = {
    orange: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-400 dark:border-yellow-500/30',
    blue:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30',
    green:  'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30',
    purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30',
    slate:  'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-600/50 dark:text-slate-300 dark:border-slate-600/50',
    red:    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30',
  }
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full border uppercase tracking-wide ${styles[color]}`}>
      {label}
    </span>
  )
}

// ─── Section heading ──────────────────────────────────────────────────────────

function SectionHeading({ icon, label, count, color = 'slate' }: {
  icon: React.ReactNode
  label: string
  count?: number
  color?: 'orange' | 'emerald' | 'blue' | 'slate'
}) {
  const iconColor = { orange: 'text-orange-500', emerald: 'text-emerald-600', blue: 'text-blue-500', slate: 'text-slate-400' }[color]
  const badgeColor = {
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
  }[color]
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className={iconColor}>{icon}</span>
      <h2 className="font-bold text-slate-900 dark:text-white text-lg">{label}</h2>
      {count !== undefined && (
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
          {count}
        </span>
      )}
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Hero card skeleton */}
      <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-sm p-5 animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-40 bg-slate-200 dark:bg-slate-700 rounded-lg" />
            <div className="h-3.5 w-56 bg-slate-100 dark:bg-slate-700/60 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-4">
          <div className="h-10 w-24 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
          <div className="h-10 w-24 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
          <div className="h-10 w-24 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
        </div>
      </div>
      {/* Challenge card skeletons */}
      {[1, 2].map(i => (
        <div key={i} className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl shadow-sm p-5 animate-pulse">
          <div className="h-4 w-28 bg-slate-200 dark:bg-slate-700 rounded-full mb-3" />
          <div className="h-5 w-48 bg-slate-200 dark:bg-slate-700 rounded-lg mb-2" />
          <div className="h-4 w-32 bg-slate-100 dark:bg-slate-700/60 rounded-lg mb-4" />
          <div className="h-11 w-full bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const { activeTeam, teams, switchTeam, seasonId, refresh: refreshTeam } = useTeam()
  const { unreadByChallengeId } = useChat()
  const selectedTeamId = activeTeam?.id ?? null

  const [loading, setLoading]               = useState(true)
  const [playerName, setPlayerName]         = useState('')
  const [challenges, setChallenges]         = useState<DashboardChallenge[]>([])
  const [wins, setWins]                     = useState(0)
  const [losses, setLosses]                 = useState(0)
  const [recentMatches, setRecentMatches]   = useState<RecentMatch[]>([])
  const [freezeLoading, setFreezeLoading]   = useState(false)
  const [forfeitTarget, setForfeitTarget]   = useState<{ id: string; code: string; myTeamId: string; opponent: string } | null>(null)
  const [forfeiting, setForfeiting]         = useState(false)
  const [actionLoading, setActionLoading]   = useState<string | null>(null)
  const [scoreModal, setScoreModal]         = useState<DashboardChallenge | null>(null)
  const [scoreState, setScoreState]         = useState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' })
  const [scoreVenueId, setScoreVenueId]     = useState('')
  const [scoreSubmitting, setScoreSubmitting] = useState(false)
  const [venues, setVenues]                 = useState<Array<{ id: string; name: string; address?: string | null }>>([])
  const [chatLoading, setChatLoading]       = useState<string | null>(null)
  const [activeTickets, setActiveTickets]   = useState<Array<{ id: string; ticket_type: string }>>([])

  type OppStats = { wins: number; losses: number; played: number; recentForm: ('W' | 'L')[]; winStreak: number }
  const [opponentStatsMap, setOpponentStatsMap] = useState<Map<string, OppStats>>(new Map())
  const [myRecentForm, setMyRecentForm]     = useState<('W' | 'L')[]>([])
  const [myWinStreak, setMyWinStreak]       = useState(0)

  type OppMatch = { id: string; challenge_code: string; confirmed_time: string | null; accepted_slot: string | null; match_date: string | null; challenging_team_id: string; challenged_team_id: string; challenging_team: { id: string; name: string }; challenged_team: { id: string; name: string } }
  const [oppScheduledMap, setOppScheduledMap] = useState<Map<string, OppMatch[]>>(new Map())

  // ── Fetch player name once ────────────────────────────────────────────────
  useEffect(() => {
    const getPlayer = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('players').select('name').eq('id', user.id).single()
      if (data?.name) setPlayerName(data.name.split(' ')[0]) // first name only
    }
    getPlayer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Fetch challenges ──────────────────────────────────────────────────────
  const fetchChallenges = useCallback(async (teamId: string, sid: string) => {
    const { data, error } = await supabase
      .from('challenges')
      .select(`
        *,
        challenging_team:teams!challenging_team_id(
          id, name,
          player1:players!player1_id(id, name, phone),
          player2:players!player2_id(id, name, phone)
        ),
        challenged_team:teams!challenged_team_id(
          id, name,
          player1:players!player1_id(id, name, phone),
          player2:players!player2_id(id, name, phone)
        ),
        venue:venues!venue_id(id, name, address),
        match_result:match_results!challenge_id(*)
      `)
      .eq('season_id', sid)
      .or(`challenging_team_id.eq.${teamId},challenged_team_id.eq.${teamId}`)
      .in('status', [
        'pending', 'accepted', 'accepted_open', 'time_pending_confirm',
        'reschedule_requested', 'reschedule_pending_admin',
        'revision_proposed', 'scheduled', 'result_pending', 'played',
      ])
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Dashboard] fetchChallenges error:', error)
    }

    const normalised = (data || []).map(c => ({
      ...c,
      match_result: Array.isArray(c.match_result) ? (c.match_result[0] ?? null) : (c.match_result ?? null),
    })) as DashboardChallenge[]

    // Keep result_pending always; keep played only if not yet verified (legacy compat)
    const active = normalised.filter(c => {
      if (c.status === 'result_pending') return true
      if (c.status === 'played') {
        const mr = c.match_result
        return mr ? !mr.verified_at : false
      }
      return true
    })
    setChallenges(active)

    // Venues for score modal
    const { data: venueData } = await supabase
      .from('venues').select('id, name, address')
      .eq('season_id', sid).eq('is_active', true).order('name')
    setVenues(venueData || [])

    // W/L + all results for stats (verified match results + forfeit losses)
    const [{ count: w }, { count: l }, allResultsRes, forfeitAsChallenger, forfeitAsChallenged] = await Promise.all([
      supabase.from('match_results').select('id', { count: 'exact' })
        .eq('season_id', sid).eq('winner_team_id', teamId).not('verified_at', 'is', null),
      supabase.from('match_results').select('id', { count: 'exact' })
        .eq('season_id', sid).eq('loser_team_id', teamId).not('verified_at', 'is', null),
      supabase.from('match_results')
        .select('winner_team_id, loser_team_id, created_at')
        .eq('season_id', sid).not('verified_at', 'is', null)
        .order('created_at', { ascending: false }),
      // Forfeits where this team was the challenger and forfeited
      supabase.from('challenges').select('id', { count: 'exact', head: true })
        .eq('season_id', sid).eq('status', 'forfeited')
        .eq('forfeit_by', 'challenger').eq('challenging_team_id', teamId),
      // Forfeits where this team was the challenged and forfeited
      supabase.from('challenges').select('id', { count: 'exact', head: true })
        .eq('season_id', sid).eq('status', 'forfeited')
        .eq('forfeit_by', 'challenged').eq('challenged_team_id', teamId),
    ])
    const forfeitLossCount = (forfeitAsChallenger.count ?? 0) + (forfeitAsChallenged.count ?? 0)
    setWins(w ?? 0)
    setLosses((l ?? 0) + forfeitLossCount)

    // Last 5 verified match results for this team
    const { data: historyData } = await supabase
      .from('match_results')
      .select(`
        id, winner_team_id, loser_team_id, verified_at,
        set1_challenger, set1_challenged, set2_challenger, set2_challenged,
        supertiebreak_challenger, supertiebreak_challenged,
        challenge:challenges!challenge_id(
          id, challenge_code, challenging_team_id, challenged_team_id,
          challenging_team:teams!challenging_team_id(id, name),
          challenged_team:teams!challenged_team_id(id, name)
        )
      `)
      .eq('season_id', sid)
      .or(`winner_team_id.eq.${teamId},loser_team_id.eq.${teamId}`)
      .not('verified_at', 'is', null)
      .order('verified_at', { ascending: false })
      .limit(5)
    setRecentMatches((historyData || []).map((m: any) => ({
      ...m,
      challenge: Array.isArray(m.challenge) ? (m.challenge[0] ?? null) : (m.challenge ?? null),
    })) as RecentMatch[])

    // Build opponent stats
    const statsMap = new Map<string, OppStats>()
    const getOrCreate = (id: string) => {
      if (!statsMap.has(id)) statsMap.set(id, { wins: 0, losses: 0, played: 0, recentForm: [], winStreak: 0 })
      return statsMap.get(id)!
    }
    for (const mr of (allResultsRes.data || [])) {
      const ws = getOrCreate(mr.winner_team_id)
      const ls = getOrCreate(mr.loser_team_id)
      ws.wins++; ws.played++; if (ws.recentForm.length < 5) ws.recentForm.push('W')
      ls.losses++; ls.played++; if (ls.recentForm.length < 5) ls.recentForm.push('L')
    }
    for (const [, s] of statsMap) {
      let streak = 0
      for (const r of s.recentForm) { if (r === 'W') streak++; else break }
      s.winStreak = streak
    }
    setOpponentStatsMap(statsMap)
    const myS = statsMap.get(teamId)
    setMyRecentForm(myS?.recentForm ?? [])
    setMyWinStreak(myS?.winStreak ?? 0)

    // Opponent's other scheduled matches
    const myScheduled = (data || []).filter(c => c.status === 'scheduled')
    const oppIds = [...new Set(myScheduled.map(c =>
      c.challenging_team_id === teamId ? c.challenged_team_id : c.challenging_team_id
    ))]
    if (oppIds.length > 0) {
      const { data: oppSched } = await supabase
        .from('challenges')
        .select(`id, challenge_code, confirmed_time, accepted_slot, match_date, challenging_team_id, challenged_team_id,
          challenging_team:teams!challenging_team_id(id, name),
          challenged_team:teams!challenged_team_id(id, name)`)
        .eq('season_id', sid).eq('status', 'scheduled')
        .or(`challenging_team_id.in.(${oppIds.join(',')}),challenged_team_id.in.(${oppIds.join(',')})`)
      const newMap = new Map<string, OppMatch[]>()
      for (const oppId of oppIds) {
        newMap.set(oppId, (oppSched || []).filter(m =>
          (m.challenging_team_id === oppId || m.challenged_team_id === oppId) &&
          m.challenging_team_id !== teamId && m.challenged_team_id !== teamId
        ) as unknown as OppMatch[])
      }
      setOppScheduledMap(newMap)
    } else {
      setOppScheduledMap(new Map())
    }

    // Active (usable) tickets for this team
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('id, ticket_type')
      .eq('team_id', teamId)
      .eq('season_id', sid)
      .eq('status', 'active')
    setActiveTickets(ticketData || [])
  }, [supabase])

  // ── Re-fetch when active team or season changes ──────────────────────────
  useEffect(() => {
    if (selectedTeamId && seasonId) {
      setLoading(true)
      setChallenges([])
      setWins(0); setLosses(0)
      setMyRecentForm([]); setMyWinStreak(0)
      setOpponentStatsMap(new Map())
      setOppScheduledMap(new Map())
      setRecentMatches([])
      setActiveTickets([])
      fetchChallenges(selectedTeamId, seasonId).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [selectedTeamId, seasonId, fetchChallenges])

  const reload = useCallback(async () => {
    if (selectedTeamId && seasonId) await fetchChallenges(selectedTeamId, seasonId)
  }, [selectedTeamId, seasonId, fetchChallenges])

  // ── Realtime: re-fetch when any challenge or match result changes ──────────
  useEffect(() => {
    if (!selectedTeamId) return
    const channel = supabase
      .channel('dashboard-live-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'challenges' }, () => { reload() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'match_results' }, () => { reload() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, selectedTeamId, reload])

  // ── Actions ───────────────────────────────────────────────────────────────

  const doVerify = async (c: DashboardChallenge, action: 'verify' | 'dispute') => {
    const mr = c.match_result
    if (!mr || !selectedTeamId) return
    const verifyingTeamId = selectedTeamId !== mr.reported_by_team_id ? selectedTeamId : null
    if (!verifyingTeamId) { toast.error('Not authorized'); return }
    setActionLoading(c.id + ':' + action)
    try {
      const res = await fetch(`/api/matches/${mr.id}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teamId: verifyingTeamId }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed'); return }
      toast.success(action === 'verify' ? 'Result verified! Rankings updated.' : 'Result disputed — admin will review.')
      await reload()
    } catch { toast.error('An error occurred') }
    finally { setActionLoading(null) }
  }

  const doSubmitScore = async () => {
    const c = scoreModal
    if (!c || !selectedTeamId) return
    const { s1ch, s1cd, s2ch, s2cd, tbch, tbcd } = scoreState
    if (!s1ch || !s1cd || !s2ch || !s2cd) { toast.error('Enter scores for both sets'); return }
    const n = (v: string) => parseInt(v, 10)
    const set1ChallengerWon = n(s1ch) > n(s1cd)
    const set2ChallengerWon = n(s2ch) > n(s2cd)
    const challengerSetsWon = (set1ChallengerWon ? 1 : 0) + (set2ChallengerWon ? 1 : 0)
    const needsTiebreak = challengerSetsWon === 1
    if (needsTiebreak && (!tbch || !tbcd)) { toast.error('Sets are 1-1, enter the super tiebreak scores'); return }
    const winnerTeamId = challengerSetsWon >= 2
      ? c.challenging_team_id
      : needsTiebreak
        ? (n(tbch) > n(tbcd) ? c.challenging_team_id : c.challenged_team_id)
        : c.challenged_team_id
    setScoreSubmitting(true)
    try {
      const res = await fetch('/api/matches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: c.id, reportingTeamId: selectedTeamId, winnerTeamId,
          set1Challenger: n(s1ch), set1Challenged: n(s1cd),
          set2Challenger: n(s2ch), set2Challenged: n(s2cd),
          supertiebreakChallenger: needsTiebreak ? n(tbch) : null,
          supertiebreakChallenged: needsTiebreak ? n(tbcd) : null,
          matchDate: (c.match_date ?? c.accepted_slot) || new Date().toISOString(),
          matchLocation: c.match_location || null,
          venueId: scoreVenueId || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed to submit score'); return }
      toast.success('Score submitted! Waiting for opponent to verify.')
      setScoreModal(null)
      setScoreState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' })
      setScoreVenueId('')
      await reload()
    } catch { toast.error('An error occurred') }
    finally { setScoreSubmitting(false) }
  }

  async function handleFreeze() {
    if (!selectedTeamId) return
    if (!confirm('Freeze your team? You will drop 1 position immediately, then 1 more every week. You cannot freeze while in an active challenge.')) return
    setFreezeLoading(true)
    try {
      const res = await fetch(`/api/teams/${selectedTeamId}/freeze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to freeze team'); return }
      toast.success(`Team frozen. Dropped to rank #${data.newRank}.`)
      refreshTeam()
      if (seasonId) await fetchChallenges(selectedTeamId, seasonId)
    } catch { toast.error('Something went wrong') }
    finally { setFreezeLoading(false) }
  }

  async function handleUnfreeze() {
    if (!selectedTeamId) return
    setFreezeLoading(true)
    try {
      const res = await fetch(`/api/teams/${selectedTeamId}/unfreeze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to unfreeze team'); return }
      toast.success('Team unfrozen. You can now send and receive challenges.')
      refreshTeam()
      if (seasonId) await fetchChallenges(selectedTeamId, seasonId)
    } catch { toast.error('Something went wrong') }
    finally { setFreezeLoading(false) }
  }

  async function openChat(challengeId: string) {
    setChatLoading(challengeId)
    try {
      const res = await fetch(`/api/chat/challenge/${challengeId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.chatId) router.push(`/chat/${data.chatId}`)
      } else {
        toast.error('Chat not available yet')
      }
    } catch { toast.error('Failed to open chat') }
    finally { setChatLoading(null) }
  }

  function openForfeit(c: DashboardChallenge) {
    const myTeamId = c.challenging_team_id === selectedTeamId ? c.challenging_team_id : c.challenged_team_id
    setForfeitTarget({ id: c.id, code: c.challenge_code, myTeamId, opponent: opponent(c).name ?? 'opponent' })
  }

  async function handleForfeit() {
    if (!forfeitTarget) return
    setForfeiting(true)
    try {
      const res = await fetch(`/api/challenges/${forfeitTarget.id}/forfeit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forfeitingTeamId: forfeitTarget.myTeamId }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed to forfeit'); return }
      toast.success('Challenge forfeited.')
      setForfeitTarget(null)
      if (selectedTeamId && seasonId) await fetchChallenges(selectedTeamId, seasonId)
    } catch { toast.error('An error occurred') }
    finally { setForfeiting(false) }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const isLoading = (id: string) => actionLoading?.startsWith(id) ?? false

  const opponent = (c: DashboardChallenge) =>
    c.challenging_team_id === selectedTeamId ? c.challenged_team : c.challenging_team

  // OppContact: shows player names only — WA links are visible on the challenge detail page
  const OppContact = ({ c }: { c: DashboardChallenge }) => {
    const opp = opponent(c)
    const players: PlayerInfo[] = [(opp as any)?.player1, (opp as any)?.player2].filter(Boolean)
    if (players.length === 0) return null
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
        {players.map(p => p.name).join(' & ')}
      </p>
    )
  }

  const OpenChatBtn = ({ id }: { id: string }) => {
    const unread = unreadByChallengeId[id] ?? 0
    return (
      <button
        onClick={() => openChat(id)}
        disabled={chatLoading === id}
        className={`flex items-center justify-center gap-2 mt-2 w-full py-2 rounded-xl text-sm font-medium transition-colors ${
          unread > 0
            ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
            : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-700/60 dark:hover:bg-slate-700 dark:text-slate-300'
        }`}
      >
        {chatLoading === id
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <MessageCircle className="h-4 w-4" />}
        Chat
        {unread > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white text-emerald-600 text-[11px] font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    )
  }

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  }

  const slots = (c: DashboardChallenge) => [c.slot_1, c.slot_2, c.slot_3].filter(Boolean) as string[]

  // Always shows "Challenger vs Challenged" regardless of which team you are
  const matchup = (c: DashboardChallenge) =>
    `${c.challenging_team.name} vs ${c.challenged_team.name}`

  // ── Challenge categorisation ──────────────────────────────────────────────

  const receivedPending      = challenges.filter(c => c.challenged_team_id === selectedTeamId && c.status === 'pending')
  const awaitingConfirm      = challenges.filter(c => c.challenging_team_id === selectedTeamId && c.status === 'accepted')
  const needToEnterTime      = challenges.filter(c =>
    (c.challenged_team_id === selectedTeamId || c.challenging_team_id === selectedTeamId) && c.status === 'accepted_open')
  // time_pending_confirm: the team that did NOT submit the time confirms.
  // time_submitted_by_team_id tracks who entered it (set-time path).
  // Fallback (null submitter) = accepted path where challenger always confirms.
  const timePendingMyConfirm = challenges.filter(c => {
    if (c.status !== 'time_pending_confirm') return false
    const inChallenge = c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId
    if (!inChallenge) return false
    const submitter = c.time_submitted_by_team_id
    return submitter ? submitter !== selectedTeamId : c.challenging_team_id === selectedTeamId
  })
  const pendingVerify        = challenges.filter(c => {
    const mr = c.match_result
    if (!mr || c.status !== 'result_pending') return false
    return (c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId)
      && !mr.verified_at && mr.reported_by_team_id !== selectedTeamId
  })
  const scheduled            = challenges.filter(c => c.status === 'scheduled')
  const scheduledNeedResult  = scheduled.filter(c => {
    if (c.match_result) return false
    if (!(c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId)) return false
    const matchAt = c.confirmed_time ?? c.match_date ?? c.accepted_slot
    return matchAt ? new Date(matchAt) <= new Date() : false
  })

  const sentPending          = challenges.filter(c => c.challenging_team_id === selectedTeamId && c.status === 'pending')
  const sentAccepted         = challenges.filter(c => c.challenged_team_id === selectedTeamId && c.status === 'accepted')
  // Waiting: I submitted the time, waiting for the other team to confirm.
  const timeEnteredWaiting   = challenges.filter(c => {
    if (c.status !== 'time_pending_confirm') return false
    const inChallenge = c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId
    if (!inChallenge) return false
    const submitter = c.time_submitted_by_team_id
    return submitter ? submitter === selectedTeamId : c.challenged_team_id === selectedTeamId
  })
  const rescheduleWaiting    = challenges.filter(c =>
    (c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId) &&
    (c.status === 'reschedule_requested' || c.status === 'reschedule_pending_admin'))
  const submittedAwaiting    = challenges.filter(c => {
    const mr = c.match_result
    if (!mr || c.status !== 'result_pending') return false
    return mr.reported_by_team_id === selectedTeamId && !mr.verified_at
  })

  const actionCount = receivedPending.length + awaitingConfirm.length + needToEnterTime.length
    + timePendingMyConfirm.length + pendingVerify.length + scheduledNeedResult.length

  const waitingCount = sentPending.length + sentAccepted.length + timeEnteredWaiting.length
    + rescheduleWaiting.length + submittedAwaiting.length

  // ── Greeting ──────────────────────────────────────────────────────────────

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // ── Loading & empty states ────────────────────────────────────────────────

  if (loading) return <DashboardSkeleton />

  if (teams.length === 0) {
    return (
      <DCard className="p-12 text-center">
        <Users className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">No Teams Yet</h3>
        <p className="text-slate-500 mb-5">You haven't joined any teams for the current season.</p>
        <Link href="/ladder"><Button>Browse Teams</Button></Link>
      </DCard>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-3xl mx-auto">

      {/* ── Hero: greeting + team stats ── */}
      <DCard className="p-5">
        {/* Greeting */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {greeting}{playerName ? `, ${playerName}` : ''} 👋
          </h1>
          {actionCount > 0 ? (
            <p className="text-sm text-orange-600 dark:text-orange-400 font-medium mt-0.5">
              You have {actionCount} action{actionCount !== 1 ? 's' : ''} waiting
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-0.5">Here's your season overview</p>
          )}
        </div>


        {/* Stats row */}
        {activeTeam && (
          <div className="flex items-center gap-3 flex-wrap">
            {activeTeam.tierName && <TierBadge tier={activeTeam.tierName} />}
            {activeTeam.rank != null && (
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700/60 rounded-xl px-3 py-1.5">
                <Trophy className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="font-bold text-slate-900 dark:text-white text-base tabular-nums">#{activeTeam.rank}</span>
              </div>
            )}
            <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700/60 rounded-xl px-3 py-1.5">
              <span className="text-sm"><span className="font-bold text-emerald-600 dark:text-emerald-400">{wins}</span><span className="text-slate-500 ml-1">W</span></span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-sm"><span className="font-bold text-red-600 dark:text-red-400">{losses}</span><span className="text-slate-500 ml-1">L</span></span>
              {wins + losses > 0 && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-sm font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                    {Math.round((wins / (wins + losses)) * 100)}%
                  </span>
                </>
              )}
            </div>
            {/* Recent form dots */}
            {myRecentForm.length > 0 && (
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/60 rounded-xl px-3 py-1.5">
                {[...myRecentForm].reverse().slice(0,5).reverse().map((r, i) => (
                  <span key={i} className={`inline-flex items-center justify-center h-5 w-5 rounded-md text-[10px] font-bold
                    ${r === 'W' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'}`}>
                    {r}
                  </span>
                ))}
                {myWinStreak >= 3 && (
                  <span className="text-xs font-bold text-orange-500 ml-1">🔥{myWinStreak}</span>
                )}
              </div>
            )}
            <Link href="/ladder" className="ml-auto">
              <Button size="sm" className="gap-1.5 text-sm h-9">
                <Zap className="h-4 w-4" />Challenge
              </Button>
            </Link>
          </div>
        )}

        {/* Player names */}
        {activeTeam && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
            {activeTeam.player1Name} &amp; {activeTeam.player2Name}
          </p>
        )}

        {/* Active tickets */}
        {activeTickets.length > 0 && (() => {
          const TICKET_STYLE: Record<string, { label: string; cls: string; dot: string }> = {
            tier:   { label: 'Tier Ticket',   cls: 'bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-500/10 dark:border-violet-500/30 dark:text-violet-300', dot: 'bg-violet-500' },
            silver: { label: 'Silver Ticket', cls: 'bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-600/30 dark:border-slate-500/40 dark:text-slate-300', dot: 'bg-slate-400' },
            gold:   { label: 'Gold Ticket',   cls: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300', dot: 'bg-amber-400' },
          }
          return (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
              <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                🎫 Available Tickets
              </p>
              <div className="flex flex-wrap gap-2">
                {activeTickets.map(t => {
                  const s = TICKET_STYLE[t.ticket_type] ?? TICKET_STYLE.tier
                  return (
                    <Link key={t.id} href="/ladder">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold cursor-pointer transition-opacity hover:opacity-80 ${s.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                        {s.label}
                      </span>
                    </Link>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                Tap a ticket to go to the ladder and use it
              </p>
            </div>
          )
        })()}
      </DCard>

      {/* ── Frozen state banner ── */}
      {activeTeam?.status === 'frozen' && (
        <DCard className="p-4 border-blue-200 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/8">
          <div className="flex items-center gap-3">
            <Snowflake className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Team is Frozen</p>
              <p className="text-xs text-blue-600 dark:text-blue-400/70 mt-0.5">
                Your team drops 1 position every week. Unfreeze to resume challenges.
              </p>
            </div>
            <Button size="sm" onClick={handleUnfreeze} disabled={freezeLoading}
              className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white h-9 text-xs">
              {freezeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Unfreeze
            </Button>
          </div>
        </DCard>
      )}

      {/* ══════════════════════════════════════════════════════
          ACTION REQUIRED
      ══════════════════════════════════════════════════════ */}

      {actionCount > 0 && (
        <div>
          <SectionHeading icon={<AlertTriangle className="h-5 w-5" />} label="Action Required" count={actionCount} color="orange" />
          <div className="space-y-3">

            {/* Challenge received — needs response */}
            {receivedPending.map(c => (
              <DCard key={c.id} className="p-5 border-orange-200 dark:border-orange-500/30">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <StatusPill label="Challenge Received" color="orange" />
                      <CountdownPill deadline={c.accept_deadline} />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">{matchup(c)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">↓ They challenged you</p>
                    <OppContact c={c} />
                  </div>
                </div>
                {slots(c).length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Their suggested times</p>
                    {slots(c).map((slot, i) => (
                      <div key={slot} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600/40 text-sm text-slate-700 dark:text-slate-300">
                        <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="text-slate-400 text-xs mr-1">Slot {i + 1}</span>
                        {fmtDate(slot)}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Link href={`/challenges/${c.id}`} className="block">
                    <Button className="w-full h-11 text-sm font-semibold gap-2">
                      <Check className="h-4 w-4" />Respond to Challenge
                    </Button>
                  </Link>
                  <Link href={`/challenges/${c.id}`} className="block">
                    <Button variant="outline" className="w-full h-9 text-xs text-slate-500 gap-1.5">
                      <X className="h-3.5 w-3.5" />Decline (opens details)
                    </Button>
                  </Link>
                </div>
              </DCard>
            ))}

            {/* Confirmed time — challenger must confirm or dispute */}
            {awaitingConfirm.map(c => (
              <DCard key={c.id} className="p-5 border-orange-200 dark:border-orange-500/30">
                <div className="mb-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <StatusPill label="Confirm Match Time" color="orange" />
                    <CountdownPill deadline={c.confirmation_deadline} />
                  </div>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">{matchup(c)}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{opponent(c).name} set the match time</p>
                  <OppContact c={c} />
                  {c.confirmed_time && (
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mt-1">
                      📅 {fmtDate(c.confirmed_time)}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5">Auto-confirms if you don't respond in time</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button className="w-full h-11 text-sm font-semibold gap-2"
                    onClick={async () => {
                      setActionLoading(c.id + ':confirm')
                      try {
                        const res = await fetch(`/api/challenges/${c.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) })
                        if (res.ok) { toast.success('Match confirmed!'); await reload() }
                        else { const d = await res.json(); toast.error(d.error || 'Failed') }
                      } catch { toast.error('An error occurred') }
                      finally { setActionLoading(null) }
                    }}
                    disabled={!!actionLoading}>
                    {isLoading(c.id + ':confirm') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Yes, this time is correct
                  </Button>
                  <Button variant="outline" className="w-full h-9 text-xs gap-1.5 text-slate-600 dark:text-slate-300"
                    onClick={async () => {
                      setActionLoading(c.id + ':dispute')
                      try {
                        const res = await fetch(`/api/challenges/${c.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'dispute' }) })
                        if (res.ok) { toast.success('Disputed — they will re-enter the time.'); await reload() }
                        else { const d = await res.json(); toast.error(d.error || 'Failed') }
                      } catch { toast.error('An error occurred') }
                      finally { setActionLoading(null) }
                    }}
                    disabled={!!actionLoading}>
                    {isLoading(c.id + ':dispute') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Dispute — time doesn't match
                  </Button>
                </div>
                <OpenChatBtn id={c.id} />
              </DCard>
            ))}

            {/* accepted_open — either team enters agreed time */}
            {needToEnterTime.map(c => (
              <DCard key={c.id} className="p-5 border-yellow-200 dark:border-amber-500/30">
                <div className="mb-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <StatusPill label="Enter Agreed Time" color="yellow" />
                  </div>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">{matchup(c)}</p>
                  <OppContact c={c} />
                  <p className="text-sm text-slate-500 mt-1">
                    {c.challenging_team_id === selectedTeamId
                      ? 'Your opponent accepted — either of you can now enter the agreed time.'
                      : 'You accepted — either of you can now enter the agreed time.'}
                  </p>
                  {(c as any).match_deadline && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      Play by {new Date((c as any).match_deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                  )}
                </div>
                <Link href={`/challenges/${c.id}`} className="block">
                  <Button className="w-full h-11 text-sm font-semibold gap-2 bg-amber-500 hover:bg-amber-600">
                    <Calendar className="h-4 w-4" />Enter Match Time &amp; Venue
                  </Button>
                </Link>
                <OpenChatBtn id={c.id} />
              </DCard>
            ))}

            {/* time_pending_confirm — challenger must confirm opponent's proposed time */}
            {timePendingMyConfirm.map(c => (
              <DCard key={c.id} className="p-5 border-orange-200 dark:border-orange-500/30">
                <div className="mb-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <StatusPill label="Confirm Match Time" color="orange" />
                    <CountdownPill deadline={c.confirmation_deadline} />
                  </div>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">{matchup(c)}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{opponent(c).name} proposed a time</p>
                  <OppContact c={c} />
                  {(c as any).reschedule_proposed_time && (
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mt-1">📅 {fmtDate((c as any).reschedule_proposed_time)}</p>
                  )}
                </div>
                <Link href={`/challenges/${c.id}`} className="block">
                  <Button className="w-full h-11 text-sm font-semibold gap-2">
                    <Check className="h-4 w-4" />Review &amp; Confirm Time
                  </Button>
                </Link>
                <OpenChatBtn id={c.id} />
              </DCard>
            ))}

            {/* Verify result */}
            {pendingVerify.map(c => {
              const mr = c.match_result!
              const winnerName = mr.winner_team_id === c.challenging_team_id ? c.challenging_team.name : c.challenged_team.name
              const sets = [
                { label: 'Set 1', ch: mr.set1_challenger, cd: mr.set1_challenged },
                { label: 'Set 2', ch: mr.set2_challenger, cd: mr.set2_challenged },
                ...(mr.supertiebreak_challenger != null ? [{ label: 'TB', ch: mr.supertiebreak_challenger, cd: mr.supertiebreak_challenged }] : []),
              ].filter(s => s.ch != null)
              return (
                <DCard key={c.id} className="p-5 border-blue-200 dark:border-blue-500/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusPill label="Verify Result" color="blue" />
                      <CountdownPill deadline={mr.verify_deadline} urgent />
                    </div>
                    <Link href={`/challenges/${c.id}`}>
                      <button className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-0.5">
                        Details <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </Link>
                  </div>
                  {/* Score block */}
                  <div className="bg-slate-50 dark:bg-slate-700/40 rounded-xl p-4 mb-3 space-y-2">
                    <div className="flex justify-between text-xs font-medium text-slate-500 px-1">
                      <span className="truncate max-w-[45%]">{c.challenging_team.name}</span>
                      <span className="truncate max-w-[45%] text-right">{c.challenged_team.name}</span>
                    </div>
                    {sets.map(s => (
                      <div key={s.label} className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs w-8 shrink-0 text-center">{s.label}</span>
                        <div className="flex items-center gap-2 flex-1 justify-center">
                          <span className={`text-2xl font-bold tabular-nums ${s.ch! > s.cd! ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-500'}`}>{s.ch}</span>
                          <span className="text-slate-300 dark:text-slate-600 font-bold">–</span>
                          <span className={`text-2xl font-bold tabular-nums ${s.cd! > s.ch! ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-500'}`}>{s.cd}</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-600/50">
                      <Trophy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="text-xs text-slate-500">Winner:</span>
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 truncate">{winnerName}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button className="w-full h-11 text-sm font-semibold gap-2"
                      onClick={() => doVerify(c, 'verify')} disabled={isLoading(c.id)}>
                      {isLoading(c.id + ':verify') ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Verify Result
                    </Button>
                    <Button variant="outline" className="w-full h-9 text-xs border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10 gap-1.5"
                      onClick={() => doVerify(c, 'dispute')} disabled={isLoading(c.id)}>
                      {isLoading(c.id + ':dispute') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      Dispute Score
                    </Button>
                  </div>
                </DCard>
              )
            })}

            {/* Scheduled match needing result submission */}
            {scheduledNeedResult.map(c => {
              const matchAt = c.confirmed_time ?? c.match_date ?? c.accepted_slot
              return (
                <DCard key={c.id} className="p-5 border-yellow-200 dark:border-yellow-500/30">
                  <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <StatusPill label="Submit Result" color="yellow" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">{matchup(c)}</p>
                    <OppContact c={c} />
                    {matchAt && <p className="text-sm text-slate-500 mt-0.5">{fmtDate(matchAt)}</p>}
                  </div>
                  <Button className="w-full h-11 text-sm font-semibold gap-2 bg-amber-500 hover:bg-amber-600 text-white dark:text-slate-900"
                    onClick={() => { setScoreModal(c); setScoreState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' }); const v = Array.isArray((c as any).venue) ? (c as any).venue[0] : (c as any).venue; setScoreVenueId(v?.id ?? '') }}>
                    <Flag className="h-4 w-4" />Enter Match Score
                  </Button>
                </DCard>
              )
            })}

          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          UPCOMING MATCHES
      ══════════════════════════════════════════════════════ */}

      {scheduled.length > 0 && (
        <div>
          <SectionHeading icon={<Calendar className="h-5 w-5" />} label="Upcoming Matches" count={scheduled.length} color="emerald" />
          <div className="space-y-3">
            {scheduled.map(c => {
              const matchAt = c.confirmed_time ?? c.accepted_slot ?? c.match_date
              const isPast = matchAt ? new Date(matchAt) < new Date() : false
              const canReport = !c.match_result && (c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId)
              const venueRaw = Array.isArray(c.venue) ? c.venue[0] : c.venue
              const locationLabel = venueRaw?.name ?? c.match_location ?? null
              const isOutgoing = c.challenging_team_id === selectedTeamId
              const oppId = opponent(c).id
              const os = opponentStatsMap.get(oppId)
              return (
                <DCard key={c.id} className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border uppercase tracking-wide
                          ${isPast
                            ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/30'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30'}`}>
                          {isPast ? 'Match Played?' : 'Scheduled'}
                        </span>
                        <span className={`text-[11px] font-medium ${isOutgoing ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {isOutgoing ? '↑ You challenged' : '↓ Challenged you'}
                        </span>
                        <code className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 rounded-md">
                          {c.challenge_code}
                        </code>
                      </div>

                      <p className="text-lg font-bold text-slate-900 dark:text-white leading-tight">{matchup(c)}</p>
                      <OppContact c={c} />

                      {/* Opponent stats */}
                      {os && os.played > 0 && (
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-xs font-semibold">
                            <span className="text-emerald-600 dark:text-emerald-500">{os.wins}W</span>
                            <span className="text-slate-300 dark:text-slate-600 mx-1">·</span>
                            <span className="text-red-600 dark:text-red-500">{os.losses}L</span>
                          </span>
                          <span className="text-xs text-slate-400">{Math.round((os.wins / os.played) * 100)}%</span>
                          {os.recentForm.length > 0 && (
                            <div className="flex items-center gap-0.5">
                              {[...os.recentForm].reverse().slice(0,5).reverse().map((r, i) => (
                                <span key={i} className={`inline-block h-1.5 w-1.5 rounded-full ${r === 'W' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                              ))}
                            </div>
                          )}
                          {os.winStreak >= 3 && <span className="text-xs text-orange-500 font-bold">🔥{os.winStreak}</span>}
                        </div>
                      )}

                      {/* Date/time/venue block */}
                      {matchAt ? (
                        <div className="mt-3 inline-flex flex-col gap-1 bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600/40 rounded-xl px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-base">📅</span>
                            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                              {new Date(matchAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-base">🕐</span>
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                              {new Date(matchAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                          </div>
                          {locationLabel && (
                            <div className="flex items-center gap-2">
                              <span className="text-base">📍</span>
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                                {locationLabel}{venueRaw?.address ? ` · ${venueRaw.address}` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 mt-1">Time not yet confirmed</p>
                      )}
                      {!matchAt && locationLabel && (
                        <p className="text-sm text-slate-500 mt-0.5">📍 {locationLabel}{venueRaw?.address ? ` · ${venueRaw.address}` : ''}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {canReport && (
                        <Button size="sm" className="text-xs h-9 px-3 gap-1.5"
                          onClick={() => { setScoreModal(c); setScoreState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' }); const v = Array.isArray((c as any).venue) ? (c as any).venue[0] : (c as any).venue; setScoreVenueId(v?.id ?? '') }}>
                          <Flag className="h-3.5 w-3.5" />Score
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-xs h-9 gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 relative"
                        onClick={() => openChat(c.id)} disabled={chatLoading === c.id}>
                        {chatLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (
                          <span className="relative">
                            <MessageCircle className="h-3.5 w-3.5" />
                            {(unreadByChallengeId[c.id] ?? 0) > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">{unreadByChallengeId[c.id] > 9 ? '9+' : unreadByChallengeId[c.id]}</span>
                            )}
                          </span>
                        )}
                        Chat
                      </Button>
                      <Link href={`/challenges/${c.id}`}>
                        <Button size="sm" variant="outline" className="text-xs h-9 w-full">Details</Button>
                      </Link>
                      <button onClick={() => openForfeit(c)}
                        className="text-xs text-red-400/60 hover:text-red-500 dark:text-red-400/50 dark:hover:text-red-400 transition-colors text-center">
                        Forfeit
                      </button>
                    </div>
                  </div>
                </DCard>
              )
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          WAITING ON OTHERS
      ══════════════════════════════════════════════════════ */}

      {waitingCount > 0 && (
        <div>
          <SectionHeading icon={<Clock className="h-5 w-5" />} label="Waiting for Response" count={waitingCount} color="blue" />
          <div className="space-y-3">

            {sentPending.map(c => (
              <DCard key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusPill label="Challenge Sent" color="blue" />
                      <CountdownPill deadline={c.accept_deadline} />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">{matchup(c)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">↑ You challenged</p>
                    <OppContact c={c} />
                    <p className="text-sm text-slate-500 mt-0.5">Waiting for them to respond</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link href={`/challenges/${c.id}`}>
                      <button className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-0.5">
                        View <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </Link>
                    <button onClick={() => openChat(c.id)} disabled={chatLoading === c.id}
                      className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                      {chatLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (
                        <span className="relative">
                          <MessageCircle className="h-3 w-3" />
                          {(unreadByChallengeId[c.id] ?? 0) > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">
                              {unreadByChallengeId[c.id] > 9 ? '9+' : unreadByChallengeId[c.id]}
                            </span>
                          )}
                        </span>
                      )}
                      Chat
                    </button>
                  </div>
                </div>
              </DCard>
            ))}

            {sentAccepted.map(c => (
              <DCard key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusPill label="Awaiting Confirmation" color="blue" />
                      <CountdownPill deadline={c.confirmation_deadline} />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      {matchup(c)}
                    </p>
                    <OppContact c={c} />
                    {c.confirmed_time && <p className="text-sm text-slate-500 mt-0.5">Time: {fmtDate(c.confirmed_time)}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">Auto-confirms if they don't respond in time</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link href={`/challenges/${c.id}`}>
                      <button className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-0.5">
                        View <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </Link>
                    <button onClick={() => openChat(c.id)} disabled={chatLoading === c.id}
                      className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                      {chatLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (<span className="relative"><MessageCircle className="h-3 w-3" />{(unreadByChallengeId[c.id] ?? 0) > 0 && (<span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">{unreadByChallengeId[c.id] > 9 ? '9+' : unreadByChallengeId[c.id]}</span>)}</span>)}
                      Chat
                    </button>
                  </div>
                </div>
              </DCard>
            ))}

            {timeEnteredWaiting.map(c => (
              <DCard key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusPill label="Time Proposed" color="blue" />
                      <CountdownPill deadline={c.confirmation_deadline} />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      {matchup(c)}
                    </p>
                    <OppContact c={c} />
                    <p className="text-sm text-slate-500 mt-0.5">You entered the time — waiting for them to confirm</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link href={`/challenges/${c.id}`}>
                      <button className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-0.5">
                        View <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </Link>
                    <button onClick={() => openChat(c.id)} disabled={chatLoading === c.id}
                      className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                      {chatLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (<span className="relative"><MessageCircle className="h-3 w-3" />{(unreadByChallengeId[c.id] ?? 0) > 0 && (<span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">{unreadByChallengeId[c.id] > 9 ? '9+' : unreadByChallengeId[c.id]}</span>)}</span>)}
                      Chat
                    </button>
                  </div>
                </div>
              </DCard>
            ))}

            {rescheduleWaiting.map(c => (
              <DCard key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusPill label={c.status === 'reschedule_pending_admin' ? 'Admin Review' : 'Reschedule Requested'} color="purple" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      {matchup(c)}
                    </p>
                    <OppContact c={c} />
                    <p className="text-sm text-slate-500 mt-0.5">
                      {c.status === 'reschedule_pending_admin'
                        ? 'Both teams agreed to reschedule — waiting for admin'
                        : 'A reschedule has been requested'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link href={`/challenges/${c.id}`}>
                      <button className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-0.5">
                        View <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </Link>
                    <button onClick={() => openChat(c.id)} disabled={chatLoading === c.id}
                      className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                      {chatLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (<span className="relative"><MessageCircle className="h-3 w-3" />{(unreadByChallengeId[c.id] ?? 0) > 0 && (<span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">{unreadByChallengeId[c.id] > 9 ? '9+' : unreadByChallengeId[c.id]}</span>)}</span>)}
                      Chat
                    </button>
                  </div>
                </div>
              </DCard>
            ))}

            {submittedAwaiting.map(c => (
              <DCard key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusPill label="Result Submitted" color="slate" />
                      <CountdownPill deadline={c.match_result?.verify_deadline} />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      {matchup(c)}
                    </p>
                    <OppContact c={c} />
                    <p className="text-sm text-slate-500 mt-0.5">
                      {c.match_result?.verify_deadline && new Date(c.match_result.verify_deadline) < new Date()
                        ? 'Timer expired — auto-approval running shortly'
                        : 'Waiting for them to verify — auto-approves when timer expires'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Link href={`/challenges/${c.id}`}>
                      <button className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-0.5">
                        View <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </Link>
                    <button onClick={() => openChat(c.id)} disabled={chatLoading === c.id}
                      className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                      {chatLoading === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (<span className="relative"><MessageCircle className="h-3 w-3" />{(unreadByChallengeId[c.id] ?? 0) > 0 && (<span className="absolute -top-1.5 -right-1.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center">{unreadByChallengeId[c.id] > 9 ? '9+' : unreadByChallengeId[c.id]}</span>)}</span>)}
                      Chat
                    </button>
                  </div>
                </div>
              </DCard>
            ))}

          </div>
        </div>
      )}

      {/* ── Empty state — no challenges at all ── */}
      {challenges.length === 0 && (
        <DCard className="p-10 text-center">
          <Zap className="h-12 w-12 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">No active challenges</p>
          <p className="text-sm text-slate-500 mb-5">Send a challenge to start climbing the ladder</p>
          <Link href="/ladder">
            <Button className="gap-2"><Zap className="h-4 w-4" />Browse Ladder</Button>
          </Link>
        </DCard>
      )}

      {/* ══════════════════════════════════════════════════════
          MATCH HISTORY (last 5 verified)
      ══════════════════════════════════════════════════════ */}

      {recentMatches.length > 0 && (
        <div>
          <SectionHeading icon={<TrendingUp className="h-5 w-5" />} label="Recent Results" color="slate" />
          <DCard>
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {recentMatches.map(m => {
                const ch = m.challenge
                if (!ch) return null
                const won = m.winner_team_id === selectedTeamId
                const myTeamName = won
                  ? (ch.challenging_team_id === selectedTeamId ? ch.challenging_team.name : ch.challenged_team.name)
                  : (ch.challenging_team_id === selectedTeamId ? ch.challenging_team.name : ch.challenged_team.name)
                const oppTeamName = won
                  ? (ch.challenging_team_id !== selectedTeamId ? ch.challenging_team.name : ch.challenged_team.name)
                  : (ch.challenging_team_id !== selectedTeamId ? ch.challenging_team.name : ch.challenged_team.name)

                // Build score string from my team's perspective
                const isChallenger = ch.challenging_team_id === selectedTeamId
                const mySet1 = isChallenger ? m.set1_challenger : m.set1_challenged
                const opSet1 = isChallenger ? m.set1_challenged : m.set1_challenger
                const mySet2 = isChallenger ? m.set2_challenger : m.set2_challenged
                const opSet2 = isChallenger ? m.set2_challenged : m.set2_challenger
                const scoreStr = m.supertiebreak_challenger != null
                  ? `${mySet1}-${opSet1}, ${mySet2}-${opSet2}, ${isChallenger ? m.supertiebreak_challenger : m.supertiebreak_challenged}-${isChallenger ? m.supertiebreak_challenged : m.supertiebreak_challenger}`
                  : `${mySet1}-${opSet1}, ${mySet2}-${opSet2}`

                return (
                  <Link key={m.id} href={`/challenges/${ch.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                    {/* W/L indicator */}
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-xl text-sm font-bold shrink-0
                      ${won
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'}`}>
                      {won ? 'W' : 'L'}
                    </span>
                    {/* Opponent */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">vs {oppTeamName}</p>
                      <p className="text-xs text-slate-400 font-mono">{scoreStr}</p>
                    </div>
                    {/* Date */}
                    <p className="text-xs text-slate-400 shrink-0">
                      {new Date(m.verified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                    <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
                  </Link>
                )
              })}
            </div>
          </DCard>
        </div>
      )}

      {/* ── Freeze toggle (active teams only) ── */}
      {activeTeam && activeTeam.status === 'active' && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-slate-400">
            Need a break?{' '}
            <button onClick={handleFreeze} disabled={freezeLoading}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline underline-offset-2 transition-colors">
              {freezeLoading ? 'Freezing…' : 'Freeze your team'}
            </button>
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          SCORE ENTRY MODAL
      ══════════════════════════════════════════════════════ */}

      {scoreModal && (() => {
        const c = scoreModal
        const { s1ch, s1cd, s2ch, s2cd, tbch, tbcd } = scoreState
        const n = (v: string) => parseInt(v, 10) || 0
        const set1ChWon = s1ch && s1cd ? n(s1ch) > n(s1cd) : null
        const set2ChWon = s2ch && s2cd ? n(s2ch) > n(s2cd) : null
        const chSets = (set1ChWon ? 1 : 0) + (set2ChWon ? 1 : 0)
        const cdSets = ((set1ChWon === false) ? 1 : 0) + ((set2ChWon === false) ? 1 : 0)
        const needsTB = s1ch && s1cd && s2ch && s2cd && chSets === 1 && cdSets === 1
        const winner = chSets >= 2 ? c.challenging_team.name
          : cdSets >= 2 ? c.challenged_team.name
          : needsTB && tbch && tbcd ? (n(tbch) > n(tbcd) ? c.challenging_team.name : c.challenged_team.name)
          : null
        const setScores = (field: keyof typeof scoreState) => (e: React.ChangeEvent<HTMLInputElement>) =>
          setScoreState(prev => ({ ...prev, [field]: e.target.value }))
        const ScoreRow = ({ label, chField, cdField }: { label: string; chField: keyof typeof scoreState; cdField: keyof typeof scoreState }) => (
          <div className="flex items-center gap-3">
            <span className="text-slate-500 dark:text-slate-400 text-xs font-semibold w-8 shrink-0 text-center">{label}</span>
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <p className="text-xs text-slate-500 mb-1 truncate text-center font-medium">{c.challenging_team.name}</p>
                <Input type="number" min="0" max="99" inputMode="numeric"
                  value={scoreState[chField]} onChange={setScores(chField)}
                  className="text-center h-14 text-2xl font-bold" placeholder="0" />
              </div>
              <span className="text-slate-300 dark:text-slate-600 font-bold text-xl mt-6 shrink-0">–</span>
              <div className="flex-1">
                <p className="text-xs text-slate-500 mb-1 truncate text-center font-medium">{c.challenged_team.name}</p>
                <Input type="number" min="0" max="99" inputMode="numeric"
                  value={scoreState[cdField]} onChange={setScores(cdField)}
                  className="text-center h-14 text-2xl font-bold" placeholder="0" />
              </div>
            </div>
          </div>
        )
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center"
            onClick={e => { if (e.target === e.currentTarget) setScoreModal(null) }}>
            <div className="w-full sm:max-w-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
              rounded-t-2xl sm:rounded-2xl p-5 space-y-5 max-h-[92vh] overflow-y-auto shadow-xl">
              <div className="flex justify-center sm:hidden">
                <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Flag className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    <h3 className="font-bold text-slate-900 dark:text-white text-xl">Enter Match Score</h3>
                  </div>
                  <p className="text-slate-500 text-sm mt-0.5">{c.challenging_team.name} vs {c.challenged_team.name}</p>
                </div>
                <button onClick={() => setScoreModal(null)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-2 -mr-1 rounded-xl">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4">
                <ScoreRow label="Set 1" chField="s1ch" cdField="s1cd" />
                <ScoreRow label="Set 2" chField="s2ch" cdField="s2cd" />
                {needsTB && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                      <span className="text-xs text-orange-500 font-bold tracking-wide">SUPER TIEBREAK</span>
                      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <ScoreRow label="TB" chField="tbch" cdField="tbcd" />
                  </div>
                )}
              </div>
              {venues.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
                    Venue Played At
                  </label>
                  <select value={scoreVenueId} onChange={e => setScoreVenueId(e.target.value)}
                    className="w-full bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-emerald-500 h-11">
                    <option value="">— No change / unknown —</option>
                    {venues.map(v => <option key={v.id} value={v.id}>{v.name}{v.address ? ` · ${v.address}` : ''}</option>)}
                  </select>
                </div>
              )}
              {winner ? (
                <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl">
                  <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-500">Winner</p>
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">{winner}</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600/40 rounded-xl text-center">
                  <p className="text-slate-400 text-sm">Enter scores above to see winner</p>
                </div>
              )}
              <div className="flex gap-3 pb-1">
                <Button onClick={doSubmitScore} disabled={scoreSubmitting || !winner}
                  className="flex-1 h-12 text-base font-semibold gap-2">
                  {scoreSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
                  Submit Score
                </Button>
                <Button onClick={() => setScoreModal(null)} variant="outline" className="h-12 px-5">Cancel</Button>
              </div>
              <p className="text-xs text-slate-400 text-center pb-1">The opposing team will verify this result.</p>
            </div>
          </div>
        )
      })()}

      {/* ── Forfeit confirmation modal ── */}
      {forfeitTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-500/20 rounded-xl shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-lg">Forfeit challenge?</h3>
                <p className="text-slate-500 text-sm mt-0.5">
                  vs <span className="text-slate-700 dark:text-slate-300 font-medium">{forfeitTarget.opponent}</span>
                  {' · '}<code className="text-xs text-slate-400">{forfeitTarget.code}</code>
                </p>
              </div>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">This counts as a forfeit loss.</p>
              <p className="text-xs text-red-600/70 dark:text-red-300/70 mt-0.5">Your team will drop positions. This cannot be undone.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setForfeitTarget(null)} disabled={forfeiting} className="flex-1 h-11">
                Cancel
              </Button>
              <Button onClick={handleForfeit} disabled={forfeiting}
                className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white">
                {forfeiting ? 'Forfeiting…' : 'Forfeit'}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
