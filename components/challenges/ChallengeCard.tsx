'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CountdownTimer } from '@/components/ui/countdown-timer'
import { ChevronRight, AlertCircle, CheckCircle2, Clock } from 'lucide-react'

export interface ChallengeCardProps {
  code: string
  challenger: {
    name: string
    rank: number
  }
  challenged: {
    name: string
    rank: number
  }
  status: 'pending' | 'scheduled' | 'played' | 'forfeited' | 'dissolved'
  timeSlots?: string[]
  deadline: string
  userRole?: 'challenger' | 'challenged' | 'spectator'
  match?: {
    date: string
    location: string
  }
  onAccept?: () => void
  onReject?: () => void
  onReport?: () => void
  onClick?: () => void
}

const statusConfig = {
  pending: {
    badge: 'pending' as const,
    label: 'Pending',
    icon: Clock,
    color: 'text-yellow-400',
  },
  scheduled: {
    badge: 'scheduled' as const,
    label: 'Scheduled',
    icon: CheckCircle2,
    color: 'text-emerald-400',
  },
  played: {
    badge: 'played' as const,
    label: 'Played',
    icon: CheckCircle2,
    color: 'text-blue-400',
  },
  forfeited: {
    badge: 'forfeited' as const,
    label: 'Forfeited',
    icon: AlertCircle,
    color: 'text-red-400',
  },
  dissolved: {
    badge: 'dissolved' as const,
    label: 'Dissolved',
    icon: AlertCircle,
    color: 'text-slate-400',
  },
}

export function ChallengeCard({
  code,
  challenger,
  challenged,
  status,
  timeSlots = [],
  deadline,
  userRole = 'spectator',
  match,
  onAccept,
  onReject,
  onReport,
  onClick,
}: ChallengeCardProps) {
  const config = statusConfig[status]
  const Icon = config.icon
  const canRespond = userRole === 'challenged' && status === 'pending'

  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer transition-all hover:shadow-xl ${
        userRole !== 'spectator' ? 'border-emerald-500/30' : ''
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-mono text-slate-500">{code}</p>
            <CardTitle className="text-lg">
              {challenger.name} vs {challenged.name}
            </CardTitle>
          </div>
          <Badge variant={config.badge} className="flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {config.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Teams Info */}
        <div className="flex items-center justify-between py-3 px-3 bg-slate-800/50 rounded-lg">
          <div className="text-center">
            <p className="text-sm text-slate-400">Challenger</p>
            <p className="font-semibold text-slate-100">{challenger.name}</p>
            <p className="text-xs text-slate-500">Rank #{challenger.rank}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-500" />
          <div className="text-center">
            <p className="text-sm text-slate-400">Challenged</p>
            <p className="font-semibold text-slate-100">{challenged.name}</p>
            <p className="text-xs text-slate-500">Rank #{challenged.rank}</p>
          </div>
        </div>

        {/* Time Slots */}
        {timeSlots.length > 0 && status === 'pending' && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-100">Offered Time Slots</p>
            <div className="space-y-1">
              {timeSlots.map((slot, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 rounded text-sm text-slate-300"
                >
                  <Clock className="h-4 w-4 text-slate-500" />
                  {new Date(slot).toLocaleString()}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Match Details */}
        {match && status === 'scheduled' && (
          <div className="space-y-2 px-3 py-3 bg-slate-800/50 rounded-lg">
            <p className="text-sm font-semibold text-slate-100">Match Details</p>
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">Date:</span> {new Date(match.date).toLocaleString()}
            </p>
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">Location:</span> {match.location}
            </p>
          </div>
        )}

        {/* Deadline */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Deadline:</span>
          <CountdownTimer deadline={deadline} />
        </div>

        {/* Action Buttons */}
        {canRespond && (
          <div className="flex gap-2 pt-2">
            <Button
              onClick={(e) => {
                e.stopPropagation()
                onAccept?.()
              }}
              className="flex-1"
              variant="default"
            >
              Accept
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation()
                onReject?.()
              }}
              className="flex-1"
              variant="outline"
            >
              Reject
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation()
                onReport?.()
              }}
              size="sm"
              variant="ghost"
              title="Report issue"
            >
              Report
            </Button>
          </div>
        )}

        {userRole === 'spectator' && (
          <p className="text-xs text-slate-500 italic">You are viewing this as a spectator</p>
        )}
      </CardContent>
    </Card>
  )
}
