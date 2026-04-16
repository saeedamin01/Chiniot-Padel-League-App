'use client'

import React, { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'

interface CountdownTimerProps {
  deadline: string | Date
  onExpire?: () => void
  showSeconds?: boolean
}

function formatTimeRemaining(ms: number, showSeconds: boolean = false) {
  if (ms <= 0) {
    return 'Expired'
  }

  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (showSeconds && seconds < 60) {
    return `${seconds}s`
  }

  if (seconds < 3600) {
    return `${minutes}m ${seconds % 60}s`
  }

  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`
  }

  return `${days}d ${hours % 24}h`
}

export function CountdownTimer({
  deadline,
  onExpire,
  showSeconds = false,
}: CountdownTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>('--:--')
  const [isExpired, setIsExpired] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const updateTimer = () => {
      const deadlineDate = new Date(deadline)
      const now = new Date()
      const ms = deadlineDate.getTime() - now.getTime()

      if (ms <= 0) {
        setTimeRemaining('Expired')
        setIsExpired(true)
        onExpire?.()
      } else {
        setTimeRemaining(formatTimeRemaining(ms, showSeconds))
        setIsExpired(false)
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [deadline, onExpire, showSeconds, mounted])

  const isLowTime = timeRemaining.includes('h') === false &&
                   timeRemaining !== 'Expired' &&
                   !timeRemaining.includes('d')

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono text-sm font-semibold ${
      isExpired
        ? 'bg-red-500/10 border border-red-500/30 text-red-400'
        : isLowTime
        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
        : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
    }`}>
      <Clock className="w-4 h-4" />
      <span>{timeRemaining}</span>
    </div>
  )
}
