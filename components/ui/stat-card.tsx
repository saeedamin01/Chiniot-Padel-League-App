import React from "react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  color?: string
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  color = 'emerald',
}: StatCardProps) {
  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-emerald-400" />
      case 'down':
        return <TrendingDown className="w-4 h-4 text-red-400" />
      case 'neutral':
      default:
        return <Minus className="w-4 h-4 text-slate-400" />
    }
  }

  const colorClasses = {
    emerald: 'text-emerald-400',
    cyan: 'text-cyan-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    slate: 'text-slate-400',
  }

  const colorClass = colorClasses[color as keyof typeof colorClasses] || colorClasses.emerald

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-6 shadow-lg">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-400">{title}</p>
          <p className="mt-2 text-3xl font-bold text-slate-100">{value}</p>
          {subtitle && (
            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={cn("rounded-lg bg-slate-700/50 p-3", colorClass)}>
            {icon}
          </div>
        )}
      </div>
      {trendValue && trend && (
        <div className="mt-4 flex items-center gap-2">
          {getTrendIcon()}
          <span className={cn(
            "text-sm font-medium",
            trend === 'up' ? 'text-emerald-400' :
            trend === 'down' ? 'text-red-400' :
            'text-slate-400'
          )}>
            {trendValue}
          </span>
        </div>
      )}
    </div>
  )
}
