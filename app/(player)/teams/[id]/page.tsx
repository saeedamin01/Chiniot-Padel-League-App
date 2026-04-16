'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import {
  Trophy, Snowflake, Flame, TrendingUp, TrendingDown,
  ArrowLeft, Users, Swords, Calendar, CheckCircle2, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerInfo { id: string; name: string }

interface TeamData {
  id: string
  name: string
  status: string
  player1?: PlayerInfo
  player2?: PlayerInfo
  ladder_position?: {
    rank: number
    status: string
    tier?: { id: string; name: string }
  }
}

interface MatchHistoryRow {
  id: string
  winner_team_id: string
  loser_team_id: string
  created_at: string
  verified_at: string | null
  set1_challenger: number | null
  set1_challenged: number | null
  set2_challenger: number | null
  set2_challenged: number | null
  supertiebreak_challenger: number | null
  supertiebreak_challenged: number | null
  challenge: {
    id: string
    challenging_team_id: string
    challenged_team_id: string
    challenging_team?: { id: string; name: string }
    challenged_team?: { id: string; name: string }
    tier?: { name: string }
  }
}

interface ActiveChallengeRow {
  id: string
  status: string
  challenging_team_id: string
  challenged_team_id: string
  challenging_team?: { id: string; name: string }
  challenged_team?: { id: string; name: string }
  tier?: { name: string }
}

interface TeamStats {
  wins: number; losses: number; played: number
  recentForm: ('W' | 'L')[]; winStreak: number; rankGained: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Platinum: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Silver: 'bg-slate-400/20 text-slate-300 border-slate-400/40',
  Bronze: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
}
const TIER_RING: Record<string, string> = {
  Diamond: 'border-cyan-500/50', Platinum: 'border-violet-500/50',
  Gold: 'border-yellow-500/50', Silver: 'border-slate-400/50', Bronze: 'border-orange-500/50',
}

