'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface ActiveTeam {
  id: string
  name: string
  status: string
  rank: number | null
  tierName: string | null
  tierColor: string | null
  player1Id: string
  player2Id: string
  player1Name: string
  player2Name: string
}

interface TeamContextValue {
  teams: ActiveTeam[]          // all teams this player is on
  activeTeam: ActiveTeam | null
  switchTeam: (teamId: string) => void
  loading: boolean
  refresh: () => void
  seasonId: string
}

const TeamContext = createContext<TeamContextValue>({
  teams: [],
  activeTeam: null,
  switchTeam: () => {},
  loading: true,
  refresh: () => {},
  seasonId: '',
})

export function TeamProvider({
  children,
  userId,
  seasonId,
}: {
  children: React.ReactNode
  userId: string
  seasonId: string
}) {
  const supabase = createClient()
  const [teams, setTeams] = useState<ActiveTeam[]>([])
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const STORAGE_KEY = `cpl_active_team_${userId}`

  const loadTeams = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('teams')
      .select(`
        id, name, status,
        player1:players!player1_id(id, name),
        player2:players!player2_id(id, name),
        ladder_position:ladder_positions!team_id(
          rank,
          tier:tiers!tier_id(name, color)
        )
      `)
      .eq('season_id', seasonId)
      .in('status', ['active', 'frozen'])
      .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)

    if (error || !data) {
      setLoading(false)
      return
    }

    const mapped: ActiveTeam[] = data.map((t: any) => {
      const pos = Array.isArray(t.ladder_position) ? t.ladder_position[0] : t.ladder_position
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        rank: pos?.rank ?? null,
        tierName: pos?.tier?.name ?? null,
        tierColor: pos?.tier?.color ?? null,
        player1Id: t.player1?.id ?? '',
        player2Id: t.player2?.id ?? '',
        player1Name: t.player1?.name ?? '',
        player2Name: t.player2?.name ?? '',
      }
    })

    setTeams(mapped)

    // Restore saved selection, fall back to first team
    const saved = localStorage.getItem(STORAGE_KEY)
    const valid = mapped.find(t => t.id === saved)
    if (valid) {
      setActiveTeamId(valid.id)
    } else if (mapped.length > 0) {
      setActiveTeamId(mapped[0].id)
      localStorage.setItem(STORAGE_KEY, mapped[0].id)
    }

    setLoading(false)
  }, [supabase, userId, seasonId, STORAGE_KEY])

  useEffect(() => {
    loadTeams()
  }, [loadTeams])

  function switchTeam(teamId: string) {
    const found = teams.find(t => t.id === teamId)
    if (found) {
      setActiveTeamId(found.id)
      localStorage.setItem(STORAGE_KEY, found.id)
    }
  }

  const activeTeam = teams.find(t => t.id === activeTeamId) ?? null

  return (
    <TeamContext.Provider value={{ teams, activeTeam, switchTeam, loading, refresh: loadTeams, seasonId }}>
      {children}
    </TeamContext.Provider>
  )
}

export function useTeam() {
  return useContext(TeamContext)
}
