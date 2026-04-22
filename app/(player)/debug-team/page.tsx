'use client'

import { useTeam } from '@/context/TeamContext'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY DEBUG PAGE — remove before going to production
// Visit /debug-team while logged in to see the raw team data
// ─────────────────────────────────────────────────────────────────────────────

export default function DebugTeamPage() {
  const context = useTeam()
  const [authUser, setAuthUser]     = useState<any>(null)
  const [allTeams, setAllTeams]     = useState<any>(null)
  const [seasonTeams, setSeasonTeams] = useState<any>(null)
  const [storedVal, setStoredVal]   = useState<string | null>(null)
  const [queryErr, setQueryErr]     = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const run = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setAuthUser(user)
      if (!user) return

      // What's in localStorage?
      const storageKey = `cpl_active_team_${user.id}`
      setStoredVal(localStorage.getItem(storageKey) ?? '(not set)')

      // Query 1: ALL teams this player is on (no season, no status filter)
      // This shows if the second team exists at all in the DB
      const q1 = await supabase
        .from('teams')
        .select('id, name, status, season_id, player1_id, player2_id')
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
      setAllTeams({ data: q1.data, error: q1.error?.message ?? null })

      // Query 2: Teams filtered to active season + active/frozen status
      // (mirrors exactly what TeamContext does)
      const seasonRes = await supabase
        .from('seasons')
        .select('id, name, is_active')
        .order('created_at', { ascending: false })

      if (seasonRes.error) {
        setQueryErr('Season query failed: ' + seasonRes.error.message)
        return
      }

      const activeSeason = seasonRes.data?.find(s => s.is_active)

      if (!activeSeason) {
        setQueryErr('No active season found in the seasons table!')
        setSeasonTeams({ data: seasonRes.data, error: 'No active season' })
        return
      }

      const q2 = await supabase
        .from('teams')
        .select('id, name, status, season_id')
        .eq('season_id', activeSeason.id)
        .in('status', ['active', 'frozen'])
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)

      setSeasonTeams({
        activeSeason,
        data: q2.data,
        error: q2.error?.message ?? null,
        contextSeasonId: context.seasonId,
        seasonMatch: context.seasonId === activeSeason.id,
      })
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.seasonId])

  return (
    <div className="p-4 min-h-screen bg-white text-black font-mono text-sm">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">🔍 Team Switcher Debug</h1>
        <p className="text-gray-500 text-xs mb-6">
          Share a screenshot of this page to diagnose the team switcher issue.
        </p>

        <Row label="Auth User ID">
          {authUser?.id ?? 'Loading…'}
        </Row>
        <Row label="Auth Email">
          {authUser?.email ?? '—'}
        </Row>

        <Divider />

        <Row label="Context: loading">
          {String(context.loading)}
        </Row>
        <Row label="Context: seasonId (from layout)">
          {context.seasonId || '⚠️  EMPTY — TeamProvider not mounted!'}
        </Row>
        <Row label="Context: teams.length">
          {String(context.teams.length)}
        </Row>
        <Row label="Context: activeTeam">
          {context.activeTeam
            ? `${context.activeTeam.name} (id: ${context.activeTeam.id})`
            : '⚠️  null'}
        </Row>

        <Divider />

        <Row label="localStorage saved team ID">
          {storedVal ?? 'Loading…'}
        </Row>

        <Divider />

        <Block label="Context: full teams array (what the app has)">
          {JSON.stringify(context.teams, null, 2)}
        </Block>

        <Divider />

        <Block label="DB Query 1: ALL teams for this player (no filters)">
          {queryErr
            ? `ERROR: ${queryErr}`
            : JSON.stringify(allTeams, null, 2)}
        </Block>

        <Divider />

        <Block label="DB Query 2: Current-season active/frozen teams (mirrors TeamContext)">
          {JSON.stringify(seasonTeams, null, 2)}
        </Block>

        <div className="mt-8 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-xs">
          <strong>How to read this:</strong><br />
          • If &quot;Query 1&quot; shows 2 teams but &quot;Query 2&quot; shows only 1 → the missing team has wrong status or season_id<br />
          • If &quot;Context: seasonId&quot; ≠ &quot;Query 2: activeSeason.id&quot; → season mismatch bug<br />
          • If &quot;Context: teams.length&quot; = 1 → only 1 team in this season → nothing to switch
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-gray-100">
      <span className="text-gray-500 w-64 shrink-0 text-xs">{label}</span>
      <span className="text-black font-semibold text-xs break-all">{children}</span>
    </div>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="my-4">
      <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">{label}</p>
      <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-auto whitespace-pre-wrap break-all leading-relaxed">
        {children ?? 'Loading…'}
      </pre>
    </div>
  )
}

function Divider() {
  return <div className="my-4 border-t border-gray-200" />
}
