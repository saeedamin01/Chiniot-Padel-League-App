'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Trophy, Swords, Globe, MessageCircle } from 'lucide-react'
import { useChat } from '@/context/ChatContext'

export function BottomNav() {
  const pathname = usePathname()
  const { totalUnread } = useChat()

  const tabs = [
    { href: '/dashboard',  label: 'Home',         icon: LayoutDashboard, badge: 0 },
    { href: '/ladder',     label: 'Ladder',        icon: Trophy,          badge: 0 },
    { href: '/challenges', label: 'My Challenges', icon: Swords,          badge: 0 },
    { href: '/chat',       label: 'Chat',          icon: MessageCircle,   badge: totalUnread },
    { href: '/league',     label: 'League',        icon: Globe,           badge: 0 },
  ]

  return (
    <nav className={[
      'fixed bottom-0 left-0 right-0 z-50 md:hidden pwa-bottom-nav',
      'bg-white/95 border-t border-slate-200 backdrop-blur-xl',
      'dark:bg-slate-950/95 dark:border-slate-700/50',
    ].join(' ')}>
      <div className="flex items-stretch justify-around h-16">
        {tabs.map(({ href, label, icon: Icon, badge }) => {
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
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-emerald-500" />
              )}
              <div className="relative">
                <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 1.8} />
                {badge > 0 && (
                  <span className={[
                    'absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5',
                    'rounded-full bg-emerald-500 text-slate-950 text-[9px] font-bold',
                    'flex items-center justify-center border border-white dark:border-slate-950',
                  ].join(' ')}>
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              <span className={`font-medium ${label.length > 10 ? 'text-[9px] tracking-normal' : 'text-[10px] tracking-wide'}`}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
