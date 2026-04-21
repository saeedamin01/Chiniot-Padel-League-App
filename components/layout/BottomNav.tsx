'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Trophy, Swords, Globe, User, ChevronUp, Check, Users } from 'lucide-react'
import { useTeam } from '@/context/TeamContext'

const tabs = [
  { href: '/dashboard',  label: 'Home',       icon: LayoutDashboard },
  { href: '/ladder',     label: 'Ladder',     icon: Trophy          },
  { href: '/challenges', label: 'Challenges', icon: Swords          },
  { href: '/league',     label: 'League',     icon: Globe           },
  { href: '/profile',    label: 'Profile',    icon: User            },
]

const TIER_COLORS: Record<string, string> = {
  Diamond:  'text-cyan-300 border-cyan-500/50 bg-cyan-500/10',
  Platinum: 'text-violet-300 border-violet-500/50 bg-violet-500/10',
  Gold:     'text-yellow-300 border-yellow-500/50 bg-yellow-500/10',
  Silver:   'text-slate-200 border-slate-400/50 bg-slate-400/10',
  Bronze:   'text-orange-300 border-orange-500/50 bg-orange-500/10',
}

function TeamSwitcherStrip() {
  const { teams, activeTeam, switchTeam } = useTeam()
  const [open, setOpen] = useState(false)

  // Only show when player is on 2+ teams
  if (!activeTeam || teams.length < 2) return null

  const tierCls = TIER_COLORS[activeTeam.tierName ?? ''] ?? 'text-slate-300 border-slate-500/50 bg-slate-500/10'

  return (
    <>
      {/* Expanded picker — sits above the strip */}
      {open && (
        <div className="border-t border-slate-700/50 bg-slate-950/98 px-3 py-2 flex flex-col gap-1">
          {teams.map(team => {
            const tc = TIER_COLORS[team.tierName ?? ''] ?? 'text-slate-300'
            const isActive = team.id === activeTeam.id
            return (
              <button
                key={team.id}
                onClick={() => { switchTeam(team.id); setOpen(false) }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors w-full
                  ${isActive
                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                    : 'border border-transparent hover:bg-slate-800/60'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{team.name}</div>
                  <div className={`text-xs ${tc}`}>
                    {team.tierName ?? 'Unranked'}{team.rank ? ` · #${team.rank}` : ''}
                  </div>
                </div>
                {isActive && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}

      {/* Compact strip — always visible when 2+ teams */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full px-4 py-1.5 border-t border-slate-700/50 bg-slate-900/80"
      >
        <div className="flex items-center gap-2">
          <Users className="h-3 w-3 text-slate-400 shrink-0" />
          <span className="text-[11px] text-slate-400">Team:</span>
          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${tierCls}`}>
            {activeTeam.name}
            {activeTeam.tierName && <span className="opacity-70 font-normal"> · {activeTeam.tierName}</span>}
          </span>
        </div>
        <ChevronUp className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
    </>
  )
}

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden pwa-bottom-nav
                 bg-slate-950/95 backdrop-blur-xl border-t border-slate-700/50"
    >
      <TeamSwitcherStrip />
      <div className="flex items-stretch justify-around h-16">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`
                flex flex-col items-center justify-center gap-1 flex-1 py-2
                transition-colors relative
                ${active ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}
              `}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-emerald-400" />
              )}
              <Icon className={`h-5 w-5 ${active ? 'text-emerald-400' : ''}`} strokeWidth={active ? 2.5 : 1.8} />
              <span className={`text-[10px] font-medium tracking-wide ${active ? 'text-emerald-400' : ''}`}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
