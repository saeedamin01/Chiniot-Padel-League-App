'use client'

import React, { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  Search, Trophy, Users, Snowflake,
  TrendingUp, TrendingDown, Flame, ArrowRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamInfo {
  id: string
  name: string
  player1?: { id: string; name: string }
  player2?: { id: string; name: string }
}

interface TeamStats {
  wins: number
  losses: number
  played: number
  recentForm: ('W' | 'L')[]
  rankGained: number
  winStreak: number
}

interface PositionRow {
  rank: number
  status: 'active' | 'frozen' | 'vacant'
  team: TeamInfo | null
  team_id: string | null
  stats: TeamStats | null
}

interface TierInfo {
  id: string
  name: string
  min_rank: number
  max_rank: number | null
  rank_order: number
}

interface TierSection {
  tier: TierInfo
  positions: PositionRow[]
}

// ─── Tier style map ───────────────────────────────────────────────────────────
const TIER_STYLE: Record<string, { header: string; accent: string; rank: string; badge: string }> = {
  Diamond:  { header: 'from-cyan-500/10  to-transparent border-cyan-500/20',   accent: 'bg-cyan-400',   rank: 'text-cyan-400',   badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'   },
  Platinum: { header: 'from-violet-500/10 to-transparent border-violet-500/20', accent: 'bg-violet-400', rank: 'text-violet-400', badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  Gold:     { header: 'from-amber-500/10  to-transparent border-amber-500/20',  accent: 'bg-amber-400',  rank: 'text-amber-400',  badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30'  },
  Silver:   { header: 'from-slate-400/10  to-transparent border-slate-400/20',  accent: 'bg-slate-400',  rank: 'text-slate-300',  badge: 'bg-slate-400/15 text-slate-200 border-slate-400/30'  },
  Bronze:   { header: 'from-orange-500/10 to-transparent border-orange-500/20', accent: 'bg-orange-400', rank: 'text-orange-400', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
}
const defaultStyle = { header: 'from-slate-700/20 to-transparent border-slate-700/30', accent: 'bg-emerald-400', rank: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }

// ─── Stats strip (read-only, no links) ───────────────────────────────────────
function StatsStrip({ stats }: { stats: TeamStats }) {
  if (stats.played === 0) {
    return <span className="text-[11px] text-slate-500 italic">No matches yet</span>
  }
  const winPct = Math.round((stats.wins / stats.played) * 100)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-semibold tabular-nums">
        <span className="text-emerald-400">{stats.wins}W</span>
        <span className="text-slate-500 mx-0.5">·</span>
        <span className="text-red-400">{stats.losses}L</span>
      </span>
      <span className="text-[11px] text-slate-500 tabular-nums">{winPct}%</span>
      {stats.recentForm.length > 0 && (
        <div className="flex items-center gap-0.5">
          {[...stats.recentForm].reverse().slice(0, 5).reverse().map((r, i) => (
            <span
              key={i}
              title={r === 'W' ? 'Win' : 'Loss'}
              className={`inline-block h-1.5 w-1.5 rounded-full ${r === 'W' ? 'bg-emerald-400' : 'bg-red-400'}`}
            />
          ))}
        </div>
      )}
      {stats.winStreak >= 3 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/20">
          <Flame className="h-2.5 w-2.5" />{stats.winStreak}
        </span>
      )}
      {stats.rankGained !== 0 && (
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${stats.rankGained > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {stats.rankGained > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(stats.rankGained)}
        </span>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StandingsPage() {
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [tierSections, setTierSections] = useState<TierSection[]>([])
  const [seasonName, setSeasonName] = useState<string>('')
  const [totalMatches, setTotalMatches] = useState<number>(0)
  const supabase = createClient()

  useEffect(() => {
    const fetchStandings = async () => {
      try {
        // Get active season
        const { data: season } = await supabase
          .from('seasons').select('id, name').eq('is_active', true).single()
        if (!season) { setLoading(false); return }

        setSeasonName(season.name ?? '')

        // Fetch tiers, positions, and results in parallel
        const [tiersRes, positionsRes, resultsRes] = await Promise.all([
          supabase.from('tiers')
            .select('id, name, min_rank, max_rank, rank_order')
            .eq('season_id', season.id)
            .order('rank_order', { ascending: true }),

          supabase.from('ladder_positions')
            .select(`
              rank, status, team_id,
              team:teams!team_id(
                id, name,
                player1:players!player1_id(id, name),
                player2:players!player2_id(id, name)
              )
            `)
            .eq('season_id', season.id)
            .order('rank', { ascending: true }),

          supabase.from('match_results')
            .select('id, winner_team_id, loser_team_id, challenge:challenges!challenge_id(challenging_team_id, challenged_team_id)')
            .eq('season_id', season.id)
            .order('created_at', { ascending: false }),
        ])

        const tiers: TierInfo[] = tiersRes.data || []
        const allPositions: any[] = positionsRes.data || []
        const allResults: any[] = resultsRes.data || []

        setTotalMatches(allResults.length)

        // Build stats map
        const statsMap = new Map<string, TeamStats>()
        const getOrCreate = (teamId: string): TeamStats => {
          if (!statsMap.has(teamId)) {
            statsMap.set(teamId, { wins: 0, losses: 0, played: 0, recentForm: [], rankGained: 0, winStreak: 0 })
          }
          return statsMap.get(teamId)!
        }

        for (const mr of allResults) {
          const challenge = Array.isArray(mr.challenge) ? mr.challenge[0] : mr.challenge
          const winnerStats = getOrCreate(mr.winner_team_id)
          const loserStats  = getOrCreate(mr.loser_team_id)

          winnerStats.wins++
          winnerStats.played++
          loserStats.losses++
          loserStats.played++

          if (winnerStats.recentForm.length < 5) winnerStats.recentForm.push('W')
          if (loserStats.recentForm.length < 5)  loserStats.recentForm.push('L')

          if (challenge) {
            if (mr.winner_team_id === challenge.challenging_team_id) {
              winnerStats.rankGained++
              loserStats.rankGained--
            }
          }
        }

        // Compute win streaks
        for (const [, s] of statsMap) {
          let streak = 0
          for (const r of s.recentForm) {
            if (r === 'W') streak++
            else break
          }
          s.winStreak = streak
        }

        const rankToPos = new Map<number, any>()
        allPositions.forEach(p => rankToPos.set(p.rank, p))

        // Build tier sections
        const sections: TierSection[] = tiers.map(tier => {
          const maxRank = tier.max_rank ?? tier.min_rank
          const positions: PositionRow[] = []

          for (let rank = tier.min_rank; rank <= maxRank; rank++) {
            const pos = rankToPos.get(rank)
            if (!pos) {
              positions.push({ rank, status: 'vacant', team: null, team_id: null, stats: null })
              continue
            }
            const stats = statsMap.get(pos.team_id) ?? { wins: 0, losses: 0, played: 0, recentForm: [], rankGained: 0, winStreak: 0 }
            positions.push({
              rank,
              status: pos.status as 'active' | 'frozen',
              team: pos.team ?? null,
              team_id: pos.team_id,
              stats,
            })
          }

          return { tier, positions }
        })

        setTierSections(sections)
      } catch (err) {
        console.error('Error fetching standings:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchStandings()
  }, [supabase])

  const filteredSections = useMemo(() => {
    if (!searchTerm) return tierSections
    return tierSections.map(s => ({
      ...s,
      positions: s.positions.filter(pos =>
        pos.status === 'vacant' ||
        pos.team?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (pos.team?.player1?.name ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (pos.team?.player2?.name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
      ),
    })).filter(s => s.positions.length > 0)
  }, [tierSections, searchTerm])

  const totalTeams = tierSections.reduce((sum, s) => sum + s.positions.filter(p => p.status !== 'vacant').length, 0)

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">

      {/* Nav */}
      <nav className="border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/80 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            <span>🎾</span>
            <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">CPL</span>
            <span className="text-slate-400 font-normal text-sm hidden sm:inline">/ Standings</span>
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
          >
            Sign In
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-emerald-400" />
            <h1 className="text-3xl font-black text-white tracking-tight">Live Standings</h1>
          </div>
          {seasonName && (
            <p className="text-slate-400 text-sm">{seasonName} · Live rankings updated in real-time</p>
          )}

          {/* Quick stats */}
          {!loading && (
            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-1.5 text-sm text-slate-400">
                <Users className="h-4 w-4 text-emerald-400" />
                <span><span className="font-semibold text-white">{totalTeams}</span> teams</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-slate-400">
                <Trophy className="h-4 w-4 text-amber-400" />
                <span><span className="font-semibold text-white">{totalMatches}</span> matches played</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-slate-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                <span>Live</span>
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 text-slate-400 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search teams or players…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 h-10 bg-slate-800/60 border border-slate-700/50 text-white placeholder-slate-500 rounded-xl text-sm outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
          />
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-slate-800/40 rounded-2xl h-[72px] animate-pulse" />
            ))}
          </div>
        )}

        {/* Tier sections */}
        {!loading && filteredSections.map(({ tier, positions }) => {
          const style = TIER_STYLE[tier.name] ?? defaultStyle
          const filledCount = positions.filter(p => p.status !== 'vacant').length

          return (
            <div key={tier.id} className="space-y-1.5">

              {/* Tier header */}
              <div className={`flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r ${style.header} border rounded-xl`}>
                <span className={`h-2 w-2 rounded-full ${style.accent} shrink-0`} />
                <span className="font-semibold text-white text-sm tracking-wide">{tier.name}</span>
                <span className="text-slate-500 text-xs ml-auto">
                  {filledCount}/{positions.length} · Ranks {tier.min_rank}–{tier.max_rank ?? tier.min_rank}
                </span>
              </div>

              {/* Rows */}
              <div className="space-y-1">
                {positions.map(pos => {

                  // Vacant
                  if (pos.status === 'vacant') {
                    return (
                      <div key={pos.rank} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-slate-700/40 bg-slate-900/20">
                        <span className="w-10 text-right text-sm font-bold text-slate-700 shrink-0">#{pos.rank}</span>
                        <span className="text-slate-600 text-xs italic">Vacant</span>
                      </div>
                    )
                  }

                  const isFrozen = pos.status === 'frozen'

                  return (
                    <div
                      key={pos.rank}
                      className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-150 ${
                        isFrozen
                          ? 'bg-blue-500/8 border-blue-500/20'
                          : 'bg-slate-800/50 border-slate-700/40 hover:bg-slate-800/70 hover:border-slate-600/60'
                      }`}
                    >
                      {/* Rank */}
                      <div className="w-10 text-right shrink-0 pt-0.5">
                        <span className={`text-xl font-black tabular-nums leading-none ${style.rank}`}>
                          #{pos.rank}
                        </span>
                        {pos.stats && pos.stats.rankGained !== 0 && (
                          <div className={`flex items-center justify-end mt-0.5 gap-0.5 text-[10px] font-semibold ${pos.stats.rankGained > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pos.stats.rankGained > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                            {Math.abs(pos.stats.rankGained)}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-sm text-white">
                            {pos.team?.name}
                          </span>
                          {isFrozen && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/25 shrink-0">
                              <Snowflake className="h-2.5 w-2.5" />Frozen
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 leading-tight truncate">
                          {pos.team?.player1?.name} &amp; {pos.team?.player2?.name}
                        </p>
                        {pos.stats && pos.stats.played > 0 && (
                          <div className="pt-0.5">
                            <StatsStrip stats={pos.stats} />
                          </div>
                        )}
                        {pos.stats && pos.stats.played === 0 && (
                          <p className="text-[11px] text-slate-600 italic">No matches played yet</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* Empty state */}
        {!loading && filteredSections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-slate-600" />
            </div>
            <h3 className="font-semibold text-white mb-1">
              {searchTerm ? 'No Results' : 'No Standings Yet'}
            </h3>
            <p className="text-sm text-slate-500">
              {searchTerm ? 'Try a different search term' : 'No teams have joined the ladder yet'}
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

        {/* CTA for non-members */}
        {!loading && totalTeams > 0 && (
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/8 to-transparent p-8 text-center space-y-4 mt-8">
            <p className="text-white font-bold text-lg">Want to compete?</p>
            <p className="text-slate-400 text-sm">Join the Chiniot Padel League and start climbing the ladder</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-semibold rounded-lg transition-all text-sm gap-1.5"
              >
                Sign In to Your Account
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/"
                className="inline-flex items-center justify-center px-6 py-2.5 bg-slate-700/50 border border-slate-600 hover:bg-slate-700 text-white font-semibold rounded-lg transition-all text-sm"
              >
                Learn More
              </Link>
            </div>
          </div>
        )}

      </div>

      {/* Footer */}
      <footer className="border-t border-slate-700/50 mt-16 py-8 text-center text-slate-500 text-sm">
        <p>© 2026 Chiniot Padel League · <Link href="/" className="hover:text-emerald-400 transition-colors">Home</Link></p>
      </footer>
    </div>
  )
}
