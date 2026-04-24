'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Trophy, LogOut, Settings, Shield, ChevronDown, Users, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useTeam } from '@/context/TeamContext'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { ChatBell } from '@/components/layout/ChatBell'

interface NavbarProps {
  isAdmin?: boolean
  userAvatar?: string
  userName?: string
  userEmail?: string
  onLogout?: () => void
}

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/ladder', label: 'Ladder' },
  { href: '/challenges', label: 'My Challenges' },
  { href: '/league', label: 'League' },
  { href: '/chat', label: 'Chat' },
]

const TIER_COLORS: Record<string, string> = {
  Diamond:  'text-cyan-700   dark:text-cyan-400   border-cyan-400/40   bg-cyan-500/10',
  Platinum: 'text-violet-700 dark:text-violet-400 border-violet-400/40 bg-violet-500/10',
  Gold:     'text-amber-700  dark:text-yellow-400 border-yellow-400/40 bg-amber-500/10',
  Silver:   'text-slate-600  dark:text-slate-300  border-slate-400/40  bg-slate-400/10',
  Bronze:   'text-orange-700 dark:text-orange-400 border-orange-400/40 bg-orange-500/10',
}

const TIER_DOT: Record<string, string> = {
  Diamond:  'bg-cyan-500',
  Platinum: 'bg-violet-500',
  Gold:     'bg-amber-500',
  Silver:   'bg-slate-400',
  Bronze:   'bg-orange-500',
}

const TIER_TEXT: Record<string, string> = {
  Diamond:  'text-cyan-700 dark:text-cyan-300',
  Platinum: 'text-violet-700 dark:text-violet-300',
  Gold:     'text-amber-700 dark:text-yellow-300',
  Silver:   'text-slate-600 dark:text-slate-200',
  Bronze:   'text-orange-700 dark:text-orange-300',
}

