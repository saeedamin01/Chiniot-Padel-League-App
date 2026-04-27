'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle, RefreshCw, Calendar, Clock, Trophy,
  Swords, CheckCircle, XCircle, AlertCircle, Shield,
  TrendingUp, Users, Snowflake, MessageSquareWarning,
  ChevronRight, Flame, CircleDot,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamSnip { id: string; name: string }

interface ActiveChallenge {
  id: string
  challenge_code: string
  status: string
  accept_deadline: string | null
  match_deadline: string | null
  confirmed_time: string | null
  created_at: string
  challenging_team: TeamSnip | null
  challenged_team: TeamSnip | null
}

interface UnverifiedResult {
  id: string
  challenge_id: string
  disputed_at: string | null
  dispute_resolved_at: string | null
  dispute_flagged_at: string | null
  dispute_round: number
  verify_deadline: string | null
  dispute_deadline: string | null
  winner_team_id: string | null
  // denormalised from join
  challenge_code: string
  challenging_team_name: string
  challenged_team_name: string
}

interface RecentChallenge {
  id: string
  challenge_code: string
  status: string
  updated_at: string
  challenging_team: TeamSnip | null
  challenged_team: TeamSnip | null
}

interface SeasonInfo {
  id: string
  name: string
  end_date: string
  is_active: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function timeUntil(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Overdue'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 48) return `${Math.floor(h / 24)}d`
  if (h >= 1)  return `${h}h ${m}m`
  return `${m}m`
}

function isOverdue(iso: string | null | undefined) {
  if (!iso) return false
  return new Date(iso).getTime() < Date.now()
}

function isWithin(iso: string | null | undefined, hours: number) {
  if (!iso) return false
  const ms = new Date(iso).getTime() - Date.now()
  return ms > 0 && ms < hours * 3_600_000
}

function isToday(iso: string | null | undefined) {
  if (!iso) return false
  const d = new Date(iso)
  const t = new Date()
  return d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    accepted_open: 'Arranging',
    time_pending_confirm: 'Time Proposed',
    reschedule_requested: 'Reschedule Req.',
    reschedule_pending_admin: 'Reschedule (Admin)',
    scheduled: 'Scheduled',
    result_pending: 'Result Due',
    played: 'Played',
    forfeited: 'Forfeited',
    dissolved: 'Dissolved',
  }
  return map[s] ?? s
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, label, count, color = 'slate' }: {
  icon: React.ReactNode; label: string; count?: number; color?: string
}) {
  const colors: Record<string, string> = {
    red:    'text-red-400',
    orange: 'text-orange-400',
    yellow: 'text-yellow-400',
    blue:   'text-blue-400',
    emerald:'text-emerald-400',
    slate:  'text-slate-300',
    purple: 'text-purple-400',
  }
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={colors[color] ?? 'text-slate-300'}>{icon}</span>
      <h2 className={`font-semibold text-sm uppercase tracking-wide ${colors[color] ?? 'text-slate-300'}`}>
        {label}
      </h2>
      {count !== undefined && (
        <span className="ml-1 text-xs font-bold px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
          {count}
        </span>
      )}
    </div>
  )
}

