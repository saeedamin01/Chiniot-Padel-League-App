'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  ArrowLeft, Snowflake, Trash2, Trophy, Zap, Calendar, Clock,
  CheckCircle, AlertTriangle, ChevronRight, Ticket as TicketIcon,
  User, Shield, TrendingUp, TrendingDown, History, Loader2,
  Award, X, MapPin, Edit2, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ─── Colour maps ──────────────────────────────────────────────────────────────
const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Platinum: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Silver: 'bg-slate-400/20 text-slate-300 border-slate-400/40',
  Bronze: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
}
const TIER_RANK: Record<string, string> = {
  Diamond: 'text-cyan-400', Platinum: 'text-violet-400',
  Gold: 'text-yellow-400', Silver: 'text-slate-300', Bronze: 'text-orange-400',
}
const TICKET_COLORS: Record<string, string> = {
  tier:   'bg-violet-500/20 text-violet-300 border-violet-500/40',
  silver: 'bg-slate-400/20 text-slate-200 border-slate-400/40',
  gold:   'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
}
const TICKET_STATUS_COLORS: Record<string, string> = {
  active:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  used:      'bg-slate-500/20 text-slate-400 border-slate-500/40',
  forfeited: 'bg-red-500/20 text-red-300 border-red-500/40',
  converted: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
}
const CHALLENGE_STATUS: Record<string, { label: string; cls: string }> = {
  pending:                  { label: 'Pending',       cls: 'bg-yellow-500/20 text-yellow-300' },
  accepted:                 { label: 'Accepted',      cls: 'bg-orange-500/20 text-orange-300' },
  accepted_open:            { label: 'Time TBD',      cls: 'bg-amber-500/20  text-amber-300'  },
  time_pending_confirm:     { label: 'Time Proposed', cls: 'bg-orange-500/20 text-orange-300' },
  reschedule_requested:     { label: 'Reschedule',    cls: 'bg-purple-500/20 text-purple-300' },
  reschedule_pending_admin: { label: 'Admin Review',  cls: 'bg-indigo-500/20 text-indigo-300' },
  revision_proposed:        { label: 'Rev. Proposed', cls: 'bg-purple-500/20 text-purple-300' },
  scheduled:                { label: 'Scheduled',     cls: 'bg-blue-500/20   text-blue-300'   },
  played:                   { label: 'Played',        cls: 'bg-green-500/20  text-green-300'  },
  forfeited:                { label: 'Forfeited',     cls: 'bg-red-500/20    text-red-300'    },
  dissolved:                { label: 'Dissolved',     cls: 'bg-slate-500/20  text-slate-400'  },
}
const HISTORY_LABELS: Record<string, { label: string; cls: string }> = {
  admin_adjustment: { label: 'Admin Move',    cls: 'text-blue-400'   },
  challenge_win:    { label: 'Challenge Win', cls: 'text-emerald-400' },
  challenge_loss:   { label: 'Challenge Loss',cls: 'text-red-400'    },
  freeze_drop:      { label: 'Freeze Drop',   cls: 'text-cyan-400'   },
  forfeit_drop:     { label: 'Forfeit Drop',  cls: 'text-orange-400' },
  partner_change:   { label: 'Partner Change',cls: 'text-purple-400' },
  initial_placement:{ label: 'Placed',        cls: 'text-slate-400'  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveTicketStatus(tk: any): string {
  if (tk.status) return tk.status
  return tk.is_used ? 'used' : 'active'
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${day} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}
function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
}

function buildScore(mr: any, isChallenger: boolean) {
  if (!mr) return null
  const s = (c: any, ch: any) => isChallenger ? c : ch
  const parts = [
    mr.set1_challenger != null ? `${s(mr.set1_challenger, mr.set1_challenged)}-${s(mr.set1_challenged, mr.set1_challenger)}` : null,
    mr.set2_challenger != null ? `${s(mr.set2_challenger, mr.set2_challenged)}-${s(mr.set2_challenged, mr.set2_challenger)}` : null,
    mr.supertiebreak_challenger != null ? `[${s(mr.supertiebreak_challenger, mr.supertiebreak_challenged)}-${s(mr.supertiebreak_challenged, mr.supertiebreak_challenger)}]` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TeamDetailPage() {
  const params  = useParams()
  const router  = useRouter()
  const teamId  = params.id as string
  const supabase = createClient()

  const [loading, setLoading]         = useState(true)
  const [team, setTeam]               = useState<any>(null)
  const [position, setPosition]       = useState<any>(null)
  const [tickets, setTickets]         = useState<any[]>([])
  const [challenges, setChallenges]   = useState<any[]>([])
  const [history, setHistory]         = useState<any[]>([])
  const [allPositions, setAllPositions] = useState<any[]>([])
  const [seasonId, setSeasonId]       = useState('')

  // Action loading states
  const [actioning, setActioning]       = useState<string | null>(null)
  const [newRankStr, setNewRankStr]     = useState('')
  const [assignType, setAssignType]     = useState<string>('')
  const [assignReason, setAssignReason] = useState('')

  // Partner change state
  const [allPlayers, setAllPlayers]           = useState<any[]>([])
  const [partnerPosition, setPartnerPosition] = useState<'player1' | 'player2'>('player1')
  const [newPartnerId, setNewPartnerId]       = useState('')
  const [partnerChangeDrop, setPartnerChangeDrop] = useState(3)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: season } = await supabase
        .from('seasons').select('id').eq('is_active', true).single()
      if (!season) { setLoading(false); return }
      setSeasonId(season.id)

      // Load all active players for partner change dropdown
      const { data: playersData } = await supabase
        .from('players').select('id, name, email').eq('is_active', true).order('name')
      setAllPlayers(playersData || [])

      // Load partner_change_drop_positions from settings
      const { data: settingsData } = await supabase
        .from('league_settings').select('partner_change_drop_positions').eq('season_id', season.id).single()
      if (settingsData?.partner_change_drop_positions) {
        setPartnerChangeDrop(settingsData.partner_change_drop_positions)
      }

      const [teamRes, posRes, challengeRes, histRes, allPosRes, ticketApiRes] = await Promise.all([
        // Team + players
        supabase.from('teams')
          .select(`id, name, status, is_new_team, partner_changed, entry_fee_paid, created_at,
            player1:players!player1_id(id, name, email, avatar_url),
            player2:players!player2_id(id, name, email, avatar_url)`)
          .eq('id', teamId).single(),

        // Ladder position + tier + last challenged team
        supabase.from('ladder_positions')
          .select(`id, rank, status, consecutive_forfeits, last_challenged_team_id, updated_at,
            tier:tiers!tier_id(id, name, min_rank, max_rank),
            last_challenged_team:teams!last_challenged_team_id(id, name)`)
          .eq('team_id', teamId).eq('season_id', season.id).maybeSingle(),

        // All challenges for this team
        supabase.from('challenges')
          .select(`id, challenge_code, status, issued_at, accept_deadline, match_deadline,
            confirmed_time, accepted_slot, match_location, created_at,
            challenging_team:teams!challenging_team_id(id, name),
            challenged_team:teams!challenged_team_id(id, name),
            match_result:match_results!challenge_id(
              id, winner_team_id, loser_team_id,
              set1_challenger, set1_challenged, set2_challenger, set2_challenged,
              supertiebreak_challenger, supertiebreak_challenged,
              match_date, verified_at, auto_verified, reported_by_team_id)`)
          .or(`challenging_team_id.eq.${teamId},challenged_team_id.eq.${teamId}`)
          .eq('season_id', season.id)
          .order('created_at', { ascending: false }),

        // Rank history
        supabase.from('ladder_history')
          .select('id, old_rank, new_rank, change_type, notes, created_at')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })
          .limit(20),

        // All positions (for rank-adjust shift logic)
        supabase.from('ladder_positions')
          .select('team_id, rank, status')
          .eq('season_id', season.id)
          .order('rank', { ascending: true }),

        // Tickets via admin API
        fetch(`/api/admin/tickets?seasonId=${season.id}`)
          .then(r => r.ok ? r.json() : { tickets: [] })
          .catch(() => ({ tickets: [] })),
      ])

      setTeam(teamRes.data)
      setPosition(posRes.data)
      setChallenges(challengeRes.data || [])
      setHistory(histRes.data || [])
      setAllPositions(allPosRes.data || [])

      const allTickets = ticketApiRes.tickets || []
      setTickets(allTickets.filter((t: any) => t.team_id === teamId))
    } catch (err) {
      console.error(err)
      toast.error('Failed to load team data')
    } finally {
      setLoading(false)
    }
  }, [teamId, supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleFreeze() {
    if (!confirm(`Freeze ${team?.name}? They will drop 1 position.`)) return
    setActioning('freeze')
    try {
      const r = await fetch(`/api/teams/${teamId}/freeze`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      toast.success('Team frozen')
      fetchAll()
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  async function handleUnfreeze() {
    setActioning('unfreeze')
    try {
      const r = await fetch(`/api/teams/${teamId}/unfreeze`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      toast.success('Team unfrozen')
      fetchAll()
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  async function handleDissolve() {
    if (!confirm(`PERMANENTLY dissolve ${team?.name}? This cannot be undone.`)) return
    setActioning('dissolve')
    try {
      const r = await fetch(`/api/teams/${teamId}/dissolve`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      toast.success('Team dissolved')
      router.push('/admin/teams')
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  async function handleAdjustRank() {
    const target = parseInt(newRankStr)
    if (!target || target < 1) { toast.error('Enter a valid rank number'); return }
    if (!position) { toast.error('No ladder position found'); return }
    const currentRank = position.rank
    if (target === currentRank) { toast.error('Already at that rank'); return }

    setActioning('rank')
    try {
      // Collect changes: shift intermediate occupied ranks
      const occupied = allPositions
        .filter((p: any) => p.team_id && p.rank != null)
        .map((p: any) => ({ teamId: p.team_id, rank: p.rank as number }))
        .sort((a: any, b: any) => a.rank - b.rank)

      const changes: { teamId: string; newRank: number }[] = []

      if (target < currentRank) {
        // Moving up: teams in [target, currentRank-1] shift down by 1
        for (const { teamId: tid, rank } of occupied) {
          if (tid !== teamId && rank >= target && rank < currentRank) {
            changes.push({ teamId: tid, newRank: rank + 1 })
          }
        }
      } else {
        // Moving down: teams in [currentRank+1, target] shift up by 1
        for (const { teamId: tid, rank } of occupied) {
          if (tid !== teamId && rank > currentRank && rank <= target) {
            changes.push({ teamId: tid, newRank: rank - 1 })
          }
        }
      }
      changes.push({ teamId: teamId, newRank: target })

      const r = await fetch('/api/admin/ladder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes, seasonId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Rank adjustment failed')
      toast.success(`Moved to rank #${target}`)
      setNewRankStr('')
      fetchAll()
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  async function handleAssignTicket() {
    if (!assignType) { toast.error('Select a ticket type'); return }
    setActioning('ticket-assign')
    try {
      const r = await fetch('/api/admin/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId, seasonId,
          ticketType: assignType,
          assignedReason: assignReason || undefined,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      toast.success(`${assignType} ticket assigned`)
      setAssignType(''); setAssignReason('')
      fetchAll()
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  async function handleRevokeTicket(ticketId: string) {
    if (!confirm('Revoke this ticket? It will be marked as forfeited.')) return
    setActioning('ticket-revoke-' + ticketId)
    try {
      const r = await fetch('/api/admin/tickets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      toast.success('Ticket revoked')
      fetchAll()
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  async function handlePartnerChange() {
    if (!newPartnerId) { toast.error('Select a new player'); return }
    if (!confirm(
      `Change ${partnerPosition === 'player1' ? (team?.player1 as any)?.name : (team?.player2 as any)?.name} to ${allPlayers.find(p => p.id === newPartnerId)?.name}?\n\n` +
      `The team will drop ${partnerChangeDrop} position(s) as per league rules.`
    )) return

    setActioning('partner')
    try {
      const r = await fetch(`/api/admin/teams/${teamId}/partner-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerPosition: partnerPosition, newPlayerId: newPartnerId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      toast.success(`Partner changed. Team dropped from #${d.previousRank} to #${d.newRank}.`)
      setNewPartnerId('')
      fetchAll()
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  const DONE_STATUSES = ['played', 'forfeited', 'dissolved']
  const activeChallenges  = challenges.filter(c => !DONE_STATUSES.includes(c.status))
  const historyChallenges = challenges.filter(c => DONE_STATUSES.includes(c.status))

  const playedChallenges = challenges.filter(c => c.status === 'played')
  const wins   = playedChallenges.filter(c => {
    const mr = Array.isArray(c.match_result) ? c.match_result[0] : c.match_result
    return mr?.winner_team_id === teamId
  }).length
  const losses = playedChallenges.length - wins
  const winPct = playedChallenges.length > 0 ? Math.round((wins / playedChallenges.length) * 100) : 0

  const tierName     = position?.tier?.name ?? '—'
  const tierBadge    = TIER_BADGE[tierName]    ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'
  const tierRankCls  = TIER_RANK[tierName]     ?? 'text-slate-300'
  const teamStatus   = team?.status ?? 'active'

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
        <div className="h-32 bg-slate-800/60 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 bg-slate-800/60 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!team) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20">
        <Shield className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-white font-semibold text-lg mb-2">Team Not Found</h2>
        <p className="text-slate-400 mb-4">This team doesn't exist or was removed.</p>
        <Link href="/admin/teams"><Button variant="ghost">← Back to Teams</Button></Link>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* ── Breadcrumb ── */}
      <Link href="/admin/teams" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Teams &amp; Ladder
      </Link>

      {/* ── Header Card ── */}
      <Card className="bg-slate-800/60 border-slate-700/50 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Left: identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              {position?.rank && (
                <span className={`text-4xl font-black tabular-nums leading-none ${tierRankCls}`}>
                  #{position.rank}
                </span>
              )}
              <h1 className="text-2xl font-bold text-white truncate">{team.name}</h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {tierName !== '—' && (
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${tierBadge}`}>{tierName}</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                teamStatus === 'active'   ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                teamStatus === 'frozen'   ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                'bg-red-500/20 text-red-300 border-red-500/40'
              }`}>
                {teamStatus.charAt(0).toUpperCase() + teamStatus.slice(1)}
              </span>
              {team.is_new_team && (
                <span className="text-xs px-2 py-0.5 rounded border font-medium bg-emerald-500/10 text-emerald-400 border-emerald-500/30">New Team</span>
              )}
              {team.entry_fee_paid && (
                <span className="text-xs px-2 py-0.5 rounded border font-medium bg-slate-700 text-slate-300 border-slate-600">Fee Paid</span>
              )}
            </div>

            {/* Players */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[team.player1, team.player2].map((p: any, i) => p && (
                <Link key={p.id} href={`/admin/players/${p.id}`}
                  className="flex items-center gap-2 p-2.5 bg-slate-900/60 hover:bg-slate-900/80 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-all group">
                  <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                    {p.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white group-hover:text-emerald-300 truncate transition-colors">{p.name}</p>
                    <p className="text-xs text-slate-500 truncate">{p.email}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Right: quick actions */}
          <div className="flex flex-row sm:flex-col gap-2 shrink-0">
            {teamStatus === 'active' && (
              <Button
                size="sm" variant="outline"
                onClick={handleFreeze}
                disabled={actioning === 'freeze'}
                className="border-blue-500/40 text-blue-300 hover:bg-blue-500/10"
              >
                {actioning === 'freeze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake className="h-4 w-4" />}
                <span className="ml-1.5">Freeze</span>
              </Button>
            )}
            {teamStatus === 'frozen' && (
              <Button
                size="sm" variant="outline"
                onClick={handleUnfreeze}
                disabled={actioning === 'unfreeze'}
                className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
              >
                {actioning === 'unfreeze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-1.5">Unfreeze</span>
              </Button>
            )}
            {teamStatus !== 'dissolved' && (
              <Button
                size="sm" variant="outline"
                onClick={handleDissolve}
                disabled={actioning === 'dissolve'}
                className="border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                {actioning === 'dissolve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span className="ml-1.5">Dissolve</span>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={fetchAll} className="text-slate-400 hover:text-white">
              <RefreshCw className="h-4 w-4" />
              <span className="ml-1.5">Refresh</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ════════════════════ LEFT 2/3 ════════════════════ */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── Tickets ── */}
          <section>
            <SectionHeader icon={<TicketIcon className="h-4 w-4" />} title="Tickets" count={tickets.length} />
            <Card className="bg-slate-800/60 border-slate-700/50 overflow-hidden">
              {tickets.length > 0 ? (
                <div className="divide-y divide-slate-700/50">
                  {tickets.map((tk: any) => {
                    const st = resolveTicketStatus(tk)
                    return (
                      <div key={tk.id} className="flex items-start gap-3 p-4">
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium shrink-0 ${TICKET_COLORS[tk.ticket_type] ?? ''}`}>
                          {tk.ticket_type.charAt(0).toUpperCase() + tk.ticket_type.slice(1)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${TICKET_STATUS_COLORS[st] ?? ''}`}>{st}</span>
                            {tk.assigned_reason && (
                              <span className="text-xs text-slate-500 truncate">"{tk.assigned_reason}"</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {tk.assigner?.name && (
                              <span className="text-xs text-slate-500">by {tk.assigner.name}</span>
                            )}
                            <span className="text-xs text-slate-600">{fmtDate(tk.created_at)}</span>
                            {tk.used_at && (
                              <span className="text-xs text-slate-500">used {fmtDate(tk.used_at)}</span>
                            )}
                            {tk.challenge_id && (
                              <Link href={`/challenges/${tk.challenge_id}`} className="text-xs text-blue-400 hover:text-blue-300">
                                View Challenge →
                              </Link>
                            )}
                          </div>
                        </div>
                        {st === 'active' && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => handleRevokeTicket(tk.id)}
                            disabled={actioning === 'ticket-revoke-' + tk.id}
                            className="text-red-400 hover:bg-red-500/10 shrink-0 h-7 w-7 p-0"
                            title="Revoke ticket"
                          >
                            {actioning === 'ticket-revoke-' + tk.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <X className="h-3.5 w-3.5" />
                            }
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="p-6 text-center text-slate-500 text-sm">No tickets assigned to this team</div>
              )}

              {/* Assign new ticket */}
              <div className="p-4 border-t border-slate-700/50 bg-slate-900/30">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Assign Ticket</p>
                <div className="flex flex-wrap gap-2">
                  <Select value={assignType} onValueChange={setAssignType}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-8 text-xs w-36">
                      <SelectValue placeholder="Ticket type…" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="tier">Tier Ticket</SelectItem>
                      <SelectItem value="silver">Silver Ticket</SelectItem>
                      <SelectItem value="gold">Gold Ticket</SelectItem>
                    </SelectContent>
                  </Select>
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    value={assignReason}
                    onChange={e => setAssignReason(e.target.value)}
                    className="flex-1 min-w-[140px] h-8 px-2 text-xs bg-slate-800 border border-slate-700 text-white rounded-md placeholder-slate-500"
                  />
                  <Button
                    size="sm" onClick={handleAssignTicket}
                    disabled={!assignType || actioning === 'ticket-assign'}
                    className="h-8 bg-violet-600 hover:bg-violet-700 text-white text-xs"
                  >
                    {actioning === 'ticket-assign' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Assign'}
                  </Button>
                </div>
              </div>
            </Card>
          </section>

          {/* ── Active Challenges ── */}
          <section>
            <SectionHeader icon={<Zap className="h-4 w-4 text-yellow-400" />} title="Active Challenges" count={activeChallenges.length} />
            <div className="space-y-2">
              {activeChallenges.length > 0 ? activeChallenges.map((c: any) => {
                const isChallenger = c.challenging_team?.id === teamId
                const opponent = isChallenger ? c.challenged_team : c.challenging_team
                const { label, cls } = CHALLENGE_STATUS[c.status] ?? { label: c.status, cls: 'bg-slate-500/20 text-slate-400' }
                const matchTime = c.confirmed_time || c.accepted_slot
                return (
                  <Card key={c.id} className="bg-slate-800/60 border-slate-700/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{label}</span>
                          <code className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{c.challenge_code}</code>
                          <span className={`text-[10px] font-medium ${isChallenger ? 'text-blue-400' : 'text-yellow-400'}`}>
                            {isChallenger ? '↑ Sent' : '↓ Received'}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-white">
                          vs <span className="text-emerald-300">{opponent?.name ?? 'Unknown'}</span>
                        </p>
                        {matchTime && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-blue-300">
                            <Calendar className="h-3 w-3" />
                            {fmtDateTime(matchTime)}
                            {c.match_location && <><MapPin className="h-3 w-3 ml-1" />{c.match_location}</>}
                          </div>
                        )}
                        <p className="text-xs text-slate-500 mt-0.5">Issued {fmtDate(c.issued_at)}</p>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Link href={`/challenges/${c.id}`}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-slate-400 hover:text-white">
                            Player view <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </Link>
                        <Link href={`/admin/challenges?highlight=${c.id}`}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-slate-400 hover:text-white">
                            Admin edit <Edit2 className="h-3 w-3 ml-0.5" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </Card>
                )
              }) : (
                <Card className="bg-slate-800/40 border-slate-700/30 p-6 text-center text-slate-500 text-sm">
                  No active challenges
                </Card>
              )}
            </div>
          </section>

          {/* ── Challenge & Match History ── */}
          <section>
            <SectionHeader icon={<History className="h-4 w-4 text-slate-400" />} title="Challenge & Match History" count={historyChallenges.length} />
            <div className="space-y-2">
              {historyChallenges.length > 0 ? historyChallenges.map((c: any) => {
                const isChallenger = c.challenging_team?.id === teamId
                const opponent = isChallenger ? c.challenged_team : c.challenging_team
                const mr = Array.isArray(c.match_result) ? c.match_result[0] : c.match_result
                const isWin = mr?.winner_team_id === teamId
                const score = buildScore(mr, isChallenger)
                const isPlayed = c.status === 'played'
                const isForfeited = c.status === 'forfeited'
                const isDissolved = c.status === 'dissolved'
                const { label, cls } = CHALLENGE_STATUS[c.status] ?? { label: c.status, cls: 'bg-slate-500/20 text-slate-400' }

                return (
                  <Card key={c.id} className={`p-4 border ${
                    isDissolved ? 'bg-slate-800/40 border-slate-700/30' :
                    isPlayed && isWin ? 'bg-emerald-950/20 border-emerald-500/20' :
                    isPlayed ? 'bg-red-950/15 border-red-500/15' :
                    isForfeited ? 'bg-orange-950/15 border-orange-500/15' :
                    'bg-slate-800/40 border-slate-700/30'
                  }`}>
                    <div className="flex items-center gap-3">
                      {/* Outcome icon */}
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        isDissolved ? 'bg-slate-700/50' :
                        isPlayed && isWin ? 'bg-emerald-500/20' :
                        isPlayed ? 'bg-red-500/20' :
                        'bg-orange-500/20'
                      }`}>
                        {isDissolved ? <X className="h-4 w-4 text-slate-400" />
                          : isPlayed && isWin ? <Trophy className="h-4 w-4 text-emerald-400" />
                          : isPlayed ? <Shield className="h-4 w-4 text-red-400" />
                          : <AlertTriangle className="h-4 w-4 text-orange-400" />
                        }
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white truncate">
                            vs {opponent?.name ?? 'Unknown'}
                          </span>
                          <code className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{c.challenge_code}</code>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{label}</span>
                          {isPlayed && mr && (
                            <span className={`text-xs font-semibold ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isWin ? 'Win' : 'Loss'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {score && <span className="text-xs text-slate-300 font-mono">{score}</span>}
                          {mr?.match_date && <span className="text-xs text-slate-500">{fmtDate(mr.match_date)}</span>}
                          {mr && !mr.verified_at && !mr.auto_verified && (
                            <span className="text-xs text-yellow-400">⏳ Pending verification</span>
                          )}
                          {isChallenger
                            ? <span className="text-[10px] text-blue-400">↑ Challenger</span>
                            : <span className="text-[10px] text-yellow-400">↓ Challenged</span>
                          }
                        </div>
                      </div>

                      <Link href={`/challenges/${c.id}`} className="shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-500 hover:text-white">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </Card>
                )
              }) : (
                <Card className="bg-slate-800/40 border-slate-700/30 p-6 text-center text-slate-500 text-sm">
                  No completed challenges
                </Card>
              )}
            </div>
          </section>
        </div>

        {/* ════════════════════ SIDEBAR 1/3 ════════════════════ */}
        <div className="space-y-6">

          {/* ── Ladder Position ── */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-5">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Ladder Position</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Current Rank</span>
                <span className={`text-2xl font-black ${tierRankCls}`}>
                  {position?.rank ? `#${position.rank}` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Tier</span>
                {tierName !== '—'
                  ? <span className={`text-xs px-2 py-0.5 rounded border font-medium ${tierBadge}`}>{tierName}</span>
                  : <span className="text-xs text-slate-400">—</span>
                }
              </div>
              {position?.consecutive_forfeits > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Consecutive Forfeits</span>
                  <span className="text-xs font-bold text-orange-400">{position.consecutive_forfeits}</span>
                </div>
              )}
              {position?.last_challenged_team && (
                <div className="flex justify-between items-start gap-2">
                  <span className="text-xs text-slate-500 shrink-0">Last Challenged</span>
                  <Link href={`/admin/teams/${position.last_challenged_team.id}`} className="text-xs text-right text-blue-400 hover:text-blue-300 truncate">
                    {position.last_challenged_team.name}
                  </Link>
                </div>
              )}
            </div>

            {/* Rank Adjust */}
            {teamStatus !== 'dissolved' && (
              <div className="mt-5 pt-4 border-t border-slate-700/50">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Adjust Rank</p>
                <div className="flex gap-2">
                  <Input
                    type="number" min="1" placeholder={`Current: #${position?.rank ?? '?'}`}
                    value={newRankStr}
                    onChange={e => setNewRankStr(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdjustRank()}
                    className="h-8 text-xs bg-slate-900 border-slate-700 text-white flex-1"
                  />
                  <Button
                    size="sm" onClick={handleAdjustRank}
                    disabled={actioning === 'rank' || !newRankStr}
                    className="h-8 px-3 bg-slate-700 hover:bg-slate-600 text-white text-xs shrink-0"
                  >
                    {actioning === 'rank' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Move'}
                  </Button>
                </div>
                <p className="text-[10px] text-slate-600 mt-1">Teams in between will shift automatically</p>
              </div>
            )}
          </Card>

          {/* ── Match Record ── */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-5">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Match Record</h3>
            {playedChallenges.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase mb-0.5">Played</p>
                    <p className="text-xl font-bold text-white">{playedChallenges.length}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase mb-0.5">Wins</p>
                    <p className="text-xl font-bold text-emerald-400">{wins}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase mb-0.5">Losses</p>
                    <p className="text-xl font-bold text-red-400">{losses}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
                  <span className="text-xs text-slate-500">Win Rate</span>
                  <div className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-blue-400" />
                    <span className="text-sm font-bold text-blue-400">{winPct}%</span>
                  </div>
                </div>
                {/* Recent form dots */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 mr-0.5">Form</span>
                  {playedChallenges.slice(0, 7).map((c: any, i: number) => {
                    const mr = Array.isArray(c.match_result) ? c.match_result[0] : c.match_result
                    const isW = mr?.winner_team_id === teamId
                    return (
                      <span key={i} title={isW ? 'Win' : 'Loss'}
                        className={`inline-block h-2 w-2 rounded-full ${isW ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-2">No matches played yet</p>
            )}
          </Card>

          {/* ── Rank History ── */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-5">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Rank History</h3>
            {history.length > 0 ? (
              <div className="space-y-2">
                {history.map((h: any) => {
                  const info = HISTORY_LABELS[h.change_type] ?? { label: h.change_type, cls: 'text-slate-400' }
                  const moved = h.new_rank != null && h.old_rank != null ? h.new_rank - h.old_rank : null
                  return (
                    <div key={h.id} className="flex items-start gap-2.5 text-xs">
                      <div className="mt-0.5 shrink-0">
                        {moved !== null && moved !== 0
                          ? moved < 0
                            ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                            : <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                          : <History className="h-3.5 w-3.5 text-slate-500" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-medium ${info.cls}`}>{info.label}</span>
                          {h.old_rank != null && h.new_rank != null && (
                            <span className="text-slate-400">#{h.old_rank} → #{h.new_rank}</span>
                          )}
                        </div>
                        {h.notes && <p className="text-slate-500 truncate">{h.notes}</p>}
                        <p className="text-slate-600">{fmtDate(h.created_at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-2">No rank changes recorded</p>
            )}
          </Card>

          {/* ── Partner Change ── */}
          {teamStatus !== 'dissolved' && (
            <Card className="bg-slate-800/60 border-slate-700/50 p-5">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-1">Change Partner</h3>
              <p className="text-xs text-slate-500 mb-4">
                League rule: team drops <span className="text-amber-400 font-medium">{partnerChangeDrop} position{partnerChangeDrop !== 1 ? 's' : ''}</span> when a partner changes.
                Cannot change during an active challenge.
              </p>

              <div className="space-y-3">
                {/* Which slot to replace */}
                <div>
                  <Label className="text-xs text-slate-400 mb-1.5 block">Replace which player?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['player1', 'player2'] as const).map(slot => {
                      const p = slot === 'player1' ? (team.player1 as any) : (team.player2 as any)
                      return (
                        <button
                          key={slot}
                          onClick={() => setPartnerPosition(slot)}
                          className={`p-2 rounded-lg border text-left text-xs transition-all ${
                            partnerPosition === slot
                              ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                              : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-600'
                          }`}
                        >
                          <p className="font-medium truncate">{p?.name ?? '—'}</p>
                          <p className="text-slate-500 truncate text-[10px]">{p?.email ?? ''}</p>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* New player select */}
                <div>
                  <Label className="text-xs text-slate-400 mb-1.5 block">New player</Label>
                  <Select value={newPartnerId} onValueChange={setNewPartnerId}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-xs h-8">
                      <SelectValue placeholder="Select player…" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 max-h-48">
                      {allPlayers
                        .filter(p => p.id !== team.player1?.id && p.id !== team.player2?.id)
                        .map(p => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            {p.name} <span className="text-slate-500">({p.email})</span>
                          </SelectItem>
                        ))
                      }
                    </SelectContent>
                  </Select>
                </div>

                {newPartnerId && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300">
                    ⚠ Team will drop {partnerChangeDrop} position{partnerChangeDrop !== 1 ? 's' : ''} from #{position?.rank ?? '?'} → #{Math.min((position?.rank ?? 1) + partnerChangeDrop, 999)}
                  </div>
                )}

                <Button
                  size="sm"
                  onClick={handlePartnerChange}
                  disabled={!newPartnerId || actioning === 'partner'}
                  className="w-full bg-amber-600 hover:bg-amber-500 text-white text-xs"
                >
                  {actioning === 'partner'
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Changing…</>
                    : 'Confirm Partner Change'
                  }
                </Button>
              </div>
            </Card>
          )}

          {/* ── Team Meta ── */}
          <Card className="bg-slate-800/60 border-slate-700/50 p-5">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">Info</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Member since</span>
                <span className="text-slate-300">{fmtDate(team.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Team type</span>
                <span className="text-slate-300">{team.is_new_team ? 'New' : 'Returning'}</span>
              </div>
              {team.partner_changed && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Partner change</span>
                  <span className="text-orange-400">Yes</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Entry fee</span>
                <span className={team.entry_fee_paid ? 'text-emerald-400' : 'text-red-400'}>
                  {team.entry_fee_paid ? 'Paid' : 'Not paid'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Season pos. updated</span>
                <span className="text-slate-300">{fmtDate(position?.updated_at)}</span>
              </div>
            </div>
          </Card>

        </div>
        {/* End sidebar */}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-slate-400">{icon}</span>
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{title}</h2>
      {count !== undefined && count > 0 && (
        <span className="px-2 py-0.5 bg-slate-700 text-slate-300 rounded-full text-xs font-medium">{count}</span>
      )}
    </div>
  )
}
