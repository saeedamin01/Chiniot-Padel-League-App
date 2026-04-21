'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Trophy, Swords, Globe, User, ChevronDown, Check, Users } from 'lucide-react'
import { useTeam } from '@/context/TeamContext'

const TIER_COLORS: Record<string, { tab: string; dot: string; sheet: string }> = {
  Diamond:  { tab: 'text-cyan-400',   dot: 'bg-cyan-400',   sheet: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10'   },
  Platinum: { tab: 'text-violet-400', dot: 'bg-violet-400', sheet: 'text-violet-300 border-violet-500/40 bg-violet-500/10' },
  Gold:     { tab: 'text-yellow-400', dot: 'bg-yellow-400', sheet: 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10' },
  Silver:   { tab: 'text-slate-300',  dot: 'bg-slate-300',  sheet: 'text-slate-200 border-slate-400/40 bg-slate-400/10'  },
  Bronze:   { tab: 'text-orange-400', dot: 'bg-orange-400', sheet: 'text-orange-300 border-orange-500/40 bg-orange-500/10' },
}
const DEFAULT_COLORS = { tab: 'text-emerald-400', dot: 'bg-emerald-400', sheet: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' }

export function BottomNav() {
  const pathname = usePathname()
  const { teams, activeTeam, switchTeam } = useTeam()
  const [sheetOpen, setSheetOpen] = useState(false)

  const canSwitch = teams.length >= 2
  const tierColors = TIER_COLORS[activeTeam?.tierName ?? ''] ?? DEFAULT_COLORS

  // Tabs — for multi-team players, replace Profile with Team switcher
  const tabs = [
    { href: '/dashboard',  label: 'Home',       icon: LayoutDashboard },
    { href: '/ladder',     label: 'Ladder',     icon: Trophy          },
    { href: '/challenges', label: 'Challenges', icon: Swords          },
    { href: '/league',     label: 'League',     icon: Globe           },
  ]

  return (
    <>
      {/* Team picker sheet — slides up when tapped */}
      {sheetOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
          />
          {/* Sheet */}
          <div className="fixed bottom-0 left-0 right-0 z-[70] bg-slate-900 rounded-t-2xl border-t border-slate-700/60 pwa-bottom-nav">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-600" />
            </div>
            <div className="px-4 pb-2">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Switch Team</p>
              <div className="flex flex-col gap-2">
                {teams.map(team => {
                  const tc = TIER_COLORS[team.tierName ?? ''] ?? DEFAULT_COLORS
                  const isActive = team.id === activeTeam?.id
                  return (
                    <button
                      key={team.id}
                      onClick={() => { switchTeam(team.id); setSheetOpen(false) }}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all w-full
                        ${isActive
                          ? 'bg-emerald-500/15 border border-emerald-500/40'
                          : 'bg-slate-800/60 border border-slate-700/40 active:bg-slate-700/60'}`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${tc.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-white">{team.name}</div>
                        <div className={`text-xs mt-0.5 ${tc.sheet.split(' ')[0]}`}>
                          {team.tierName ?? 'Unranked'}{team.rank ? ` · #${team.rank}` : ''}
                        </div>
                      </div>
                      {isActive && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
            {/* Extra bottom padding so last item clears the home indicator */}
            <div className="h-4" />
          </div>
        </>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden pwa-bottom-nav
                      bg-slate-950/95 backdrop-blur-xl border-t border-slate-700/50">
        <div className="flex items-stretch justify-around h-16">

          {/* Regular nav tabs */}
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center justify-center gap-1 flex-1 py-2
                  transition-colors relative
                  ${active ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
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

          {/* 5th slot — Team switcher (multi-team) or Profile (single-team) */}
          {canSwitch ? (
            <button
              onClick={() => setSheetOpen(true)}
              className="flex flex-col items-center justify-center gap-1 flex-1 py-2 relative transition-colors"
            >
              {/* Tier colour dot indicator */}
              <div className="relative">
                <Users className={`h-5 w-5 ${tierColors.tab}`} strokeWidth={1.8} />
                <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-slate-950 ${tierColors.dot}`} />
              </div>
              <span className={`text-[10px] font-medium tracking-wide ${tierColors.tab}`}>
                Team
              </span>
            </button>
          ) : (
            <Link
              href="/profile"
              className={`flex flex-col items-center justify-center gap-1 flex-1 py-2
                transition-colors relative
                ${pathname === '/profile' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {pathname === '/profile' && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-emerald-400" />
              )}
              <User className={`h-5 w-5 ${pathname === '/profile' ? 'text-emerald-400' : ''}`} strokeWidth={pathname === '/profile' ? 2.5 : 1.8} />
              <span className={`text-[10px] font-medium tracking-wide ${pathname === '/profile' ? 'text-emerald-400' : ''}`}>
                Profile
              </span>
            </Link>
          )}

        </div>
      </nav>
    </>
  )
}
