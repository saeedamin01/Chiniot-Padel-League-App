'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { History, Calendar, Trophy, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TierBadge } from '@/components/ui/tier-badge'

interface SnapshotRow {
  rank:    number
  team_id: string
  team:    string
  p1:      string
  p2:      string
  tier:    string
  status:  string
  w:       number
  l:       number
}

interface Snapshot {
  id:            string
  snapshot_date: string
  data:          SnapshotRow[]
  created_at:    string
}

export default function LadderHistoryPage() {
  const supabase = createClient()
  const [snapshots, setSnapshots]       = useState<Snapshot[]>([])
  const [selected, setSelected]         = useState<Snapshot | null>(null)
  const [compared, setCompared]         = useState<Snapshot | null>(null)
  const [loading, setLoading]           = useState(true)
  const [snapping, setSnapping]         = useState(false)

  useEffect(() => {
    fetchSnapshots()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSnapshots() {
    setLoading(true)
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) { setLoading(false); return }

    const { data } = await supabase
      .from('ladder_snapshots')
      .select('id, snapshot_date, data, created_at')
      .eq('season_id', season.id)
      .order('snapshot_date', { ascending: false })
      .limit(7)

    const snaps = (data || []) as Snapshot[]
    setSnapshots(snaps)
    if (snaps.length > 0) setSelected(snaps[0])
    setLoading(false)
  }

  // Take a manual snapshot now (calls cron endpoint)
  async function takeSnapshot() {
    setSnapping(true)
    try {
      const res = await fetch('/api/cron/ladder-snapshot', {
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}` },
      })
      // Admin takes snapshot via dedicated admin API instead
      const adminRes = await fetch('/api/admin/ladder-snapshot', { method: 'POST' })
      if (adminRes.ok) {
        await fetchSnapshots()
      }
    } finally {
      setSnapping(false)
    }
  }

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })

  // Compute rank diff between selected and compared snapshot for a given team
  function rankDiff(teamId: string): number | null {
    if (!compared || !selected) return null
    const a = selected.data.find(r => r.team_id === teamId)
    const b = compared.data.find(r => r.team_id === teamId)
    if (!a || !b) return null
    return b.rank - a.rank // positive = moved up (rank number decreased)
  }

  const RankDiff = ({ teamId }: { teamId: string }) => {
    if (!compared) return null
    const diff = rankDiff(teamId)
    if (diff === null) return <span className="text-xs text-slate-600 ml-1">new</span>
    if (diff === 0)    return <Minus className="h-3 w-3 text-slate-600 ml-1" />
    if (diff > 0) return (
      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400 ml-1 font-semibold">
        <TrendingUp className="h-3 w-3" />+{diff}
      </span>
    )
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-red-400 ml-1 font-semibold">
        <TrendingDown className="h-3 w-3" />{diff}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-800/50 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <History className="h-6 w-6 text-emerald-400" />
            Ladder History
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Daily snapshots of the ladder — last 7 days. Saved automatically at 2am each day.
          </p>
        </div>
        <Button
          size="sm"
          onClick={takeSnapshot}
          disabled={snapping}
          className="bg-emerald-500 hover:bg-emerald-600 text-xs shrink-0"
        >
          {snapping
            ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          Save Snapshot Now
        </Button>
      </div>

      {snapshots.length === 0 ? (
        <Card className="bg-slate-800/60 border-slate-700/50 p-12 text-center">
          <History className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium mb-1">No snapshots yet</p>
          <p className="text-slate-500 text-sm mb-4">
            The first snapshot will be saved automatically tonight at 2am,
            or click &quot;Save Snapshot Now&quot; above.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">

          {/* ── Sidebar: date picker ── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Select Date</p>
            {snapshots.map(snap => (
              <button
                key={snap.id}
                onClick={() => setSelected(snap)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                  selected?.id === snap.id
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                    : 'bg-slate-800/40 border-slate-700/40 text-slate-300 hover:bg-slate-700/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="text-sm font-medium">
                    {new Date(snap.snapshot_date + 'T00:00:00').toLocaleDateString('en-GB', {
                      weekday: 'short', day: 'numeric', month: 'short',
                    })}
                  </span>
                  {snapshots[0]?.id === snap.id && (
                    <span className="ml-auto text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-medium">
                      Latest
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 ml-5">{snap.data.length} teams</p>
              </button>
            ))}

            {/* Compare toggle */}
            {snapshots.length > 1 && selected && (
              <div className="pt-3 border-t border-slate-700/50 mt-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Compare With</p>
                {snapshots.filter(s => s.id !== selected.id).map(snap => (
                  <button
                    key={snap.id}
                    onClick={() => setCompared(compared?.id === snap.id ? null : snap)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors mb-1 ${
                      compared?.id === snap.id
                        ? 'bg-violet-500/15 border-violet-500/40 text-white'
                        : 'bg-slate-800/30 border-slate-700/30 text-slate-400 hover:bg-slate-700/30'
                    }`}
                  >
                    {new Date(snap.snapshot_date + 'T00:00:00').toLocaleDateString('en-GB', {
                      weekday: 'short', day: 'numeric', month: 'short',
                    })}
                  </button>
                ))}
                {compared && (
                  <p className="text-[11px] text-violet-400 mt-1 text-center">
                    Showing movement vs {new Date(compared.snapshot_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Main: ladder table ── */}
          {selected && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Trophy className="h-5 w-5 text-emerald-400" />
                <h2 className="font-bold text-white text-lg">{fmtDate(selected.snapshot_date)}</h2>
                <span className="text-xs text-slate-500">
                  {new Date(selected.created_at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </span>
              </div>

              <Card className="bg-slate-800/60 border-slate-700/50 overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[48px_1fr_80px_60px] gap-2 px-4 py-2 border-b border-slate-700/50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  <span>Rank</span>
                  <span>Team</span>
                  <span>Tier</span>
                  <span className="text-right">W / L</span>
                </div>

                <div className="divide-y divide-slate-700/30">
                  {selected.data.map(row => (
                    <div
                      key={row.team_id}
                      className={`grid grid-cols-[48px_1fr_80px_60px] gap-2 px-4 py-2.5 items-center ${
                        row.status === 'frozen' ? 'opacity-50' : ''
                      }`}
                    >
                      {/* Rank */}
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-white tabular-nums text-sm">#{row.rank}</span>
                        <RankDiff teamId={row.team_id} />
                      </div>

                      {/* Team */}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {row.team}
                          {row.status === 'frozen' && (
                            <span className="ml-1.5 text-[10px] text-blue-400 font-normal">❄️ frozen</span>
                          )}
                        </p>
                        {(row.p1 || row.p2) && (
                          <p className="text-xs text-slate-500 truncate">
                            {[row.p1, row.p2].filter(Boolean).join(' & ')}
                          </p>
                        )}
                      </div>

                      {/* Tier */}
                      <div>
                        {row.tier && <TierBadge tier={row.tier} />}
                      </div>

                      {/* W/L */}
                      <div className="text-right text-xs tabular-nums">
                        <span className="text-emerald-400 font-semibold">{row.w}</span>
                        <span className="text-slate-600 mx-0.5">/</span>
                        <span className="text-red-400 font-semibold">{row.l}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
