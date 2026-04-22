'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Trophy, Swords, Globe, Check, Users } from 'lucide-react'
import { useTeam } from '@/context/TeamContext'

// ── Tier colour map ──────────────────────────────────────────────────────────
// Each entry has three slots:
//   tab  — the icon/label colour on the bottom bar tab
//   dot  — the small indicator dot on the Users icon
//   text — the secondary text inside the team sheet card
//   card — the card background for active vs inactive team rows
const TIER_COLORS: Record<string, {
  tab:  string
  dot:  string
  text: string
}> = {
  Diamond:  {
    tab:  'text-cyan-600  dark:text-cyan-400',
    dot:  'bg-cyan-500',
    text: 'text-cyan-700  dark:text-cyan-300',
  },
  Platinum: {
    tab:  'text-violet-600 dark:text-violet-400',
    dot:  'bg-violet-500',
    text: 'text-violet-700 dark:text-violet-300',
  },
  Gold: {
    tab:  'text-amber-600  dark:text-yellow-400',
    dot:  'bg-amber-500',
    text: 'text-amber-700  dark:text-yellow-300',
  },
  Silver: {
    tab:  'text-slate-500  dark:text-slate-300',
    dot:  'bg-slate-400',
    text: 'text-slate-600  dark:text-slate-200',
  },
  Bronze: {
    tab:  'text-orange-600 dark:text-orange-400',
    dot:  'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-300',
  },
}

const DEFAULT_COLORS = {
  tab:  'text-emerald-600 dark:text-emerald-400',
  dot:  'bg-emerald-500',
  text: 'text-emerald-700 dark:text-emerald-300',
}

export function BottomNav() {
  const pathname = usePathname()
  const { teams, activeTeam, switchTeam } = useTeam()
  const [sheetOpen, setSheetOpen] = useState(false)

  const tierColors = TIER_COLORS[activeTeam?.tierName ?? ''] ?? DEFAULT_COLORS
  const canSwitch  = teams.length >= 2

  const tabs = [
    { href: '/dashboard',  label: 'Home',       icon: LayoutDashboard },
    { href: '/ladder',     label: 'Ladder',     icon: Trophy          },
    { href: '/challenges', label: 'Challenges', icon: Swords          },
    { href: '/league',     label: 'League',     icon: Globe           },
  ]

  return (
    <>
      {/* ── Team sheet — slides up from bottom when Team tab is tapped ── */}
      {sheetOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            onClick={() => setSheetOpen(false)}
          />

          {/* Sheet panel */}
          <div className={[
            'fixed bottom-0 left-0 right-0 z-[70] rounded-t-2xl pwa-bottom-nav',
            // Light: white with border + shadow; Dark: dark slate
            'bg-white border-t border-slate-200 shadow-2xl',
            'dark:bg-slate-900 dark:border-slate-700/60',
          ].join(' ')}>

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>

            <div className="px-4 pb-2">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {canSwitch ? 'Switch Team' : 'Your Team'}
                </p>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  Close
                </button>
              </div>

              {/* Team list */}
              <div className="flex flex-col gap-2">
                {teams.length === 0 && (
                  <p className="text-sm text-slate-400 dark:text-slate-500 italic py-2 text-center">
                    No teams found for this season.
                  </p>
                )}

                {teams.map(team => {
                  const tc       = TIER_COLORS[team.tierName ?? ''] ?? DEFAULT_COLORS
                  const isActive = team.id === activeTeam?.id

                  return (
                    <button
                      key={team.id}
                      onClick={() => { switchTeam(team.id); setSheetOpen(false) }}
                      disabled={isActive && !canSwitch}
                      className={[
                        'flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all w-full',
                        isActive
                          // Active: green tint, border
                          ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/15 dark:border-emerald-500/40'
                          // Inactive: light gray tint
                          : 'bg-slate-50 border border-slate-200 active:bg-slate-100 dark:bg-slate-800/60 dark:border-slate-700/40 dark:active:bg-slate-700/60',
                      ].join(' ')}
                    >
                      {/* Tier colour dot */}
                      <div className={`w-3 h-3 rounded-full shrink-0 ${tc.dot}`} />

                      {/* Team info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                          {team.name}
                        </div>
                        <div className={`text-xs mt-0.5 ${tc.text}`}>
                          {team.tierName ?? 'Unranked'}
                          {team.rank ? ` · #${team.rank}` : ''}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                          {team.player1Name} &amp; {team.player2Name}
                        </div>
                      </div>

                      {/* Active checkmark */}
                      {isActive && (
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Active
                          </span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Bottom breathing room above home indicator */}
            <div className="h-5" />
          </div>
        </>
      )}

      {/* ── Bottom nav bar ── */}
      <nav className={[
        'fixed bottom-0 left-0 right-0 z-50 md:hidden pwa-bottom-nav',
        // Light: white, border; Dark: very dark bg
        'bg-white/95 border-t border-slate-200 backdrop-blur-xl',
        'dark:bg-slate-950/95 dark:border-slate-700/50',
      ].join(' ')}>

        <div className="flex items-stretch justify-around h-16">

          {/* Regular nav tabs */}
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
              || (href !== '/dashboard' && pathname.startsWith(href))

            return (
              <Link
                key={href}
                href={href}
                className={[
                  'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 relative transition-colors',
                  active
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300',
                ].join(' ')}
              >
                {/* Active indicator line */}
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-emerald-500" />
                )}
                <Icon
                  className="h-5 w-5"
                  strokeWidth={active ? 2.5 : 1.8}
                />
                <span className="text-[10px] font-medium tracking-wide">
                  {label}
                </span>
              </Link>
            )
          })}

          {/* ── Team tab — always rendered, always tappable ── */}
          <button
            onClick={() => setSheetOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 relative transition-colors"
          >
            {/* Users icon with tier-coloured dot */}
            <div className="relative">
              <Users
                className={`h-5 w-5 ${activeTeam ? tierColors.tab : 'text-slate-400 dark:text-slate-500'}`}
                strokeWidth={1.8}
              />
              {activeTeam && (
                <span className={[
                  'absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full',
                  'border-2 border-white dark:border-slate-950',
                  tierColors.dot,
                ].join(' ')} />
              )}
            </div>

            <span className={`text-[10px] font-medium tracking-wide ${
              activeTeam ? tierColors.tab : 'text-slate-400 dark:text-slate-500'
            }`}>
              {canSwitch ? 'Teams' : 'Team'}
            </span>
          </button>

        </div>
      </nav>
    </>
  )
}
