import React from "react"
import { Badge } from "./badge"

interface TierBadgeProps {
  tier: string
  size?: 'sm' | 'md' | 'lg'
}

const tierConfig = {
  diamond: {
    icon: '💎',
    variant: 'diamond' as const,
    label: 'Diamond',
  },
  platinum: {
    icon: '🔷',
    variant: 'platinum' as const,
    label: 'Platinum',
  },
  gold: {
    icon: '🥇',
    variant: 'gold' as const,
    label: 'Gold',
  },
  silver: {
    icon: '🥈',
    variant: 'silver' as const,
    label: 'Silver',
  },
  bronze: {
    icon: '🥉',
    variant: 'bronze' as const,
    label: 'Bronze',
  },
}

const sizeClasses = {
  sm: 'text-xs px-2 py-1',
  md: 'text-sm px-3 py-1.5',
  lg: 'text-base px-4 py-2',
}

export function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  const normalizedTier = tier.toLowerCase()
  const config = tierConfig[normalizedTier as keyof typeof tierConfig] || tierConfig.silver
  const sizeClass = sizeClasses[size]

  return (
    <Badge variant={config.variant} className={sizeClass}>
      <span className="mr-1">{config.icon}</span>
      {config.label}
    </Badge>
  )
}
