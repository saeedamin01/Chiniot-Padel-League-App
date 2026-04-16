'use client'

import Link from 'next/link'
import { Trophy, Swords, TrendingUp, ArrowRight, Users, Zap, Medal, Calendar } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Static data ──────────────────────────────────────────────────────────────

const TIERS = [
  { name: 'Diamond',  emoji: '💎', color: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',     textColor: 'text-cyan-400',   accentColor: 'bg-cyan-500/10',   prize1: 60000, prize2: 30000, ranks: 'Ranks 1–4' },
  { name: 'Platinum', emoji: '🔷', color: 'from-violet-500/20 to-violet-600/10 border-violet-500/30', textColor: 'text-violet-300', accentColor: 'bg-violet-500/10', prize1: 50000, prize2: 25000, ranks: 'Ranks 5–19' },
  { name: 'Gold',     emoji: '🥇', color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30',   textColor: 'text-amber-400',  accentColor: 'bg-amber-500/10',  prize1: 40000, prize2: 20000, ranks: 'Ranks 20–34' },
  { name: 'Silver',   emoji: '🥈', color: 'from-gray-500/20 to-gray-600/10 border-gray-500/30',      textColor: 'text-gray-300',   accentColor: 'bg-gray-500/10',   prize1: 30000, prize2: 15000, ranks: 'Ranks 35–49' },
  { name: 'Bronze',   emoji: '🥉', color: 'from-orange-500/20 to-orange-600/10 border-orange-500/30', textColor: 'text-orange-400', accentColor: 'bg-orange-500/10', prize1: 30000, prize2: 15000, ranks: 'Ranks 50+' },
]

const STEPS = [
  { icon: Swords,     title: 'Challenge', emoji: '🎯', description: 'Challenge any team in your tier or climb to the one above' },
  { icon: TrendingUp, title: 'Play',      emoji: '⚡', description: 'Win matches to earn points and move up the ladder' },
  { icon: Trophy,     title: 'Climb',     emoji: '🏆', description: 'Reach the top of your tier and claim the championship prizes' },
]

const TIER_RANK_STYLE: Record<string, { rank: string; badge: string; dot: string }> = {
  Diamond:  { rank: 'text-cyan-400',   badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25',   dot: 'bg-cyan-400'   },
  Platinum: { rank: 'text-violet-400', badge: 'bg-violet-500/15 text-violet-300 border-violet-500/25', dot: 'bg-violet-400' },
  Gold:     { rank: 'text-amber-400',  badge: 'bg-amber-500/15 text-amber-300 border-amber-500/25',  dot: 'bg-amber-400'  },
  Silver:   { rank: 'text-slate-300',  badge: 'bg-slate-400/15 text-slate-200 border-slate-400/25',  dot: 'bg-slate-400'  },
  Bronze:   { rank: 'text-orange-400', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/25', dot: 'bg-orange-400' },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LiveStats {
  teamCount: number
  matchCount: number
  seasonName: string
}

interface RecentResult {
  id: string
  winnerName: string
  loserName: string
  winnerRank: number | null
  loserRank: number | null
  playedAt: string
}

interface LadderPreviewRow {
  rank: number
  teamName: string
  player1: string
  player2: string
  wins: number
  losses: number
  tierName: string
}

interface TierPreview {
  tierName: string
  rows: LadderPreviewRow[]
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [mounted, setMounted] = useState(false)
  const [animatedEmojis, setAnimatedEmojis] = useState<Array<{ id: string; left: string; delay: number }>>([])

  // Live data
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null)
  const [recentResults, setRecentResults] = useState<RecentResult[]>([])
  const [tierPreviews, setTierPreviews] = useState<TierPreview[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    setMounted(true)
    const emojis = Array.from({ length: 15 }, (_, i) => ({
      id: `emoji-${i}`,
      left: `${Math.random() * 100}%`,
      delay: Math.random() * 5,
    }))
    setAnimatedEmojis(emojis)
  }, [])

  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        // Active season
        const { data: season } = await supabase
          .from('seasons').select('id, name').eq('is_active', true).single()
        if (!season) { setDataLoading(false); return }

        // Parallel: teams count, matches, tiers, ladder positions, recent results
        const [teamsRes, matchesRes, tiersRes, positionsRes, recentRes] = await Promise.all([
          supabase.from('teams')
            .select('id', { count: 'exact', head: true })
            .eq('season_id', season.id)
            .in('status', ['active', 'frozen']),

          supabase.from('match_results')
            .select('id', { count: 'exact', head: true })
            .eq('season_id', season.id),

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
              ),
              tier:tiers!tier_id(name)
            `)
            .eq('season_id', season.id)
            .order('rank', { ascending: true })
            .limit(60),

          supabase.from('match_results')
            .select(`
              id, created_at,
              winner:teams!winner_team_id(name),
              loser:teams!loser_team_id(name),
              winner_team_id, loser_team_id
            `)
            .eq('season_id', season.id)
            .order('created_at', { ascending: false })
            .limit(6),
        ])

        // Live stats
        setLiveStats({
          teamCount: teamsRes.count ?? 0,
          matchCount: matchesRes.count ?? 0,
          seasonName: season.name ?? '',
        })

        // Rank lookup for recent results
        const rankMap = new Map<string, number>()
        for (const p of (positionsRes.data || [])) {
          if (p.team_id) rankMap.set(p.team_id, p.rank)
        }

        // Build match stats for W/L
        const statsMap = new Map<string, { wins: number; losses: number }>()
        const allResultsRes = await supabase.from('match_results')
          .select('winner_team_id, loser_team_id')
          .eq('season_id', season.id)
        for (const mr of (allResultsRes.data || [])) {
          if (!statsMap.has(mr.winner_team_id)) statsMap.set(mr.winner_team_id, { wins: 0, losses: 0 })
          if (!statsMap.has(mr.loser_team_id))  statsMap.set(mr.loser_team_id,  { wins: 0, losses: 0 })
          statsMap.get(mr.winner_team_id)!.wins++
          statsMap.get(mr.loser_team_id)!.losses++
        }

        // Recent results
        const results: RecentResult[] = (recentRes.data || []).map((mr: any) => {
          const winner = Array.isArray(mr.winner) ? mr.winner[0] : mr.winner
          const loser  = Array.isArray(mr.loser)  ? mr.loser[0]  : mr.loser
          return {
            id: mr.id,
            winnerName: winner?.name ?? 'Unknown',
            loserName:  loser?.name  ?? 'Unknown',
            winnerRank: rankMap.get(mr.winner_team_id) ?? null,
            loserRank:  rankMap.get(mr.loser_team_id)  ?? null,
            playedAt:   mr.created_at,
          }
        })
        setRecentResults(results)

        // Tier previews — top 3 per tier
        const tiers: any[] = tiersRes.data || []
        const allPositions: any[] = positionsRes.data || []
        const rankToPos = new Map<number, any>()
        allPositions.forEach(p => rankToPos.set(p.rank, p))

        const previews: TierPreview[] = tiers.map(tier => {
          const maxRank = tier.max_rank ?? tier.min_rank
          const rows: LadderPreviewRow[] = []
          for (let rank = tier.min_rank; rank <= maxRank && rows.length < 3; rank++) {
            const pos = rankToPos.get(rank)
            if (!pos || pos.status === 'vacant' || !pos.team) continue
            const s = statsMap.get(pos.team_id) ?? { wins: 0, losses: 0 }
            rows.push({
              rank,
              teamName: pos.team.name,
              player1:  (Array.isArray(pos.team.player1) ? pos.team.player1[0] : pos.team.player1)?.name ?? '',
              player2:  (Array.isArray(pos.team.player2) ? pos.team.player2[0] : pos.team.player2)?.name ?? '',
              wins:     s.wins,
              losses:   s.losses,
              tierName: tier.name,
            })
          }
          return { tierName: tier.name, rows }
        }).filter(tp => tp.rows.length > 0)

        setTierPreviews(previews)
      } catch (err) {
        console.error('Failed to load live data:', err)
      } finally {
        setDataLoading(false)
      }
    }

    fetchLiveData()
  }, [supabase])

  // Format recent result date
  const fmtResultDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch {
      return iso
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* Animated background */}
      {mounted && (
        <div className="fixed inset-0 pointer-events-none">
          {animatedEmojis.map((emoji) => (
            <div
              key={emoji.id}
              className="absolute text-4xl opacity-5 animate-pulse"
              style={{ left: emoji.left, top: '-50px', animation: `float ${8 + Math.random() * 4}s ease-in-out infinite`, animationDelay: `${emoji.delay}s` }}
            >
              🎾
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes float {
          0%   { transform: translateY(0) translateX(0);    opacity: 0; }
          10%  { opacity: 0.1; }
          50%  { opacity: 0.05; }
          90%  { opacity: 0; }
          100% { transform: translateY(100vh) translateX(100px); opacity: 0; }
        }
      `}</style>

      {/* Navigation */}
      <nav className="relative z-10 border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-2xl font-bold">
            <span>🎾</span>
            <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">CPL</span>
          </div>
          <div className="hidden md:flex items-center space-x-8 text-slate-300">
            <a href="#how-it-works" className="hover:text-white transition">How It Works</a>
            <a href="#tiers" className="hover:text-white transition">Tiers</a>
            <Link href="/standings" className="hover:text-white transition">Standings</Link>
            <Link href="/login" className="px-4 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-600 transition text-white">
              Sign In
            </Link>
          </div>
          <Link href="/login" className="md:hidden px-3 py-1.5 rounded-lg bg-slate-700/50 text-white text-sm">
            Sign In
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-8">
            {/* Live badge */}
            <div className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-full w-fit">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
              <span className="text-emerald-400 text-sm font-semibold">
                {liveStats?.seasonName ? `${liveStats.seasonName} — Now Live` : 'Season Now Live'}
              </span>
            </div>

            <div className="space-y-4">
              <h1 className="text-5xl md:text-6xl font-black leading-tight">
                <span className="bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400 bg-clip-text text-transparent">
                  🎾 Chiniot Padel League
                </span>
              </h1>
              <p className="text-xl text-slate-400 leading-relaxed max-w-2xl">
                The premier padel ladder league for the Chiniot community. Challenge friends, climb ranks, and compete for incredible prizes across five competitive tiers.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link
                href="/standings"
                className="group inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold rounded-lg transition-all transform hover:scale-105 shadow-lg"
              >
                View Live Standings
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-8 py-4 bg-slate-700/50 border border-slate-500 hover:bg-slate-600 text-white font-bold rounded-lg transition-all"
              >
                Sign In
              </Link>
            </div>
          </div>

          {/* Right visual */}
          <div className="relative h-96 hidden lg:flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-3xl blur-3xl"></div>
            <div className="relative text-center space-y-8">
              <div className="text-8xl animate-bounce" style={{ animationDelay: '0s' }}>🏆</div>
              <div className="flex justify-center space-x-4 text-6xl">
                <div className="animate-bounce" style={{ animationDelay: '0.2s' }}>🎾</div>
                <div className="animate-bounce" style={{ animationDelay: '0.4s' }}>⚡</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live Stats Bar ── */}
      <section className="relative z-10 border-y border-slate-700/50 backdrop-blur-sm bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <p className="text-sm text-slate-400 uppercase tracking-wider">Teams</p>
              {dataLoading ? (
                <div className="h-9 w-16 bg-slate-700/40 rounded animate-pulse mx-auto mt-1" />
              ) : (
                <p className="text-3xl font-bold text-emerald-400">{liveStats?.teamCount ?? '—'}</p>
              )}
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-400 uppercase tracking-wider">Tiers</p>
              <p className="text-3xl font-bold text-emerald-400">5</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-400 uppercase tracking-wider">Prize Pool</p>
              <p className="text-3xl font-bold text-emerald-400">PKR 225K</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-slate-400 uppercase tracking-wider">Matches Played</p>
              {dataLoading ? (
                <div className="h-9 w-16 bg-slate-700/40 rounded animate-pulse mx-auto mt-1" />
              ) : (
                <p className="text-3xl font-bold text-emerald-400">{liveStats?.matchCount ?? '—'}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Live Ladder Preview ── */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wider">Live Data</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black mb-4">Current Leaders</h2>
          <p className="text-xl text-slate-400">Top teams across each tier, updated in real-time</p>
        </div>

        {dataLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-slate-800/40 rounded-2xl h-48 animate-pulse" />
            ))}
          </div>
        ) : tierPreviews.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tierPreviews.map(tp => {
              const style = TIER_RANK_STYLE[tp.tierName] ?? { rank: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25', dot: 'bg-emerald-400' }
              const tierData = TIERS.find(t => t.name === tp.tierName)
              return (
                <div key={tp.tierName} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 overflow-hidden hover:border-slate-600/60 transition-colors">
                  {/* Tier header */}
                  <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${style.dot} shrink-0`} />
                    <span className="font-bold text-white text-sm">{tierData?.emoji} {tp.tierName}</span>
                    <span className="text-slate-500 text-xs ml-auto">{tierData?.ranks}</span>
                  </div>
                  {/* Teams */}
                  <div className="divide-y divide-slate-700/30">
                    {tp.rows.map(row => (
                      <div key={row.rank} className="flex items-center gap-3 px-4 py-3">
                        <span className={`text-lg font-black tabular-nums w-8 shrink-0 ${style.rank}`}>#{row.rank}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-white truncate">{row.teamName}</p>
                          <p className="text-xs text-slate-500 truncate">{row.player1} &amp; {row.player2}</p>
                        </div>
                        {(row.wins + row.losses) > 0 && (
                          <div className="shrink-0 text-right">
                            <span className="text-[11px] font-semibold tabular-nums">
                              <span className="text-emerald-400">{row.wins}W</span>
                              <span className="text-slate-500 mx-0.5">·</span>
                              <span className="text-red-400">{row.losses}L</span>
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500">
            <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Season just started — check back soon!</p>
          </div>
        )}

        <div className="text-center mt-8">
          <Link
            href="/standings"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800/60 border border-slate-700/50 hover:border-emerald-500/40 hover:bg-slate-800 text-white font-semibold transition-all text-sm group"
          >
            View Full Standings
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </section>

      {/* ── Recent Results ── */}
      {recentResults.length > 0 && (
        <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Recent Results</h2>
            <p className="text-slate-400">Latest match outcomes from the ladder</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 max-w-5xl mx-auto">
            {recentResults.map(result => (
              <div key={result.id} className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3 space-y-2">
                {/* Winner */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 shrink-0">WIN</span>
                  <span className="font-semibold text-sm text-white truncate">{result.winnerName}</span>
                  {result.winnerRank && <span className="text-xs text-slate-500 shrink-0">#{result.winnerRank}</span>}
                </div>
                {/* Loser */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 shrink-0 mr-[1px]">DEF</span>
                  <span className="text-sm text-slate-400 truncate">{result.loserName}</span>
                  {result.loserRank && <span className="text-xs text-slate-600 shrink-0">#{result.loserRank}</span>}
                </div>
                {/* Date */}
                <div className="flex items-center gap-1 text-[11px] text-slate-600 pt-0.5">
                  <Calendar className="h-3 w-3" />
                  {fmtResultDate(result.playedAt)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── How It Works ── */}
      <section id="how-it-works" className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-black mb-4">How It Works</h2>
          <p className="text-xl text-slate-400">Three simple steps to join the league and start climbing</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map((step, index) => {
            const Icon = step.icon
            return (
              <div key={index} className="relative group">
                <div className="relative p-8 rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-800/50 to-slate-900/50 hover:border-slate-600 transition-all duration-300 h-full">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-emerald-500/0 group-hover:from-emerald-500/10 group-hover:to-emerald-500/5 rounded-2xl transition-all duration-300"></div>
                  <div className="relative space-y-4">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30 text-2xl font-bold text-emerald-400">
                      {index + 1}
                    </div>
                    <div className="space-y-2">
                      <div className="text-5xl">{step.emoji}</div>
                      <h3 className="text-2xl font-bold text-white">{step.title}</h3>
                    </div>
                    <p className="text-slate-400 leading-relaxed">{step.description}</p>
                  </div>
                </div>
                {index < STEPS.length - 1 && (
                  <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 items-center justify-center w-8 h-8 rounded-full bg-slate-800 border border-slate-700 z-20">
                    <ArrowRight className="w-4 h-4 text-emerald-400" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Tiers ── */}
      <section id="tiers" className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-black mb-4">Five Competitive Tiers</h2>
          <p className="text-xl text-slate-400">Compete in your level and climb to claim bigger prizes</p>
        </div>

        <div className="grid lg:grid-cols-5 md:grid-cols-2 gap-6">
          {TIERS.map((tier, index) => (
            <div
              key={index}
              className={`group relative p-6 rounded-2xl border bg-gradient-to-br ${tier.color} hover:border-opacity-100 transition-all duration-300 h-full transform hover:scale-105 hover:-translate-y-2`}
            >
              <div className={`absolute inset-0 rounded-2xl ${tier.accentColor} opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl`}></div>
              <div className="relative space-y-4">
                <div className="text-5xl">{tier.emoji}</div>
                <h3 className={`text-2xl font-black ${tier.textColor}`}>{tier.name}</h3>
                <p className="text-sm text-slate-300">{tier.ranks}</p>
                <div className="space-y-2 pt-4 border-t border-slate-700/50">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">1st Place</span>
                    <span className={`font-bold ${tier.textColor}`}>PKR {tier.prize1.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">2nd Place</span>
                    <span className={`font-bold ${tier.textColor}`}>PKR {tier.prize2.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-green-500/5 p-12 text-center">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent blur-3xl"></div>
          <div className="relative space-y-6">
            <h2 className="text-4xl font-black">Ready to Join?</h2>
            <p className="text-xl text-slate-400">
              Sign up now and start your journey to the top of the Chiniot Padel League
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link
                href="/register"
                className="inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white font-bold rounded-lg transition-all transform hover:scale-105"
              >
                Create Account
                <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
              <Link
                href="/standings"
                className="inline-flex items-center justify-center px-8 py-4 bg-slate-700/50 border border-slate-500 hover:bg-slate-600 text-white font-bold rounded-lg transition-all"
              >
                View Live Standings
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-slate-700/50 bg-slate-900/50 backdrop-blur-sm mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-3 gap-12 mb-8">
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-xl font-bold">
                <span>🎾</span>
                <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                  Chiniot Padel League
                </span>
              </div>
              <p className="text-slate-400">The premier padel ladder league for the Chiniot community.</p>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-white">Quick Links</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link href="/standings" className="hover:text-emerald-400 transition">Live Standings</Link></li>
                <li><Link href="/login" className="hover:text-emerald-400 transition">Sign In</Link></li>
                <li><Link href="/register" className="hover:text-emerald-400 transition">Register</Link></li>
              </ul>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-white">Support</h4>
              <ul className="space-y-2 text-slate-400">
                <li><button className="hover:text-emerald-400 transition">Help Center</button></li>
                <li><button className="hover:text-emerald-400 transition">Contact Us</button></li>
                <li><button className="hover:text-emerald-400 transition">Rules &amp; FAQs</button></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-700/50 pt-8 flex flex-col md:flex-row justify-between items-center text-slate-400 text-sm">
            <p>© 2026 Chiniot Padel League. Built with love for the community.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <button className="hover:text-white transition">Privacy</button>
              <button className="hover:text-white transition">Terms</button>
              <button className="hover:text-white transition">Contact</button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
