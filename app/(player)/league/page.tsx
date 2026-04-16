'use client'

import React, { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import {
  Flame, TrendingUp, Trophy, Calendar, Swords,
  Zap, Star, ShieldCheck, Activity, Users, Clock,
  ChevronRight, ArrowUp,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamInfo {
  id: string; name: string
  player1?: { id: string; name: string }
  player2?: { id: string; name: string }
}

interface TierInfo { id?: string; name: string }

interface MatchResultRow {
  id: string
  winner_team_id: string
  loser_team_id: string
  created_at: string
  verified_at: string | null
  set1_challenger: number | null; set1_challenged: number | null
  set2_challenger: number | null; set2_challenged: number | null
  supertiebreak_challenger: number | null; supertiebreak_challenged: number | null
  challenge: {
    id: string
    challenging_team_id: string; challenged_team_id: string
    challenging_team: TeamInfo; challenged_team: TeamInfo
    tier: TierInfo | null
  } | null
}

interface ChallengeRow {
  id: string; status: string
  confirmed_time: string | null; accepted_slot: string | null; match_date: string | null
  created_at: string
  challenging_team: TeamInfo; challenged_team: TeamInfo
  tier: TierInfo | null
}

interface TeamStats {
  teamId: string; teamName: string
  player1Name: string; player2Name: string
  rank: number; tier: string
  wins: number; losses: number; played: number
  winPct: number; recentForm: ('W' | 'L')[]; winStreak: number; rankGained: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Platinum: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Silver: 'bg-slate-400/20 text-slate-300 border-slate-400/40',
  Bronze: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
}

function TierPill({ name }: { name?: string }) {
  if (!name) return null
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${TIER_BADGE[name] ?? 'bg-slate-500/20 text-slate-400 border-slate-500/40'}`}>
      {name}
    </span>
  )
}

function playerNames(t: TeamInfo) {
  return [t.player1?.name, t.player2?.name].filter(Boolean).join(' & ')
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return 'TBC'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatScore(mr: MatchResultRow) {
  const c = mr.challenge
  if (!c) return ''
  const isWC = mr.winner_team_id === c.challenging_team_id
  const s = (a: number | null, b: number | null) => (a != null && b != null) ? `${a}-${b}` : null
  const sets = [
    isWC ? s(mr.set1_challenger, mr.set1_challenged) : s(mr.set1_challenged, mr.set1_challenger),
    isWC ? s(mr.set2_challenger, mr.set2_challenged) : s(mr.set2_challenged, mr.set2_challenger),
  ].filter(Boolean)
  const tb = isWC
    ? s(mr.supertiebreak_challenger, mr.supertiebreak_challenged)
    : s(mr.supertiebreak_challenged, mr.supertiebreak_challenger)
  if (tb) sets.push(`[${tb}]`)
  return sets.join('  ')
}

function FormDots({ form, size = 'sm' }: { form: ('W' | 'L')[]; size?: 'sm' | 'lg' }) {
  const last5 = [...form].reverse().slice(0, 5).reverse()
  const dot = size === 'lg' ? 'h-2 w-2' : 'h-1.5 w-1.5'
  return (
    <div className="flex items-center gap-0.5">
      {last5.map((r, i) => (
        <span key={i} className={`inline-block ${dot} rounded-full ${r === 'W' ? 'bg-emerald-400' : 'bg-red-400'}`} />
      ))}
    </div>
  )
}

// ─── Tab pill selector ────────────────────────────────────────────────────────

type Tab = 'highlights' | 'upcoming' | 'results' | 'live'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'highlights', label: 'Highlights', icon: <Star className="h-3.5 w-3.5" /> },
  { id: 'upcoming',   label: 'Upcoming',   icon: <Calendar className="h-3.5 w-3.5" /> },
  { id: 'results',    label: 'Results',    icon: <Trophy className="h-3.5 w-3.5" /> },
  { id: 'live',       label: 'Live',       icon: <Zap className="h-3.5 w-3.5" /> },
]

// ─── Highlights Tab ───────────────────────────────────────────────────────────

function HighlightsTab({ allStats, seasonPulse }: {
  allStats: TeamStats[]
  seasonPulse: { matches: number; teams: number; activeChallenges: number; thisWeek: number }
}) {
  const onFire         = useMemo(() => allStats.filter(s => s.winStreak >= 3).sort((a,b) => b.winStreak - a.winStreak).slice(0, 6), [allStats])
  const biggestMovers  = useMemo(() => allStats.filter(s => s.rankGained > 0).sort((a,b) => b.rankGained - a.rankGained).slice(0, 6), [allStats])
  const perfectRecord  = useMemo(() => allStats.filter(s => s.played >= 2 && s.losses === 0).sort((a,b) => b.played - a.played), [allStats])
  const mostActive     = useMemo(() => allStats.filter(s => s.played > 0).sort((a,b) => b.played - a.played).slice(0, 3), [allStats])
  const winRateLeaders = useMemo(() => allStats.filter(s => s.played >= 3).sort((a,b) => b.winPct - a.winPct).slice(0, 3), [allStats])

  // Top 2 teams per tier
  const tierLeaders = useMemo(() => {
    const tiers = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']
    return tiers
      .map(tier => ({
        tier,
        leaders: allStats.filter(s => s.tier === tier && s.played > 0).sort((a, b) => b.winPct - a.winPct).slice(0, 2),
      }))
      .filter(t => t.leaders.length > 0)
  }, [allStats])

  if (allStats.length === 0 || allStats.every(s => s.played === 0)) {
    return (
      <div className="text-center py-20">
        <Activity className="h-10 w-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400 font-medium">Season stats will appear here once matches are played</p>
      </div>
    )
  }

  return (
    <div className="space-y-10">

      {/* ── Season Pulse ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Matches Played',  value: seasonPulse.matches,          color: 'text-emerald-500 dark:text-emerald-400' },
          { label: 'Active Teams',    value: seasonPulse.teams,            color: 'text-slate-800 dark:text-white' },
          { label: 'Live Challenges', value: seasonPulse.activeChallenges, color: 'text-amber-500 dark:text-amber-400' },
          { label: 'Played This Week',value: seasonPulse.thisWeek,         color: 'text-blue-500 dark:text-blue-400' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 p-4 text-center">
            <div className={`text-3xl font-black ${color}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-1 leading-tight">{label}</div>
          </Card>
        ))}
      </div>

      {/* ── On Fire 🔥 ── */}
      {onFire.length > 0 && (
        <section>
          <SectionTitle icon={<Flame className="h-4 w-4 text-orange-500 dark:text-orange-400" />} label="On Fire" color="text-orange-500 dark:text-orange-400" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {onFire.map(s => (
              <Link key={s.teamId} href={`/teams/${s.teamId}`}>
                <Card className="bg-gradient-to-br from-orange-100 to-orange-50 dark:from-orange-500/10 dark:to-slate-800/80 border-orange-200 dark:border-orange-500/25 p-4 hover:border-orange-400 dark:hover:border-orange-500/50 transition-all group cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-300 transition-colors truncate">{s.teamName}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{[s.player1Name, s.player2Name].filter(Boolean).join(' & ')}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <TierPill name={s.tier} />
                        <span className="text-xs text-slate-500">#{s.rank}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Flame className="h-4 w-4 text-orange-500 dark:text-orange-400" />
                        <span className="text-2xl font-black text-orange-500 dark:text-orange-400">{s.winStreak}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">win streak</p>
                      <div className="mt-1.5 flex justify-end">
                        <FormDots form={s.recentForm} />
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Perfect Record ── */}
      {perfectRecord.length > 0 && (
        <section>
          <SectionTitle icon={<ShieldCheck className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />} label="Perfect Record" color="text-emerald-500 dark:text-emerald-400" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {perfectRecord.map(s => (
              <Link key={s.teamId} href={`/teams/${s.teamId}`}>
                <Card className="bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-500/10 dark:to-slate-800/80 border-emerald-200 dark:border-emerald-500/25 p-4 hover:border-emerald-400 dark:hover:border-emerald-500/50 transition-all group cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors truncate">{s.teamName}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{[s.player1Name, s.player2Name].filter(Boolean).join(' & ')}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <TierPill name={s.tier} />
                        <span className="text-xs text-slate-500">#{s.rank}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">100%</div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{s.played}W · 0L</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Biggest Climbers ── */}
      {biggestMovers.length > 0 && (
        <section>
          <SectionTitle icon={<TrendingUp className="h-4 w-4 text-sky-500 dark:text-sky-400" />} label="Biggest Climbers" color="text-sky-500 dark:text-sky-400" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {biggestMovers.map(s => (
              <Link key={s.teamId} href={`/teams/${s.teamId}`}>
                <Card className="bg-gradient-to-br from-sky-100 to-sky-50 dark:from-sky-500/10 dark:to-slate-800/80 border-sky-200 dark:border-sky-500/25 p-4 hover:border-sky-400 dark:hover:border-sky-500/50 transition-all group cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 dark:text-white group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors truncate">{s.teamName}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{[s.player1Name, s.player2Name].filter(Boolean).join(' & ')}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <TierPill name={s.tier} />
                        <span className="text-xs text-slate-600 dark:text-slate-400">{s.wins}W · {s.losses}L</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="flex items-center gap-0.5 justify-end">
                        <ArrowUp className="h-4 w-4 text-sky-500 dark:text-sky-400" />
                        <span className="text-2xl font-black text-sky-500 dark:text-sky-400">{s.rankGained}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">positions climbed</p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Win Rate Leaders + Most Active ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

        {winRateLeaders.length > 0 && (
          <section>
            <SectionTitle icon={<Trophy className="h-4 w-4 text-yellow-500 dark:text-yellow-400" />} label="Win Rate Leaders" color="text-yellow-600 dark:text-yellow-400" sub="min. 3 matches" />
            <div className="space-y-2">
              {winRateLeaders.map((s, i) => (
                <Link key={s.teamId} href={`/teams/${s.teamId}`}>
                  <Card className="bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 p-3.5 hover:border-yellow-400 dark:hover:border-yellow-500/30 hover:bg-yellow-50 dark:hover:bg-slate-800/80 transition-all group cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className={`text-lg font-black w-6 text-center ${i === 0 ? 'text-yellow-500 dark:text-yellow-400' : i === 1 ? 'text-slate-400 dark:text-slate-300' : 'text-orange-600 dark:text-orange-700'}`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white group-hover:text-yellow-700 dark:group-hover:text-yellow-300 transition-colors text-sm truncate">{s.teamName}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <TierPill name={s.tier} />
                          <FormDots form={s.recentForm} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-lg font-black text-yellow-500 dark:text-yellow-400">{s.winPct}%</span>
                        <p className="text-[10px] text-slate-500">{s.wins}W · {s.losses}L</p>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {mostActive.length > 0 && (
          <section>
            <SectionTitle icon={<Activity className="h-4 w-4 text-violet-500 dark:text-violet-400" />} label="Most Active" color="text-violet-600 dark:text-violet-400" sub="by matches played" />
            <div className="space-y-2">
              {mostActive.map((s, i) => (
                <Link key={s.teamId} href={`/teams/${s.teamId}`}>
                  <Card className="bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 p-3.5 hover:border-violet-400 dark:hover:border-violet-500/30 hover:bg-violet-50 dark:hover:bg-slate-800/80 transition-all group cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-black w-6 text-center text-violet-500 dark:text-violet-400">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors text-sm truncate">{s.teamName}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <TierPill name={s.tier} />
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-500">{s.wins}W</span>
                          <span className="text-[11px] text-red-500">{s.losses}L</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-lg font-black text-violet-500 dark:text-violet-400">{s.played}</span>
                        <p className="text-[10px] text-slate-500">matches</p>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ── Tier Leaders ── */}
      {tierLeaders.length > 0 && (
        <section>
          <SectionTitle icon={<Star className="h-4 w-4 text-slate-500 dark:text-slate-300" />} label="Top of Their Tier" color="text-slate-600 dark:text-slate-300" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tierLeaders.map(({ tier, leaders }) => (
              <Card key={tier} className="p-4 border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800/60">
                {/* Tier header */}
                <div className="mb-3">
                  <TierPill name={tier} />
                </div>
                {/* Top 2 teams */}
                <div className="space-y-3">
                  {leaders.map((s, i) => (
                    <Link key={s.teamId} href={`/teams/${s.teamId}`}>
                      <div className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/50 ${i === 0 ? 'bg-slate-100 dark:bg-slate-700/30' : ''}`}>
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span className={`text-sm font-black w-4 text-center shrink-0 ${i === 0 ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className={`font-semibold text-sm truncate ${i === 0 ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{s.teamName}</p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-600 truncate">{[s.player1Name, s.player2Name].filter(Boolean).join(' & ')}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-sm font-black ${i === 0 ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{s.winPct}%</span>
                          <p className="text-[10px] text-slate-400 dark:text-slate-600">{s.wins}W · {s.losses}L</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

    </div>
  )
}

// ─── Upcoming Tab ─────────────────────────────────────────────────────────────

function UpcomingTab({ challenges }: { challenges: ChallengeRow[] }) {
  if (challenges.length === 0) {
    return (
      <EmptyState icon={<Calendar className="h-10 w-10 text-slate-600" />}
        title="No upcoming matches" subtitle="Scheduled matches will appear here once times are confirmed." />
    )
  }
  return (
    <div className="space-y-3">
      {challenges.map(c => {
        const matchAt = c.confirmed_time ?? c.accepted_slot ?? c.match_date
        return (
          <Card key={c.id} className="bg-white dark:bg-slate-800/60 border-blue-200 dark:border-blue-500/20 p-5 hover:border-blue-400 dark:hover:border-blue-500/40 transition-colors">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                <span className="text-xs font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wide">Upcoming</span>
                {c.tier && <TierPill name={c.tier.name} />}
              </div>
              {matchAt && (
                <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{fmtDateTime(matchAt)}</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1 text-center">
                <Link href={`/teams/${c.challenging_team.id}`} className="font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-300 transition-colors">
                  {c.challenging_team.name}
                </Link>
                {playerNames(c.challenging_team) && (
                  <p className="text-xs text-slate-500 mt-0.5">{playerNames(c.challenging_team)}</p>
                )}
              </div>
              <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-xs font-black">VS</div>
              <div className="flex-1 text-center">
                <Link href={`/teams/${c.challenged_team.id}`} className="font-bold text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-300 transition-colors">
                  {c.challenged_team.name}
                </Link>
                {playerNames(c.challenged_team) && (
                  <p className="text-xs text-slate-500 mt-0.5">{playerNames(c.challenged_team)}</p>
                )}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab({ results, statsMap }: {
  results: MatchResultRow[]
  statsMap: Map<string, { wins: number; losses: number; played: number; recentForm: ('W'|'L')[] }>
}) {
  if (results.length === 0) {
    return (
      <EmptyState icon={<Trophy className="h-10 w-10 text-slate-600" />}
        title="No results yet" subtitle="Match results will appear here once games are played and verified." />
    )
  }
  return (
    <div className="space-y-3">
      {results.map(mr => {
        const c = mr.challenge
        if (!c) return null
        const winner = mr.winner_team_id === c.challenging_team_id ? c.challenging_team : c.challenged_team
        const loser  = mr.winner_team_id === c.challenging_team_id ? c.challenged_team : c.challenging_team
        const score  = formatScore(mr)
        const ws = statsMap.get(winner.id)
        const ls = statsMap.get(loser.id)

        return (
          <Card key={mr.id} className="bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 p-5 hover:border-slate-300 dark:hover:border-slate-600/80 transition-colors">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-500 dark:text-emerald-400 uppercase tracking-wide">Result</span>
                {c.tier && <TierPill name={c.tier.name} />}
              </div>
              <span className="text-xs text-slate-500">{timeAgo(mr.verified_at ?? mr.created_at)}</span>
            </div>

            {/* Winner row */}
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <Link href={`/teams/${winner.id}`} className="font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors">
                  {winner.name}
                </Link>
                {playerNames(winner) && <p className="text-xs text-slate-500 mt-0.5">{playerNames(winner)}</p>}
                {ws && ws.played > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-500 font-semibold">{ws.wins}W</span>
                    <span className="text-[11px] text-slate-400">·</span>
                    <span className="text-[11px] text-red-500 font-semibold">{ws.losses}L</span>
                    <FormDots form={ws.recentForm} />
                  </div>
                )}
              </div>
              <div className="text-right shrink-0 ml-4">
                <span className="inline-flex items-center gap-1 text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full">
                  WON
                </span>
                {score && <p className="text-sm font-mono font-bold text-slate-900 dark:text-white mt-1">{score}</p>}
              </div>
            </div>

            <div className="my-3 border-t border-slate-200 dark:border-slate-700/50" />

            {/* Loser row */}
            <div className="flex items-center justify-between opacity-55">
              <div className="flex-1 min-w-0">
                <Link href={`/teams/${loser.id}`} className="font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                  {loser.name}
                </Link>
                {playerNames(loser) && <p className="text-xs text-slate-500 mt-0.5">{playerNames(loser)}</p>}
                {ls && ls.played > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-500 font-semibold">{ls.wins}W</span>
                    <span className="text-[11px] text-slate-400">·</span>
                    <span className="text-[11px] text-red-500 font-semibold">{ls.losses}L</span>
                  </div>
                )}
              </div>
              <span className="text-xs text-slate-500 font-medium shrink-0 ml-4">LOST</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Live Tab ─────────────────────────────────────────────────────────────────

function LiveTab({ challenges }: { challenges: ChallengeRow[] }) {
  if (challenges.length === 0) {
    return (
      <EmptyState icon={<Zap className="h-10 w-10 text-slate-600" />}
        title="Nothing live right now" subtitle="Active challenges — ones being arranged or awaiting a time — appear here." />
    )
  }

  const statusLabel: Record<string, { label: string; color: string }> = {
    pending:              { label: 'Awaiting acceptance',  color: 'text-yellow-600 dark:text-yellow-400' },
    accepted:             { label: 'Arranging schedule',   color: 'text-orange-600 dark:text-orange-400' },
    accepted_open:        { label: 'Arranging schedule',   color: 'text-orange-600 dark:text-orange-400' },
    time_pending_confirm: { label: 'Confirming time',      color: 'text-blue-600 dark:text-blue-400' },
    scheduled:            { label: 'Match scheduled',      color: 'text-emerald-600 dark:text-emerald-400' },
  }

  return (
    <div className="space-y-3">
      {challenges.map(c => {
        const sl = statusLabel[c.status] ?? { label: c.status, color: 'text-slate-400' }
        return (
          <Card key={c.id} className="bg-white dark:bg-slate-800/60 border-amber-200 dark:border-amber-500/20 p-4 hover:border-amber-400 dark:hover:border-amber-500/40 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </div>
                  <span className={`text-xs font-semibold ${sl.color}`}>{sl.label}</span>
                  {c.tier && <TierPill name={c.tier.name} />}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Link href={`/teams/${c.challenging_team.id}`} className="font-semibold text-slate-900 dark:text-white hover:text-amber-600 dark:hover:text-amber-300 transition-colors text-sm truncate block">
                      {c.challenging_team.name}
                    </Link>
                    {playerNames(c.challenging_team) && (
                      <p className="text-[11px] text-slate-500 truncate">{playerNames(c.challenging_team)}</p>
                    )}
                  </div>
                  <span className="text-slate-400 text-xs font-bold shrink-0">vs</span>
                  <div className="flex-1 min-w-0 text-right">
                    <Link href={`/teams/${c.challenged_team.id}`} className="font-semibold text-slate-900 dark:text-white hover:text-amber-600 dark:hover:text-amber-300 transition-colors text-sm truncate block">
                      {c.challenged_team.name}
                    </Link>
                    {playerNames(c.challenged_team) && (
                      <p className="text-[11px] text-slate-500 truncate">{playerNames(c.challenged_team)}</p>
                    )}
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-slate-500 shrink-0">{timeAgo(c.created_at)}</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SectionTitle({ icon, label, color, sub }: { icon: React.ReactNode; label: string; color: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className={color}>{icon}</span>
      <h2 className={`font-bold text-base ${color}`}>{label}</h2>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  )
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="text-center py-20">
      <div className="flex justify-center mb-3">{icon}</div>
      <p className="text-slate-300 font-semibold">{title}</p>
      <p className="text-slate-500 text-sm mt-1 max-w-xs mx-auto">{subtitle}</p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LeaguePage() {
  const supabase = createClient()
  const [tab, setTab] = useState<Tab>('highlights')
  const [loading, setLoading] = useState(true)

  const [results, setResults]     = useState<MatchResultRow[]>([])
  const [scheduled, setScheduled] = useState<ChallengeRow[]>([])
  const [live, setLive]           = useState<ChallengeRow[]>([])
  const [allStats, setAllStats]   = useState<TeamStats[]>([])
  const [rawStatsMap, setRawStatsMap] = useState<Map<string, { wins: number; losses: number; played: number; recentForm: ('W'|'L')[] }>>(new Map())
  const [seasonPulse, setSeasonPulse] = useState({ matches: 0, teams: 0, activeChallenges: 0, thisWeek: 0 })

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).single()
        if (!season) return

        const [resultsRes, scheduledRes, liveRes, positionsRes, allResultsRes] = await Promise.all([
          supabase.from('match_results')
            .select(`
              id, winner_team_id, loser_team_id, created_at, verified_at,
              set1_challenger, set1_challenged, set2_challenger, set2_challenged,
              supertiebreak_challenger, supertiebreak_challenged,
              challenge:challenges!challenge_id(
                id, challenging_team_id, challenged_team_id,
                challenging_team:teams!challenging_team_id(id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)),
                challenged_team:teams!challenged_team_id(id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)),
                tier:tiers!tier_id(id, name)
              )
            `)
            .eq('season_id', season.id)
            .order('created_at', { ascending: false })
            .limit(50),

          supabase.from('challenges')
            .select(`
              id, status, confirmed_time, accepted_slot, match_date, created_at,
              challenging_team:teams!challenging_team_id(id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)),
              challenged_team:teams!challenged_team_id(id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)),
              tier:tiers!tier_id(id, name)
            `)
            .eq('season_id', season.id)
            .eq('status', 'scheduled')
            .order('confirmed_time', { ascending: true })
            .limit(20),

          supabase.from('challenges')
            .select(`
              id, status, confirmed_time, accepted_slot, match_date, created_at,
              challenging_team:teams!challenging_team_id(id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)),
              challenged_team:teams!challenged_team_id(id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)),
              tier:tiers!tier_id(id, name)
            `)
            .eq('season_id', season.id)
            .in('status', ['pending', 'accepted', 'accepted_open', 'time_pending_confirm'])
            .order('created_at', { ascending: false })
            .limit(20),

          supabase.from('ladder_positions')
            .select(`rank, status, team_id, team:teams!team_id(id, name, player1:players!player1_id(id, name), player2:players!player2_id(id, name)), tier:tiers!tier_id(id, name)`)
            .eq('season_id', season.id).neq('status', 'dissolved').order('rank'),

          supabase.from('match_results')
            .select('winner_team_id, loser_team_id, created_at, challenge:challenges!challenge_id(challenging_team_id, challenged_team_id)')
            .eq('season_id', season.id)
            .order('created_at', { ascending: false }),
        ])

        // ── Build stats ──────────────────────────────────────────────────────
        type RawStats = { wins: number; losses: number; played: number; recentForm: ('W'|'L')[]; winStreak: number; rankGained: number }
        const map = new Map<string, RawStats>()
        const get = (id: string): RawStats => {
          if (!map.has(id)) map.set(id, { wins: 0, losses: 0, played: 0, recentForm: [], winStreak: 0, rankGained: 0 })
          return map.get(id)!
        }
        const oneWeekAgo = Date.now() - 7 * 24 * 3600 * 1000
        let thisWeek = 0
        for (const mr of (allResultsRes.data || [])) {
          const chal = Array.isArray(mr.challenge) ? mr.challenge[0] : mr.challenge
          get(mr.winner_team_id).wins++
          get(mr.winner_team_id).played++
          get(mr.loser_team_id).losses++
          get(mr.loser_team_id).played++
          if (get(mr.winner_team_id).recentForm.length < 10) get(mr.winner_team_id).recentForm.push('W')
          if (get(mr.loser_team_id).recentForm.length < 10) get(mr.loser_team_id).recentForm.push('L')
          if (chal && mr.winner_team_id === chal.challenging_team_id) {
            get(mr.winner_team_id).rankGained++
            get(mr.loser_team_id).rankGained--
          }
          if (new Date(mr.created_at).getTime() > oneWeekAgo) thisWeek++
        }
        for (const [, s] of map) {
          let streak = 0
          for (const r of s.recentForm) { if (r === 'W') streak++; else break }
          s.winStreak = streak
        }

        // ── Build standings rows from positions ──────────────────────────────
        const posData: any[] = positionsRes.data || []
        const standingsList: TeamStats[] = posData.map(pos => {
          const team = Array.isArray(pos.team) ? pos.team[0] : pos.team
          const tier = Array.isArray(pos.tier) ? pos.tier[0] : pos.tier
          const s = map.get(pos.team_id) ?? { wins: 0, losses: 0, played: 0, recentForm: [], winStreak: 0, rankGained: 0 }
          return {
            teamId: pos.team_id,
            teamName: team?.name ?? '—',
            player1Name: team?.player1?.name ?? (Array.isArray(team?.player1) ? team.player1[0]?.name : '') ?? '',
            player2Name: team?.player2?.name ?? (Array.isArray(team?.player2) ? team.player2[0]?.name : '') ?? '',
            rank: pos.rank,
            tier: tier?.name ?? '—',
            wins: s.wins, losses: s.losses, played: s.played,
            winPct: s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0,
            recentForm: s.recentForm, winStreak: s.winStreak, rankGained: s.rankGained,
          }
        })

        const normalize = (c: any): ChallengeRow => ({
          ...c,
          challenging_team: Array.isArray(c.challenging_team) ? c.challenging_team[0] : c.challenging_team,
          challenged_team: Array.isArray(c.challenged_team) ? c.challenged_team[0] : c.challenged_team,
          tier: Array.isArray(c.tier) ? c.tier[0] : c.tier,
        })

        const normalizeResult = (r: any): MatchResultRow => ({
          ...r,
          challenge: Array.isArray(r.challenge) ? {
            ...r.challenge[0],
            challenging_team: Array.isArray(r.challenge[0]?.challenging_team) ? r.challenge[0].challenging_team[0] : r.challenge[0]?.challenging_team,
            challenged_team: Array.isArray(r.challenge[0]?.challenged_team) ? r.challenge[0].challenged_team[0] : r.challenge[0]?.challenged_team,
            tier: Array.isArray(r.challenge[0]?.tier) ? r.challenge[0].tier[0] : r.challenge[0]?.tier,
          } : r.challenge,
        })

        // Simplified stats map for results tab
        const simpleMap = new Map<string, { wins: number; losses: number; played: number; recentForm: ('W'|'L')[] }>()
        for (const [id, s] of map) simpleMap.set(id, { wins: s.wins, losses: s.losses, played: s.played, recentForm: s.recentForm })

        setResults((resultsRes.data || []).map(normalizeResult))
        setScheduled((scheduledRes.data || []).map(normalize))
        setLive((liveRes.data || []).map(normalize))
        setAllStats(standingsList)
        setRawStatsMap(simpleMap)
        setSeasonPulse({
          matches: allResultsRes.data?.length ?? 0,
          teams: posData.length,
          activeChallenges: (liveRes.data?.length ?? 0) + (scheduledRes.data?.length ?? 0),
          thisWeek,
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-slate-400">Loading…</div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">League</h1>
        <p className="text-slate-400 mt-1 text-sm">Chiniot Padel League · Current Season</p>
      </div>

      {/* Tab selector — pill style */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map(t => {
          // Badge counts
          const badge = t.id === 'upcoming' ? scheduled.length
            : t.id === 'results'   ? results.length
            : t.id === 'live'      ? live.length
            : null
          const isActive = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all border ${
                isActive
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-slate-900 dark:border-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-600'
              }`}
            >
              {t.icon}{t.label}
              {badge != null && badge > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5 ${isActive ? 'bg-slate-700 dark:bg-slate-200 text-slate-100 dark:text-slate-700' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'highlights' && <HighlightsTab allStats={allStats} seasonPulse={seasonPulse} />}
        {tab === 'upcoming'   && <UpcomingTab challenges={scheduled} />}
        {tab === 'results'    && <ResultsTab results={results} statsMap={rawStatsMap} />}
        {tab === 'live'       && <LiveTab challenges={live} />}
      </div>
    </div>
  )
}
