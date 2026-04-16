'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tier, Ticket, TicketType } from '@/types'
import { Trophy, Snowflake, Trash2, GripVertical, Ticket as TicketIcon, ExternalLink } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface TeamRow {
  id: string
  name: string
  status: string
  player1?: { name: string }
  player2?: { name: string }
  ladder_position?: any
}
interface TicketRow extends Ticket {
  team?: { id: string; name: string }
  assigner?: { id: string; name: string }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TIER_COLORS: Record<string, string> = {
  Diamond: 'border-cyan-500/50 bg-cyan-500/5',
  Platinum: 'border-violet-500/50 bg-violet-500/5',
  Gold:     'border-yellow-500/50 bg-yellow-500/5',
  Silver:   'border-slate-400/50 bg-slate-400/5',
  Bronze:   'border-orange-500/50 bg-orange-500/5',
}
const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Platinum: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Gold:     'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Silver:   'bg-slate-400/20 text-slate-300 border-slate-400/40',
  Bronze:   'bg-orange-500/20 text-orange-300 border-orange-500/40',
}
const TICKET_COLORS: Record<string, string> = {
  tier:   'bg-violet-500/20 text-violet-300 border-violet-500/40',
  silver: 'bg-slate-400/20 text-slate-200 border-slate-400/40',
  gold:   'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
}

