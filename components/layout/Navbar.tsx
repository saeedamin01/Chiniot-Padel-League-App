'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Trophy, LogOut, Settings, Shield, ChevronDown, Users } from 'lucide-react'
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
  { href: '/challenges', label: 'Challenges' },
  { href: '/league', label: 'League' },
]

const TIER_COLORS: Record<string, string> = {
  Diamond:  'text-cyan-400 border-cyan-400/40 bg-cyan-400/10',
  Platinum: 'text-violet-400 border-violet-400/40 bg-violet-400/10',
  Gold:     'text-yellow-400 border-yellow-400/40 bg-yellow-400/10',
  Silver:   'text-slate-300 border-slate-300/40 bg-slate-300/10',
  Bronze:   'text-orange-400 border-orange-400/40 bg-orange-400/10',
}

function TeamSwitcher() {
  const { teams, activeTeam, switchTeam } = useTeam()

  // Don't render if player has no teams or only 1 team
  if (!activeTeam) return null

  const tierClass = TIER_COLORS[activeTeam.tierName ?? ''] ?? 'text-slate-400 border-slate-600 bg-slate-800'

  // Single team — just show the badge, no dropdown
  if (teams.length === 1) {
    return (
      <div className={`hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${tierClass}`}>
        <Users className="h-3 w-3" />
        <span>{activeTeam.name}</span>
        {activeTeam.rank && <span className="opacity-60">#{activeTeam.rank}</span>}
      </div>
    )
  }

  // Multiple teams — show switcher dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-opacity hover:opacity-80 ${tierClass}`}>
          <Users className="h-3 w-3" />
          <span>{activeTeam.name}</span>
          {activeTeam.rank && <span className="opacity-60">#{activeTeam.rank}</span>}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56 bg-slate-900 border-slate-700">
        <DropdownMenuLabel className="text-slate-400 text-xs">Switch Active Team</DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-slate-700" />
        {teams.map(team => {
          const tc = TIER_COLORS[team.tierName ?? ''] ?? 'text-slate-400'
          const isActive = team.id === activeTeam.id
          return (
            <DropdownMenuItem
              key={team.id}
              onClick={() => switchTeam(team.id)}
              className={`cursor-pointer gap-2 ${isActive ? 'bg-slate-800' : ''}`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">{team.name}</span>
                  {isActive && (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/30">
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
        <DropdownMenuSeparator className="bg-slate-700" />
        <div className="px-2 py-1.5 text-[11px] text-slate-500 leading-tight">
          Actions (challenges, freeze) apply to your active team.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <nav className="sticky top-0 z-40 border-b border-slate-700 bg-slate-950/95 backdrop-blur supports-[backdrop-filter]:bg-slate-950/60 pwa-header">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 md:h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Trophy className="h-6 w-6 text-emerald-500" />
            <span className="text-xl font-bold gradient-text">CPL</span>
          </Link>

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

          {/* Team Switcher — centre */}
          <TeamSwitcher />

          {/* Right Side */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Notifications */}
            <NotificationBell />

            {/* User Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-slate-800/80 dark:hover:bg-slate-800/80 hover:bg-slate-100/80 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">
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