function TierBadge({ name }: { name?: string }) {
  if (!name) return null
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${TIER_BADGE[name] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/40'}`}>
      {name}
    </span>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  const d2 = new Date(iso)
  const wd = d2.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${wd} ${String(d2.getDate()).padStart(2,'0')}/${String(d2.getMonth()+1).padStart(2,'0')}/${d2.getFullYear()}`
}

function formatScore(mr: MatchHistoryRow, teamId: string): string {
  const c = mr.challenge
  const isTeamChallenger = c.challenging_team_id === teamId
  const didTeamWin = mr.winner_team_id === teamId
  const isWinnerChallenger = mr.winner_team_id === c.challenging_team_id

  const s = (a: number | null, b: number | null) => (a != null && b != null) ? `${a}-${b}` : null
  const sets = [
    isWinnerChallenger ? s(mr.set1_challenger, mr.set1_challenged) : s(mr.set1_challenged, mr.set1_challenger),
    isWinnerChallenger ? s(mr.set2_challenger, mr.set2_challenged) : s(mr.set2_challenged, mr.set2_challenger),
  ].filter(Boolean)
  const tb = isWinnerChallenger
    ? s(mr.supertiebreak_challenger, mr.supertiebreak_challenged)
    : s(mr.supertiebreak_challenged, mr.supertiebreak_challenger)
  if (tb) sets.push(`[${tb}]`)
  // Always show score from winner's perspective
  return sets.join(', ')
}

// ─── Stats block ──────────────────────────────────────────────────────────────

function StatsBlock({ stats }: { stats: TeamStats }) {
  const winPct = stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0

  if (stats.played === 0) {
    return (
      <div className="text-center py-4 text-slate-500 text-sm italic">No matches played yet</div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="text-center">
        <div className="text-2xl font-bold text-emerald-400">{stats.wins}</div>
        <div className="text-xs text-slate-500 mt-0.5">Wins</div>
      </div>
      <div className="text-center border-x border-slate-700/50">
        <div className="text-2xl font-bold text-slate-300">{stats.played}</div>
        <div className="text-xs text-slate-500 mt-0.5">Played</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold text-red-400">{stats.losses}</div>
        <div className="text-xs text-slate-500 mt-0.5">Losses</div>
      </div>

      <div className="col-span-3 pt-3 border-t border-slate-700/50 flex items-center justify-center gap-4 flex-wrap">
        <span className={`text-lg font-bold ${winPct >= 60 ? 'text-emerald-400' : winPct >= 40 ? 'text-slate-300' : 'text-red-400'}`}>
          {winPct}% win rate
        </span>

        {stats.recentForm.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 mr-1">Form</span>
            {[...stats.recentForm].reverse().slice(0, 5).reverse().map((r, i) => (
              <span key={i} className={`inline-block h-2 w-2 rounded-full ${r === 'W' ? 'bg-emerald-400' : 'bg-red-400'}`} />
            ))}
          </div>
        )}

        {stats.winStreak >= 3 && (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/20">
            <Flame className="h-3 w-3" />{stats.winStreak}-match win streak
          </span>
        )}

        {stats.rankGained !== 0 && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${stats.rankGained > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {stats.rankGained > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {Math.abs(stats.rankGained)} rank{Math.abs(stats.rankGained) !== 1 ? 's' : ''} {stats.rankGained > 0 ? 'gained' : 'lost'}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PublicTeamPage() {
  const params = useParams()
  const teamId = params.id as string
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<TeamData | null>(null)
  const [stats, setStats] = useState<TeamStats>({ wins: 0, losses: 0, played: 0, recentForm: [], winStreak: 0, rankGained: 0 })
  const [matchHistory, setMatchHistory] = useState<MatchHistoryRow[]>([])
  const [activeChallenge, setActiveChallenge] = useState<ActiveChallengeRow | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data: season } = await supabase
          .from('seasons').select('id').eq('is_active', true).single()
        if (!season) return

        // Team + ladder position
        const { data: teamData, error: teamError } = await supabase
          .from('teams')
          .select(`
            id, name, status,
            player1:players!player1_id(id, name),
            player2:players!player2_id(id, name),
            ladder_position:ladder_positions!team_id(rank, status, tier:tiers!tier_id(id, name))
          `)
          .eq('id', teamId)
          .eq('season_id', season.id)
          .single()

        if (teamError || !teamData) { setNotFound(true); return }

        const pos = Array.isArray((teamData as any).ladder_position)
          ? (teamData as any).ladder_position[0]
          : (teamData as any).ladder_position
        const tier = pos ? (Array.isArray(pos.tier) ? pos.tier[0] : pos.tier) : null

        setTeam({
          ...teamData as any,
          player1: Array.isArray((teamData as any).player1) ? (teamData as any).player1[0] : (teamData as any).player1,
          player2: Array.isArray((teamData as any).player2) ? (teamData as any).player2[0] : (teamData as any).player2,
          ladder_position: pos ? { ...pos, tier } : undefined,
        })

        // Match history + active challenge in parallel
        const [matchRes, challengeRes] = await Promise.all([
          supabase.from('match_results')
            .select(`
              id, winner_team_id, loser_team_id, created_at, verified_at,
              set1_challenger, set1_challenged, set2_challenger, set2_challenged,
              supertiebreak_challenger, supertiebreak_challenged,
              challenge:challenges!challenge_id(
                id, challenging_team_id, challenged_team_id,
                challenging_team:teams!challenging_team_id(id, name),
                challenged_team:teams!challenged_team_id(id, name),
                tier:tiers!tier_id(id, name)
              )
            `)
            .eq('season_id', season.id)
            .or(`winner_team_id.eq.${teamId},loser_team_id.eq.${teamId}`)
            .order('created_at', { ascending: false })
            .limit(30),

          supabase.from('challenges')
            .select(`
              id, status, challenging_team_id, challenged_team_id,
              challenging_team:teams!challenging_team_id(id, name),
              challenged_team:teams!challenged_team_id(id, name),
              tier:tiers!tier_id(id, name)
            `)
            .eq('season_id', season.id)
            .or(`challenging_team_id.eq.${teamId},challenged_team_id.eq.${teamId}`)
            .in('status', ['pending', 'accepted', 'accepted_open', 'time_pending_confirm', 'scheduled'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        // Compute stats
        const matchData: any[] = matchRes.data || []
        const teamStats: TeamStats = { wins: 0, losses: 0, played: 0, recentForm: [], winStreak: 0, rankGained: 0 }

        for (const mr of matchData) {
          const c = Array.isArray(mr.challenge) ? mr.challenge[0] : mr.challenge
          if (mr.winner_team_id === teamId) {
            teamStats.wins++
            if (teamStats.recentForm.length < 10) teamStats.recentForm.push('W')
            if (c && teamId === c.challenging_team_id) teamStats.rankGained++
          } else {
            teamStats.losses++
            if (teamStats.recentForm.length < 10) teamStats.recentForm.push('L')
            if (c && teamId === c.challenging_team_id) teamStats.rankGained--
          }
          teamStats.played++
        }
        let streak = 0
        for (const r of teamStats.recentForm) { if (r === 'W') streak++; else break }
        teamStats.winStreak = streak

        // Normalize match history
        const normalizedHistory: MatchHistoryRow[] = matchData.map(mr => ({
          ...mr,
          challenge: Array.isArray(mr.challenge) ? {
            ...mr.challenge[0],
            challenging_team: Array.isArray(mr.challenge[0]?.challenging_team) ? mr.challenge[0].challenging_team[0] : mr.challenge[0]?.challenging_team,
            challenged_team: Array.isArray(mr.challenge[0]?.challenged_team) ? mr.challenge[0].challenged_team[0] : mr.challenge[0]?.challenged_team,
            tier: Array.isArray(mr.challenge[0]?.tier) ? mr.challenge[0].tier[0] : mr.challenge[0]?.tier,
          } : mr.challenge,
        }))

        // Normalize active challenge
        let normalizedChallenge: ActiveChallengeRow | null = null
        if (challengeRes.data) {
          const cd = challengeRes.data as any
          normalizedChallenge = {
            ...cd,
            challenging_team: Array.isArray(cd.challenging_team) ? cd.challenging_team[0] : cd.challenging_team,
            challenged_team: Array.isArray(cd.challenged_team) ? cd.challenged_team[0] : cd.challenged_team,
            tier: Array.isArray(cd.tier) ? cd.tier[0] : cd.tier,
          }
        }

        setStats(teamStats)
        setMatchHistory(normalizedHistory)
        setActiveChallenge(normalizedChallenge)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [teamId])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-slate-400">Loading team profile…</div>
      </div>
    )
  }

  if (notFound || !team) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <Users className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Team not found</h2>
        <p className="text-slate-400 mb-6">This team doesn't exist or isn't part of the current season.</p>
        <Link href="/ladder"><Button variant="outline">Back to Ladder</Button></Link>
      </div>
    )
  }

  const pos = team.ladder_position
  const tierName = pos?.tier?.name
  const isFrozen = pos?.status === 'frozen' || team.status === 'frozen'

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Back */}
      <Link href="/ladder" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" />Back to Ladder
      </Link>

      {/* Team Header */}
      <Card className={`border-2 p-6 ${tierName ? TIER_RING[tierName] ?? 'border-slate-700' : 'border-slate-700'} bg-slate-800/60`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-white">{team.name}</h1>
              {tierName && <TierBadge name={tierName} />}
              {isFrozen && (
                <span className="inline-flex items-center gap-1 text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 px-2 py-0.5 rounded-full">
                  <Snowflake className="h-3 w-3" />Frozen
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-slate-400 text-sm">
              <Users className="h-4 w-4 shrink-0" />
              <span>
                {[team.player1?.name, team.player2?.name].filter(Boolean).join(' & ') || 'Players TBD'}
              </span>
            </div>
          </div>

          {pos?.rank && (
            <div className="text-right shrink-0">
              <div className="text-3xl font-black text-white">#{pos.rank}</div>
              <div className="text-xs text-slate-500 mt-0.5">Ladder rank</div>
            </div>
          )}
        </div>
      </Card>

      {/* Active Challenge Notice */}
      {activeChallenge && (
        <Card className="bg-amber-500/5 border-amber-500/30 p-4">
          <div className="flex items-center gap-3">
            <Swords className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-300">
                {activeChallenge.status === 'scheduled' ? 'Match Scheduled' : 'Match in Progress'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeChallenge.challenging_team_id === teamId
                  ? `Challenging ${activeChallenge.challenged_team?.name}`
                  : `Being challenged by ${activeChallenge.challenging_team?.name}`}
                {activeChallenge.tier?.name && ` · ${activeChallenge.tier.name}`}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Stats */}
      <Card className="bg-slate-800/60 border-slate-700 p-5">
        <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-emerald-400" />Season Stats
        </h2>
        <StatsBlock stats={stats} />
      </Card>

      {/* Match History */}
      <div>
        <h2 className="font-semibold text-white mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400" />
          Match History
          {matchHistory.length > 0 && (
            <span className="text-xs text-slate-500 font-normal ml-1">({matchHistory.length} matches)</span>
          )}
        </h2>

        {matchHistory.length === 0 ? (
          <Card className="bg-slate-800/40 border-slate-700/60 p-8 text-center">
            <p className="text-slate-500 text-sm italic">No matches played yet this season</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {matchHistory.map(mr => {
              const c = mr.challenge
              if (!c) return null
              const didWin = mr.winner_team_id === teamId
              const opponent = c.challenging_team_id === teamId ? c.challenged_team : c.challenging_team
              const score = formatScore(mr, teamId)
              const isChallenger = c.challenging_team_id === teamId

              return (
                <Card key={mr.id} className={`p-4 border ${didWin ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-slate-800/40 border-slate-700/50'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {didWin
                        ? <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                        : <XCircle className="h-5 w-5 text-red-400/70 shrink-0" />}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold ${didWin ? 'text-emerald-400' : 'text-red-400'}`}>
                            {didWin ? 'Won' : 'Lost'}
                          </span>
                          <span className="text-slate-400 text-sm">vs</span>
                          {opponent ? (
                            <Link href={`/teams/${opponent.id}`} className="text-sm font-medium text-white hover:text-emerald-300 transition-colors">
                              {opponent.name}
                            </Link>
                          ) : (
                            <span className="text-sm text-slate-400">Unknown</span>
                          )}
                          {c.tier?.name && <TierBadge name={c.tier.name} />}
                          <span className="text-[10px] text-slate-600">{isChallenger ? '↑ challenged up' : '↓ defended'}</span>
                        </div>
                        {score && (
                          <p className="text-xs font-mono text-slate-400 mt-0.5">{score}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500 shrink-0">
                      {timeAgo(mr.verified_at ?? mr.created_at)}
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
