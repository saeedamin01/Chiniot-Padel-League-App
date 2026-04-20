'use client'

import React, { useState } from 'react'
import { ChevronDown, Users, Check } from 'lucide-react'
import { useTeam } from '@/context/TeamContext'

const TIER_COLORS: Record<string, { bar: string; badge: string }> = {
  Diamond:  { bar: 'bg-cyan-950/80 border-cyan-700/40',   badge: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/15' },
  Platinum: { bar: 'bg-violet-950/80 border-violet-700/40', badge: 'text-violet-300 border-violet-500/40 bg-violet-500/15' },
  Gold:     { bar: 'bg-yellow-950/80 border-yellow-700/40', badge: 'text-yellow-300 border-yellow-500/40 bg-yellow-500/15' },
  Silver:   { bar: 'bg-slate-800/80 border-slate-600/40',  badge: 'text-slate-200 border-slate-400/40 bg-slate-400/15' },
  Bronze:   { bar: 'bg-orange-950/80 border-orange-700/40', badge: 'text-orange-300 border-orange-500/40 bg-orange-500/15' },
}

const DEFAULT_COLORS = {
  bar: 'bg-slate-900/80 border-slate-700/40',
  badge: 'text-slate-300 border-slate-500/40 bg-slate-500/15',
}

export function TeamBar() {
  const { teams, activeTeam, switchTeam } = useTeam()
  const [open, setOpen] = useState(false)

  // Only show on mobile (md:hidden), only when player is on 2+ teams
  if (!activeTeam || teams.length < 2) return null

  const colors = TIER_COLORS[activeTeam.tierName ?? ''] ?? DEFAULT_COLORS

  return (
    <div className={`pwa-team-bar border-b ${colors.bar} backdrop-blur-sm`}>
      <div className="max-w-7xl mx-auto px-4">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 py-2 w-full"
          aria-label="Switch active team"
        >
          <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="text-xs text-slate-400 shrink-0">Active team:</span>
          <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${colors.badge}`}>
            {activeTeam.name}
            {activeTeam.tierName && (
              <span className="opacity-70 font-normal">· {activeTeam.tierName}</span>
            )}
            {activeTeam.rank && (
              <span className="opacity-60 font-normal">#{activeTeam.rank}</span>
            )}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {open && (
          <div className="pb-2 flex flex-col gap-1">
            {teams.map(team => {
              const tc = TIER_COLORS[team.tierName ?? ''] ?? DEFAULT_COLORS
              const isActive = team.id === activeTeam.id
              return (
                <button
                  key={team.id}
                  onClick={() => { switchTeam(team.id); setOpen(false) }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors
                    ${isActive ? 'bg-emerald-500/10 border border-emerald-500/30' : 'hover:bg-slate-800/60 border border-transparent'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">{team.name}</div>
                    <div className={`text-xs ${tc.badge.split(' ')[0]}`}>
                      {team.tierName ?? 'Unranked'}{team.rank ? ` · #${team.rank}` : ''}
                    </div>
                  </div>
                  {isActive && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