function resolveTicketStatus(tk: TicketRow): string {
  if (tk.status) return tk.status
  return tk.is_used ? 'used' : 'active'
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LadderManagementPage() {
  const supabase = createClient()
  const [teams, setTeams]   = useState<TeamRow[]>([])
  const [tiers, setTiers]   = useState<Tier[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [seasonId, setSeasonId] = useState('')
  const [activeTab, setActiveTab] = useState('ladder')

  // Rank-adjust state
  const [swappingRank, setSwappingRank] = useState<number | null>(null)
  const [rankError, setRankError]       = useState('')
  const [jumpTargets, setJumpTargets]   = useState<Record<string, string>>({})

  // ── Data ────────────────────────────────────────────────────────────────────
  async function loadData() {
    setLoading(true)
    const { data: seasonData } = await supabase.from('seasons').select('id').eq('is_active', true).single()
    if (!seasonData) { setLoading(false); return }
    setSeasonId(seasonData.id)

    const [{ data: teamsData }, { data: tiersData }] = await Promise.all([
      supabase.from('teams')
        .select('id, name, status, player1:players!player1_id(name), player2:players!player2_id(name), ladder_position:ladder_positions!team_id(rank, status, tier:tiers!tier_id(id, name))')
        .eq('season_id', seasonData.id),
      supabase.from('tiers').select('*').eq('season_id', seasonData.id).order('rank_order', { ascending: true }),
    ])

    setTeams((teamsData || []) as any)
    setTiers(tiersData || [])
    await loadTickets(seasonData.id)
    setLoading(false)
  }

  async function loadTickets(sid?: string) {
    const id = sid || seasonId
    if (!id) return
    const res = await fetch(`/api/admin/tickets?seasonId=${id}`)
    if (res.ok) {
      const data = await res.json()
      setTickets(data.tickets || [])
    }
  }

  useEffect(() => { loadData() }, [])

  // ── Team actions ─────────────────────────────────────────────────────────────
  async function handleFreezeTeam(teamId: string) {
    if (!confirm('Freeze this team? They will drop 1 position immediately.')) return
    await fetch(`/api/teams/${teamId}/freeze`, { method: 'POST' })
    loadData()
  }
  async function handleDissolveTeam(teamId: string) {
    if (!confirm('PERMANENTLY dissolve this team? This cannot be undone.')) return
    await fetch(`/api/teams/${teamId}/dissolve`, { method: 'POST' })
    loadData()
  }

  // ── Rank swap ─────────────────────────────────────────────────────────────────
  async function handleSwap(rankA: number, rankB: number) {
    const teamA = rankToTeam.get(rankA)
    const teamB = rankToTeam.get(rankB)
    if (!teamA || !teamB) return
    if (teamA.status === 'frozen' || teamB.status === 'frozen') return
    setSwappingRank(rankA)
    setRankError('')
    try {
      const res = await fetch('/api/admin/ladder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [{ teamId: teamA.id, newRank: rankB }, { teamId: teamB.id, newRank: rankA }],
          seasonId,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Swap failed')
      await loadData()
    } catch (err) {
      setRankError(err instanceof Error ? err.message : 'Swap failed')
    } finally { setSwappingRank(null) }
  }

  // ── Rank jump ─────────────────────────────────────────────────────────────────
  async function handleJump(teamId: string, fromRank: number, toRank: number) {
    if (fromRank === toRank) return
    setSwappingRank(fromRank)
    setRankError('')
    try {
      const allOccupied = Array.from(rankToTeam.keys()).sort((a, b) => a - b)
      const changes: { teamId: string; newRank: number }[] = []
      if (toRank < fromRank) {
        for (const r of allOccupied) {
          if (r >= toRank && r < fromRank) {
            const t = rankToTeam.get(r)
            if (t && t.id !== teamId) changes.push({ teamId: t.id, newRank: r + 1 })
          }
        }
      } else {
        for (const r of allOccupied) {
          if (r > fromRank && r <= toRank) {
            const t = rankToTeam.get(r)
            if (t && t.id !== teamId) changes.push({ teamId: t.id, newRank: r - 1 })
          }
        }
      }
      changes.push({ teamId, newRank: toRank })
      const res = await fetch('/api/admin/ladder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes, seasonId }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Move failed')
      setJumpTargets(prev => { const next = { ...prev }; delete next[teamId]; return next })
      await loadData()
    } catch (err) {
      setRankError(err instanceof Error ? err.message : 'Move failed')
    } finally { setSwappingRank(null) }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function tierForRank(rank: number): Tier | null {
    return tiers.find(t => rank >= t.min_rank && rank <= (t.max_rank ?? t.min_rank)) ?? null
  }

  const rankToTeam = new Map<number, TeamRow>()
  teams.forEach(t => {
    const pos = Array.isArray(t.ladder_position) ? t.ladder_position[0] : t.ladder_position
    if (pos?.rank) rankToTeam.set(pos.rank, t)
  })

  const tierSections = tiers.map(tier => {
    const slots: Array<{ rank: number; team: TeamRow | null }> = []
    for (let r = tier.min_rank; r <= (tier.max_rank ?? tier.min_rank); r++) {
      slots.push({ rank: r, team: rankToTeam.get(r) ?? null })
    }
    return { tier, slots }
  })

  // Ticket map for TicketBadges
  const ticketsByTeam = new Map<string, TicketRow[]>()
  tickets.forEach(tk => {
    const tid = (tk as any).team_id as string
    if (!tid) return
    if (!ticketsByTeam.has(tid)) ticketsByTeam.set(tid, [])
    ticketsByTeam.get(tid)!.push(tk)
  })

  function TicketBadges({ teamId }: { teamId: string }) {
    const tks = ticketsByTeam.get(teamId) ?? []
    if (tks.length === 0) return null
    return (
      <div className="flex items-center gap-1 flex-wrap mt-1">
        {tks.map(tk => {
          const st = resolveTicketStatus(tk)
          const active = st === 'active'
          const cls = active
            ? TICKET_COLORS[tk.ticket_type] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'
            : 'bg-slate-800/60 text-slate-500 border-slate-700/40 line-through'
          return (
            <span key={tk.id} className={`text-[10px] px-1.5 py-0.5 border rounded font-medium flex items-center gap-0.5 ${cls}`}>
              <TicketIcon className="h-2.5 w-2.5 shrink-0" />
              {tk.ticket_type.charAt(0).toUpperCase() + tk.ticket_type.slice(1)}
              {!active && <span className="text-[9px] opacity-70 ml-0.5">({st})</span>}
            </span>
          )
        })}
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="text-slate-400">Loading…</div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Ladder</h1>
          <p className="text-slate-400 mt-1 text-sm">
            {teams.filter(t => t.status !== 'dissolved').length} active teams across {tiers.length} tiers
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="ladder">
            <Trophy className="w-4 h-4 mr-2" />Ladder View
          </TabsTrigger>
          <TabsTrigger value="adjust">
            <GripVertical className="w-4 h-4 mr-2" />Rank Adjust
          </TabsTrigger>
        </TabsList>

        {/* ── Ladder View ──────────────────────────────────────────────────── */}
        <TabsContent value="ladder" className="space-y-6 mt-4">
          {tierSections.length === 0 ? (
            <Card className="bg-slate-800/60 border-slate-700 p-12 text-center">
              <p className="text-slate-400">No tiers configured for this season. Set up tiers in Settings → Tier Configuration.</p>
            </Card>
          ) : (
            tierSections.map(({ tier, slots }) => (
              <div key={tier.id} className="space-y-2">
                {/* Tier header */}
                <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${TIER_COLORS[tier.name] ?? 'border-slate-700/50 bg-slate-800/30'}`}>
                  <div className="flex items-center gap-3">
                    <Trophy className="h-5 w-5 text-slate-400" />
                    <div>
                      <h2 className="font-semibold text-white">{tier.name} Tier</h2>
                      <p className="text-xs text-slate-500">
                        Ranks {tier.min_rank}–{tier.max_rank ?? tier.min_rank} · {slots.filter(s => s.team).length}/{slots.length} filled
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded border font-medium ${TIER_BADGE[tier.name] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
                    {tier.name}
                  </span>
                </div>

                {/* Position rows */}
                <div className="space-y-1">
                  {slots.map(({ rank, team }) => {
                    const pos = team ? (Array.isArray(team.ladder_position) ? team.ladder_position[0] : team.ladder_position) : null
                    const status = pos?.status ?? 'active'
                    return (
                      <div key={rank} className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                        team
                          ? status === 'frozen' ? 'bg-blue-900/20 border-blue-700/40' : 'bg-slate-800/60 border-slate-700/50 hover:bg-slate-800/80'
                          : 'bg-slate-900/30 border-slate-800/50 border-dashed'
                      }`}>
                        <div className="w-10 text-center shrink-0">
                          <span className={`text-lg font-bold ${team ? 'text-emerald-400' : 'text-slate-600'}`}>#{rank}</span>
                        </div>
                        {team ? (
                          <>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-white truncate">{team.name}</span>
                                {status === 'frozen' && (
                                  <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded">Frozen</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 truncate">{team.player1?.name} & {team.player2?.name}</p>
                              <TicketBadges teamId={team.id} />
                            </div>
                            <Badge variant={team.status === 'active' ? 'default' : team.status === 'frozen' ? 'secondary' : 'destructive'} className="text-xs shrink-0">
                              {team.status}
                            </Badge>
                            <div className="flex items-center gap-1 shrink-0">
                              <Link href={`/admin/teams/${team.id}`}>
                                <Button size="sm" variant="ghost" className="text-slate-400 hover:bg-slate-700 h-7 w-7 p-0" title="View team details">
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </Button>
                              </Link>
                              {team.status === 'active' && (
                                <Button size="sm" variant="ghost" onClick={() => handleFreezeTeam(team.id)} className="text-blue-400 hover:bg-blue-400/10 h-7 w-7 p-0" title="Freeze team">
                                  <Snowflake className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => handleDissolveTeam(team.id)} className="text-red-400 hover:bg-red-400/10 h-7 w-7 p-0" title="Dissolve team">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 text-slate-600 text-sm italic">Vacant</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}

          {/* Teams outside all tier ranges */}
          {(() => {
            const rankedTeamIds = new Set(Array.from(rankToTeam.values()).map(t => t.id))
            const unranked = teams.filter(t => !rankedTeamIds.has(t.id) && t.status !== 'dissolved')
            if (unranked.length === 0) return null
            return (
              <div className="space-y-2">
                <div className="px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
                  <div className="text-amber-400 font-medium text-sm">⚠ Teams outside defined tier ranges ({unranked.length}) — assign a rank within a tier</div>
                </div>
                {unranked.map(team => (
                  <div key={team.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-700/40 bg-amber-900/10">
                    <div className="w-10 text-center text-slate-600 text-lg font-bold">–</div>
                    <div className="flex-1">
                      <span className="font-medium text-white">{team.name}</span>
                      <p className="text-xs text-slate-400">{team.player1?.name} & {team.player2?.name}</p>
                    </div>
                    <Link href={`/admin/teams/${team.id}`}>
                      <Button size="sm" variant="ghost" className="text-slate-400 hover:bg-slate-700 h-7 w-7 p-0">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => handleDissolveTeam(team.id)} className="text-red-400 hover:bg-red-400/10 h-7 w-7 p-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )
          })()}
        </TabsContent>

        {/* ── Rank Adjust ───────────────────────────────────────────────────── */}
        <TabsContent value="adjust" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">
              Use <span className="text-white font-medium">↑ ↓</span> to swap one step, or type a rank number and press <span className="text-white font-medium">Enter</span> (or →) to jump multiple positions. Frozen teams cannot be moved.
            </p>
            {swappingRank !== null && (
              <span className="text-sm text-slate-400 animate-pulse">Saving…</span>
            )}
          </div>

          {rankError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">{rankError}</div>
          )}

          <div className="space-y-6">
            {tierSections.map(({ tier, slots }) => {
              const filledSlots = slots.filter(s => s.team)
              if (filledSlots.length === 0) return null
              return (
                <div key={tier.id} className="space-y-1">
                  <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${TIER_COLORS[tier.name] ?? 'border-slate-700/50 bg-slate-800/30'}`}>
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${TIER_BADGE[tier.name] ?? ''}`}>{tier.name}</span>
                    <span className="text-xs text-slate-500">Ranks {tier.min_rank}–{tier.max_rank ?? tier.min_rank}</span>
                  </div>

                  {slots.map(({ rank, team }) => {
                    if (!team) return null
                    const isFrozen = team.status === 'frozen'
                    const isSwapping = swappingRank === rank

                    const allSorted = tierSections
                      .flatMap(s => s.slots)
                      .filter(s => s.team)
                      .sort((a, b) => a.rank - b.rank)
                    const myIndex = allSorted.findIndex(s => s.rank === rank)
                    const prevSlot = allSorted[myIndex - 1]
                    const nextSlot = allSorted[myIndex + 1]
                    const canMoveUp   = !isFrozen && !!prevSlot && prevSlot.team?.status !== 'frozen'
                    const canMoveDown = !isFrozen && !!nextSlot && nextSlot.team?.status !== 'frozen'

                    return (
                      <div key={rank} className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
                        isSwapping ? 'bg-emerald-900/20 border-emerald-700/40'
                          : isFrozen ? 'bg-blue-900/10 border-blue-700/30 opacity-60'
                          : 'bg-slate-800/60 border-slate-700/50'
                      }`}>
                        {/* Up/Down */}
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onClick={() => canMoveUp && handleSwap(rank, prevSlot!.rank)}
                            disabled={!canMoveUp || swappingRank !== null}
                            className={`w-7 h-6 rounded text-xs font-bold flex items-center justify-center transition-colors ${
                              canMoveUp && swappingRank === null
                                ? 'bg-slate-700 hover:bg-emerald-600 text-white cursor-pointer'
                                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                            }`}
                          >▲</button>
                          <button
                            onClick={() => canMoveDown && handleSwap(rank, nextSlot!.rank)}
                            disabled={!canMoveDown || swappingRank !== null}
                            className={`w-7 h-6 rounded text-xs font-bold flex items-center justify-center transition-colors ${
                              canMoveDown && swappingRank === null
                                ? 'bg-slate-700 hover:bg-emerald-600 text-white cursor-pointer'
                                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                            }`}
                          >▼</button>
                        </div>

                        {/* Rank */}
                        <div className="w-10 text-center shrink-0">
                          <span className="text-base font-bold text-emerald-400">#{rank}</span>
                        </div>

                        {/* Team info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">{team.name}</span>
                            {isFrozen && <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded">Frozen</span>}
                          </div>
                          <p className="text-xs text-slate-400">{team.player1?.name} & {team.player2?.name}</p>
                        </div>

                        {/* Tier badge */}
                        <span className={`text-xs px-2 py-1 rounded border font-medium hidden sm:inline shrink-0 ${TIER_BADGE[tierForRank(rank)?.name ?? ''] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/40'}`}>
                          {tierForRank(rank)?.name ?? '—'}
                        </span>

                        {/* Detail link */}
                        <Link href={`/admin/teams/${team.id}`}>
                          <Button size="sm" variant="ghost" className="text-slate-400 hover:bg-slate-700 h-7 w-7 p-0 shrink-0" title="View team details">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </Link>

                        {/* Jump-to input */}
                        {!isFrozen && (
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number" min={1} max={rankToTeam.size}
                              placeholder={String(rank)}
                              value={jumpTargets[team.id] ?? ''}
                              disabled={swappingRank !== null}
                              onChange={e => setJumpTargets(prev => ({ ...prev, [team.id]: e.target.value }))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const t = parseInt(jumpTargets[team.id] ?? '')
                                  if (!isNaN(t) && t !== rank && t >= 1) handleJump(team.id, rank, t)
                                }
                                if (e.key === 'Escape') setJumpTargets(prev => { const n = { ...prev }; delete n[team.id]; return n })
                              }}
                              className="w-14 h-7 px-1.5 text-xs text-center bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              disabled={!jumpTargets[team.id] || swappingRank !== null}
                              onClick={() => {
                                const t = parseInt(jumpTargets[team.id] ?? '')
                                if (!isNaN(t) && t !== rank && t >= 1) handleJump(team.id, rank, t)
                              }}
                              className={`h-7 px-2 rounded text-xs font-medium transition-colors ${
                                jumpTargets[team.id] && swappingRank === null
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                              }`}
                            >→</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
