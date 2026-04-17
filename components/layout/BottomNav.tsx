'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Trophy, Swords, Globe, User } from 'lucide-react'

const tabs = [
  { href: '/dashboard',  label: 'Home',       icon: LayoutDashboard },
  { href: '/ladder',     label: 'Ladder',     icon: Trophy          },
  { href: '/challenges', label: 'Challenges', icon: Swords          },
  { href: '/league',     label: 'League',     icon: Globe           },
  { href: '/profile',    label: 'Profile',    icon: User            },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden pwa-bottom-nav
                 bg-slate-950/95 backdrop-blur-xl border-t border-slate-700/50"
    >
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
              {/* Active indicator dot */}
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