function TeamSwitcher() {
  const { teams, activeTeam, switchTeam } = useTeam()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!activeTeam) return null

  const tierClass = TIER_COLORS[activeTeam.tierName ?? ''] ?? 'text-slate-400 border-slate-600 bg-slate-800'
  const canSwitch = teams.length >= 2

  // Truncate team name for mobile pill
  const shortName = activeTeam.name.length > 14
    ? activeTeam.name.slice(0, 13) + '…'
    : activeTeam.name

  return (
    <>
      {/* ── Mobile pill (shown on all screens, triggers bottom sheet) ── */}
      <button
        onClick={() => setSheetOpen(true)}
        className={`md:hidden flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-opacity hover:opacity-80 ${tierClass}`}
      >
        <Users className="h-3 w-3 shrink-0" />
        <span className="max-w-[100px] truncate">{shortName}</span>
        {activeTeam.rank && <span className="opacity-60">#{activeTeam.rank}</span>}
        {canSwitch && <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />}
      </button>

      {/* ── Desktop dropdown (md+) ── */}
      {canSwitch ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`hidden md:flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-opacity hover:opacity-80 ${tierClass}`}>
              <Users className="h-3 w-3 shrink-0" />
              <span>{activeTeam.name}</span>
              {activeTeam.rank && <span className="opacity-60">#{activeTeam.rank}</span>}
              <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-56">
            <DropdownMenuLabel className="text-muted-foreground text-xs">Switch Active Team</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {teams.map(team => {
              const tc = TIER_COLORS[team.tierName ?? ''] ?? 'text-slate-500 dark:text-slate-400'
              const isActive = team.id === activeTeam.id
              return (
                <DropdownMenuItem
                  key={team.id}
                  onClick={() => switchTeam(team.id)}
                  className={`cursor-pointer gap-2 ${isActive ? 'bg-emerald-500/10' : ''}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-sm font-medium">{team.name}</span>
                      {isActive && (
                        <span className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/30">
                          Active
                        </span>
                      )}
                    </div>
                    <div className={`text-xs mt-0.5 ${tc}`}>
                      {team.tierName ?? 'Unranked'}{team.rank ? ` · #${team.rank}` : ''}
                    </div>
                  </div>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground leading-tight">
              Actions (challenges, freeze) apply to your active team.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className={`hidden md:flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${tierClass}`}>
          <Users className="h-3 w-3 shrink-0" />
          <span>{activeTeam.name}</span>
          {activeTeam.rank && <span className="opacity-60">#{activeTeam.rank}</span>}
        </div>
      )}

      {/* ── Mobile bottom sheet ── */}
      {sheetOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            onClick={() => setSheetOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-2xl bg-white border-t border-slate-200 shadow-2xl dark:bg-slate-900 dark:border-slate-700/60">
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>
            <div className="px-4 pb-2">
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
              <div className="flex flex-col gap-2">
                {teams.map(team => {
                  const isActive = team.id === activeTeam.id
                  const dot = TIER_DOT[team.tierName ?? ''] ?? 'bg-slate-400'
                  const txt = TIER_TEXT[team.tierName ?? ''] ?? 'text-slate-500'
                  return (
                    <button
                      key={team.id}
                      onClick={() => { switchTeam(team.id); setSheetOpen(false) }}
                      disabled={isActive && !canSwitch}
                      className={[
                        'flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all w-full',
                        isActive
                          ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/15 dark:border-emerald-500/40'
                          : 'bg-slate-50 border border-slate-200 active:bg-slate-100 dark:bg-slate-800/60 dark:border-slate-700/40',
                      ].join(' ')}
                    >
                      <div className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">
                          {team.name}
                        </div>
                        <div className={`text-xs mt-0.5 ${txt}`}>
                          {team.tierName ?? 'Unranked'}{team.rank ? ` · #${team.rank}` : ''}
                        </div>
                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                          {team.player1Name} &amp; {team.player2Name}
                        </div>
                      </div>
                      {isActive && (
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Active</span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="h-5" />
          </div>
        </>
      )}
    </>
  )
}

export function Navbar({
  isAdmin = false,
  userAvatar,
  userName = 'User',
  userEmail,
  onLogout,
}: NavbarProps) {
  // Build initials: up to 2 words → first letter each
  const initials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
  const pathname = usePathname()
  const isActive = (href: string) => pathname.startsWith(href)

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pwa-header shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 md:h-16 items-center justify-between">
          {/* Logo + mobile team pill */}
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/" className="flex items-center gap-2">
              <Trophy className="h-6 w-6 text-emerald-600" />
              <span className="text-xl font-bold gradient-text">CPL</span>
            </Link>
            <TeamSwitcher />
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <Button variant={isActive(link.href) ? 'default' : 'ghost'} size="sm" className="text-sm">
                  {link.label}
                </Button>
              </Link>
            ))}
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Chat */}
            <ChatBell />

            {/* Notifications */}
            <NotificationBell />

            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <Avatar className="h-8 w-8 ring-2 ring-emerald-500/40 ring-offset-2 ring-offset-background transition-all">
                    <AvatarImage src={userAvatar} alt={userName} />
                    <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-sm font-bold tracking-wide select-none">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400 hidden sm:block" />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-60 p-0 overflow-hidden">
                {/* Profile header */}
                <div className="flex items-center gap-3 px-4 py-3.5 bg-gradient-to-br from-emerald-500/10 to-teal-600/5 border-b border-border">
                  <Avatar className="h-11 w-11 ring-2 ring-emerald-500/50 ring-offset-2 ring-offset-background shrink-0">
                    <AvatarImage src={userAvatar} alt={userName} />
                    <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold text-base select-none">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{userName}</p>
                    {userEmail && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{userEmail}</p>
                    )}
                    {isAdmin && (
                      <span className="inline-block mt-1 text-[10px] bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded-full border border-amber-500/25 font-medium">
                        Admin
                      </span>
                    )}
                  </div>
                </div>

                {/* Menu items */}
                <div className="p-1.5">
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="cursor-pointer flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm">
                      <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>Profile &amp; Settings</span>
                    </Link>
                  </DropdownMenuItem>

                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin" className="cursor-pointer flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm">
                        <Shield className="h-4 w-4 text-amber-500 shrink-0" />
                        <span>Admin Panel</span>
                      </Link>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuSeparator className="my-1.5" />

                  <DropdownMenuItem
                    onClick={onLogout}
                    className="cursor-pointer flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-500 focus:text-red-500 focus:bg-red-500/10"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            </div>
        </div>
      </div>
    </nav>
  )
}
