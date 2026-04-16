'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  ArrowLeft, Shield, Mail, Lock, CheckCircle, User,
  Trophy, Zap, Calendar, ChevronRight, RefreshCw,
  Loader2, Edit2, Check, X, Phone, AlertTriangle, KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

// ─── Colour helpers ───────────────────────────────────────────────────────────
const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Platinum: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Gold:     'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Silver:   'bg-slate-400/20 text-slate-300 border-slate-400/40',
  Bronze:   'bg-orange-500/20 text-orange-300 border-orange-500/40',
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${day} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PlayerDetailPage() {
  const params   = useParams()
  const router   = useRouter()
  const playerId = params.id as string
  const supabase = createClient()

  const [loading, setLoading]     = useState(true)
  const [player, setPlayer]       = useState<any>(null)
  const [teams, setTeams]         = useState<any[]>([])
  const [matches, setMatches]     = useState<any[]>([])

  const [actioning, setActioning] = useState<string | null>(null)

  // Inline name-edit state
  const [editingName, setEditingName]   = useState(false)
  const [nameValue, setNameValue]       = useState('')

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [playerRes, teamsRes] = await Promise.all([
        supabase.from('players').select('*').eq('id', playerId).single(),
        supabase.from('teams')
          .select(`
            id, name, status, partner_changed, is_new_team, created_at,
            season:seasons!season_id(id, name, is_active),
            player1:players!player1_id(id, name, email),
            player2:players!player2_id(id, name, email),
            ladder_position:ladder_positions!team_id(rank, status, tier:tiers!tier_id(name))
          `)
          .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
          .order('created_at', { ascending: false }),
      ])

      setPlayer(playerRes.data)
      setNameValue(playerRes.data?.name ?? '')

      const allTeams = teamsRes.data || []
      setTeams(allTeams)

      // Fetch match results for all teams
      const teamIds = allTeams.map((t: any) => t.id).filter(Boolean)
      if (teamIds.length > 0) {
        const { data: matchData } = await supabase
          .from('match_results')
          .select(`
            id, winner_team_id, loser_team_id, match_date, verified_at, auto_verified,
            set1_challenger, set1_challenged, set2_challenger, set2_challenged,
            supertiebreak_challenger, supertiebreak_challenged,
            challenge:challenges!challenge_id(
              id, challenging_team_id,
              challenging_team:teams!challenging_team_id(id, name),
              challenged_team:teams!challenged_team_id(id, name)
            )
          `)
          .or(teamIds.map((id: string) => `winner_team_id.eq.${id},loser_team_id.eq.${id}`).join(','))
          .order('match_date', { ascending: false })
          .limit(15)
        setMatches(matchData || [])
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to load player data')
    } finally {
      setLoading(false)
    }
  }, [playerId, supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleSaveName() {
    if (!nameValue.trim()) return
    setActioning('name')
    try {
      const { error } = await supabase.from('players')
        .update({ name: nameValue.trim() })
        .eq('id', playerId)
      if (error) throw error
      toast.success('Name updated')
      setEditingName(false)
      fetchAll()
    } catch { toast.error('Failed to update name') }
    finally { setActioning(null) }
  }

  async function handleToggleAdmin() {
    const making = !player?.is_admin
    if (making && !confirm(`Grant admin access to ${player?.name}?`)) return
    if (!making && !confirm(`Remove admin access from ${player?.name}?`)) return
    setActioning('admin')
    try {
      const { error } = await supabase.from('players')
        .update({ is_admin: making })
        .eq('id', playerId)
      if (error) throw error
      toast.success(making ? 'Admin access granted' : 'Admin access removed')
      fetchAll()
    } catch { toast.error('Failed to update admin status') }
    finally { setActioning(null) }
  }

  async function handleToggleActive() {
    const activating = !player?.is_active
    if (!activating && !confirm(`Suspend ${player?.name}? They won't be able to log in.`)) return
    setActioning('active')
    try {
      const { error } = await supabase.from('players')
        .update({ is_active: activating })
        .eq('id', playerId)
      if (error) throw error
      toast.success(activating ? 'Account activated' : 'Account suspended')
      fetchAll()
    } catch { toast.error('Failed to update account status') }
    finally { setActioning(null) }
  }

  async function handleResendVerification() {
    setActioning('verify')
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, email: player?.email }),
      })
      if (!res.ok) throw new Error()
      toast.success('Verification email sent')
    } catch { toast.error('Failed to send verification email') }
    finally { setActioning(null) }
  }

  async function handleResetPassword() {
    if (!confirm(`Send a password reset email to ${player?.email}?`)) return
    setActioning('reset')
    try {
      const res = await fetch(`/api/admin/players/${playerId}/reset-password`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`Password reset email sent to ${data.email}`)
    } catch (e: any) { toast.error(e.message) }
    finally { setActioning(null) }
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const teamIds = new Set(teams.map((t: any) => t.id))
  const wins   = matches.filter(m => teamIds.has(m.winner_team_id)).length
  const losses = matches.filter(m => teamIds.has(m.loser_team_id)).length
  const activeTeams   = teams.filter((t: any) => t.status !== 'dissolved')
  const currentTeams  = teams.filter((t: any) => (Array.isArray(t.season) ? t.season[0] : t.season)?.is_active)
  const dissolvedTeams = teams.filter((t: any) => t.status === 'dissolved')

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <div className="h-8 w-48 bg-slate-800 rounded animate-pulse" />
        <div className="h-32 bg-slate-800/60 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-slate-800/60 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!player) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <User className="h-12 w-12 text-slate-600 mx-auto mb-4" />
        <h2 className="text-white font-semibold text-lg mb-2">Player Not Found</h2>
        <Link href="/admin/players"><Button variant="ghost">← Back to Players</Button></Link>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Breadcrumb */}
      <Link href="/admin/players" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="h-4 w-4" />Players
      </Link>

      {/* ── Header Card ── */}
      <Card className="bg-slate-800/60 border-slate-700/50 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            {/* Name + edit */}
            {editingName ? (
              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
                  className="bg-slate-900 border-slate-600 text-white text-xl font-bold h-9 max-w-xs"
                  autoFocus
                />
                <Button size="sm" onClick={handleSaveName} disabled={actioning === 'name'}
                  className="h-9 w-9 p-0 bg-emerald-600 hover:bg-emerald-500">
                  {actioning === 'name' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}
                  className="h-9 w-9 p-0 text-slate-400">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-2xl font-bold text-white">{player.name}</h1>
                <Button size="sm" variant="ghost" onClick={() => setEditingName(true)}
                  className="h-7 w-7 p-0 text-slate-500 hover:text-white">
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {player.is_admin && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-blue-500/20 text-blue-300 border-blue-500/40">
                  <Shield className="h-3 w-3" />Admin
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                player.is_active ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-red-500/20 text-red-300 border-red-500/40'
              }`}>
                {player.is_active ? 'Active' : 'Suspended'}
              </span>
              {player.email_verified ? (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                  <CheckCircle className="h-3 w-3" />Verified
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                  Unverified
                </span>
              )}
            </div>

            {/* Contact */}
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <Mail className="h-3.5 w-3.5 shrink-0" />{player.email}
              </div>
              {player.phone && (
                <div className="flex items-center gap-2 text-slate-400">
                  <Phone className="h-3.5 w-3.5 shrink-0" />{player.phone}
                </div>
              )}
              <p className="text-slate-600 text-xs">Member since {fmtDate(player.created_at)}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-row sm:flex-col gap-2 shrink-0">
            <Button size="sm" variant="outline"
              onClick={handleToggleAdmin}
              disabled={actioning === 'admin'}
              className={`${player.is_admin
                ? 'border-slate-600 text-slate-400 hover:border-red-500/40 hover:text-red-400'
                : 'border-blue-500/40 text-blue-300 hover:bg-blue-500/10'
              }`}>
              {actioning === 'admin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              <span className="ml-1.5">{player.is_admin ? 'Remove Admin' : 'Make Admin'}</span>
            </Button>

            {player.is_active ? (
              <Button size="sm" variant="outline"
                onClick={handleToggleActive}
                disabled={actioning === 'active'}
                className="border-red-500/40 text-red-400 hover:bg-red-500/10">
                {actioning === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                <span className="ml-1.5">Suspend</span>
              </Button>
            ) : (
              <Button size="sm" variant="outline"
                onClick={handleToggleActive}
                disabled={actioning === 'active'}
                className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                {actioning === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                <span className="ml-1.5">Activate</span>
              </Button>
            )}

            {!player.email_verified && (
              <Button size="sm" variant="outline"
                onClick={handleResendVerification}
                disabled={actioning === 'verify'}
                className="border-slate-600 text-slate-400 hover:border-blue-500/40 hover:text-blue-300">
                {actioning === 'verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                <span className="ml-1.5">Resend Verify</span>
              </Button>
            )}

            <Button size="sm" variant="outline"
              onClick={handleResetPassword}
              disabled={actioning === 'reset'}
              className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10">
              {actioning === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              <span className="ml-1.5">Reset Password</span>
            </Button>

            <Button size="sm" variant="ghost" onClick={fetchAll} className="text-slate-500 hover:text-white">
              <RefreshCw className="h-4 w-4" /><span className="ml-1.5">Refresh</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-slate-800/60 border-slate-700/50 p-4 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Teams</p>
          <p className="text-2xl font-bold text-white">{activeTeams.length}</p>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700/50 p-4 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Wins</p>
          <p className="text-2xl font-bold text-emerald-400">{wins}</p>
        </Card>
        <Card className="bg-slate-800/60 border-slate-700/50 p-4 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Losses</p>
          <p className="text-2xl font-bold text-red-400">{losses}</p>
        </Card>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Current / Active Teams */}
        <section>
          <SectionHeader icon={<Trophy className="h-4 w-4 text-emerald-400" />} title="Current Teams" count={currentTeams.length} />
          <div className="space-y-2">
            {currentTeams.length > 0 ? currentTeams.map((team: any) => {
              const pos = Array.isArray(team.ladder_position) ? team.ladder_position[0] : team.ladder_position
              const tier = Array.isArray(pos?.tier) ? pos?.tier[0] : pos?.tier
              const partner = team.player1?.id === playerId ? team.player2 : team.player1
              return (
                <Card key={team.id} className={`p-4 border ${
                  team.status === 'frozen' ? 'bg-blue-900/10 border-blue-700/30' : 'bg-slate-800/60 border-slate-700/50'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-white truncate">{team.name}</p>
                        {tier?.name && (
                          <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${TIER_BADGE[tier.name] ?? ''}`}>
                            {tier.name}
                          </span>
                        )}
                        {pos?.rank && <span className="text-xs font-bold text-emerald-400">#{pos.rank}</span>}
                        {team.status === 'frozen' && (
                          <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded">Frozen</span>
                        )}
                        {team.partner_changed && (
                          <span className="text-xs px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded">Partner Changed</span>
                        )}
                      </div>
                      {partner && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Partner: <Link href={`/admin/players/${partner.id}`} className="text-slate-400 hover:text-white">{partner.name}</Link>
                        </p>
                      )}
                    </div>
                    <Link href={`/admin/teams/${team.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-500 hover:text-white shrink-0">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              )
            }) : (
              <Card className="bg-slate-800/40 border-slate-700/30 p-4 text-center text-slate-500 text-sm">
                Not on any team in the current season
              </Card>
            )}
          </div>
        </section>

        {/* Match History */}
        <section>
          <SectionHeader icon={<Zap className="h-4 w-4 text-slate-400" />} title="Recent Matches" count={matches.length} />
          <div className="space-y-2">
            {matches.length > 0 ? matches.map((m: any) => {
              const isWin = teamIds.has(m.winner_team_id)
              const ch = Array.isArray(m.challenge) ? m.challenge[0] : m.challenge
              const myTeamId = isWin ? m.winner_team_id : m.loser_team_id
              const isChallenger = ch?.challenging_team_id === myTeamId
              const opponentTeam = isChallenger ? ch?.challenged_team : ch?.challenging_team
              const opponentName = (Array.isArray(opponentTeam) ? opponentTeam[0] : opponentTeam)?.name ?? 'Unknown'

              const sets = [
                m.set1_challenger != null ? `${isChallenger ? m.set1_challenger : m.set1_challenged}-${isChallenger ? m.set1_challenged : m.set1_challenger}` : null,
                m.set2_challenger != null ? `${isChallenger ? m.set2_challenger : m.set2_challenged}-${isChallenger ? m.set2_challenged : m.set2_challenger}` : null,
                m.supertiebreak_challenger != null ? `[${isChallenger ? m.supertiebreak_challenger : m.supertiebreak_challenged}-${isChallenger ? m.supertiebreak_challenged : m.supertiebreak_challenger}]` : null,
              ].filter(Boolean).join(', ')

              return (
                <Card key={m.id} className={`p-3 border flex items-center gap-3 ${
                  isWin ? 'bg-emerald-950/20 border-emerald-500/20' : 'bg-red-950/15 border-red-500/15'
                }`}>
                  <span className={`text-xs font-bold px-2 py-1 rounded shrink-0 ${isWin ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                    {isWin ? 'W' : 'L'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">vs {opponentName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {sets && <span className="text-xs text-slate-400 font-mono">{sets}</span>}
                      <span className="text-xs text-slate-600">{fmtDate(m.match_date)}</span>
                      {!m.verified_at && !m.auto_verified && (
                        <span className="text-xs text-yellow-500">⏳ Pending</span>
                      )}
                    </div>
                  </div>
                </Card>
              )
            }) : (
              <Card className="bg-slate-800/40 border-slate-700/30 p-4 text-center text-slate-500 text-sm">
                No matches played yet
              </Card>
            )}
          </div>
        </section>

      </div>

      {/* ── Past Teams (dissolved) ── */}
      {dissolvedTeams.length > 0 && (
        <section>
          <SectionHeader icon={<AlertTriangle className="h-4 w-4 text-slate-500" />} title="Past Teams" count={dissolvedTeams.length} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {dissolvedTeams.map((team: any) => {
              const season = Array.isArray(team.season) ? team.season[0] : team.season
              const partner = team.player1?.id === playerId ? team.player2 : team.player1
              return (
                <Card key={team.id} className="bg-slate-800/30 border-slate-700/30 p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-400 font-medium truncate">{team.name}</p>
                    <p className="text-xs text-slate-600">{season?.name ?? 'Unknown season'} · {partner?.name ?? '—'}</p>
                  </div>
                  <Link href={`/admin/teams/${team.id}`}>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-slate-600 hover:text-white shrink-0">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </Card>
              )
            })}
          </div>
        </section>
      )}

    </div>
  )
}

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