function ChalRow({ c, badge, badgeColor }: {
  c: ActiveChallenge | RecentChallenge
  badge?: string
  badgeColor?: string
}) {
  const bgMap: Record<string, string> = {
    red:    'bg-red-500/15 text-red-300 border-red-500/30',
    orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    yellow: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    blue:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
    emerald:'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    purple: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    slate:  'bg-slate-700/50 text-slate-300 border-slate-600/30',
  }
  const ac = c as ActiveChallenge
  const rc = c as RecentChallenge
  const deadline = ac.accept_deadline ?? ac.confirmed_time ?? ac.match_deadline
  const overdue = deadline ? isOverdue(deadline) : false
  return (
    <Link href={`/admin/challenges?id=${c.id}`} className="block">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-500">{c.challenge_code}</span>
            <span className="text-sm font-semibold text-white truncate">
              {c.challenging_team?.name ?? '—'} <span className="text-slate-500 font-normal">vs</span> {c.challenged_team?.name ?? '—'}
            </span>
          </div>
          {deadline && (
            <p className={`text-xs mt-0.5 ${overdue ? 'text-red-400' : 'text-slate-400'}`}>
              {overdue ? '⚠ ' : ''}
              {'status' in c && statusLabel((c as ActiveChallenge).status)}
              {deadline ? ` · ${fmt(deadline)}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${bgMap[badgeColor ?? 'slate']}`}>
              {badge}
            </span>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
        </div>
      </div>
    </Link>
  )
}

function ResultRow({ r }: { r: UnverifiedResult }) {
  const isEscalated = !!r.dispute_flagged_at
  const isDisputed  = !!r.disputed_at && !r.dispute_resolved_at
  const deadline    = isDisputed ? r.dispute_deadline : r.verify_deadline
  const overdue     = deadline ? isOverdue(deadline) : false

  let badge = 'Verify'
  let color = 'blue'
  if (isEscalated)  { badge = 'Admin Required'; color = 'red' }
  else if (isDisputed) { badge = `Dispute Rd ${r.dispute_round}`; color = 'orange' }

  return (
    <Link href={`/admin/challenges?id=${r.challenge_id}`} className="block">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-500">{r.challenge_code}</span>
            <span className="text-sm font-semibold text-white">
              {r.challenging_team_name} <span className="text-slate-500 font-normal">vs</span> {r.challenged_team_name}
            </span>
          </div>
          {deadline && (
            <p className={`text-xs mt-0.5 ${overdue ? 'text-red-400' : 'text-slate-400'}`}>
              {overdue ? '⚠ Deadline passed' : `Deadline: ${fmt(deadline)}`}
              {!overdue && deadline && ` (${timeUntil(deadline)} left)`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            color === 'red'    ? 'bg-red-500/15 text-red-300 border-red-500/30' :
            color === 'orange' ? 'bg-orange-500/15 text-orange-300 border-orange-500/30' :
            'bg-blue-500/15 text-blue-300 border-blue-500/30'
          }`}>
            {badge}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
        </div>
      </div>
    </Link>
  )
}

function StatCard({ label, value, sub, icon, color = 'slate' }: {
  label: string; value: number | string; sub?: string
  icon: React.ReactNode; color?: string
}) {
  const valColors: Record<string, string> = {
    red: 'text-red-400', orange: 'text-orange-400', yellow: 'text-yellow-400',
    emerald: 'text-emerald-400', blue: 'text-blue-400', purple: 'text-purple-400',
    slate: 'text-white',
  }
  return (
    <Card className="bg-slate-800/60 border-slate-700 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
          <p className={`text-3xl font-bold mt-1.5 ${valColors[color] ?? 'text-white'}`}>{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <span className="text-slate-600">{icon}</span>
      </div>
    </Card>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-6 text-slate-500 text-sm italic">{label}</div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const supabase = createClient()
  const [loading, setLoading]           = useState(true)
  const [lastRefresh, setLastRefresh]   = useState(new Date())
  const [season, setSeason]             = useState<SeasonInfo | null>(null)
  const [activeChallenges, setActive]   = useState<ActiveChallenge[]>([])
  const [unverified, setUnverified]     = useState<UnverifiedResult[]>([])
  const [recent, setRecent]             = useState<RecentChallenge[]>([])
  const [totalTeams, setTotalTeams]     = useState(0)
  const [frozenTeams, setFrozenTeams]   = useState(0)
  const [totalPlayed, setTotalPlayed]   = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: s } = await supabase.from('seasons').select('id,name,end_date,is_active').eq('is_active', true).single()
      if (!s) { setLoading(false); return }
      setSeason(s)

      const [
        chalRes, resultRes, recentRes,
        teamCount, frozenCount, playedCount,
      ] = await Promise.all([
        // All live challenges
        supabase.from('challenges').select(`
          id, challenge_code, status, accept_deadline, match_deadline, confirmed_time, created_at,
          challenging_team:teams!challenging_team_id(id, name),
          challenged_team:teams!challenged_team_id(id, name)
        `).eq('season_id', s.id)
          .in('status', [
            'pending','accepted','accepted_open','time_pending_confirm',
            'reschedule_requested','reschedule_pending_admin','scheduled','result_pending',
          ])
          .order('created_at', { ascending: true }),

        // All unverified results with challenge info
        supabase.from('match_results').select(`
          id, challenge_id, disputed_at, dispute_resolved_at, dispute_flagged_at,
          dispute_round, verify_deadline, dispute_deadline, winner_team_id,
          challenge:challenges!challenge_id(
            challenge_code,
            challenging_team:teams!challenging_team_id(name),
            challenged_team:teams!challenged_team_id(name)
          )
        `).eq('season_id', s.id).is('verified_at', null).eq('auto_verified', false),

        // Recent completions
        supabase.from('challenges').select(`
          id, challenge_code, status, updated_at,
          challenging_team:teams!challenging_team_id(id, name),
          challenged_team:teams!challenged_team_id(id, name)
        `).eq('season_id', s.id)
          .in('status', ['played','forfeited','dissolved'])
          .order('updated_at', { ascending: false })
          .limit(8),

        supabase.from('teams').select('id', { count: 'exact', head: true }).eq('season_id', s.id),
        supabase.from('ladder_positions').select('id', { count: 'exact', head: true }).eq('season_id', s.id).eq('status', 'frozen'),
        supabase.from('match_results').select('id', { count: 'exact', head: true }).eq('season_id', s.id).not('verified_at', 'is', null),
      ])

      setActive((chalRes.data ?? []).map(c => ({
        ...c,
        challenging_team: Array.isArray(c.challenging_team) ? c.challenging_team[0] : c.challenging_team,
        challenged_team:  Array.isArray(c.challenged_team)  ? c.challenged_team[0]  : c.challenged_team,
      })) as ActiveChallenge[])

      setUnverified((resultRes.data ?? []).map((r: any) => {
        const ch = Array.isArray(r.challenge) ? r.challenge[0] : r.challenge
        return {
          ...r,
          challenge_code:        ch?.challenge_code ?? '',
          challenging_team_name: Array.isArray(ch?.challenging_team) ? ch.challenging_team[0]?.name : ch?.challenging_team?.name ?? '—',
          challenged_team_name:  Array.isArray(ch?.challenged_team)  ? ch.challenged_team[0]?.name  : ch?.challenged_team?.name  ?? '—',
        } as UnverifiedResult
      }))

      setRecent((recentRes.data ?? []).map(c => ({
        ...c,
        challenging_team: Array.isArray(c.challenging_team) ? c.challenging_team[0] : c.challenging_team,
        challenged_team:  Array.isArray(c.challenged_team)  ? c.challenged_team[0]  : c.challenged_team,
      })) as RecentChallenge[])

      setTotalTeams(teamCount.count ?? 0)
      setFrozenTeams(frozenCount.count ?? 0)
      setTotalPlayed(playedCount.count ?? 0)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => { load() }, [load])

  // ── Derived buckets ──────────────────────────────────────────────────────────

  const now = new Date()

  // Pending (awaiting acceptance)
  const pending          = activeChallenges.filter(c => c.status === 'pending')
  const overduePending   = pending.filter(c => isOverdue(c.accept_deadline))
  const urgentPending    = pending.filter(c => !isOverdue(c.accept_deadline) && isWithin(c.accept_deadline, 6))
  const healthyPending   = pending.filter(c => !isOverdue(c.accept_deadline) && !isWithin(c.accept_deadline, 6))

  // Arranging time
  const arranging        = activeChallenges.filter(c =>
    ['accepted','accepted_open','time_pending_confirm','reschedule_requested','reschedule_pending_admin'].includes(c.status))

  // Scheduled
  const scheduled        = activeChallenges.filter(c => c.status === 'scheduled')
  const todayMatches     = scheduled.filter(c => isToday(c.confirmed_time))
  const overdueScheduled = scheduled.filter(c => c.confirmed_time && isOverdue(c.confirmed_time) && !isToday(c.confirmed_time))
  const upcomingMatches  = scheduled.filter(c => c.confirmed_time && !isOverdue(c.confirmed_time) && !isToday(c.confirmed_time))

  // Result pending (no score submitted yet)
  const resultPending    = activeChallenges.filter(c => c.status === 'result_pending')

  // Disputes & verification
  const escalated        = unverified.filter(r => r.dispute_flagged_at && !r.dispute_resolved_at)
  const disputed         = unverified.filter(r => r.disputed_at && !r.dispute_resolved_at && !r.dispute_flagged_at)
  const verifyPending    = unverified.filter(r => !r.disputed_at)
  const urgentVerify     = verifyPending.filter(r => isWithin(r.verify_deadline, 2))
  const urgentDispute    = disputed.filter(r => isWithin(r.dispute_deadline, 2))

  // Needs attention count
  const needsAttention   = overduePending.length + overdueScheduled.length + escalated.length + urgentVerify.length + urgentDispute.length

  // Season days remaining
  const daysLeft = season ? Math.max(0, Math.ceil((new Date(season.end_date).getTime() - now.getTime()) / 86_400_000)) : null

  if (loading && activeChallenges.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="h-5 w-5 animate-spin" />
          Loading league data…
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 pb-12">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">League Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {season?.name ?? 'No active season'}
            {daysLeft !== null && ` · ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`}
            {' · '}
            <span className="text-slate-500">Refreshed {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Teams"         value={totalTeams}            sub="this season"     icon={<Users className="h-6 w-6" />}              color="slate" />
        <StatCard label="Frozen"        value={frozenTeams}           sub="on ladder"       icon={<Snowflake className="h-6 w-6" />}           color={frozenTeams > 0 ? 'blue' : 'slate'} />
        <StatCard label="Live Matches"  value={activeChallenges.length} sub="in progress"   icon={<Swords className="h-6 w-6" />}             color="emerald" />
        <StatCard label="Today"         value={todayMatches.length}   sub="matches today"   icon={<Calendar className="h-6 w-6" />}            color={todayMatches.length > 0 ? 'purple' : 'slate'} />
        <StatCard label="Disputes"      value={disputed.length + escalated.length} sub="unresolved" icon={<MessageSquareWarning className="h-6 w-6" />} color={disputed.length + escalated.length > 0 ? 'orange' : 'slate'} />
        <StatCard label="Needs Attention" value={needsAttention}      sub="items flagged"   icon={<AlertTriangle className="h-6 w-6" />}       color={needsAttention > 0 ? 'red' : 'emerald'} />
      </div>

      {/* ── Needs Attention ── */}
      {needsAttention > 0 && (
        <div className="space-y-3">
          <SectionHeader icon={<AlertTriangle className="h-4 w-4" />} label="Needs Attention" count={needsAttention} color="red" />
          <div className="grid gap-2">
            {escalated.map(r => <ResultRow key={r.id} r={r} />)}
            {overduePending.map(c => <ChalRow key={c.id} c={c} badge="Overdue" badgeColor="red" />)}
            {overdueScheduled.map(c => <ChalRow key={c.id} c={c} badge="Match Overdue" badgeColor="red" />)}
            {urgentVerify.map(r => <ResultRow key={r.id} r={r} />)}
            {urgentDispute.map(r => <ResultRow key={r.id} r={r} />)}
          </div>
        </div>
      )}

      {/* ── Today's matches ── */}
      <div className="space-y-3">
        <SectionHeader icon={<Calendar className="h-4 w-4" />} label="Today's Matches" count={todayMatches.length} color="purple" />
        {todayMatches.length === 0
          ? <EmptyState label="No matches scheduled for today" />
          : (
            <div className="grid gap-2">
              {todayMatches
                .sort((a, b) => new Date(a.confirmed_time!).getTime() - new Date(b.confirmed_time!).getTime())
                .map(c => (
                  <Link href={`/admin/challenges?id=${c.id}`} key={c.id} className="block">
                    <div className="flex items-center justify-between gap-3 px-3 py-3 rounded-lg bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/25 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="text-center shrink-0">
                          <p className="text-lg font-bold text-purple-300">{fmtTime(c.confirmed_time)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">
                            {c.challenging_team?.name} <span className="text-slate-500 font-normal">vs</span> {c.challenged_team?.name}
                          </p>
                          <p className="text-xs text-slate-400 font-mono">{c.challenge_code}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isOverdue(c.confirmed_time) && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30">
                            In progress
                          </span>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                      </div>
                    </div>
                  </Link>
                ))
              }
            </div>
          )
        }
      </div>

      {/* ── Main grid: pipeline + disputes ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Challenge pipeline ── */}
        <div className="space-y-6">
          <h2 className="text-base font-semibold text-slate-200 flex items-center gap-2">
            <Swords className="h-4 w-4 text-slate-400" /> Challenge Pipeline
          </h2>

          {/* Pending accepts */}
          <div className="space-y-2">
            <SectionHeader icon={<Clock className="h-3.5 w-3.5" />} label="Awaiting Acceptance" count={pending.length} color={overduePending.length > 0 ? 'red' : urgentPending.length > 0 ? 'orange' : 'slate'} />
            {pending.length === 0
              ? <EmptyState label="No pending challenges" />
              : (
                <div className="grid gap-1.5">
                  {overduePending.map(c => <ChalRow key={c.id} c={c} badge="Overdue" badgeColor="red" />)}
                  {urgentPending.map(c => <ChalRow key={c.id} c={c} badge={`${timeUntil(c.accept_deadline)} left`} badgeColor="orange" />)}
                  {healthyPending.map(c => <ChalRow key={c.id} c={c} badge={`${timeUntil(c.accept_deadline)} left`} badgeColor="slate" />)}
                </div>
              )
            }
          </div>

          {/* Arranging */}
          <div className="space-y-2">
            <SectionHeader icon={<CircleDot className="h-3.5 w-3.5" />} label="Arranging Match Time" count={arranging.length} color="blue" />
            {arranging.length === 0
              ? <EmptyState label="No challenges arranging time" />
              : <div className="grid gap-1.5">{arranging.map(c => <ChalRow key={c.id} c={c} badge={statusLabel(c.status)} badgeColor="blue" />)}</div>
            }
          </div>

          {/* Scheduled upcoming */}
          {upcomingMatches.length > 0 && (
            <div className="space-y-2">
              <SectionHeader icon={<Calendar className="h-3.5 w-3.5" />} label="Upcoming Matches" count={upcomingMatches.length} color="emerald" />
              <div className="grid gap-1.5">
                {upcomingMatches
                  .sort((a, b) => new Date(a.confirmed_time!).getTime() - new Date(b.confirmed_time!).getTime())
                  .map(c => <ChalRow key={c.id} c={c} badge={fmt(c.confirmed_time)} badgeColor="emerald" />)
                }
              </div>
            </div>
          )}

          {/* Result pending (awaiting score submission) */}
          <div className="space-y-2">
            <SectionHeader icon={<Trophy className="h-3.5 w-3.5" />} label="Awaiting Score Submission" count={resultPending.length} color="yellow" />
            {resultPending.length === 0
              ? <EmptyState label="No matches awaiting scores" />
              : <div className="grid gap-1.5">{resultPending.map(c => <ChalRow key={c.id} c={c} badge="Score Due" badgeColor="yellow" />)}</div>
            }
          </div>
        </div>

        {/* ── Results & disputes ── */}
        <div className="space-y-6">
          <h2 className="text-base font-semibold text-slate-200 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-slate-400" /> Results & Disputes
          </h2>

          {/* Escalated (admin must resolve) */}
          {escalated.length > 0 && (
            <div className="space-y-2">
              <SectionHeader icon={<AlertCircle className="h-3.5 w-3.5" />} label="Admin Resolution Required" count={escalated.length} color="red" />
              <div className="grid gap-1.5">{escalated.map(r => <ResultRow key={r.id} r={r} />)}</div>
            </div>
          )}

          {/* Active disputes */}
          <div className="space-y-2">
            <SectionHeader icon={<MessageSquareWarning className="h-3.5 w-3.5" />} label="Active Disputes" count={disputed.length} color="orange" />
            {disputed.length === 0
              ? <EmptyState label="No active disputes" />
              : <div className="grid gap-1.5">{disputed.map(r => <ResultRow key={r.id} r={r} />)}</div>
            }
          </div>

          {/* Awaiting verification */}
          <div className="space-y-2">
            <SectionHeader icon={<Shield className="h-3.5 w-3.5" />} label="Awaiting Score Verification" count={verifyPending.length} color="blue" />
            {verifyPending.length === 0
              ? <EmptyState label="No scores awaiting verification" />
              : <div className="grid gap-1.5">{verifyPending.map(r => <ResultRow key={r.id} r={r} />)}</div>
            }
          </div>

          {/* League totals */}
          <Card className="bg-slate-800/40 border-slate-700 p-4 mt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Season Totals</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xl font-bold text-emerald-400">{totalPlayed}</p>
                <p className="text-xs text-slate-500">Matches played</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{totalTeams}</p>
                <p className="text-xs text-slate-500">Teams registered</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-400">{frozenTeams}</p>
                <p className="text-xs text-slate-500">Teams frozen</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-400">{daysLeft ?? '—'}</p>
                <p className="text-xs text-slate-500">Days remaining</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Recent completions ── */}
      <div className="space-y-3">
        <SectionHeader icon={<Flame className="h-4 w-4" />} label="Recent Completions" count={recent.length} color="emerald" />
        {recent.length === 0
          ? <EmptyState label="No recent completions" />
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {recent.map(c => {
                const isForfeited = c.status === 'forfeited'
                const isDissolved = c.status === 'dissolved'
                return (
                  <Link href={`/admin/challenges?id=${c.id}`} key={c.id} className="block">
                    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-800/40 hover:bg-slate-700/40 border border-slate-700/40 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {isForfeited
                            ? <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                            : isDissolved
                            ? <XCircle className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                            : <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          }
                          <span className="text-sm font-medium text-white truncate">
                            {c.challenging_team?.name} vs {c.challenged_team?.name}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 pl-5">
                          {isForfeited ? 'Forfeited' : isDissolved ? 'Dissolved' : 'Played'} · {new Date(c.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                    </div>
                  </Link>
                )
              })}
            </div>
          )
        }
      </div>

      {/* ── Quick links ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
        {[
          { href: '/admin/challenges', label: 'All Challenges' },
          { href: '/admin/ladder',     label: 'Ladder'         },
          { href: '/admin/players',    label: 'Players'        },
          { href: '/admin/settings',   label: 'Settings'       },
        ].map(l => (
          <Link key={l.href} href={l.href}>
            <div className="text-center py-2.5 px-3 rounded-lg bg-slate-800/40 hover:bg-slate-700/50 border border-slate-700/50 text-sm text-slate-300 hover:text-white transition-colors">
              {l.label}
            </div>
          </Link>
        ))}
      </div>

    </div>
  )
}
