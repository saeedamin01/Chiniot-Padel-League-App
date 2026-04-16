'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  Trophy, Zap, Calendar, Clock, AlertTriangle, CheckCircle,
  XCircle, RefreshCw, ChevronDown, ArrowRight, Loader2,
  Check, X, Flag, Users, AlertCircle, Snowflake, MessageCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { TierBadge } from '@/components/ui/tier-badge'
import type { Team, LadderPosition, Challenge, MatchResult } from '@/types'
import { useTeam } from '@/context/TeamContext'

// ─── Types ───────────────────────────────────────────────────────────────────

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

  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  const expired = remaining === 0

  return { hours, minutes, seconds, expired, remaining }
}

function CountdownPill({ deadline, urgent }: { deadline: string | null | undefined; urgent?: boolean }) {
  const { hours, minutes, seconds, expired } = useCountdown(deadline)
  if (!deadline) return null
  const isUrgent = urgent || (!expired && hours < 1)
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full border ${
      expired
        ? 'bg-red-500/10 text-red-400 border-red-500/30'
        : isUrgent
        ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
        : 'bg-slate-700/50 text-slate-300 border-slate-600/50'
    }`}>
      <Clock className="h-3 w-3 flex-shrink-0" />
      {expired ? 'Expired' : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`}
    </span>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon, label, count, color }: {
  icon: React.ReactNode
  label: string
  count: number
  color: string
}) {
  return (
    <div className={`flex items-center gap-2 mb-3`}>
      <span className={color}>{icon}</span>
      <h2 className="font-semibold text-white text-base">{label}</h2>
      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${color} bg-current/10`}
        style={{ backgroundColor: 'rgba(var(--tw-text-opacity),0.1)' }}>
        {count}
      </span>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient()
  // ── Team context — single source of truth for active team ────────────────────
  const { activeTeam, teams, seasonId, refresh: refreshTeam } = useTeam()
  const selectedTeamId = activeTeam?.id ?? null

  const [loading, setLoading] = useState(true)
  const [challenges, setChallenges] = useState<DashboardChallenge[]>([])
  const [wins, setWins] = useState(0)
  const [losses, setLosses] = useState(0)

  // Freeze/unfreeze state
  const [freezeLoading, setFreezeLoading] = useState(false)

  // Forfeit state
  const [forfeitTarget, setForfeitTarget] = useState<{ id: string; code: string; myTeamId: string; opponent: string } | null>(null)
  const [forfeiting, setForfeiting] = useState(false)

  // Inline action state
  const [actionLoading, setActionLoading] = useState<string | null>(null) // stores challenge id

  // Inline score-entry state
  const [scoreModal, setScoreModal] = useState<DashboardChallenge | null>(null)
  const [scoreState, setScoreState] = useState({
    s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '',
  })
  const [scoreVenueId, setScoreVenueId] = useState('')
  const [scoreSubmitting, setScoreSubmitting] = useState(false)

  // Venues for the active season (used in score modal)
  const [venues, setVenues] = useState<Array<{ id: string; name: string; address?: string | null }>>([])

  // Opponent stats map: teamId → { wins, losses, played, recentForm, winStreak }
  type OppStats = { wins: number; losses: number; played: number; recentForm: ('W' | 'L')[]; winStreak: number }
  const [opponentStatsMap, setOpponentStatsMap] = useState<Map<string, OppStats>>(new Map())

  // ── Fetch challenges for selected team ──────────────────────────────────────
  const fetchChallenges = useCallback(async (teamId: string, sid: string) => {
    const { data } = await supabase
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
        match_result:match_results(*)
      `)
      .eq('season_id', sid)
      .or(`challenging_team_id.eq.${teamId},challenged_team_id.eq.${teamId}`)
      .in('status', [
        'pending', 'accepted', 'accepted_open', 'time_pending_confirm',
        'reschedule_requested', 'reschedule_pending_admin',
        'revision_proposed', 'scheduled', 'played',
      ])
      .order('created_at', { ascending: false })

    const normalised = (data || []).map(c => ({
      ...c,
      match_result: Array.isArray(c.match_result) ? (c.match_result[0] ?? null) : (c.match_result ?? null),
    })) as DashboardChallenge[]

    setChallenges(normalised)

    // Venues for the season (for score modal)
    const { data: venueData } = await supabase
      .from('venues')
      .select('id, name, address')
      .eq('season_id', sid)
      .eq('is_active', true)
      .order('name')
    setVenues(venueData || [])

    // Win/loss count for my team + all match results for opponent stats
    const [{ count: w }, { count: l }, allResultsRes] = await Promise.all([
      supabase.from('match_results').select('id', { count: 'exact' })
        .eq('season_id', sid).eq('winner_team_id', teamId),
      supabase.from('match_results').select('id', { count: 'exact' })
        .eq('season_id', sid).eq('loser_team_id', teamId),
      supabase.from('match_results')
        .select('winner_team_id, loser_team_id, created_at')
        .eq('season_id', sid)
        .order('created_at', { ascending: false }),
    ])
    setWins(w ?? 0)
    setLosses(l ?? 0)

    // Build opponent stats map from all season match results
    const statsMap = new Map<string, { wins: number; losses: number; played: number; recentForm: ('W' | 'L')[]; winStreak: number }>()
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
  }, [supabase])

  // ── Re-fetch challenges when active team or season changes ──────────────────
  useEffect(() => {
    if (selectedTeamId && seasonId) {
      fetchChallenges(selectedTeamId, seasonId).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [selectedTeamId, seasonId, fetchChallenges])

  // ── Reload helper ────────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    if (selectedTeamId && seasonId) await fetchChallenges(selectedTeamId, seasonId)
  }, [selectedTeamId, seasonId, fetchChallenges])

  // ── Actions ──────────────────────────────────────────────────────────────────

  const doVerify = async (c: DashboardChallenge, action: 'verify' | 'dispute') => {
    const mr = c.match_result
    if (!mr || !selectedTeamId) return
    const verifyingTeamId = selectedTeamId !== mr.reported_by_team_id ? selectedTeamId : null
    if (!verifyingTeamId) { toast.error('Not authorized'); return }

    setActionLoading(c.id + ':' + action)
    try {
      const res = await fetch(`/api/matches/${mr.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, teamId: verifyingTeamId }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Failed'); return }
      toast.success(action === 'verify' ? 'Result verified! Rankings updated.' : 'Result disputed — admin will review.')
      await reload()
    } catch { toast.error('An error occurred') }
    finally { setActionLoading(null) }
  }

  // ── Submit score ─────────────────────────────────────────────────────────────
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: c.id,
          reportingTeamId: selectedTeamId,
          winnerTeamId,
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

  // ── Compute sections ─────────────────────────────────────────────────────────

  const isLoading = (id: string) => actionLoading?.startsWith(id) ?? false

  const receivedPending     = challenges.filter(c => c.challenged_team_id === selectedTeamId && c.status === 'pending')
  // 'accepted' — challenging team needs to confirm the time entered by challenged team (old flow)
  const awaitingConfirm     = challenges.filter(c => c.challenging_team_id === selectedTeamId && c.status === 'accepted')
  // 'accepted_open' — either team can enter the agreed time; both sides see it as action required
  const needToEnterTime     = challenges.filter(c =>
    (c.challenged_team_id === selectedTeamId || c.challenging_team_id === selectedTeamId) &&
    c.status === 'accepted_open'
  )
  // 'time_pending_confirm' — opponent (challenged team) entered a time, I (challenger) need to confirm it
  const timePendingMyConfirm = challenges.filter(c => c.challenging_team_id === selectedTeamId && c.status === 'time_pending_confirm')
  const pendingVerify       = challenges.filter(c => {
    const mr = c.match_result
    if (!mr || c.status !== 'played') return false
    const isOpponent = (c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId)
    return isOpponent && !mr.verified_at && mr.reported_by_team_id !== selectedTeamId
  })

  const sentPending         = challenges.filter(c => c.challenging_team_id === selectedTeamId && c.status === 'pending')
  // challenged team entered the time, waiting for challenger to confirm (old flow)
  const sentAccepted        = challenges.filter(c => c.challenged_team_id === selectedTeamId && c.status === 'accepted')
  // 'time_pending_confirm' — I (challenged team) entered a time, waiting for challenger to confirm it
  const timeEnteredWaiting  = challenges.filter(c => c.challenged_team_id === selectedTeamId && c.status === 'time_pending_confirm')
  // reschedule states
  const rescheduleWaiting   = challenges.filter(c =>
    (c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId) &&
    (c.status === 'reschedule_requested' || c.status === 'reschedule_pending_admin')
  )
  const submittedAwaiting   = challenges.filter(c => {
    const mr = c.match_result
    if (!mr || c.status !== 'played') return false
    return mr.reported_by_team_id === selectedTeamId && !mr.verified_at
  })

  const scheduled           = challenges.filter(c => c.status === 'scheduled')
  // Either team can report — but only prompt as "Action Required" once the match time has passed
  const scheduledNeedResult = scheduled.filter(c => {
    if (c.match_result) return false
    if (!(c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId)) return false
    const matchAt = c.confirmed_time ?? c.match_date ?? c.accepted_slot
    return matchAt ? new Date(matchAt) <= new Date() : false
  })

  const actionCount = receivedPending.length + awaitingConfirm.length + needToEnterTime.length + timePendingMyConfirm.length + pendingVerify.length + scheduledNeedResult.length

  // ── Freeze / Unfreeze ────────────────────────────────────────────────────────
  async function handleFreeze() {
    if (!selectedTeamId) return
    if (!confirm('Freeze your team? You will immediately drop 1 position, then 1 more every week. You cannot freeze while in an active challenge.')) return
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

  // ── Forfeit ───────────────────────────────────────────────────────────────────
  function openForfeit(c: DashboardChallenge) {
    const myTeamId = c.challenging_team_id === selectedTeamId
      ? c.challenging_team_id : c.challenged_team_id
    setForfeitTarget({ id: c.id, code: c.challenge_code, myTeamId, opponent: opponent(c).name ?? 'opponent' })
  }

  async function handleForfeit() {
    if (!forfeitTarget) return
    setForfeiting(true)
    try {
      const res = await fetch(`/api/challenges/${forfeitTarget.id}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // ── Loading skeleton ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-slate-800/50 rounded-xl h-32 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!loading && teams.length === 0) {
    return (
      <Card className="bg-slate-800/60 border-slate-700/50 p-12 text-center">
        <Users className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">No Teams Yet</h3>
        <p className="text-slate-400 mb-4">You haven't joined any teams for the current season</p>
        <Link href="/ladder"><Button className="bg-emerald-500 hover:bg-emerald-600">Browse Teams</Button></Link>
      </Card>
    )
  }

  const opponent = (c: DashboardChallenge) =>
    c.challenging_team_id === selectedTeamId ? c.challenged_team : c.challenging_team

  // Returns "Player 1 & Player 2" for the opponent team
  const oppPlayers = (c: DashboardChallenge) => {
    const opp = opponent(c)
    const p1 = (opp as any)?.player1?.name
    const p2 = (opp as any)?.player2?.name
    return [p1, p2].filter(Boolean).join(' & ')
  }

  // Renders opponent player names with WhatsApp links
  const OppContact = ({ c }: { c: DashboardChallenge }) => {
    const opp = opponent(c)
    const players: PlayerInfo[] = [
      (opp as any)?.player1 as PlayerInfo,
      (opp as any)?.player2 as PlayerInfo,
    ].filter(Boolean)
    if (players.length === 0) return null
    return (
      <div className="flex items-center gap-2 flex-wrap mt-0.5">
        {players.map((p, i) => {
          const raw = p.phone?.replace(/\D/g, '') ?? ''
          const waNumber = raw.startsWith('0') ? '92' + raw.slice(1) : raw
          const waUrl = waNumber
            ? `https://wa.me/${waNumber}?text=${encodeURIComponent(`Hi! Reaching out about our CPL challenge ${c.challenge_code} 🎾`)}`
            : null
          return (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="text-xs text-slate-400">{p.name}</span>
              {waUrl && (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-colors"
                >
                  <MessageCircle className="h-2.5 w-2.5" />WA
                </a>
              )}
              {i < players.length - 1 && <span className="text-slate-600 text-xs">&amp;</span>}
            </span>
          )
        })}
      </div>
    )
  }

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  }

  const slots = (c: DashboardChallenge) =>
    [c.slot_1, c.slot_2, c.slot_3].filter(Boolean) as string[]

  return (
    <div className="space-y-6 max-w-3xl mx-auto">

      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        {actionCount > 0 && (
          <p className="text-orange-400 text-sm mt-0.5">
            {actionCount} action{actionCount !== 1 ? 's' : ''} need your attention
          </p>
        )}
      </div>

      {/* ── Team stats strip ── */}
      {activeTeam && (
        <Card className="bg-slate-800/60 border-slate-700/50 p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              {activeTeam.tierName && (
                <TierBadge tier={activeTeam.tierName} />
              )}
              {activeTeam.rank != null && (
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-4 w-4 text-emerald-400" />
                  <span className="font-bold text-white text-lg">#{activeTeam.rank}</span>
                </div>
              )}
            </div>
            <div className="h-8 w-px bg-slate-600 hidden sm:block" />
            <div className="flex gap-4 text-sm">
              <span><span className="font-semibold text-emerald-400">{wins}</span> <span className="text-slate-400">W</span></span>
              <span><span className="font-semibold text-red-400">{losses}</span> <span className="text-slate-400">L</span></span>
              <span>
                <span className="font-semibold text-slate-200">
                  {wins + losses === 0 ? '0' : Math.round((wins / (wins + losses)) * 100)}%
                </span> <span className="text-slate-400">win rate</span>
              </span>
            </div>
            <div className="ml-auto flex gap-2">
              <Link href="/ladder">
                <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-xs">
                  <Zap className="h-3.5 w-3.5 mr-1" /> Send Challenge
                </Button>
              </Link>
            </div>
          </div>
          <p className="text-slate-500 text-xs mt-2">
            {activeTeam.player1Name} &amp; {activeTeam.player2Name}
          </p>
        </Card>
      )}

      {/* ── Freeze / Unfreeze ── */}
      {activeTeam && activeTeam.status !== 'dissolved' && (
        activeTeam.status === 'frozen' ? (
          <Card className="bg-blue-950/30 border-blue-500/40 p-4">
            <div className="flex items-start gap-3">
              <Snowflake className="h-5 w-5 text-blue-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-300">Team is Frozen</p>
                <p className="text-xs text-blue-400/70 mt-0.5">
                  Your team drops 1 position every week while frozen. You cannot send or accept challenges.
                  Unfreeze to return to your current rank and resume play.
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleUnfreeze}
                disabled={freezeLoading}
                className="shrink-0 bg-blue-500 hover:bg-blue-400 text-white text-xs"
              >
                {freezeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span className="ml-1.5">Unfreeze</span>
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="bg-slate-800/40 border-slate-700/30 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <Snowflake className="h-4 w-4 text-slate-500 shrink-0" />
                <p className="text-xs text-slate-500">
                  Need a break? Freeze your team — you&apos;ll drop 1 spot immediately, then 1 more per week.
                  You cannot freeze while in an active challenge.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleFreeze}
                disabled={freezeLoading}
                className="shrink-0 border-slate-600 text-slate-400 hover:border-blue-500/50 hover:text-blue-300 text-xs"
              >
                {freezeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Snowflake className="h-3.5 w-3.5" />}
                <span className="ml-1.5">Freeze Team</span>
              </Button>
            </div>
          </Card>
        )
      )}

      {/* ════════════════════════════════════════════════════════════════
          ACTION REQUIRED
      ════════════════════════════════════════════════════════════════ */}

      {actionCount > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-orange-400" />
            <h2 className="font-bold text-white text-lg">Action Required</h2>
            <span className="bg-orange-500/20 text-orange-400 border border-orange-500/40 text-xs font-bold px-2 py-0.5 rounded-full">
              {actionCount}
            </span>
          </div>
          <div className="space-y-3">

            {/* Received challenges — coordinate offline first, then enter agreed time in challenge detail */}
            {receivedPending.map(c => (
              <Card key={c.id} className="bg-slate-800/60 border-orange-500/30 p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        Challenge Received
                      </span>
                      <CountdownPill deadline={c.accept_deadline} />
                    </div>
                    <p className="font-semibold text-white mt-1">
                      from <span className="text-emerald-400">{opponent(c).name}</span>
                    </p>
                    <OppContact c={c} />
                  </div>
                </div>

                {/* Their suggested slots */}
                {slots(c).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Suggested times</p>
                    {slots(c).map((slot, i) => (
                      <div key={slot} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/40 text-sm text-slate-300">
                        <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span className="text-slate-500 text-xs mr-0.5">Slot {i + 1}</span>
                        {fmtDate(slot)}
                      </div>
                    ))}
                  </div>
                )}

                {/* What to do */}
                <p className="text-xs text-slate-400 bg-slate-700/30 border border-slate-600/40 rounded-lg px-3 py-2 leading-relaxed">
                  Pick one of their slots, or agree a different time with <span className="text-white font-medium">{opponent(c).name}</span> over WhatsApp. Venue can be set after.
                </p>

                {/* Action */}
                <div className="flex flex-col gap-2 pt-1">
                  <Link href={`/challenges/${c.id}`} className="block w-full">
                    <Button
                      size="sm"
                      className="w-full bg-emerald-500 hover:bg-emerald-600 h-11 text-sm font-semibold"
                    >
                      <Check className="h-4 w-4 mr-1.5" />
                      Respond to Challenge
                    </Button>
                  </Link>
                  <Link href={`/challenges/${c.id}`} className="block w-full">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-9 text-xs text-slate-400 border-slate-600/50 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40"
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Decline (opens full details)
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}

            {/* Challenged team entered confirmed time — you need to confirm or dispute */}
            {awaitingConfirm.map(c => (
              <Card key={c.id} className="bg-slate-800/60 border-orange-500/30 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        Confirm Match Time
                      </span>
                      <CountdownPill deadline={c.confirmation_deadline} />
                    </div>
                    <p className="font-semibold text-white mt-1">
                      <span className="text-emerald-400">{opponent(c).name}</span> set the match time
                    </p>
                    <OppContact c={c} />
                    {c.confirmed_time && (
                      <p className="text-slate-300 text-sm mt-0.5">
                        📅 {fmtDate(c.confirmed_time)}
                      </p>
                    )}
                    <p className="text-slate-500 text-xs mt-1">Auto-confirms if you don't respond in time</p>
                  </div>
                  <Link href={`/challenges/${c.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                      Details <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      setActionLoading(c.id + ':confirm')
                      try {
                        const res = await fetch(`/api/challenges/${c.id}/confirm`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'confirm' }),
                        })
                        if (res.ok) { toast.success('Match confirmed!'); await reload() }
                        else { const d = await res.json(); toast.error(d.error || 'Failed') }
                      } catch { toast.error('An error occurred') }
                      finally { setActionLoading(null) }
                    }}
                    disabled={!!actionLoading}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 h-11 text-sm font-semibold"
                  >
                    {isLoading(c.id + ':confirm') ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
                    Confirm — This is correct
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setActionLoading(c.id + ':dispute')
                      try {
                        const res = await fetch(`/api/challenges/${c.id}/confirm`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'dispute' }),
                        })
                        if (res.ok) { toast.success('Disputed — they will re-enter the time.'); await reload() }
                        else { const d = await res.json(); toast.error(d.error || 'Failed') }
                      } catch { toast.error('An error occurred') }
                      finally { setActionLoading(null) }
                    }}
                    disabled={!!actionLoading}
                    className="w-full border-slate-600 text-slate-300 h-10 text-xs"
                  >
                    {isLoading(c.id + ':dispute') ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <X className="h-3.5 w-3.5 mr-1" />}
                    Dispute — Time doesn't match
                  </Button>
                </div>
              </Card>
            ))}

            {/* accepted_open — either team must enter the agreed time */}
            {needToEnterTime.map(c => {
              const iAmChallenger = c.challenging_team_id === selectedTeamId
              return (
                <Card key={c.id} className="bg-slate-800/60 border-amber-500/30 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                          Enter Agreed Time &amp; Venue
                        </span>
                      </div>
                      <p className="font-semibold text-white mt-1">
                        vs <span className="text-emerald-400">{opponent(c).name}</span>
                      </p>
                      <OppContact c={c} />
                      <p className="text-slate-400 text-xs mt-0.5">
                        {iAmChallenger
                          ? 'Your opponent accepted — either of you can enter the agreed time and venue here.'
                          : 'You accepted without a slot — either of you can enter the agreed time and venue here.'}
                      </p>
                      {(c as any).match_deadline && (
                        <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          Play by{' '}
                          {new Date((c as any).match_deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      )}
                    </div>
                    <Link href={`/challenges/${c.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                        Details <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                  <Link href={`/challenges/${c.id}`} className="block w-full">
                    <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-600 h-11 text-sm font-semibold">
                      <Calendar className="h-4 w-4 mr-1.5" />
                      Enter Match Time &amp; Venue
                    </Button>
                  </Link>
                </Card>
              )
            })}

            {/* time_pending_confirm — opponent entered a time, I (challenger) need to confirm */}
            {timePendingMyConfirm.map(c => (
              <Card key={c.id} className="bg-slate-800/60 border-orange-500/30 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        Confirm Match Time
                      </span>
                      <CountdownPill deadline={c.confirmation_deadline} />
                    </div>
                    <p className="font-semibold text-white mt-1">
                      <span className="text-emerald-400">{opponent(c).name}</span> proposed a time
                    </p>
                    <OppContact c={c} />
                    {(c as any).reschedule_proposed_time && (
                      <p className="text-slate-300 text-sm mt-0.5">📅 {fmtDate((c as any).reschedule_proposed_time)}</p>
                    )}
                    <p className="text-slate-500 text-xs mt-1">Auto-confirms if you don't respond in time</p>
                  </div>
                  <Link href={`/challenges/${c.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                      Details <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
                <Link href={`/challenges/${c.id}`} className="block w-full">
                  <Button size="sm" className="w-full bg-emerald-500 hover:bg-emerald-600 h-11 text-sm font-semibold">
                    <Check className="h-4 w-4 mr-1.5" />
                    Review &amp; Confirm Time
                  </Button>
                </Link>
              </Card>
            ))}

            {/* Results pending your verification */}
            {pendingVerify.map(c => {
              const mr = c.match_result!
              const winnerName = mr.winner_team_id === c.challenging_team_id
                ? c.challenging_team.name
                : c.challenged_team.name
              const sets = [
                { label: 'Set 1', ch: mr.set1_challenger, cd: mr.set1_challenged },
                { label: 'Set 2', ch: mr.set2_challenger, cd: mr.set2_challenged },
                ...(mr.supertiebreak_challenger != null
                  ? [{ label: 'TB', ch: mr.supertiebreak_challenger, cd: mr.supertiebreak_challenged }]
                  : []),
              ].filter(s => s.ch != null)
              return (
                <Card key={c.id} className="bg-slate-800/60 border-blue-500/30 p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        Verify Result
                      </span>
                      <CountdownPill deadline={mr.verify_deadline} urgent />
                    </div>
                    <Link href={`/challenges/${c.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                        Details <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  </div>

                  {/* Score block — the thing that needs to be verified, make it prominent */}
                  <div className="bg-slate-700/40 rounded-xl p-3 space-y-2">
                    {/* Team name row */}
                    <div className="flex justify-between text-xs text-slate-400 font-medium px-1">
                      <span className="truncate max-w-[40%]">{c.challenging_team.name}</span>
                      <span className="truncate max-w-[40%] text-right">{c.challenged_team.name}</span>
                    </div>
                    {/* Score rows */}
                    {sets.map(s => (
                      <div key={s.label} className="flex items-center gap-2">
                        <span className="text-slate-500 text-xs w-8 shrink-0">{s.label}</span>
                        <div className="flex items-center gap-2 flex-1 justify-center">
                          <span className={`text-2xl font-bold tabular-nums ${s.ch! > s.cd! ? 'text-white' : 'text-slate-400'}`}>{s.ch}</span>
                          <span className="text-slate-600 font-bold">–</span>
                          <span className={`text-2xl font-bold tabular-nums ${s.cd! > s.ch! ? 'text-white' : 'text-slate-400'}`}>{s.cd}</span>
                        </div>
                      </div>
                    ))}
                    {/* Winner callout */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-600/50 mt-1">
                      <Trophy className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span className="text-xs text-slate-400">Winner:</span>
                      <span className="text-sm font-bold text-emerald-400 truncate">{winnerName}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      onClick={() => doVerify(c, 'verify')}
                      disabled={isLoading(c.id)}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 h-11 text-sm font-semibold"
                    >
                      {isLoading(c.id + ':verify') ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
                      Verify Result
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => doVerify(c, 'dispute')}
                      disabled={isLoading(c.id)}
                      className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 h-10 text-xs"
                    >
                      {isLoading(c.id + ':dispute') ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
                      Dispute Score
                    </Button>
                  </div>
                </Card>
              )
            })}

            {/* Scheduled matches needing result submission */}
            {scheduledNeedResult.map(c => {
              const matchAt = c.confirmed_time ?? c.match_date ?? c.accepted_slot
              return (
                <Card key={c.id} className="bg-slate-800/60 border-yellow-500/30 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                          Submit Result
                        </span>
                      </div>
                      <p className="font-semibold text-white mt-1">
                        vs <span className="text-emerald-400">{opponent(c).name}</span>
                      </p>
                      <OppContact c={c} />
                      {matchAt && <p className="text-slate-400 text-xs">{fmtDate(matchAt)}</p>}
                    </div>
                    <Link href={`/challenges/${c.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                        Details <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                  <Button
                    onClick={() => { setScoreModal(c); setScoreState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' }); const v = Array.isArray((c as any).venue) ? (c as any).venue[0] : (c as any).venue; setScoreVenueId(v?.id ?? '') }}
                    className="w-full bg-yellow-500/90 hover:bg-yellow-500 text-slate-900 font-semibold h-11"
                  >
                    <Flag className="h-4 w-4 mr-2" /> Enter Match Score
                  </Button>
                </Card>
              )
            })}

          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          UPCOMING MATCHES
      ════════════════════════════════════════════════════════════════ */}

      {scheduled.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-5 w-5 text-emerald-400" />
            <h2 className="font-bold text-white text-lg">Upcoming Matches</h2>
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold px-2 py-0.5 rounded-full">
              {scheduled.length}
            </span>
          </div>
          <div className="space-y-3">
            {scheduled.map(c => {
              // confirmed_time is set when admin or player locks in the time;
              // fall back to accepted_slot (player-selected slot) then match_date
              const matchAt = c.confirmed_time ?? c.accepted_slot ?? c.match_date
              const isPast = matchAt ? new Date(matchAt) < new Date() : false
              const canReport = !c.match_result &&
                (c.challenging_team_id === selectedTeamId || c.challenged_team_id === selectedTeamId)
              const venueRaw = Array.isArray(c.venue) ? c.venue[0] : c.venue
              const venueName = venueRaw?.name
              const venueAddress = venueRaw?.address
              const locationLabel = venueName ?? c.match_location ?? null
              const isOutgoing = c.challenging_team_id === selectedTeamId
              return (
                <Card key={c.id} className="bg-slate-800/60 border-emerald-500/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide border ${
                          isPast
                            ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        }`}>
                          {isPast ? 'Match Played?' : 'Scheduled'}
                        </span>
                        <code className="text-[10px] px-1.5 py-0.5 bg-slate-700/60 text-slate-400 rounded">
                          {c.challenge_code}
                        </code>
                        <span className={`text-[10px] font-medium ${isOutgoing ? 'text-blue-400' : 'text-yellow-400'}`}>
                          {isOutgoing ? '↑ You challenged' : '↓ You were challenged'}
                        </span>
                      </div>

                      <p className="font-semibold text-white">
                        vs{' '}
                        <Link href={`/teams/${opponent(c).id}`} className="text-emerald-400 hover:text-emerald-300 hover:underline underline-offset-2 transition-colors">
                          {opponent(c).name}
                        </Link>
                      </p>
                      <OppContact c={c} />

                      {/* Opponent season stats */}
                      {(() => {
                        const oppId = opponent(c).id
                        const os = opponentStatsMap.get(oppId)
                        if (!os || os.played === 0) return null
                        const winPct = Math.round((os.wins / os.played) * 100)
                        return (
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[11px] font-semibold tabular-nums">
                              <span className="text-emerald-500">{os.wins}W</span>
                              <span className="text-slate-500 mx-0.5">·</span>
                              <span className="text-red-500">{os.losses}L</span>
                            </span>
                            <span className="text-[11px] text-slate-500">{winPct}%</span>
                            {os.recentForm.length > 0 && (
                              <div className="flex items-center gap-0.5">
                                {[...os.recentForm].reverse().slice(0,5).reverse().map((r, i) => (
                                  <span key={i} className={`inline-block h-1.5 w-1.5 rounded-full ${r === 'W' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                ))}
                              </div>
                            )}
                            {os.winStreak >= 3 && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                🔥{os.winStreak}
                              </span>
                            )}
                          </div>
                        )
                      })()}

                      {matchAt ? (
                        <div className="mt-1.5 space-y-0.5">
                          <p className="text-sm font-medium text-slate-200">
                            📅 {new Date(matchAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                          </p>
                          <p className="text-sm text-slate-300">
                            🕐 {new Date(matchAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                          </p>
                        </div>
                      ) : (
                        <p className="text-slate-500 text-xs mt-1">Time not yet confirmed</p>
                      )}

                      {locationLabel && (
                        <p className="text-slate-400 text-xs mt-1">
                          📍 {locationLabel}{venueAddress ? ` · ${venueAddress}` : ''}
                        </p>
                      )}
                      {(c as any).match_deadline && !isPast && (
                        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 shrink-0 text-red-400/70" />
                          <span>Play by{' '}
                            <span className="text-red-400/80">
                              {new Date((c as any).match_deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      {canReport && (
                        <Button
                          size="sm"
                          onClick={() => { setScoreModal(c); setScoreState({ s1ch: '', s1cd: '', s2ch: '', s2cd: '', tbch: '', tbcd: '' }); const v = Array.isArray((c as any).venue) ? (c as any).venue[0] : (c as any).venue; setScoreVenueId(v?.id ?? '') }}
                          className="bg-emerald-500 hover:bg-emerald-600 text-xs h-9 px-3"
                        >
                          <Flag className="h-3.5 w-3.5 mr-1" /> Enter Score
                        </Button>
                      )}
                      <Link href={`/challenges/${c.id}`}>
                        <Button size="sm" variant="ghost" className="text-xs text-slate-400 h-9 w-full">
                          View Details
                        </Button>
                      </Link>
                      <button onClick={() => openForfeit(c)}
                        className="w-full text-xs text-red-400/50 hover:text-red-400 transition-colors py-0.5 text-center">
                        Forfeit match
                      </button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          WAITING ON OTHERS
      ════════════════════════════════════════════════════════════════ */}

      {(sentPending.length + sentAccepted.length + submittedAwaiting.length + timeEnteredWaiting.length + rescheduleWaiting.length) > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-5 w-5 text-blue-400" />
            <h2 className="font-bold text-white text-lg">Waiting for Response</h2>
          </div>
          <div className="space-y-3">

            {sentPending.map(c => (
              <Card key={c.id} className="bg-slate-800/60 border-slate-700/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        Challenge Sent
                      </span>
                      <CountdownPill deadline={c.accept_deadline} />
                    </div>
                    <p className="font-semibold text-white mt-1">
                      to <span className="text-emerald-400">{opponent(c).name}</span>
                    </p>
                    <OppContact c={c} />
                    <p className="text-slate-400 text-xs">Waiting for them to accept, decline, or propose a new time</p>
                    {(c as any).match_deadline && (
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        Play by{' '}
                        {new Date((c as any).match_deadline).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                    )}
                  </div>
                  <Link href={`/challenges/${c.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                      View <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}

            {sentAccepted.map(c => (
              <Card key={c.id} className="bg-slate-800/60 border-orange-500/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        Awaiting Confirmation
                      </span>
                      <CountdownPill deadline={c.confirmation_deadline} />
                    </div>
                    <p className="font-semibold text-white mt-1">
                      vs <span className="text-emerald-400">{opponent(c).name}</span>
                    </p>
                    <OppContact c={c} />
                    {c.confirmed_time && (
                      <p className="text-slate-400 text-xs">Time you entered: {fmtDate(c.confirmed_time)}</p>
                    )}
                    <p className="text-slate-500 text-xs">Auto-confirms if they don't respond in time</p>
                  </div>
                  <Link href={`/challenges/${c.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                      View <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}


            {/* time_pending_confirm — I (challenged team) entered time, waiting for challenger to confirm */}
            {timeEnteredWaiting.map(c => (
              <Card key={c.id} className="bg-slate-800/60 border-slate-700/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-orange-500/10 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        Time Proposed
                      </span>
                      <CountdownPill deadline={c.confirmation_deadline} />
                    </div>
                    <p className="font-semibold text-white mt-1">
                      vs <span className="text-emerald-400">{opponent(c).name}</span>
                    </p>
                    <OppContact c={c} />
                    <p className="text-slate-400 text-xs mt-0.5">You entered the time — waiting for them to confirm</p>
                    <p className="text-slate-500 text-xs">Auto-confirms if they don't respond in time</p>
                  </div>
                  <Link href={`/challenges/${c.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                      View <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}

            {/* reschedule pending */}
            {rescheduleWaiting.map(c => (
              <Card key={c.id} className="bg-slate-800/60 border-purple-500/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                        {c.status === 'reschedule_pending_admin' ? 'Admin Review' : 'Reschedule Requested'}
                      </span>
                    </div>
                    <p className="font-semibold text-white mt-1">
                      vs <span className="text-emerald-400">{opponent(c).name}</span>
                    </p>
                    <OppContact c={c} />
                    <p className="text-slate-400 text-xs mt-0.5">
                      {c.status === 'reschedule_pending_admin'
                        ? 'Both teams agreed to reschedule — waiting for admin approval'
                        : 'A reschedule has been requested — go to challenge details'}
                    </p>
                  </div>
                  <Link href={`/challenges/${c.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                      View <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}

            {submittedAwaiting.map(c => {
              const mr = c.match_result!
              return (
                <Card key={c.id} className="bg-slate-800/60 border-slate-700/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] bg-slate-600/50 text-slate-300 border border-slate-600/50 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                          Result Submitted
                        </span>
                        <CountdownPill deadline={mr.verify_deadline} />
                      </div>
                      <p className="font-semibold text-white mt-1">
                        vs <span className="text-emerald-400">{opponent(c).name}</span>
                      </p>
                      <OppContact c={c} />
                      <p className="text-slate-400 text-xs">Waiting for them to verify — auto-approves when timer expires</p>
                    </div>
                    <Link href={`/challenges/${c.id}`}>
                      <Button variant="ghost" size="sm" className="text-xs text-slate-400 shrink-0">
                        View <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              )
            })}

          </div>
        </div>
      )}

      {/* Empty state when no active challenges */}
      {challenges.filter(c => !['played','forfeited','dissolved'].includes(c.status)).length === 0 && (
        <Card className="bg-slate-800/40 border-slate-700/30 p-8 text-center">
          <Zap className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium mb-1">No active challenges</p>
          <p className="text-slate-500 text-sm mb-4">Send a challenge to climb the ladder!</p>
          <Link href="/ladder">
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600">Browse Ladder to Challenge</Button>
          </Link>
        </Card>
      )}

      {/* ── Inline Score Entry Modal ─────────────────────────────────────────── */}
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
            <span className="text-slate-400 text-xs font-semibold w-8 shrink-0 text-center">{label}</span>
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 truncate text-center font-medium">{c.challenging_team.name}</p>
                <Input
                  type="number" min="0" max="99"
                  inputMode="numeric"
                  value={scoreState[chField]}
                  onChange={setScores(chField)}
                  className="bg-slate-700 border-slate-600 text-white text-center h-14 text-2xl font-bold"
                  placeholder="0"
                />
              </div>
              <span className="text-slate-500 font-bold text-xl mt-6 shrink-0">–</span>
              <div className="flex-1">
                <p className="text-xs text-slate-400 mb-1 truncate text-center font-medium">{c.challenged_team.name}</p>
                <Input
                  type="number" min="0" max="99"
                  inputMode="numeric"
                  value={scoreState[cdField]}
                  onChange={setScores(cdField)}
                  className="bg-slate-700 border-slate-600 text-white text-center h-14 text-2xl font-bold"
                  placeholder="0"
                />
              </div>
            </div>
          </div>
        )

        return (
          /* Backdrop */
          <div
            className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center"
            onClick={(e) => { if (e.target === e.currentTarget) setScoreModal(null) }}
          >
            {/* Sheet — slides up from bottom on mobile, centred card on sm+ */}
            <div className="w-full sm:max-w-sm bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl p-5 space-y-5 max-h-[92vh] overflow-y-auto">

              {/* Drag handle (mobile hint) */}
              <div className="flex justify-center sm:hidden">
                <div className="w-10 h-1 bg-slate-600 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Flag className="h-4 w-4 text-emerald-400" />
                    <h3 className="font-bold text-white text-lg">Enter Match Score</h3>
                  </div>
                  <p className="text-slate-400 text-sm mt-0.5">
                    {c.challenging_team.name} vs {c.challenged_team.name}
                  </p>
                </div>
                <button
                  onClick={() => setScoreModal(null)}
                  className="text-slate-400 hover:text-white p-2 -mr-1 rounded-lg"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Score inputs */}
              <div className="space-y-4">
                <ScoreRow label="Set 1" chField="s1ch" cdField="s1cd" />
                <ScoreRow label="Set 2" chField="s2ch" cdField="s2cd" />
                {needsTB && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-slate-600" />
                      <span className="text-xs text-orange-400 font-semibold tracking-wide">SUPER TIEBREAK</span>
                      <div className="h-px flex-1 bg-slate-600" />
                    </div>
                    <ScoreRow label="TB" chField="tbch" cdField="tbcd" />
                  </div>
                )}
              </div>

              {/* Venue */}
              {venues.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">
                    Venue Played At
                  </label>
                  <select
                    value={scoreVenueId}
                    onChange={e => setScoreVenueId(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 h-11"
                  >
                    <option value="">— No change / unknown —</option>
                    {venues.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name}{v.address ? ` · ${v.address}` : ''}
                      </option>
                    ))}
                  </select>
                  {scoreVenueId && scoreVenueId !== ((() => { const v = Array.isArray((c as any).venue) ? (c as any).venue[0] : (c as any).venue; return v?.id })()) && (
                    <p className="text-xs text-amber-400 mt-1">Venue will be updated to your selection</p>
                  )}
                </div>
              )}

              {/* Winner preview */}
              {winner ? (
                <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <Trophy className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs text-slate-400">Winner</p>
                    <p className="font-bold text-emerald-400">{winner}</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-700/30 border border-slate-600/40 rounded-xl text-center">
                  <p className="text-slate-500 text-xs">Enter scores above to see winner</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pb-1">
                <Button
                  onClick={doSubmitScore}
                  disabled={scoreSubmitting || !winner}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 h-12 text-base font-semibold"
                >
                  {scoreSubmitting
                    ? <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    : <CheckCircle className="h-5 w-5 mr-2" />}
                  Submit Score
                </Button>
                <Button
                  onClick={() => setScoreModal(null)}
                  variant="outline"
                  className="h-12 px-5 border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
              </div>

              <p className="text-xs text-slate-500 text-center pb-1">
                The opposing team will be asked to verify this result.
              </p>
            </div>
          </div>
        )
      })()}

      {/* ── Forfeit confirmation ── */}
      {forfeitTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-white text-lg">Forfeit challenge?</h3>
                <p className="text-slate-400 text-sm mt-1">
                  vs <span className="text-white font-medium">{forfeitTarget.opponent}</span>
                  {' · '}<code className="text-xs text-slate-400">{forfeitTarget.code}</code>
                </p>
              </div>
            </div>
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-300 font-medium">This counts as a forfeit against your team.</p>
              <p className="text-xs text-red-300/70 mt-0.5">Your team will drop positions. This cannot be undone.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setForfeitTarget(null)} disabled={forfeiting}
                className="flex-1 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleForfeit} disabled={forfeiting}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-60">
                {forfeiting ? 'Forfeiting…' : 'Forfeit'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
