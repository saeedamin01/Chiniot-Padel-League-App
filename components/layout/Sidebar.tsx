'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Trophy,
  Users,
  Zap,
  Settings,
  BookOpen,
  Calendar,
  Menu,
  X,
  ListOrdered,
  History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { cn } from '@/lib/utils'

interface SidebarProps {
  isAdmin?: boolean
}

const sidebarLinks = [
  {
    title: 'Dashboard',
    href: '/admin',
    icon: LayoutDashboard,
  },
  {
    title: 'Teams',
    href: '/admin/teams',
    icon: Users,
  },
  {
    title: 'Ladder',
    href: '/admin/ladder',
    icon: ListOrdered,
  },
  {
    title: 'Ladder History',
    href: '/admin/ladder-history',
    icon: History,
  },
  {
    title: 'Challenges',
    href: '/admin/challenges',
    icon: Zap,
  },
  {
    title: 'Season Management',
    href: '/admin/seasons',
    icon: Calendar,
  },
  {
    title: 'Players',
    href: '/admin/players',
    icon: Users,
  },
  {
    title: 'Audit Log',
    href: '/admin/audit',
    icon: BookOpen,
  },
  {
    title: 'Settings',
    href: '/admin/settings',
    icon: Settings,
  },
]

export function Sidebar({ isAdmin = false }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  if (!isAdmin) {
    return null
  }

  return (
    <>
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-20 left-4 z-40 rounded-lg p-2 bg-slate-800 text-slate-100 md:hidden"
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-16 left-0 z-30 w-64 border-r border-slate-700 bg-slate-900 transition-transform duration-200 md:translate-x-0 md:static md:inset-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          <nav className="flex-1 space-y-1 p-4">
            {sidebarLinks.map((link) => {
              const Icon = link.icon
              const active = isActive(link.href)

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                >
                  <Button
                    variant={active ? 'default' : 'ghost'}
                    className={cn(
                      'w-full justify-start gap-3 text-sm',
                      active && 'bg-emerald-500 text-slate-950 hover:bg-emerald-600'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {link.title}
                  </Button>
                </Link>
              )
            })}
          </nav>

          {/* Exit Admin + Footer */}
          <div className="border-t border-slate-700 p-4 space-y-3">
            <Link href="/dashboard" onClick={() => setIsOpen(false)}>
              <Button variant="outline" className="w-full justify-start gap-3 text-sm text-slate-300 border-slate-600 hover:bg-slate-800">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Exit Admin Panel
              </Button>
            </Link>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Admin Panel</p>
                <p className="text-xs font-semibold text-slate-100 mt-1">Chiniot Padel League</p>
              </div>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-slate-950/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
