'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch — only render icon after mount
  useEffect(() => setMounted(true), [])

  // Reserve the exact space during SSR so layout doesn't shift
  if (!mounted) return <div className="w-9 h-9" />

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={[
        'relative rounded-lg p-2 transition-colors',
        // Light mode: slate icon, hover with light-gray tint
        'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        // Dark mode overrides
        'dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200',
      ].join(' ')}
    >
      {isDark
        ? <Sun  className="h-5 w-5 text-yellow-500" />
        : <Moon className="h-5 w-5" />
      }
    </button>
  )
}
